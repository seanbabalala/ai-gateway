import type { GatewayPlugin } from '../../src/plugins/types';
import {
  SAFE_ANALYTICS_FIELDS,
  sanitizeForExternal,
} from '../_shared/safety';

interface AnalyticsSinkConfig {
  enabled?: boolean;
  endpoint?: string;
  headers?: Record<string, string>;
  batch_size?: number;
  flush_interval_ms?: number;
  timeout_ms?: number;
  max_queue?: number;
  include_prompt_response?: boolean;
  fields?: string[];
}

export default class AnalyticsSinkPlugin implements GatewayPlugin {
  meta = {
    name: 'analytics-sink',
    version: '0.4.0',
    priority: 120,
  };

  private enabled = false;
  private endpoint = '';
  private headers: Record<string, string> = {};
  private batchSize = 50;
  private flushIntervalMs = 5000;
  private timeoutMs = 3000;
  private maxQueue = 1000;
  private includePromptResponse = false;
  private fields = SAFE_ANALYTICS_FIELDS;
  private queue: Record<string, unknown>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  events = [
    {
      event: 'log',
      handler: (payload: unknown) => this.enqueue(payload),
    },
  ];

  onLoad(config: Readonly<Record<string, unknown>>): void {
    const cfg = config as AnalyticsSinkConfig;
    this.enabled = cfg.enabled === true;
    if (!this.enabled) return;
    if (!cfg.endpoint || typeof cfg.endpoint !== 'string') {
      throw new Error('analytics-sink requires config.endpoint when enabled=true');
    }

    this.endpoint = cfg.endpoint;
    this.headers = isRecord(cfg.headers) ? cfg.headers : {};
    this.batchSize = positiveInteger(cfg.batch_size, this.batchSize);
    this.flushIntervalMs = positiveInteger(
      cfg.flush_interval_ms,
      this.flushIntervalMs,
    );
    this.timeoutMs = positiveInteger(cfg.timeout_ms, this.timeoutMs);
    this.maxQueue = positiveInteger(cfg.max_queue, this.maxQueue);
    this.includePromptResponse = cfg.include_prompt_response === true;
    this.fields = Array.isArray(cfg.fields)
      ? cfg.fields.filter((field): field is string => typeof field === 'string')
      : SAFE_ANALYTICS_FIELDS;
  }

  async onDestroy(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flushForTests(false);
  }

  enqueue(payload: unknown): void {
    if (!this.enabled) return;
    const sanitized = sanitizeForExternal(payload, {
      allowedFields: this.fields,
      includePromptResponse: this.includePromptResponse,
    });
    if (!sanitized || typeof sanitized !== 'object') return;
    if (this.queue.length >= this.maxQueue) {
      this.queue.shift();
    }
    this.queue.push(sanitized as Record<string, unknown>);
    this.scheduleFlush(this.queue.length >= this.batchSize ? 0 : this.flushIntervalMs);
  }

  async flushForTests(requeueOnFailure = true): Promise<void> {
    let guard = 0;
    while (this.queue.length > 0 && guard < 100) {
      guard += 1;
      await this.flush(requeueOnFailure);
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushing || this.queue.length === 0) return;
    if (this.timer && delayMs > 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush(true);
    }, delayMs);
    this.timer.unref?.();
  }

  private async flush(requeueOnFailure: boolean): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.batchSize);
    try {
      await this.post(batch);
    } catch {
      if (requeueOnFailure) {
        this.queue.unshift(...batch);
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush(this.flushIntervalMs);
      }
    }
  }

  private async post(events: Record<string, unknown>[]): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          version: 'siftgate.analytics.v1',
          events,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`analytics-sink HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
