import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import type {
  ElasticsearchLogSinkConfig,
  FileLogSinkConfig,
  LogSinkConfig,
  LogSinkRetryConfig,
  WebhookLogSinkConfig,
} from '../config/gateway.config';
import type { CallLog } from '../database/entities/call-log.entity';
import type {
  LogSinkBatchPayload,
  LogSinkDeliveryState,
  LogSinkRuntimeStatus,
} from './log-sink.types';

interface QueueItem {
  record: Record<string, unknown>;
}

interface NormalizedSinkRuntime {
  key: string;
  batchSize: number;
  flushIntervalMs: number;
  maxQueue: number;
  overflow: 'drop_oldest' | 'drop_newest';
  retry: Required<LogSinkRetryConfig>;
}

interface SinkState {
  queue: QueueItem[];
  flushing: boolean;
  timer?: NodeJS.Timeout;
  delivered: number;
  dropped: number;
  failedBatches: number;
  lastStatus: LogSinkDeliveryState;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

const SAFE_LOG_FIELDS = [
  'request_id',
  'timestamp',
  'source_format',
  'tier',
  'score',
  'node_id',
  'model',
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
  'cost_usd',
  'latency_ms',
  'status_code',
  'is_fallback',
  'structured_output_requested',
  'structured_output_type',
  'structured_output_strategy',
  'structured_output_supported',
  'structured_output_schema_name',
  'session_key',
  'error',
  'api_key_name',
  'api_key_id',
  'retry_count',
  'experiment_group',
];

const DEFAULT_EXCLUDED_FIELDS = [
  'prompt',
  'response',
  'request_body',
  'response_body',
  'messages',
  'content',
  'raw_headers',
  'headers',
  'authorization',
  'provider_key',
  'provider_api_key',
  'api_key',
  'password',
  'secret',
  'token',
  'bearer',
];

@Injectable()
export class LogSinkService implements OnModuleDestroy {
  private readonly logger = new Logger(LogSinkService.name);
  private readonly states = new Map<string, SinkState>();
  private readonly unsupportedWarned = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    for (const state of this.states.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
    }
    await this.flushForTests();
  }

  enqueue(log: CallLog): void {
    const logging = this.config.logSinks;
    if (!logging.enabled) return;

    logging.sinks.forEach((sink, index) => {
      if (sink.enabled === false) return;
      const runtime = this.normalizeSink(sink, index);
      const record = this.buildLogRecord(log, sink);
      this.enqueueRecord(sink, runtime, record);
    });
  }

  getStatus(): LogSinkRuntimeStatus[] {
    const logging = this.config.logSinks;
    return logging.sinks.map((sink, index) => {
      const runtime = this.normalizeSink(sink, index);
      const state = this.stateFor(runtime.key);
      return {
        name: runtime.key,
        type: sink.type,
        enabled: logging.enabled && sink.enabled !== false,
        queued: state.queue.length,
        delivered: state.delivered,
        dropped: state.dropped,
        failed_batches: state.failedBatches,
        last_status: state.lastStatus,
        last_error: state.lastError,
        last_success_at: state.lastSuccessAt,
        last_failure_at: state.lastFailureAt,
      };
    });
  }

  async flushForTests(): Promise<void> {
    const logging = this.config.logSinks;
    for (const [index, sink] of logging.sinks.entries()) {
      if (sink.enabled === false) continue;
      const runtime = this.normalizeSink(sink, index);
      const state = this.stateFor(runtime.key);
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      while (state.queue.length > 0) {
        await this.flushSink(sink, runtime);
      }
    }
  }

  buildLogRecordForTests(
    log: Partial<CallLog> & Record<string, unknown>,
    sink: Partial<LogSinkConfig> = {},
  ): Record<string, unknown> {
    return this.buildLogRecord(log as CallLog, sink as LogSinkConfig);
  }

  private enqueueRecord(
    sink: LogSinkConfig,
    runtime: NormalizedSinkRuntime,
    record: Record<string, unknown>,
  ): void {
    const state = this.stateFor(runtime.key);
    if (state.queue.length >= runtime.maxQueue) {
      state.dropped += 1;
      state.lastStatus = 'dropped';
      if (runtime.overflow === 'drop_newest') {
        return;
      }
      state.queue.shift();
    }

    state.queue.push({ record });
    state.lastStatus = 'queued';
    this.scheduleFlush(sink, runtime, state.queue.length >= runtime.batchSize ? 0 : runtime.flushIntervalMs);
  }

  private scheduleFlush(
    sink: LogSinkConfig,
    runtime: NormalizedSinkRuntime,
    delayMs: number,
  ): void {
    const state = this.stateFor(runtime.key);
    if (state.flushing || state.queue.length === 0) return;
    if (state.timer && delayMs > 0) return;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.flushSink(sink, runtime);
    }, delayMs);
    state.timer.unref?.();
  }

  private async flushSink(
    sink: LogSinkConfig,
    runtime: NormalizedSinkRuntime,
  ): Promise<void> {
    const state = this.stateFor(runtime.key);
    if (state.flushing || state.queue.length === 0) return;

    state.flushing = true;
    const items = state.queue.splice(0, runtime.batchSize);
    const batch = items.map((item) => item.record);
    let lastError: Error | null = null;

    try {
      for (let attempt = 1; attempt <= runtime.retry.attempts; attempt += 1) {
        try {
          await this.deliverBatch(sink, batch, runtime.retry.timeout_ms);
          state.delivered += batch.length;
          state.lastStatus = 'sent';
          state.lastError = null;
          state.lastSuccessAt = new Date().toISOString();
          return;
        } catch (err) {
          lastError = err as Error;
          if (attempt < runtime.retry.attempts && runtime.retry.backoff_ms > 0) {
            await this.sleep(runtime.retry.backoff_ms);
          }
        }
      }

      state.dropped += batch.length;
      state.failedBatches += 1;
      state.lastStatus = sink.type === 's3' ? 'unsupported' : 'failed';
      state.lastError = lastError?.message || 'Log sink delivery failed';
      state.lastFailureAt = new Date().toISOString();
      this.logger.warn(
        `Log sink "${runtime.key}" failed after ${runtime.retry.attempts} attempt(s): ${state.lastError}`,
      );
    } finally {
      state.flushing = false;
      if (state.queue.length > 0) {
        this.scheduleFlush(
          sink,
          runtime,
          state.queue.length >= runtime.batchSize ? 0 : runtime.flushIntervalMs,
        );
      }
    }
  }

  private async deliverBatch(
    sink: LogSinkConfig,
    batch: Record<string, unknown>[],
    timeoutMs: number,
  ): Promise<void> {
    if (batch.length === 0) return;

    switch (sink.type) {
      case 'file':
        return this.deliverFile(sink, batch);
      case 'webhook':
        return this.deliverWebhook(sink, batch, timeoutMs);
      case 'elasticsearch':
        return this.deliverElasticsearch(sink, batch, timeoutMs);
      case 's3':
        return this.unsupportedSink(sink);
      default:
        return this.unsupportedSink(sink);
    }
  }

  private async deliverFile(
    sink: FileLogSinkConfig,
    batch: Record<string, unknown>[],
  ): Promise<void> {
    await fs.mkdir(path.dirname(sink.path), { recursive: true });
    const body = `${batch.map((record) => JSON.stringify(record)).join('\n')}\n`;
    await fs.appendFile(sink.path, body, 'utf8');
  }

  private async deliverWebhook(
    sink: WebhookLogSinkConfig,
    batch: Record<string, unknown>[],
    timeoutMs: number,
  ): Promise<void> {
    const payload: LogSinkBatchPayload = {
      version: 'siftgate.call_log_batch.v1',
      events: batch,
    };
    await this.postWithTimeout(
      sink.url,
      JSON.stringify(payload),
      {
        'Content-Type': 'application/json',
        ...(sink.headers || {}),
      },
      timeoutMs,
    );
  }

  private async deliverElasticsearch(
    sink: ElasticsearchLogSinkConfig,
    batch: Record<string, unknown>[],
    timeoutMs: number,
  ): Promise<void> {
    const baseUrl = sink.url.replace(/\/+$/, '');
    const body = batch
      .map((record) => `${JSON.stringify({ index: { _index: sink.index } })}\n${JSON.stringify(record)}`)
      .join('\n');
    await this.postWithTimeout(
      `${baseUrl}/_bulk`,
      `${body}\n`,
      {
        'Content-Type': 'application/x-ndjson',
        ...(sink.headers || {}),
      },
      timeoutMs,
    );
  }

  private async unsupportedSink(sink: LogSinkConfig): Promise<void> {
    const name = sink.name || sink.type;
    if (!this.unsupportedWarned.has(name)) {
      this.unsupportedWarned.add(name);
      this.logger.warn(`Log sink type "${sink.type}" is configured as an interface placeholder and is not active yet.`);
    }
    throw new Error(`Log sink type "${sink.type}" is not implemented yet`);
  }

  private async postWithTimeout(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
      }
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new Error(`Log sink request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildLogRecord(log: CallLog, sink: LogSinkConfig): Record<string, unknown> {
    const raw: Record<string, unknown> = {
      request_id: log.request_id,
      timestamp: this.formatTimestamp(log.timestamp),
      source_format: log.source_format,
      tier: log.tier,
      score: Number(log.score || 0),
      node_id: log.node_id,
      model: log.model,
      input_tokens: Number(log.input_tokens || 0),
      output_tokens: Number(log.output_tokens || 0),
      cache_creation_input_tokens: Number(log.cache_creation_input_tokens || 0),
      cache_read_input_tokens: Number(log.cache_read_input_tokens || 0),
      cost_usd: Number(log.cost_usd || 0),
      latency_ms: Number(log.latency_ms || 0),
      status_code: Number(log.status_code || 0),
      is_fallback: Boolean(log.is_fallback),
      structured_output_requested: Boolean(log.structured_output_requested),
      structured_output_type: log.structured_output_type || null,
      structured_output_strategy: log.structured_output_strategy || null,
      structured_output_supported: log.structured_output_supported ?? null,
      structured_output_schema_name: log.structured_output_schema_name || null,
      session_key: log.session_key || null,
      error: log.error || null,
      api_key_name: log.api_key_name || null,
      api_key_id: log.api_key_id || null,
      retry_count: Number(log.retry_count || 0),
      experiment_group: log.experiment_group || null,
    };

    const include = sink.fields && sink.fields.length > 0
      ? new Set(sink.fields)
      : new Set(SAFE_LOG_FIELDS);
    const exclude = new Set([
      ...DEFAULT_EXCLUDED_FIELDS,
      ...(sink.exclude_fields || []),
    ]);

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!include.has(key) || exclude.has(key)) continue;
      filtered[key] = value;
    }
    return this.sanitize(filtered) as Record<string, unknown>;
  }

  private sanitize(value: unknown, depth = 0, key = ''): unknown {
    if (this.isSensitiveKey(key)) return undefined;
    if (depth > 8) return '[truncated]';
    if (Array.isArray(value)) {
      return value
        .map((item) => this.sanitize(item, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = this.sanitize(child, depth + 1, childKey);
      if (sanitized !== undefined) {
        output[childKey] = sanitized;
      }
    }
    return output;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return new Set([
      'prompt',
      'response',
      'requestbody',
      'responsebody',
      'messages',
      'content',
      'rawheaders',
      'headers',
      'authorization',
      'providerkey',
      'providerapikey',
      'apikey',
      'password',
      'secret',
      'token',
      'bearer',
    ]).has(normalized);
  }

  private normalizeSink(
    sink: LogSinkConfig,
    index: number,
  ): NormalizedSinkRuntime {
    return {
      key: sink.name || `${sink.type}-${index + 1}`,
      batchSize: Math.max(1, Math.floor(sink.batch_size ?? 100)),
      flushIntervalMs: Math.max(1, Math.floor(sink.flush_interval_ms ?? 5000)),
      maxQueue: Math.max(1, Math.floor(sink.max_queue ?? 10000)),
      overflow: sink.overflow || 'drop_oldest',
      retry: {
        attempts: Math.max(1, Math.floor(sink.retry?.attempts ?? 3)),
        backoff_ms: Math.max(0, Math.floor(sink.retry?.backoff_ms ?? 1000)),
        timeout_ms: Math.max(1, Math.floor(sink.retry?.timeout_ms ?? 5000)),
      },
    };
  }

  private stateFor(key: string): SinkState {
    let state = this.states.get(key);
    if (!state) {
      state = {
        queue: [],
        flushing: false,
        delivered: 0,
        dropped: 0,
        failedBatches: 0,
        lastStatus: 'idle',
        lastError: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private formatTimestamp(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return new Date().toISOString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
