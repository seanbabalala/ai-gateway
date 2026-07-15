// ===================================================================
// TelemetryService — Injectable OpenTelemetry Wrapper
// ===================================================================
// Provides:
//   - Pre-created metric instruments (counters, histograms)
//   - withSpan() / withSpanSync() convenience methods
//   - Active-span accessor
//
// When the SDK is NOT initialized (telemetry.enabled: false), all
// @opentelemetry/api calls return no-op implementations automatically,
// so injecting this service is always safe and zero-overhead.
// ===================================================================

import { Injectable } from '@nestjs/common';
import {
  trace,
  metrics,
  context,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type Meter,
  type Counter,
  type Histogram,
  type ObservableGauge,
  type Span,
  type Attributes,
} from '@opentelemetry/api';
import type {
  ErrorRedactionMetricInput,
  ErrorRedactionReason,
  ErrorRedactionSurface,
} from '../security/error-redaction';

export interface BusinessMetricLabels {
  tier: string;
  node: string;
  model: string;
  statusCode: number;
}

export interface CallMetricInput extends BusinessMetricLabels {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd: number;
  isFallback: boolean;
  fallbackReason?: string | null;
  fallbackFromNode?: string | null;
}

export type BudgetReservationMetricEvent = 'reserve' | 'commit' | 'release' | 'rejected';
export type BudgetReservationMetricScope = 'global' | 'api_key' | 'namespace' | 'team';

export interface BudgetReservationMetricInput {
  event: BudgetReservationMetricEvent;
  scope: BudgetReservationMetricScope;
  budgetType: string;
}

export type DashboardAuthMetricEvent = 'status_failure' | 'disabled_auth';
export type DashboardAuthMetricMode =
  | 'development_allowed'
  | 'production_allowed'
  | 'production_ignored'
  | 'unknown';

export interface DashboardAuthMetricInput {
  event: DashboardAuthMetricEvent;
  mode?: DashboardAuthMetricMode;
}

export type DashboardLegacyTokenMetricEvent =
  | 'legacy_bearer_used'
  | 'legacy_query_used'
  | 'legacy_rejected';
export type DashboardLegacyTokenMetricSource = 'bearer' | 'query' | 'unknown';

export interface DashboardLegacyTokenMetricInput {
  event: DashboardLegacyTokenMetricEvent;
  source: DashboardLegacyTokenMetricSource;
}

export type StreamLifecycleMetricEvent = 'abort' | 'timeout';
export type StreamLifecycleMetricReason = 'client_aborted' | 'idle_timeout' | 'max_duration';
export type StreamLifecycleMetricPhase = 'pre_first_chunk' | 'transmission';

export interface StreamLifecycleMetricInput {
  event: StreamLifecycleMetricEvent;
  reason: StreamLifecycleMetricReason;
  phase: StreamLifecycleMetricPhase;
  node: string;
  model: string;
}

@Injectable()
export class TelemetryService {
  readonly tracer: Tracer;
  readonly meter: Meter;

  // ── Counters ──────────────────────────────────────────
  readonly requestTotal: Counter;
  readonly upstreamErrors: Counter;
  readonly tokensUsage: Counter;
  readonly costTotal: Counter;
  readonly cacheOperations: Counter;
  readonly fallbackTotal: Counter;
  readonly cacheHitsTotal: Counter;
  readonly cacheMissesTotal: Counter;
  readonly budgetReservations: Counter;
  readonly streamLifecycleTotal: Counter;
  readonly dashboardAuthEvents: Counter;
  readonly dashboardLegacyTokenEvents: Counter;
  readonly errorRedactionsTotal: Counter;

  // ── Histograms ────────────────────────────────────────
  readonly requestDuration: Histogram;
  readonly upstreamDuration: Histogram;

  // ── Observable Gauges ─────────────────────────────────
  readonly budgetUsageRatio: ObservableGauge;

  constructor() {
    this.tracer = trace.getTracer('siftgate', '0.1.0');
    this.meter = metrics.getMeter('siftgate', '0.1.0');

    // Counters
    this.requestTotal = this.meter.createCounter('siftgate_requests_total', {
      description: 'Total accepted gateway requests, labeled with bounded routing metadata',
      unit: '{request}',
    });
    this.upstreamErrors = this.meter.createCounter('gateway.upstream.errors', {
      description: 'Upstream provider errors',
      unit: '{error}',
    });
    this.tokensUsage = this.meter.createCounter('siftgate_tokens_total', {
      description: 'Token usage by direction',
      unit: '{token}',
    });
    this.costTotal = this.meter.createCounter('siftgate_cost_total', {
      description: 'Total estimated cost by upstream target',
      unit: 'USD',
    });
    this.cacheOperations = this.meter.createCounter('gateway.cache.operations', {
      description: 'Cache operations (hit/miss/store)',
      unit: '{operation}',
    });
    this.fallbackTotal = this.meter.createCounter('siftgate_fallback_total', {
      description: 'Requests served by a fallback target',
      unit: '{request}',
    });
    this.cacheHitsTotal = this.meter.createCounter('siftgate_cache_hits_total', {
      description: 'Prompt cache hits',
      unit: '{hit}',
    });
    this.cacheMissesTotal = this.meter.createCounter('siftgate_cache_misses_total', {
      description: 'Prompt cache misses',
      unit: '{miss}',
    });
    this.budgetReservations = this.meter.createCounter('siftgate_budget_reservations_total', {
      description: 'Budget reservation lifecycle events by bounded scope and budget type',
      unit: '{event}',
    });
    this.streamLifecycleTotal = this.meter.createCounter('siftgate_stream_lifecycle_total', {
      description: 'Streaming lifecycle interruptions by bounded reason and phase',
      unit: '{event}',
    });
    this.dashboardAuthEvents = this.meter.createCounter('siftgate_dashboard_auth_events_total', {
      description: 'Dashboard authentication status failures and disabled-auth startup events',
      unit: '{event}',
    });
    this.dashboardLegacyTokenEvents = this.meter.createCounter(
      'siftgate_dashboard_legacy_token_events_total',
      {
        description: 'Dashboard legacy token compatibility fallback events by bounded source',
        unit: '{event}',
      },
    );
    this.errorRedactionsTotal = this.meter.createCounter('siftgate_error_redactions_total', {
      description: 'Error redaction events by bounded gateway surface and reason',
      unit: '{event}',
    });

    // Histograms
    this.requestDuration = this.meter.createHistogram('siftgate_request_duration_seconds', {
      description: 'End-to-end request duration',
      unit: 's',
    });
    this.upstreamDuration = this.meter.createHistogram('gateway.upstream.duration', {
      description: 'Upstream provider call duration',
      unit: 'ms',
    });

    this.budgetUsageRatio = this.meter.createObservableGauge(
      'siftgate_budget_usage_ratio',
      {
        description: 'Current budget usage ratio, aggregated by scope and budget type',
        unit: '1',
      },
    );
  }

  // ── Business Metrics ───────────────────────────────────

  recordCallMetrics(input: CallMetricInput): void {
    const attrs = this.routeAttrs(input);
    this.requestTotal.add(1, attrs);
    this.requestDuration.record(
      Math.max(0, input.latencyMs || 0) / 1000,
      attrs,
    );

    this.recordTokens(input.inputTokens, {
      node: input.node,
      model: input.model,
      direction: 'input',
    });
    this.recordTokens(input.outputTokens, {
      node: input.node,
      model: input.model,
      direction: 'output',
    });
    this.recordTokens(input.cacheCreationInputTokens || 0, {
      node: input.node,
      model: input.model,
      direction: 'cache_creation_input',
    });
    this.recordTokens(input.cacheReadInputTokens || 0, {
      node: input.node,
      model: input.model,
      direction: 'cache_read_input',
    });

    if (input.costUsd > 0) {
      this.costTotal.add(input.costUsd, this.targetAttrs(input));
    }
    if (input.isFallback || input.fallbackReason) {
      this.fallbackTotal.add(1, {
        tier: this.safeLabel(input.tier, 'unknown'),
        node: this.safeLabel(input.node, 'unknown'),
        model: this.safeLabel(input.model, 'unknown'),
        reason: this.safeLabel(input.fallbackReason || 'fallback', 'fallback'),
        from_node: this.safeLabel(input.fallbackFromNode || '', ''),
        to_node: this.safeLabel(input.node, 'unknown'),
      });
    }
  }

  recordCacheHit(): void {
    this.cacheOperations.add(1, { operation: 'hit' });
    this.cacheHitsTotal.add(1);
  }

  recordCacheMiss(): void {
    this.cacheOperations.add(1, { operation: 'miss' });
    this.cacheMissesTotal.add(1);
  }

  recordCacheStore(): void {
    this.cacheOperations.add(1, { operation: 'store' });
  }

  recordBudgetReservation(input: BudgetReservationMetricInput): void {
    this.budgetReservations.add(1, {
      event: this.safeBudgetReservationEvent(input.event),
      scope: this.safeBudgetScope(input.scope),
      budget_type: this.safeLabel(input.budgetType, 'unknown'),
    });
  }

  recordStreamLifecycle(input: StreamLifecycleMetricInput): void {
    this.streamLifecycleTotal.add(1, {
      event: this.safeStreamLifecycleEvent(input.event),
      reason: this.safeStreamLifecycleReason(input.reason),
      phase: this.safeStreamLifecyclePhase(input.phase),
      node: this.safeLabel(input.node, 'unknown'),
      model: this.safeLabel(input.model, 'unknown'),
    });
  }

  recordDashboardAuthEvent(input: DashboardAuthMetricInput): void {
    this.dashboardAuthEvents.add(1, {
      event: this.safeDashboardAuthEvent(input.event),
      mode: this.safeDashboardAuthMode(input.mode ?? 'unknown'),
    });
  }

  recordDashboardLegacyTokenEvent(input: DashboardLegacyTokenMetricInput): void {
    this.dashboardLegacyTokenEvents.add(1, {
      event: this.safeDashboardLegacyTokenEvent(input.event),
      source: this.safeDashboardLegacyTokenSource(input.source),
    });
  }

  recordErrorRedaction(input: ErrorRedactionMetricInput): void {
    this.errorRedactionsTotal.add(1, {
      surface: this.safeErrorRedactionSurface(input.surface),
      reason: this.safeErrorRedactionReason(input.reason),
    });
  }

  private recordTokens(
    value: number,
    attrs: { node: string; model: string; direction: string },
  ): void {
    if (!Number.isFinite(value) || value <= 0) return;
    this.tokensUsage.add(value, {
      node: this.safeLabel(attrs.node, 'unknown'),
      model: this.safeLabel(attrs.model, 'unknown'),
      direction: this.safeLabel(attrs.direction, 'unknown'),
    });
  }

  private routeAttrs(input: BusinessMetricLabels): Attributes {
    return {
      tier: this.safeLabel(input.tier, 'unknown'),
      node: this.safeLabel(input.node, 'unknown'),
      model: this.safeLabel(input.model, 'unknown'),
      status: this.statusClass(input.statusCode),
    };
  }

  private targetAttrs(input: Pick<BusinessMetricLabels, 'node' | 'model'>): Attributes {
    return {
      node: this.safeLabel(input.node, 'unknown'),
      model: this.safeLabel(input.model, 'unknown'),
    };
  }

  private statusClass(statusCode: number): string {
    if (!Number.isFinite(statusCode) || statusCode <= 0) return 'unknown';
    return `${Math.floor(statusCode / 100)}xx`;
  }

  private safeLabel(value: unknown, fallback: string): string {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const normalized = String(value).trim();
    if (!normalized) return fallback;
    return normalized.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || fallback;
  }

  private safeBudgetReservationEvent(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['reserve', 'commit', 'release', 'rejected'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeBudgetScope(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['global', 'api_key', 'namespace', 'team'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeStreamLifecycleEvent(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['abort', 'timeout'].includes(normalized) ? normalized : 'unknown';
  }

  private safeStreamLifecycleReason(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['client_aborted', 'idle_timeout', 'max_duration'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeStreamLifecyclePhase(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['pre_first_chunk', 'transmission'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeDashboardAuthEvent(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['status_failure', 'disabled_auth'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeDashboardAuthMode(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return [
      'development_allowed',
      'production_allowed',
      'production_ignored',
      'unknown',
    ].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeDashboardLegacyTokenEvent(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return [
      'legacy_bearer_used',
      'legacy_query_used',
      'legacy_rejected',
    ].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeDashboardLegacyTokenSource(value: unknown): string {
    const normalized = this.safeLabel(value, 'unknown');
    return ['bearer', 'query', 'unknown'].includes(normalized)
      ? normalized
      : 'unknown';
  }

  private safeErrorRedactionSurface(value: unknown): ErrorRedactionSurface | 'unknown' {
    const normalized = this.safeLabel(value, 'unknown');
    return ['provider', 'batch', 'realtime', 'benchmark', 'compatibility'].includes(
      normalized,
    )
      ? (normalized as ErrorRedactionSurface)
      : 'unknown';
  }

  private safeErrorRedactionReason(value: unknown): ErrorRedactionReason | 'unknown' {
    const normalized = this.safeLabel(value, 'unknown');
    return [
      'bearer_token',
      'gateway_key',
      'provider_key',
      'sensitive_value',
      'sensitive_field',
    ].includes(normalized)
      ? (normalized as ErrorRedactionReason)
      : 'unknown';
  }

  // ── Span Helpers ──────────────────────────────────────

  /**
   * Wrap an async function with a span.
   * Automatically sets status, records exceptions, and calls span.end().
   */
  async withSpan<T>(
    name: string,
    attrs: Attributes,
    fn: (span: Span) => Promise<T>,
    kind?: SpanKind,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { kind: kind ?? SpanKind.INTERNAL, attributes: attrs },
      async (span) => {
        try {
          const result = await fn(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (err as Error).message,
          });
          span.recordException(err as Error);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Wrap a synchronous function with a span.
   */
  withSpanSync<T>(name: string, attrs: Attributes, fn: (span: Span) => T): T {
    const span = this.tracer.startSpan(name, { attributes: attrs });
    const ctx = trace.setSpan(context.active(), span);

    return context.with(ctx, () => {
      try {
        const result = fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get the currently active span (for adding attributes mid-flight).
   * Returns undefined if no span is active.
   */
  get activeSpan(): Span | undefined {
    return trace.getActiveSpan();
  }
}
