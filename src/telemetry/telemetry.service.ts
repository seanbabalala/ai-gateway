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
  type Span,
  type Attributes,
} from '@opentelemetry/api';

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

  // ── Histograms ────────────────────────────────────────
  readonly requestDuration: Histogram;
  readonly upstreamDuration: Histogram;

  constructor() {
    this.tracer = trace.getTracer('siftgate', '0.1.0');
    this.meter = metrics.getMeter('siftgate', '0.1.0');

    // Counters
    this.requestTotal = this.meter.createCounter('gateway.request.total', {
      description: 'Total gateway requests',
      unit: '{request}',
    });
    this.upstreamErrors = this.meter.createCounter('gateway.upstream.errors', {
      description: 'Upstream provider errors',
      unit: '{error}',
    });
    this.tokensUsage = this.meter.createCounter('gateway.tokens.usage', {
      description: 'Token usage (input + output)',
      unit: '{token}',
    });
    this.costTotal = this.meter.createCounter('gateway.cost.total', {
      description: 'Total estimated cost',
      unit: 'USD',
    });
    this.cacheOperations = this.meter.createCounter('gateway.cache.operations', {
      description: 'Cache operations (hit/miss/store)',
      unit: '{operation}',
    });

    // Histograms
    this.requestDuration = this.meter.createHistogram('gateway.request.duration', {
      description: 'End-to-end request duration',
      unit: 'ms',
    });
    this.upstreamDuration = this.meter.createHistogram('gateway.upstream.duration', {
      description: 'Upstream provider call duration',
      unit: 'ms',
    });
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
