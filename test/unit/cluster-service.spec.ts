import { ClusterRedisClient } from '../../src/cluster/redis-cluster.client';
import {
  ClusterRedisRuntimeConfig,
  ClusterService,
} from '../../src/cluster/cluster.service';
import { mockConfigService } from '../helpers';

class MockClusterRedisClient implements ClusterRedisClient {
  readonly store = new Map<string, unknown>();
  readonly published: { channel: string; payload: string }[] = [];
  private handler?: (payload: string) => void;
  closed = false;

  async setJson(
    key: string,
    value: unknown,
    _ttlSeconds: number,
  ): Promise<void> {
    this.store.set(key, value);
  }

  async getJson<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return [...this.store.keys()].filter((key) => key.startsWith(prefix));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async publish(channel: string, payload: string): Promise<void> {
    this.published.push({ channel, payload });
  }

  async subscribe(
    _channel: string,
    handler: (payload: string) => void,
  ): Promise<void> {
    this.handler = handler;
  }

  emit(payload: Record<string, unknown>): void {
    this.handler?.(JSON.stringify(payload));
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeConfig(overrides: Record<string, unknown> = {}): {
  config: any;
  publishReload: (source?: string) => void;
} {
  let reloadHandler: ((result: any) => void | Promise<void>) | undefined;
  const config = mockConfigService({
    cluster: {
      enabled: true,
      instance_id: 'instance-a',
      redis: { url: 'redis://127.0.0.1:6379', prefix: 'siftgate:' },
      heartbeat_interval_seconds: 10,
      heartbeat_ttl_seconds: 30,
      reload_broadcast: true,
    },
    getSnapshot: jest.fn().mockReturnValue({
      version: 7,
      loaded_at: '2026-05-02T00:00:00.000Z',
      path: '/tmp/gateway.config.yaml',
      node_count: 2,
      node_ids: ['openai', 'anthropic'],
      route_tiers: ['standard'],
      control_plane_enabled: false,
      hot_reload_watch: false,
    }),
    reload: jest.fn().mockReturnValue({ success: true }),
    onReloadSuccess: jest.fn(
      (handler: (result: any) => void | Promise<void>) => {
        reloadHandler = handler;
        return { unsubscribe: jest.fn() };
      },
    ),
    ...overrides,
  });

  return {
    config,
    publishReload: (source = 'dashboard') => {
      reloadHandler?.({
        success: true,
        source,
        current: {
          version: 8,
          loaded_at: '2026-05-02T00:01:00.000Z',
        },
      });
    },
  };
}

describe('ClusterService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps single-instance mode disabled by default', async () => {
    const redis = new MockClusterRedisClient();
    const config = mockConfigService({
      cluster: {
        enabled: false,
        instance_id: 'single',
        redis: { url: 'redis://127.0.0.1:6379', prefix: 'siftgate:' },
        heartbeat_interval_seconds: 10,
        heartbeat_ttl_seconds: 30,
        reload_broadcast: true,
      },
    });
    const factory = jest.fn(() => redis);
    const service = new ClusterService(config, factory);

    await service.onModuleInit();

    expect(service.isEnabled()).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    await expect(service.getStatus()).rejects.toThrow(
      'Cluster mode is disabled',
    );
  });

  it('returns dashboard-safe single-instance status with local state backend', async () => {
    const redis = new MockClusterRedisClient();
    const config = mockConfigService({
      cluster: {
        enabled: false,
        instance_id: 'single',
        redis: { url: 'redis://127.0.0.1:6379', prefix: 'siftgate:' },
        heartbeat_interval_seconds: 10,
        heartbeat_ttl_seconds: 30,
        reload_broadcast: true,
      },
    });
    const factory = jest.fn(() => redis);
    const state = {
      status: {
        backend: 'memory',
        configured_backend: 'memory',
        key_prefix: 'siftgate:state:',
        redis_available: false,
        unavailable_policy: 'fail_open',
        degraded: false,
        last_error: null,
        recent_errors: [],
        categories: {},
      },
    };
    const service = new ClusterService(config, factory, state as any);

    await service.onModuleInit();

    await expect(service.getDashboardStatus()).resolves.toMatchObject({
      enabled: false,
      mode: 'single_instance',
      local_node_id: 'single',
      redis: { status: 'disabled', url: null },
      state: { backend: 'memory', degraded: false },
      instance_count: 1,
    });
  });

  it('registers the local instance and exposes cluster status', async () => {
    const redis = new MockClusterRedisClient();
    const { config } = makeConfig();
    const service = new ClusterService(config, () => redis);

    await service.onModuleInit();
    const status = await service.getStatus();

    expect([...redis.store.keys()]).toContain(
      'siftgate:cluster:instances:instance-a',
    );
    expect(
      redis.published.map((item) => JSON.parse(item.payload).type),
    ).toContain('instance.registered');
    expect(status).toMatchObject({
      enabled: true,
      mode: 'redis_pubsub',
      leader_election: false,
      instance_count: 1,
    });

    await service.onModuleDestroy();
  });

  it('publishes periodic heartbeats through Redis Pub/Sub', async () => {
    jest.useFakeTimers();
    const redis = new MockClusterRedisClient();
    const { config } = makeConfig();
    const service = new ClusterService(config, () => redis);

    await service.onModuleInit();
    redis.published.length = 0;
    await jest.advanceTimersByTimeAsync(10_000);

    expect(
      redis.published.map((item) => JSON.parse(item.payload).type),
    ).toContain('instance.heartbeat');

    await service.onModuleDestroy();
  });

  it('broadcasts local config reloads without rebroadcasting cluster reloads', async () => {
    const redis = new MockClusterRedisClient();
    const { config, publishReload } = makeConfig();
    const service = new ClusterService(config, () => redis);

    await service.onModuleInit();
    redis.published.length = 0;

    publishReload('dashboard');
    await Promise.resolve();
    publishReload('cluster');
    await Promise.resolve();

    const reloadEvents = redis.published
      .map((item) => JSON.parse(item.payload))
      .filter((event) => event.type === 'config.reload');
    expect(reloadEvents).toHaveLength(1);
    expect(reloadEvents[0]).toMatchObject({
      origin_instance_id: 'instance-a',
      config_version: 8,
      reload_source: 'dashboard',
    });

    await service.onModuleDestroy();
  });

  it('reloads local config when a peer broadcasts config.reload', async () => {
    const redis = new MockClusterRedisClient();
    const { config } = makeConfig();
    const service = new ClusterService(config, () => redis);

    await service.onModuleInit();
    redis.emit({
      type: 'config.reload',
      origin_instance_id: 'instance-b',
      timestamp: new Date().toISOString(),
      config_version: 9,
    });

    expect(config.reload).toHaveBeenCalledWith({
      source: 'cluster',
      throwOnError: false,
    });

    await service.onModuleDestroy();
  });

  it('includes peer records from Redis in status', async () => {
    const redis = new MockClusterRedisClient();
    const { config } = makeConfig();
    const service = new ClusterService(config, () => redis);

    await service.onModuleInit();
    await redis.setJson(
      'siftgate:cluster:instances:instance-b',
      {
        instance_id: 'instance-b',
        status: 'online',
        started_at: '2026-05-02T00:00:00.000Z',
        last_seen_at: '2026-05-02T00:00:05.000Z',
        host: 'peer-host',
        pid: 222,
        config_version: 7,
        config_loaded_at: '2026-05-02T00:00:00.000Z',
        node_count: 2,
        node_ids: ['openai', 'anthropic'],
        route_tiers: ['standard'],
      },
      30,
    );

    const status = (await service.getStatus()) as { instances: unknown[] };

    expect(status.instances).toHaveLength(2);
    expect(status.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instance_id: 'instance-a' }),
        expect.objectContaining({ instance_id: 'instance-b' }),
      ]),
    );

    await service.onModuleDestroy();
  });

  it('passes Redis runtime config to the client factory', async () => {
    const redis = new MockClusterRedisClient();
    const { config } = makeConfig({
      cluster: {
        enabled: true,
        instance_id: 'instance-a',
        redis: { url: 'rediss://redis.example.com:6380/2', prefix: 'sg:' },
        heartbeat_interval_seconds: 10,
        heartbeat_ttl_seconds: 30,
        reload_broadcast: true,
      },
    });
    const factory = jest.fn((_runtime: ClusterRedisRuntimeConfig) => redis);
    const service = new ClusterService(config, factory);

    await service.onModuleInit();

    expect(factory).toHaveBeenCalledWith({
      url: 'rediss://redis.example.com:6380/2',
      prefix: 'sg:',
    });

    await service.onModuleDestroy();
  });
});
