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
    expect(service.fallbackTotal).toBeDefined();
    expect(service.cacheHitsTotal).toBeDefined();
    expect(service.cacheMissesTotal).toBeDefined();
    expect(service.budgetReservations).toBeDefined();
    expect(service.streamLifecycleTotal).toBeDefined();
    expect(service.dashboardAuthEvents).toBeDefined();
    expect(service.dashboardLegacyTokenEvents).toBeDefined();
  });

  it('should create all histogram instruments', () => {
    expect(service.requestDuration).toBeDefined();
    expect(service.upstreamDuration).toBeDefined();
  });

  it('should create all observable gauge instruments', () => {
    expect(service.budgetUsageRatio).toBeDefined();
  });

  // ── Counter / Histogram no-op safety ────────────────────────

  it('should not throw when adding to counters (no-op)', () => {
    expect(() => service.requestTotal.add(1, { tier: 'simple' })).not.toThrow();
    expect(() => service.upstreamErrors.add(1, { node: 'gpt' })).not.toThrow();
    expect(() => service.tokensUsage.add(100, { direction: 'input' })).not.toThrow();
    expect(() => service.costTotal.add(0.01, { model: 'gpt-4' })).not.toThrow();
    expect(() => service.cacheOperations.add(1, { operation: 'hit' })).not.toThrow();
    expect(() => service.fallbackTotal.add(1, { tier: 'standard' })).not.toThrow();
    expect(() => service.cacheHitsTotal.add(1)).not.toThrow();
    expect(() => service.cacheMissesTotal.add(1)).not.toThrow();
    expect(() => service.budgetReservations.add(1, { event: 'reserve' })).not.toThrow();
    expect(() => service.streamLifecycleTotal.add(1, { reason: 'client_aborted' })).not.toThrow();
    expect(() => service.dashboardAuthEvents.add(1, { event: 'status_failure' })).not.toThrow();
    expect(() =>
      service.dashboardLegacyTokenEvents.add(1, { event: 'legacy_bearer_used' }),
    ).not.toThrow();
  });

  it('should not throw when recording histograms (no-op)', () => {
    expect(() => service.requestDuration.record(0.15, { tier: 'standard' })).not.toThrow();
    expect(() => service.upstreamDuration.record(200, { node: 'claude' })).not.toThrow();
  });

  it('should record business call metrics with bounded labels', () => {
    (service as any).requestTotal = { add: jest.fn() };
    (service as any).requestDuration = { record: jest.fn() };
    (service as any).tokensUsage = { add: jest.fn() };
    (service as any).costTotal = { add: jest.fn() };
    (service as any).fallbackTotal = { add: jest.fn() };

    service.recordCallMetrics({
      tier: 'standard',
      node: 'openai/us east',
      model: 'gpt-4o/tenant-secret-key-that-should-not-be-a-label',
      statusCode: 201,
      latencyMs: 1234,
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 3,
      costUsd: 0.00042,
      isFallback: true,
    });

    expect(service.requestTotal.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        tier: 'standard',
        node: 'openai_us_east',
        status: '2xx',
      }),
    );
    expect(service.requestDuration.record).toHaveBeenCalledWith(
      1.234,
      expect.objectContaining({ status: '2xx' }),
    );
    expect(service.tokensUsage.add).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ direction: 'input' }),
    );
    expect(service.tokensUsage.add).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ direction: 'output' }),
    );
    expect(service.tokensUsage.add).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ direction: 'cache_creation_input' }),
    );
    expect(service.tokensUsage.add).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ direction: 'cache_read_input' }),
    );
    expect(service.costTotal.add).toHaveBeenCalledWith(
      0.00042,
      expect.objectContaining({ node: 'openai_us_east' }),
    );
    expect(service.fallbackTotal.add).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ tier: 'standard', node: 'openai_us_east' }),
    );
  });

  it('should record cache hits and misses on both legacy and business counters', () => {
    (service as any).cacheOperations = { add: jest.fn() };
    (service as any).cacheHitsTotal = { add: jest.fn() };
    (service as any).cacheMissesTotal = { add: jest.fn() };

    service.recordCacheHit();
    service.recordCacheMiss();
    service.recordCacheStore();

    expect(service.cacheOperations.add).toHaveBeenCalledWith(1, { operation: 'hit' });
    expect(service.cacheOperations.add).toHaveBeenCalledWith(1, { operation: 'miss' });
    expect(service.cacheOperations.add).toHaveBeenCalledWith(1, { operation: 'store' });
    expect(service.cacheHitsTotal.add).toHaveBeenCalledWith(1);
    expect(service.cacheMissesTotal.add).toHaveBeenCalledWith(1);
  });

  it('should record budget reservation metrics with bounded labels', () => {
    (service as any).budgetReservations = { add: jest.fn() };

    service.recordBudgetReservation({
      event: 'reserve',
      scope: 'api_key',
      budgetType: 'daily tokens',
    });

    expect(service.budgetReservations.add).toHaveBeenCalledWith(1, {
      event: 'reserve',
      scope: 'api_key',
      budget_type: 'daily_tokens',
    });
  });

  it('should record stream lifecycle metrics with bounded labels', () => {
    (service as any).streamLifecycleTotal = { add: jest.fn() };

    service.recordStreamLifecycle({
      event: 'timeout',
      reason: 'max_duration',
      phase: 'pre_first_chunk',
      node: 'openai/us east',
      model: 'gpt-4o/tenant-secret-key-that-should-not-be-a-label',
    });

    expect(service.streamLifecycleTotal.add).toHaveBeenCalledWith(1, {
      event: 'timeout',
      reason: 'max_duration',
      phase: 'pre_first_chunk',
      node: 'openai_us_east',
      model: 'gpt-4o_tenant-secret-key-that-should-not-be-a-label',
    });
  });

  it('should record dashboard auth events with bounded labels', () => {
    (service as any).dashboardAuthEvents = { add: jest.fn() };

    service.recordDashboardAuthEvent({
      event: 'disabled_auth',
      mode: 'production_ignored',
    });

    expect(service.dashboardAuthEvents.add).toHaveBeenCalledWith(1, {
      event: 'disabled_auth',
      mode: 'production_ignored',
    });
  });

  it('should record dashboard legacy token events with bounded labels', () => {
    (service as any).dashboardLegacyTokenEvents = { add: jest.fn() };

    service.recordDashboardLegacyTokenEvent({
      event: 'legacy_query_used',
      source: 'query',
    });

    expect(service.dashboardLegacyTokenEvents.add).toHaveBeenCalledWith(1, {
      event: 'legacy_query_used',
      source: 'query',
    });
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
