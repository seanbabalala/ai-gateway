import { CacheAffinityService } from '../../src/routing/cache-affinity.service';
import { mockConfigService } from '../helpers';

function makeService(overrides: {
  cacheAffinity?: Record<string, unknown>;
  stateBackend?: {
    isRedisConfigured: jest.Mock;
    setJson: jest.Mock;
    getJson: jest.Mock;
  };
} = {}) {
  const config = mockConfigService({
    cacheAffinity: {
      enabled: true,
      min_consecutive_hits: 2,
      bonus_weight: 0.35,
      ttl_safety_margin: 0.8,
      ...(overrides.cacheAffinity || {}),
    },
  });
  const service = new CacheAffinityService(
    config as never,
    overrides.stateBackend as never,
  );
  return { service };
}

describe('CacheAffinityService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-06T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns inactive when session_key is missing', () => {
    const { service } = makeService();

    expect(
      service.getCacheAffinity(undefined, 'openai', 'gpt-5', {
        supports_cache: true,
        cache_type: 'automatic',
        cache_ttl_seconds: 600,
      }),
    ).toMatchObject({
      active: false,
      bonus: 0,
      reason: 'session_key_missing',
    });

    service.onModuleDestroy();
  });

  it('activates affinity after consecutive cache hits on the same node:model', () => {
    const { service } = makeService();

    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 120,
    });
    jest.advanceTimersByTime(2_000);
    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 80,
    });

    expect(
      service.getCacheAffinity('session-1', 'openai', 'gpt-5', {
        supports_cache: true,
        cache_type: 'automatic',
        cache_ttl_seconds: 600,
      }),
    ).toMatchObject({
      active: true,
      bonus: 0.35,
      reason: 'cache_affinity_active',
      provider_cache_ttl_seconds: 600,
      consecutive_count: 2,
      cache_type: 'automatic',
    });

    service.onModuleDestroy();
  });

  it('expires affinity when the provider TTL safety window elapses', () => {
    const { service } = makeService();

    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 100,
    });
    jest.advanceTimersByTime(1_000);
    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 100,
    });
    jest.advanceTimersByTime(481_000);

    expect(
      service.getCacheAffinity('session-1', 'openai', 'gpt-5', {
        supports_cache: true,
        cache_type: 'automatic',
        cache_ttl_seconds: 600,
      }),
    ).toMatchObject({
      active: false,
      bonus: 0,
      reason: 'provider_cache_ttl_elapsed',
    });

    service.onModuleDestroy();
  });

  it('expires session history after 30 minutes of inactivity', () => {
    const { service } = makeService();

    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 100,
    });
    jest.advanceTimersByTime(1_000);
    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 100,
    });
    jest.advanceTimersByTime(31 * 60 * 1_000);

    expect(
      service.getCacheAffinity('session-1', 'openai', 'gpt-5', {
        supports_cache: true,
        cache_type: 'automatic',
        cache_ttl_seconds: 3_600,
      }),
    ).toMatchObject({
      active: false,
      bonus: 0,
      reason: 'session_history_expired',
    });

    service.onModuleDestroy();
  });

  it('persists session affinity state to the configured Redis backend', async () => {
    const stateBackend = {
      isRedisConfigured: jest.fn().mockReturnValue(true),
      setJson: jest.fn().mockResolvedValue(undefined),
      getJson: jest.fn().mockResolvedValue(null),
    };
    const { service } = makeService({ stateBackend });

    service.recordRouteResult('session-1', 'openai', 'gpt-5', {
      cache_read_input_tokens: 64,
    });
    await Promise.resolve();

    expect(stateBackend.setJson).toHaveBeenCalledWith(
      'cache_affinity',
      'session-1',
      expect.objectContaining({
        last_node_model: 'openai:gpt-5',
        last_cache_read_tokens: 64,
      }),
      1800,
    );

    service.onModuleDestroy();
  });
});
