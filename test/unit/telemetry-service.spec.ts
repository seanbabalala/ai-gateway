import { TelemetryService } from '../../src/telemetry/telemetry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;

  beforeEach(() => {
    // Constructs with no-op API (no SDK initialized in test environment)
    service = new TelemetryService();
  });

  // ── Constructor ─────────────────────────────────────────────

  it('should construct without errors in no-op environment', () => {
    expect(service).toBeDefined();
    expect(service.tracer).toBeDefined();
    expect(service.meter).toBeDefined();
  });

  it('should create all counter instruments', () => {
    expect(service.requestTotal).toBeDefined();
    expect(service.upstreamErrors).toBeDefined();
    expect(service.tokensUsage).toBeDefined();
    expect(service.costTotal).toBeDefined();
    expect(service.cacheOperations).toBeDefined();
  });

  it('should create all histogram instruments', () => {
    expect(service.requestDuration).toBeDefined();
    expect(service.upstreamDuration).toBeDefined();
  });

  // ── Counter / Histogram no-op safety ────────────────────────

  it('should not throw when adding to counters (no-op)', () => {
    expect(() => service.requestTotal.add(1, { tier: 'simple' })).not.toThrow();
    expect(() => service.upstreamErrors.add(1, { node: 'gpt' })).not.toThrow();
    expect(() => service.tokensUsage.add(100, { direction: 'input' })).not.toThrow();
    expect(() => service.costTotal.add(0.01, { model: 'gpt-4' })).not.toThrow();
    expect(() => service.cacheOperations.add(1, { operation: 'hit' })).not.toThrow();
  });

  it('should not throw when recording histograms (no-op)', () => {
    expect(() => service.requestDuration.record(150, { tier: 'standard' })).not.toThrow();
    expect(() => service.upstreamDuration.record(200, { node: 'claude' })).not.toThrow();
  });

  // ── withSpan() ──────────────────────────────────────────────

  it('should execute callback and return result', async () => {
    const result = await service.withSpan('test.span', {}, async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should propagate errors from callback', async () => {
    await expect(
      service.withSpan('test.error', {}, async () => {
        throw new Error('test failure');
      }),
    ).rejects.toThrow('test failure');
  });

  it('should pass span to callback', async () => {
    let receivedSpan: unknown = null;
    await service.withSpan('test.span', { key: 'value' }, async (span) => {
      receivedSpan = span;
      // Span operations should not throw in no-op mode
      span.setAttribute('test.attr', 'hello');
      span.addEvent('test-event');
    });
    expect(receivedSpan).toBeDefined();
  });

  it('should support custom SpanKind', async () => {
    const { SpanKind } = require('@opentelemetry/api');
    const result = await service.withSpan(
      'test.client',
      {},
      async () => 'ok',
      SpanKind.CLIENT,
    );
    expect(result).toBe('ok');
  });

  // ── withSpanSync() ──────────────────────────────────────────

  it('should execute sync callback and return result', () => {
    const result = service.withSpanSync('test.sync', {}, () => 'hello');
    expect(result).toBe('hello');
  });

  it('should propagate errors from sync callback', () => {
    expect(() =>
      service.withSpanSync('test.sync.error', {}, () => {
        throw new Error('sync failure');
      }),
    ).toThrow('sync failure');
  });

  it('should pass span to sync callback', () => {
    let receivedSpan: unknown = null;
    service.withSpanSync('test.sync', {}, (span) => {
      receivedSpan = span;
      span.setAttribute('sync.attr', 123);
    });
    expect(receivedSpan).toBeDefined();
  });

  // ── activeSpan ──────────────────────────────────────────────

  it('should return undefined for activeSpan outside a span context', () => {
    // In no-op mode, there's no active span
    expect(service.activeSpan).toBeUndefined();
  });

  // ── GenAI attributes safety ──────────────────────────────────

  it('should handle GenAI semantic attributes without throwing', async () => {
    await service.withSpan('test.genai', {}, async (span) => {
      span.setAttribute('gen_ai.system', 'openai');
      span.setAttribute('gen_ai.request.model', 'gpt-4');
      span.setAttribute('gen_ai.usage.input_tokens', 100);
      span.setAttribute('gen_ai.usage.output_tokens', 50);
    });
    // No assertion needed — just verifying no throw
  });
});
