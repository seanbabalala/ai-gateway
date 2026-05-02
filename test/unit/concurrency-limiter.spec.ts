import { ConcurrencyLimiterService, ConcurrencyLimitError } from '../../src/routing/concurrency-limiter.service';
import { TelemetryService } from '../../src/telemetry/telemetry.service';
import { NodeConfig } from '../../src/config/gateway.config';

function makeLimiter(): ConcurrencyLimiterService {
  return new ConcurrencyLimiterService(new TelemetryService());
}

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    api_key: 'sk-test',
    models: ['gpt-4o'],
    timeout_ms: 60000,
    max_concurrency: 1,
    queue_timeout_ms: 100,
    queue_policy: 'wait',
    ...overrides,
  };
}

describe('ConcurrencyLimiterService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tracks active slots and releases them once', async () => {
    const limiter = makeLimiter();
    const node = makeNode();

    const lease = await limiter.acquire(node, 'gpt-4o');
    expect(limiter.getNodeStats(node)).toEqual(
      expect.objectContaining({ active: 1, queued: 0 }),
    );

    lease.release();
    lease.release();

    expect(limiter.getNodeStats(node)).toEqual(
      expect.objectContaining({ active: 0, queued: 0 }),
    );
  });

  it('registers a business active-request gauge by node', async () => {
    const gauges: Record<string, any> = {};
    const telemetry = {
      meter: {
        createObservableGauge: jest.fn((name: string) => {
          const gauge = {
            addCallback: jest.fn((handler) => {
              gauge.callback = handler;
            }),
            callback: undefined as any,
          };
          gauges[name] = gauge;
          return gauge;
        }),
      },
    };
    const limiter = new ConcurrencyLimiterService(telemetry as any);
    const node = makeNode();

    const lease = await limiter.acquire(node, 'gpt-4o');
    const observable = { observe: jest.fn() };
    gauges.siftgate_concurrent_requests.callback(observable);

    expect(telemetry.meter.createObservableGauge).toHaveBeenCalledWith(
      'siftgate_concurrent_requests',
      expect.any(Object),
    );
    expect(observable.observe).toHaveBeenCalledWith(1, { node: 'openai' });

    lease.release();
  });

  it('queues wait-policy callers and grants the next slot on release', async () => {
    const limiter = makeLimiter();
    const node = makeNode();

    const first = await limiter.acquire(node, 'gpt-4o');
    const secondPromise = limiter.acquire(node, 'gpt-4o');

    expect(limiter.getNodeStats(node)).toEqual(
      expect.objectContaining({ active: 1, queued: 1 }),
    );

    first.release();
    const second = await secondPromise;

    expect(limiter.getNodeStats(node)).toEqual(
      expect.objectContaining({ active: 1, queued: 0 }),
    );

    second.release();
    expect(limiter.getNodeStats(node).active).toBe(0);
  });

  it('times out queued wait-policy callers and cleans queue depth', async () => {
    jest.useFakeTimers();
    const limiter = makeLimiter();
    const node = makeNode({ queue_timeout_ms: 25 });

    const first = await limiter.acquire(node, 'gpt-4o');
    const secondPromise = limiter.acquire(node, 'gpt-4o');

    jest.advanceTimersByTime(25);

    await expect(secondPromise).rejects.toMatchObject({
      name: 'ConcurrencyLimitError',
      statusCode: 503,
      fallbackAllowed: true,
    });
    expect(limiter.getNodeStats(node).queued).toBe(0);

    first.release();
  });

  it('uses fallback policy without queueing', async () => {
    const limiter = makeLimiter();
    const node = makeNode({ queue_policy: 'fallback' });

    const first = await limiter.acquire(node, 'gpt-4o');
    await expect(limiter.acquire(node, 'gpt-4o')).rejects.toMatchObject({
      name: 'ConcurrencyLimitError',
      statusCode: 503,
      fallbackAllowed: true,
      policy: 'fallback',
    });
    expect(limiter.getNodeStats(node).queued).toBe(0);

    first.release();
  });

  it('uses reject policy with a client-visible 429', async () => {
    const limiter = makeLimiter();
    const node = makeNode({ queue_policy: 'reject' });

    const first = await limiter.acquire(node, 'gpt-4o');

    await expect(limiter.acquire(node, 'gpt-4o')).rejects.toBeInstanceOf(
      ConcurrencyLimitError,
    );
    await expect(limiter.acquire(node, 'gpt-4o')).rejects.toMatchObject({
      statusCode: 429,
      fallbackAllowed: false,
      policy: 'reject',
    });

    first.release();
  });
});
