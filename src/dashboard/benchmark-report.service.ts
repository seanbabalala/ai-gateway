import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CallLog, RouteDecisionLog } from '../database/entities';
import { CatalogService } from '../catalog/catalog.service';

export type BenchmarkPeriod = '1h' | '24h' | '7d' | '30d' | '90d';
export type BenchmarkCheckStatus = 'pass' | 'warn' | 'fail';

export interface BenchmarkReportInput {
  period?: string;
  api_key?: string;
  api_key_id?: string;
  namespace?: string;
  node?: string;
  model?: string;
  source_format?: string;
  limit?: number;
}

export interface BenchmarkLatencySummary {
  avg_ms: number;
  p50_ms: number;
  p75_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

export interface BenchmarkThroughputEstimate {
  requests_per_minute: number;
  requests_per_second: number;
  period_requests_per_minute: number;
  basis: 'observed_active_window';
}

export interface BenchmarkCostSummary {
  total_usd: number;
  avg_usd_per_request: number;
}

export interface BenchmarkTokenSummary {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_tokens_per_request: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface BenchmarkCacheSummary {
  local_prompt_cache_hits: number;
  local_prompt_cache_hit_rate: number;
  provider_cache_read_hits: number;
  provider_cache_hit_rate: number;
  provider_cache_creation_hits: number;
  cache_aware_requests: number;
  cache_aware_request_rate: number;
  cache_read_token_ratio: number;
}

export interface BenchmarkMetrics {
  calls: number;
  total_requests: number;
  success: number;
  failed: number;
  success_rate: number;
  error_rate: number;
  fallback_rate: number;
  cache_hit_rate: number;
  cache_miss_rate: number;
  total_cost_usd: number;
  avg_cost_usd: number;
  total_tokens: number;
  avg_tokens: number;
  throughput_rpm: number;
  period_rpm: number;
  throughput: BenchmarkThroughputEstimate;
  cost_summary: BenchmarkCostSummary;
  token_summary: BenchmarkTokenSummary;
  cache_summary: BenchmarkCacheSummary;
  latency_ms: BenchmarkLatencySummary;
}

export interface BenchmarkCatalogEvidence {
  known_model: boolean;
  provider: string | null;
  modalities: string[];
  pricing_source: string | null;
  catalog_source: string | null;
}

export interface BenchmarkGroup extends BenchmarkMetrics {
  node_id: string;
  model: string;
  source_formats: string[];
  status: BenchmarkCheckStatus;
  catalog: BenchmarkCatalogEvidence;
}

export interface BenchmarkStatusBucket {
  status_code: number;
  calls: number;
  rate: number;
}

export interface BenchmarkErrorBucket {
  error: string;
  calls: number;
}

export interface BenchmarkCheck {
  check: 'sample_size' | 'success_rate' | 'p95_latency' | 'p99_latency' | 'fallback_rate';
  status: BenchmarkCheckStatus;
  value: number;
  actual: string;
  target: string;
}

export interface BenchmarkReport {
  generated_at: string;
  period: BenchmarkPeriod;
  window: {
    requested_since: string;
    observed_start: string | null;
    observed_end: string | null;
    active_minutes: number;
    sample_limit: number;
    truncated: boolean;
  };
  filters: {
    api_key: string | null;
    api_key_id: string | null;
    namespace: string | null;
    node: string | null;
    model: string | null;
    source_format: string | null;
  };
  summary: BenchmarkMetrics;
  checks: BenchmarkCheck[];
  by_node_model: BenchmarkGroup[];
  by_source_format: Array<BenchmarkMetrics & { source_format: string; source_family: string }>;
  by_source_family: Array<BenchmarkMetrics & { source_family: string }>;
  status_breakdown: BenchmarkStatusBucket[];
  top_errors: BenchmarkErrorBucket[];
  route_trace_coverage: {
    matched_requests: number;
    coverage_rate: number;
  };
  comparison_guidance: Array<{
    target: string;
    purpose: string;
    method: string;
  }>;
  methodology: {
    source: 'call_logs';
    synthetic_run_script: string;
    direct_baseline_required: boolean;
    notes: string[];
  };
  privacy: {
    prompt_response_stored: false;
    raw_headers_stored: false;
    provider_keys_exposed: false;
    media_bytes_stored: false;
    metadata_only: true;
  };
}

const CANONICAL_SOURCE_FORMATS = [
  'chat_completions',
  'responses',
  'messages',
  'embeddings',
  'rerank',
  'image_generation',
  'image_edit',
  'image_variation',
  'audio_transcription',
  'audio_translation',
  'audio_speech',
  'video_generation',
  'realtime',
  'batch',
];

const SOURCE_FAMILIES = [
  'chat',
  'responses',
  'messages',
  'embeddings',
  'rerank',
  'images',
  'audio',
  'video',
  'realtime',
  'batch',
];

@Injectable()
export class BenchmarkReportService {
  constructor(
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
    @Optional()
    @InjectRepository(RouteDecisionLog)
    private readonly routeDecisionRepo?: Repository<RouteDecisionLog>,
    @Optional()
    private readonly catalog?: CatalogService,
  ) {}

  async getReport(input: BenchmarkReportInput = {}): Promise<BenchmarkReport> {
    const period = this.normalizePeriod(input.period);
    const periodMs = this.periodToMs(period);
    const since = new Date(Date.now() - periodMs);
    const sampleLimit = this.limit(input.limit, 5000, 20_000);

    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .orderBy('log.timestamp', 'DESC')
      .take(sampleLimit);

    this.applyFilters(qb, input);

    const rows = await qb.getMany();
    const activeWindow = this.activeWindow(rows, periodMs);
    const summary = this.metrics(rows, activeWindow.activeMs, periodMs);
    const catalogIndex = this.buildCatalogIndex();
    const traceCoverage = await this.routeTraceCoverage(rows);

    return {
      generated_at: new Date().toISOString(),
      period,
      window: {
        requested_since: since.toISOString(),
        observed_start: activeWindow.observedStart,
        observed_end: activeWindow.observedEnd,
        active_minutes: this.round(activeWindow.activeMs / 60_000, 2),
        sample_limit: sampleLimit,
        truncated: rows.length >= sampleLimit,
      },
      filters: {
        api_key: input.api_key ?? null,
        api_key_id: input.api_key_id ?? null,
        namespace: input.namespace ?? null,
        node: input.node ?? null,
        model: input.model ?? null,
        source_format: input.source_format ?? null,
      },
      summary,
      checks: this.buildChecks(summary),
      by_node_model: this.groupByNodeModel(rows, activeWindow.activeMs, periodMs, catalogIndex),
      by_source_format: this.groupBySourceFormat(rows, activeWindow.activeMs, periodMs),
      by_source_family: this.groupBySourceFamily(rows, activeWindow.activeMs, periodMs),
      status_breakdown: this.statusBreakdown(rows),
      top_errors: this.topErrors(rows),
      route_trace_coverage: traceCoverage,
      comparison_guidance: [
        {
          target: 'Direct provider baseline',
          purpose: 'Measure provider latency without SiftGate in the same network.',
          method: 'Run the same request shape directly against the upstream endpoint, then compare p95 and error rate.',
        },
        {
          target: 'LiteLLM / New API / One API',
          purpose: 'Compare AI gateway behavior under identical auth, model, and mock-upstream conditions.',
          method: 'Run the same concurrency, request count, body, provider mock, and network placement.',
        },
        {
          target: 'Envoy or generic API gateway',
          purpose: 'Separate HTTP proxy overhead from AI-aware routing, budgets, fallback, and logging.',
          method: 'Use a static upstream route and compare throughput before enabling SiftGate policy features.',
        },
      ],
      methodology: {
        source: 'call_logs',
        synthetic_run_script: 'npm run benchmark:upstream',
        direct_baseline_required: true,
        notes: [
          'This report is generated from local call-log metadata, not prompt or response bodies.',
          'Use the benchmark script with a mock or low-cost upstream for repeatable synthetic runs.',
          'Do not publish comparative numbers unless the machine, upstream latency, request body, concurrency, and commit are identical.',
          'Local samples show operational evidence for this gateway instance; they are not a strict cloud benchmark.',
        ],
      },
      privacy: {
        prompt_response_stored: false,
        raw_headers_stored: false,
        provider_keys_exposed: false,
        media_bytes_stored: false,
        metadata_only: true,
      },
    };
  }

  private applyFilters(
    qb: SelectQueryBuilder<CallLog>,
    input: BenchmarkReportInput,
  ): void {
    if (input.api_key_id) {
      qb.andWhere('log.api_key_id = :apiKeyId', { apiKeyId: input.api_key_id });
    } else if (input.api_key) {
      qb.andWhere('log.api_key_name = :apiKey', { apiKey: input.api_key });
    }
    if (input.namespace) {
      qb.andWhere('log.namespace_id = :namespaceId', { namespaceId: input.namespace });
    }
    if (input.node) {
      qb.andWhere('log.node_id = :nodeId', { nodeId: input.node });
    }
    if (input.model) {
      qb.andWhere('log.model = :model', { model: input.model });
    }
    if (input.source_format) {
      qb.andWhere('log.source_format = :sourceFormat', {
        sourceFormat: input.source_format,
      });
    }
  }

  private normalizePeriod(value: string | undefined): BenchmarkPeriod {
    if (
      value === '1h' ||
      value === '24h' ||
      value === '7d' ||
      value === '30d' ||
      value === '90d'
    ) {
      return value;
    }
    return '24h';
  }

  private periodToMs(period: BenchmarkPeriod): number {
    if (period === '1h') return 3_600_000;
    if (period === '24h') return 86_400_000;
    if (period === '7d') return 7 * 86_400_000;
    if (period === '30d') return 30 * 86_400_000;
    return 90 * 86_400_000;
  }

  private activeWindow(rows: CallLog[], periodMs: number): {
    activeMs: number;
    observedStart: string | null;
    observedEnd: string | null;
  } {
    const timestamps = rows
      .map((row) => new Date(row.timestamp).getTime())
      .filter((value) => Number.isFinite(value));

    if (timestamps.length === 0) {
      return { activeMs: periodMs, observedStart: null, observedEnd: null };
    }

    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    return {
      activeMs: Math.max(60_000, max - min),
      observedStart: new Date(min).toISOString(),
      observedEnd: new Date(max).toISOString(),
    };
  }

  private metrics(rows: CallLog[], activeMs: number, periodMs: number): BenchmarkMetrics {
    const calls = rows.length;
    const success = rows.filter((row) => Number(row.status_code || 0) < 400).length;
    const failed = calls - success;
    const latencies = rows.map((row) => Math.max(0, Number(row.latency_ms || 0)));
    const totalCost = rows.reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
    const inputTokens = rows.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0);
    const outputTokens = rows.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0);
    const totalTokens = inputTokens + outputTokens;
    const fallback = rows.filter((row) => row.is_fallback || row.fallback_reason).length;
    const cacheCreationTokens = rows.reduce(
      (sum, row) => sum + Number(row.cache_creation_input_tokens || 0),
      0,
    );
    const cacheReadTokens = rows.reduce(
      (sum, row) => sum + Number(row.cache_read_input_tokens || 0),
      0,
    );
    const localCacheHits = rows.filter((row) => row.tier === 'cached' || row.node_id === 'cache').length;
    const providerCacheHits = rows.filter((row) => Number(row.cache_read_input_tokens || 0) > 0).length;
    const providerCacheWrites = rows.filter((row) => Number(row.cache_creation_input_tokens || 0) > 0).length;
    const cacheAwareRequests = rows.filter((row) =>
      row.tier === 'cached' ||
      row.node_id === 'cache' ||
      Number(row.cache_read_input_tokens || 0) > 0 ||
      Number(row.cache_creation_input_tokens || 0) > 0,
    ).length;
    const cacheHits = localCacheHits + providerCacheHits;
    const cacheMisses = Math.max(calls - cacheHits, 0);
    const activeMinutes = Math.max(activeMs / 60_000, 1);
    const periodMinutes = Math.max(periodMs / 60_000, 1);
    const throughputRpm = calls > 0 ? this.round(calls / activeMinutes, 2) : 0;

    return {
      calls,
      total_requests: calls,
      success,
      failed,
      success_rate: this.percent(success, calls),
      error_rate: this.percent(failed, calls),
      fallback_rate: this.percent(fallback, calls),
      cache_hit_rate: this.percent(cacheHits, calls),
      cache_miss_rate: this.percent(cacheMisses, calls),
      total_cost_usd: this.round(totalCost, 6),
      avg_cost_usd: calls > 0 ? this.round(totalCost / calls, 6) : 0,
      total_tokens: totalTokens,
      avg_tokens: calls > 0 ? Math.round(totalTokens / calls) : 0,
      throughput_rpm: throughputRpm,
      period_rpm: calls > 0 ? this.round(calls / periodMinutes, 2) : 0,
      throughput: {
        requests_per_minute: throughputRpm,
        requests_per_second: this.round(throughputRpm / 60, 3),
        period_requests_per_minute: calls > 0 ? this.round(calls / periodMinutes, 2) : 0,
        basis: 'observed_active_window',
      },
      cost_summary: {
        total_usd: this.round(totalCost, 6),
        avg_usd_per_request: calls > 0 ? this.round(totalCost / calls, 6) : 0,
      },
      token_summary: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        avg_tokens_per_request: calls > 0 ? Math.round(totalTokens / calls) : 0,
        cache_creation_input_tokens: cacheCreationTokens,
        cache_read_input_tokens: cacheReadTokens,
      },
      cache_summary: {
        local_prompt_cache_hits: localCacheHits,
        local_prompt_cache_hit_rate: this.percent(localCacheHits, calls),
        provider_cache_read_hits: providerCacheHits,
        provider_cache_hit_rate: this.percent(providerCacheHits, calls),
        provider_cache_creation_hits: providerCacheWrites,
        cache_aware_requests: cacheAwareRequests,
        cache_aware_request_rate: this.percent(cacheAwareRequests, calls),
        cache_read_token_ratio: this.percent(cacheReadTokens, Math.max(inputTokens + cacheReadTokens, 0)),
      },
      latency_ms: {
        avg_ms: Math.round(this.average(latencies)),
        p50_ms: Math.round(this.percentile(latencies, 50)),
        p75_ms: Math.round(this.percentile(latencies, 75)),
        p95_ms: Math.round(this.percentile(latencies, 95)),
        p99_ms: Math.round(this.percentile(latencies, 99)),
        max_ms: Math.round(latencies.length > 0 ? Math.max(...latencies) : 0),
      },
    };
  }

  private groupByNodeModel(
    rows: CallLog[],
    activeMs: number,
    periodMs: number,
    catalogIndex: Map<string, BenchmarkCatalogEvidence>,
  ): BenchmarkGroup[] {
    const groups = new Map<string, CallLog[]>();
    for (const row of rows) {
      const key = `${row.node_id || 'unknown'}\u0000${row.model || 'unknown'}`;
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }

    return Array.from(groups.entries())
      .map(([key, groupRows]) => {
        const [nodeId, model] = key.split('\u0000');
        const metrics = this.metrics(groupRows, activeMs, periodMs);
        return {
          ...metrics,
          node_id: nodeId,
          model,
          source_formats: Array.from(
            new Set(groupRows.map((row) => row.source_format || 'unknown')),
          ).sort(),
          status: this.groupStatus(metrics),
          catalog: catalogIndex.get(model) ?? {
            known_model: false,
            provider: null,
            modalities: [],
            pricing_source: null,
            catalog_source: null,
          },
        };
      })
      .sort((a, b) => b.calls - a.calls || a.latency_ms.p95_ms - b.latency_ms.p95_ms)
      .slice(0, 50);
  }

  private groupBySourceFormat(
    rows: CallLog[],
    activeMs: number,
    periodMs: number,
  ): Array<BenchmarkMetrics & { source_format: string; source_family: string }> {
    const groups = new Map<string, CallLog[]>();
    for (const sourceFormat of CANONICAL_SOURCE_FORMATS) {
      groups.set(sourceFormat, []);
    }
    for (const row of rows) {
      const key = row.source_format || 'unknown';
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return Array.from(groups.entries())
      .map(([sourceFormat, groupRows]) => ({
        ...this.metrics(groupRows, activeMs, periodMs),
        source_format: sourceFormat,
        source_family: this.sourceFamily(sourceFormat),
      }))
      .sort((a, b) => b.calls - a.calls || a.source_format.localeCompare(b.source_format));
  }

  private groupBySourceFamily(
    rows: CallLog[],
    activeMs: number,
    periodMs: number,
  ): Array<BenchmarkMetrics & { source_family: string }> {
    const groups = new Map<string, CallLog[]>();
    for (const sourceFamily of SOURCE_FAMILIES) {
      groups.set(sourceFamily, []);
    }
    for (const row of rows) {
      const key = this.sourceFamily(row.source_format || 'unknown');
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return Array.from(groups.entries())
      .map(([sourceFamily, groupRows]) => ({
        ...this.metrics(groupRows, activeMs, periodMs),
        source_family: sourceFamily,
      }))
      .sort((a, b) => b.calls - a.calls || a.source_family.localeCompare(b.source_family));
  }

  private sourceFamily(sourceFormat: string): string {
    if (sourceFormat === 'chat_completions') return 'chat';
    if (sourceFormat === 'responses') return 'responses';
    if (sourceFormat === 'messages') return 'messages';
    if (sourceFormat === 'embeddings') return 'embeddings';
    if (sourceFormat === 'rerank') return 'rerank';
    if (sourceFormat.startsWith('image_')) return 'images';
    if (sourceFormat.startsWith('audio_')) return 'audio';
    if (sourceFormat.startsWith('video_')) return 'video';
    if (sourceFormat.startsWith('realtime')) return 'realtime';
    if (sourceFormat === 'batch') return 'batch';
    return 'unknown';
  }

  private statusBreakdown(rows: CallLog[]): BenchmarkStatusBucket[] {
    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.status_code, (counts.get(row.status_code) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([statusCode, calls]) => ({
        status_code: statusCode,
        calls,
        rate: this.percent(calls, rows.length),
      }))
      .sort((a, b) => b.calls - a.calls || a.status_code - b.status_code);
  }

  private topErrors(rows: CallLog[]): BenchmarkErrorBucket[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.status_code < 400 && !row.error) continue;
      const key = this.sanitizeError(row.error || `HTTP ${row.status_code}`);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([error, calls]) => ({ error, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8);
  }

  private async routeTraceCoverage(rows: CallLog[]): Promise<{
    matched_requests: number;
    coverage_rate: number;
  }> {
    const requestIds = Array.from(
      new Set(rows.map((row) => row.request_id).filter((value): value is string => Boolean(value))),
    );
    if (!this.routeDecisionRepo || requestIds.length === 0) {
      return { matched_requests: 0, coverage_rate: 0 };
    }
    try {
      const matched = await this.routeDecisionRepo
        .createQueryBuilder('decision')
        .where('decision.request_id IN (:...requestIds)', { requestIds })
        .getCount();
      return {
        matched_requests: matched,
        coverage_rate: this.percent(matched, requestIds.length),
      };
    } catch {
      return { matched_requests: 0, coverage_rate: 0 };
    }
  }

  private buildCatalogIndex(): Map<string, BenchmarkCatalogEvidence> {
    const index = new Map<string, BenchmarkCatalogEvidence>();
    if (!this.catalog) return index;
    try {
      for (const model of this.catalog.models()) {
        index.set(model.id, {
          known_model: true,
          provider: model.provider,
          modalities: model.modalities as string[],
          pricing_source: model.pricing?.source ?? null,
          catalog_source: model.source ?? null,
        });
      }
    } catch {
      return index;
    }
    return index;
  }

  private sanitizeError(value: string): string {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/gw_sk_[A-Za-z0-9._~+/=-]+/gi, 'gw_sk_[redacted]')
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
      .replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
      .slice(0, 180);
  }

  private buildChecks(metrics: BenchmarkMetrics): BenchmarkCheck[] {
    return [
      {
        check: 'sample_size',
        status: metrics.calls >= 100 ? 'pass' : metrics.calls >= 30 ? 'warn' : 'fail',
        value: metrics.calls,
        actual: `${metrics.calls}`,
        target: '>=100',
      },
      {
        check: 'success_rate',
        status: metrics.success_rate >= 99 ? 'pass' : metrics.success_rate >= 95 ? 'warn' : 'fail',
        value: metrics.success_rate,
        actual: `${metrics.success_rate}%`,
        target: '>=99%',
      },
      {
        check: 'p95_latency',
        status:
          metrics.latency_ms.p95_ms <= 3000
            ? 'pass'
            : metrics.latency_ms.p95_ms <= 8000
              ? 'warn'
              : 'fail',
        value: metrics.latency_ms.p95_ms,
        actual: `${metrics.latency_ms.p95_ms}ms`,
        target: '<=3000ms',
      },
      {
        check: 'p99_latency',
        status:
          metrics.latency_ms.p99_ms <= 10_000
            ? 'pass'
            : metrics.latency_ms.p99_ms <= 20_000
              ? 'warn'
              : 'fail',
        value: metrics.latency_ms.p99_ms,
        actual: `${metrics.latency_ms.p99_ms}ms`,
        target: '<=10000ms',
      },
      {
        check: 'fallback_rate',
        status: metrics.fallback_rate <= 5 ? 'pass' : metrics.fallback_rate <= 15 ? 'warn' : 'fail',
        value: metrics.fallback_rate,
        actual: `${metrics.fallback_rate}%`,
        target: '<=5%',
      },
    ];
  }

  private groupStatus(metrics: BenchmarkMetrics): BenchmarkCheckStatus {
    if (metrics.calls === 0) return 'warn';
    if (metrics.success_rate < 95 || metrics.latency_ms.p95_ms > 8000) return 'fail';
    if (metrics.success_rate < 99 || metrics.latency_ms.p95_ms > 3000 || metrics.fallback_rate > 5) return 'warn';
    return 'pass';
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[index];
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private percent(value: number, total: number): number {
    if (total <= 0) return 0;
    return this.round((value / total) * 100, 1);
  }

  private round(value: number, digits: number): number {
    return Number(value.toFixed(digits));
  }

  private limit(value: number | undefined, fallback: number, max: number): number {
    const raw = Number(value ?? fallback);
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(Math.max(Math.floor(raw), 1), max);
  }
}
