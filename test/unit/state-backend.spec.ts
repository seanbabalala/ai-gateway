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
    },
  });
}

describe('StateBackendService', () => {
  it('uses memory backend by default for JSON state and rate limits', async () => {
    const state = new StateBackendService(mockConfigService());

    await state.setJson('cache', 'a', { ok: true }, 60);
    expect(await state.getJson('cache', 'a')).toEqual({ ok: true });

    const now = 1_000_000;
    expect(await state.hitRateLimit('rate', 'key:a', 2, 60_000, now)).toMatchObject({
      allowed: true,
      count: 1,
      remaining: 1,
      degraded: false,
    });
    expect(await state.hitRateLimit('rate', 'key:a', 2, 60_000, now + 1)).toMatchObject({
      allowed: true,
      count: 2,
      remaining: 0,
    });
    expect(await state.hitRateLimit('rate', 'key:a', 2, 60_000, now + 2)).toMatchObject({
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
    expect(command).toHaveBeenCalledWith(['INCR', 'test:rate_limit:key:abc:0']);
    expect(command).toHaveBeenCalledWith(['PEXPIRE', 'test:rate_limit:key:abc:0', '60000']);
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
      'test:circuit_breaker:circuits',
      'openai:gpt-4o',
      JSON.stringify({ state: 'OPEN', consecutiveFailures: 3 }),
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
      'test:momentum:session-1',
      '10',
      JSON.stringify({ tier: 'simple', timestamp: 10 }),
    ]);
    expect(command).toHaveBeenCalledWith(['PEXPIRE', 'test:momentum:session-1', '60000']);
  });
});
