import { StateBackendService } from '../../src/state/state-backend.service';
import { mockConfigService } from '../helpers';

function redisConfig(policy: 'fail_open' | 'fail_closed' = 'fail_open') {
  return mockConfigService({
    state: {
      backend: 'redis',
      unavailable_policy: policy,
      redis: {
        url: 'redis://localhost:6379',
        prefix: 'test:',
        timeout_ms: 50,
        sync_interval_ms: 1000,
      },
      categories: {
        concurrency: { unavailable_policy: 'fail_closed', ttl_seconds: 45 },
      },
    },
  });
}

describe('StateBackendService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses memory backend by default for JSON state and rate limits', async () => {
    const state = new StateBackendService(mockConfigService());

    await state.setJson('prompt_cache', 'a', { ok: true }, 60);
    expect(await state.getJson('prompt_cache', 'a')).toEqual({ ok: true });

    const now = 1_000_000;
    expect(await state.hitRateLimit('rate_limit', 'key:a', 2, 60_000, now)).toMatchObject({
      allowed: true,
      count: 1,
      remaining: 1,
      degraded: false,
    });
    expect(await state.hitRateLimit('rate_limit', 'key:a', 2, 60_000, now + 1)).toMatchObject({
      allowed: true,
      count: 2,
      remaining: 0,
    });
    expect(await state.hitRateLimit('rate_limit', 'key:a', 2, 60_000, now + 2)).toMatchObject({
      allowed: false,
      count: 3,
      remaining: 0,
    });
  });

  it('uses Redis INCR and PEXPIRE for shared rate limits', async () => {
    const state = new StateBackendService(redisConfig());
    const command = jest.fn(async (args: string[]) => {
      if (args[0] === 'INCR') return 1;
      if (args[0] === 'PEXPIRE') return 1;
      if (args[0] === 'PTTL') return 60_000;
      return 'OK';
    });
    (state as any).redis = { command };
    (state as any).redisAvailable = true;

    const result = await state.hitRateLimit('rate_limit', 'key:abc', 10, 60_000, 1_000);

    expect(result).toMatchObject({ allowed: true, count: 1, remaining: 9, degraded: false });
    expect(command).toHaveBeenCalledWith(['INCR', 'test:ws:default-workspace:rate_limit:key:abc:0']);
    expect(command).toHaveBeenCalledWith(['PEXPIRE', 'test:ws:default-workspace:rate_limit:key:abc:0', '60000']);
  });

  it('fails open when Redis is configured but unavailable', async () => {
    const state = new StateBackendService(redisConfig('fail_open'));

    const result = await state.hitRateLimit('rate_limit', 'key:abc', 1, 60_000, 1_000);

    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
  });

  it('fails closed when Redis is configured and unavailable', async () => {
    const state = new StateBackendService(redisConfig('fail_closed'));

    const result = await state.hitRateLimit('rate_limit', 'key:abc', 1, 60_000, 1_000);

    expect(result.allowed).toBe(false);
    expect(result.degraded).toBe(true);
  });

  it('stores circuit breaker state in a Redis hash', async () => {
    const state = new StateBackendService(redisConfig());
    const command = jest.fn(async () => 1);
    (state as any).redis = { command };
    (state as any).redisAvailable = true;

    await state.setHashJson('circuit_breaker', 'circuits', 'openai:gpt-4o', {
      state: 'OPEN',
      consecutiveFailures: 3,
    });

    expect(command).toHaveBeenCalledWith([
      'HSET',
      'test:ws:default-workspace:circuit_breaker:circuits',
      'openai:gpt-4o',
      JSON.stringify({ state: 'OPEN', consecutiveFailures: 3 }),
    ]);
    expect(command).toHaveBeenCalledWith([
      'EXPIRE',
      'test:ws:default-workspace:circuit_breaker:circuits',
      '3600',
    ]);
  });

  it('stores momentum windows in a Redis sorted set', async () => {
    const state = new StateBackendService(redisConfig());
    const command = jest.fn(async (args: string[]) => {
      if (args[0] === 'ZCARD') return 1;
      return 1;
    });
    (state as any).redis = { command };
    (state as any).redisAvailable = true;

    await state.addSortedJson('momentum', 'session-1', { tier: 'simple', timestamp: 10 }, 10, 10, 60_000);

    expect(command).toHaveBeenCalledWith([
      'ZADD',
      'test:ws:default-workspace:momentum:session-1',
      '10',
      JSON.stringify({ tier: 'simple', timestamp: 10 }),
    ]);
    expect(command).toHaveBeenCalledWith(['PEXPIRE', 'test:ws:default-workspace:momentum:session-1', '60000']);
  });

  it('scopes keys by workspace and category', async () => {
    const state = new StateBackendService(redisConfig());

    expect(state.key('rate_limit', 'api:key-a', 'workspace-a')).toBe(
      'test:ws:workspace-a:rate_limit:api:key-a',
    );
    expect(state.key('rate_limit', 'api:key-a', 'workspace-b')).toBe(
      'test:ws:workspace-b:rate_limit:api:key-a',
    );
    expect(state.keyPrefix('circuit_breaker', 'workspace-a')).toBe(
      'test:ws:workspace-a:circuit_breaker:',
    );
  });

  it('applies category-specific TTL and unavailable policy overrides', async () => {
    const state = new StateBackendService(redisConfig('fail_open'));
    const command = jest.fn(async () => 1);
    (state as any).redis = { command };
    (state as any).redisAvailable = true;

    await state.setJson('concurrency', 'node:openai', { active: 2 });

    expect(command).toHaveBeenCalledWith([
      'SETEX',
      'test:ws:default-workspace:concurrency:node:openai',
      '45',
      JSON.stringify({ active: 2 }),
    ]);
    expect(state.shouldFailClosed('concurrency')).toBe(false);

    (state as any).redisAvailable = false;
    expect(state.shouldFailClosed('concurrency')).toBe(true);
    expect(state.status.categories.concurrency).toMatchObject({
      unavailable_policy: 'fail_closed',
      ttl_seconds: 45,
      shared: true,
    });
  });

  it('clears Redis recovery probes on module destroy', async () => {
    jest.useFakeTimers();
    const state = new StateBackendService(redisConfig());
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    (state as any).redis = redis;

    await state.onModuleInit();
    expect(redis.ping).toHaveBeenCalledTimes(1);

    state.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(3_000);

    expect(redis.ping).toHaveBeenCalledTimes(1);
  });
});
