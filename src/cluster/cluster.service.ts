import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as os from 'os';
import { Subscription } from 'rxjs';
import { ConfigReloadResult, ConfigService } from '../config/config.service';
import { StateBackendService } from '../state/state-backend.service';
import type { StateRuntimeStatus } from '../state/state.types';
import {
  ClusterRedisClient,
  RespClusterRedisClient,
} from './redis-cluster.client';

export const CLUSTER_REDIS_CLIENT_FACTORY = Symbol(
  'CLUSTER_REDIS_CLIENT_FACTORY',
);

export interface ClusterRedisRuntimeConfig {
  url: string;
  prefix: string;
}

export interface ClusterRedisClientFactory {
  (config: ClusterRedisRuntimeConfig): ClusterRedisClient;
}

export interface ClusterInstanceRecord {
  instance_id: string;
  status: 'online' | 'offline';
  started_at: string;
  last_seen_at: string;
  host: string;
  pid: number;
  config_version: number;
  config_loaded_at: string;
  node_count: number;
  node_ids: string[];
  route_tiers: string[];
}

interface ClusterEvent {
  type:
    | 'instance.registered'
    | 'instance.heartbeat'
    | 'instance.offline'
    | 'config.reload';
  origin_instance_id: string;
  timestamp: string;
  instance?: ClusterInstanceRecord;
  config_version?: number;
  config_loaded_at?: string;
  reload_source?: string;
}

@Injectable()
export class ClusterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterService.name);
  private readonly startedAt = new Date().toISOString();
  private client: ClusterRedisClient | null = null;
  private heartbeatTimer?: NodeJS.Timeout;
  private reloadSubscription?: Subscription;
  private redisStatus: 'disabled' | 'connecting' | 'ready' | 'error' =
    'disabled';
  private lastHeartbeatAt: string | null = null;
  private lastEventAt: string | null = null;
  private lastInboundReloadAt: string | null = null;
  private lastOutboundReloadAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(CLUSTER_REDIS_CLIENT_FACTORY)
    private readonly clientFactory?: ClusterRedisClientFactory,
    @Optional() private readonly stateBackend?: StateBackendService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.redisStatus = 'disabled';
      return;
    }

    this.redisStatus = 'connecting';
    try {
      this.client = this.createClient();
      await this.client.subscribe(this.eventsChannel(), (payload) => {
        void this.handleClusterEvent(payload);
      });
      await this.writeHeartbeat('instance.registered');
      this.reloadSubscription = this.config.onReloadSuccess((result) => {
        void this.broadcastConfigReload(result);
      });
      this.startHeartbeatTimer();
      this.redisStatus = 'ready';
      this.lastError = null;
      this.logger.log(
        `Cluster mode enabled for instance ${this.runtime().instance_id}`,
      );
    } catch (err) {
      this.recordError(err);
      await this.client?.close().catch(() => undefined);
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.reloadSubscription?.unsubscribe();
    this.reloadSubscription = undefined;

    if (this.client && this.isEnabled()) {
      await this.publishInstanceEvent('instance.offline').catch(
        () => undefined,
      );
      await this.client.delete(this.instanceKey()).catch(() => undefined);
    }
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }

  isEnabled(): boolean {
    return this.runtime().enabled;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    if (!this.isEnabled()) {
      throw new NotFoundException('Cluster mode is disabled.');
    }

    const runtime = this.runtime();
    const local = this.localInstanceRecord('online');
    let instances = [local];

    if (this.client) {
      try {
        instances = await this.loadInstances();
        if (!instances.some((item) => item.instance_id === local.instance_id)) {
          instances.unshift(local);
        }
        this.redisStatus = 'ready';
        this.lastError = null;
      } catch (err) {
        this.recordError(err);
      }
    }

    return {
      enabled: true,
      mode: 'redis_pubsub',
      leader_election: false,
      local_node_id: runtime.instance_id,
      redis: {
        status: this.redisStatus,
        url: sanitizeRedisUrl(runtime.redis.url),
        prefix: runtime.redis.prefix,
        last_error: this.lastError,
      },
      state: this.privacySafeStateStatus(),
      reload_broadcast: runtime.reload_broadcast,
      heartbeat_interval_seconds: runtime.heartbeat_interval_seconds,
      heartbeat_ttl_seconds: runtime.heartbeat_ttl_seconds,
      local_instance: local,
      instances,
      instance_count: instances.length,
      channels: {
        events: this.eventsChannel(),
      },
      last_heartbeat_at: this.lastHeartbeatAt,
      last_event_at: this.lastEventAt,
      last_inbound_reload_at: this.lastInboundReloadAt,
      last_outbound_reload_at: this.lastOutboundReloadAt,
    };
  }

  async getDashboardStatus(): Promise<Record<string, unknown>> {
    const runtime = this.runtime();
    if (!this.isEnabled()) {
      return {
        enabled: false,
        mode: 'single_instance',
        leader_election: false,
        local_node_id: runtime.instance_id,
        redis: {
          status: 'disabled',
          url: null,
          prefix: runtime.redis.prefix,
          last_error: null,
        },
        state: this.privacySafeStateStatus(),
        reload_broadcast: false,
        heartbeat_interval_seconds: runtime.heartbeat_interval_seconds,
        heartbeat_ttl_seconds: runtime.heartbeat_ttl_seconds,
        local_instance: this.localInstanceRecord('online'),
        instances: [this.localInstanceRecord('online')],
        instance_count: 1,
        channels: { events: null },
        last_heartbeat_at: null,
        last_event_at: this.lastEventAt,
        last_inbound_reload_at: this.lastInboundReloadAt,
        last_outbound_reload_at: this.lastOutboundReloadAt,
      };
    }
    return this.getStatus();
  }

  private runtime() {
    return this.config.cluster;
  }

  private createClient(): ClusterRedisClient {
    const factory =
      this.clientFactory ??
      ((config: ClusterRedisRuntimeConfig) =>
        new RespClusterRedisClient({ url: config.url }));
    return factory(this.runtime().redis);
  }

  private startHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const intervalMs = this.runtime().heartbeat_interval_seconds * 1000;
    this.heartbeatTimer = setInterval(() => {
      void this.writeHeartbeat('instance.heartbeat');
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private async writeHeartbeat(eventType: ClusterEvent['type']): Promise<void> {
    if (!this.client || !this.isEnabled()) return;
    const runtime = this.runtime();
    const instance = this.localInstanceRecord('online');
    await this.client.setJson(
      this.instanceKey(instance.instance_id),
      instance,
      runtime.heartbeat_ttl_seconds,
    );
    this.lastHeartbeatAt = instance.last_seen_at;
    this.redisStatus = 'ready';
    this.lastError = null;
    await this.publishInstanceEvent(eventType, instance);
  }

  private async publishInstanceEvent(
    type: ClusterEvent['type'],
    instance = this.localInstanceRecord(
      type === 'instance.offline' ? 'offline' : 'online',
    ),
  ): Promise<void> {
    if (!this.client) return;
    await this.client.publish(
      this.eventsChannel(),
      JSON.stringify({
        type,
        origin_instance_id: this.runtime().instance_id,
        timestamp: new Date().toISOString(),
        instance,
      } satisfies ClusterEvent),
    );
    this.lastEventAt = new Date().toISOString();
  }

  private async broadcastConfigReload(
    result: ConfigReloadResult,
  ): Promise<void> {
    if (
      !this.client ||
      !this.isEnabled() ||
      !this.runtime().reload_broadcast ||
      result.source === 'cluster'
    ) {
      return;
    }

    try {
      await this.client.publish(
        this.eventsChannel(),
        JSON.stringify({
          type: 'config.reload',
          origin_instance_id: this.runtime().instance_id,
          timestamp: new Date().toISOString(),
          config_version: result.current.version,
          config_loaded_at: result.current.loaded_at,
          reload_source: result.source,
        } satisfies ClusterEvent),
      );
      this.lastOutboundReloadAt = new Date().toISOString();
      this.lastEventAt = this.lastOutboundReloadAt;
      this.redisStatus = 'ready';
      this.lastError = null;
    } catch (err) {
      this.recordError(err);
    }
  }

  private async handleClusterEvent(payload: string): Promise<void> {
    let event: ClusterEvent;
    try {
      event = JSON.parse(payload) as ClusterEvent;
    } catch {
      return;
    }

    if (event.origin_instance_id === this.runtime().instance_id) return;
    this.lastEventAt = new Date().toISOString();

    if (event.type !== 'config.reload') return;
    if (!this.runtime().reload_broadcast) return;

    this.lastInboundReloadAt = this.lastEventAt;
    try {
      this.config.reload({ source: 'cluster', throwOnError: false });
    } catch (err) {
      this.recordError(err);
    }
  }

  private async loadInstances(): Promise<ClusterInstanceRecord[]> {
    if (!this.client) return [this.localInstanceRecord('online')];
    const keys = await this.client.keys(`${this.instancesPrefix()}*`);
    const records: ClusterInstanceRecord[] = [];
    for (const key of keys.sort()) {
      const record = await this.client.getJson<ClusterInstanceRecord>(key);
      if (isClusterInstanceRecord(record)) {
        records.push(record);
      }
    }
    return records;
  }

  private localInstanceRecord(
    status: ClusterInstanceRecord['status'],
  ): ClusterInstanceRecord {
    const snapshot = this.config.getSnapshot();
    return {
      instance_id: this.runtime().instance_id,
      status,
      started_at: this.startedAt,
      last_seen_at: new Date().toISOString(),
      host: os.hostname(),
      pid: process.pid,
      config_version: snapshot.version,
      config_loaded_at: snapshot.loaded_at,
      node_count: snapshot.node_count,
      node_ids: snapshot.node_ids,
      route_tiers: snapshot.route_tiers,
    };
  }

  private eventsChannel(): string {
    return `${this.runtime().redis.prefix}cluster:events`;
  }

  private instancesPrefix(): string {
    return `${this.runtime().redis.prefix}cluster:instances:`;
  }

  private instanceKey(instanceId = this.runtime().instance_id): string {
    return `${this.instancesPrefix()}${instanceId}`;
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.redisStatus = 'error';
    this.lastError = message;
    this.logger.warn(`Cluster Redis operation failed: ${message}`);
  }

  private privacySafeStateStatus(): StateRuntimeStatus | null {
    const status = this.stateBackend?.status;
    if (!status) return null;
    return {
      ...status,
      key_prefix: status.key_prefix,
      last_error: status.last_error,
      recent_errors: status.recent_errors,
      categories: status.categories,
    };
  }
}

function isClusterInstanceRecord(
  value: unknown,
): value is ClusterInstanceRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ClusterInstanceRecord;
  return (
    typeof record.instance_id === 'string' &&
    (record.status === 'online' || record.status === 'offline') &&
    typeof record.last_seen_at === 'string' &&
    typeof record.config_version === 'number'
  );
}

function sanitizeRedisUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = 'redacted';
    if (url.username) url.username = 'redacted';
    return url.toString();
  } catch {
    return '[invalid redis url]';
  }
}
