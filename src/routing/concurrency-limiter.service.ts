import { Injectable, Logger, Optional } from '@nestjs/common';
import { NodeConfig, QueuePolicy } from '../config/gateway.config';
import { TelemetryService } from '../telemetry/telemetry.service';
import { StateBackendService } from '../state/state-backend.service';

export interface ConcurrencyLease {
  readonly nodeId: string;
  readonly model: string;
  release(): void;
}

export interface ConcurrencyLimitSnapshot {
  node: string;
  model?: string;
  max_concurrency: number | null;
  queue_timeout_ms: number;
  queue_policy: QueuePolicy;
  active: number;
  queued: number;
}

export class ConcurrencyLimitError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly model: string,
    public readonly statusCode: number,
    public readonly policy: QueuePolicy,
    public readonly fallbackAllowed: boolean,
  ) {
    super(message);
    this.name = 'ConcurrencyLimitError';
  }
}

interface QueueEntry {
  nodeId: string;
  model: string;
  timer: NodeJS.Timeout;
  resolve: (lease: ConcurrencyLease) => void;
  reject: (error: ConcurrencyLimitError) => void;
}

interface LimiterState {
  active: number;
  queue: QueueEntry[];
  max: number | null;
}

interface LimitSettings {
  max: number | null;
  queueTimeoutMs: number;
  policy: QueuePolicy;
}

@Injectable()
export class ConcurrencyLimiterService {
  private readonly logger = new Logger(ConcurrencyLimiterService.name);
  private readonly states = new Map<string, LimiterState>();

  constructor(
    private readonly telemetry: TelemetryService,
    @Optional() private readonly stateBackend?: StateBackendService,
  ) {
    this.registerMetrics();
  }

  async acquire(node: NodeConfig, model: string): Promise<ConcurrencyLease> {
    const settings = this.getSettings(node);
    if (!settings.max) {
      return this.createNoopLease(node.id, model);
    }

    const key = this.buildKey(node.id);
    const state = this.getState(key, settings.max);

    if (state.active < settings.max) {
      state.active += 1;
      this.publishClusterSnapshot();
      return this.createLease(key, node.id, model);
    }

    if (settings.policy === 'fallback') {
      throw new ConcurrencyLimitError(
        `Node "${node.id}" is at its concurrency limit (${settings.max}); trying fallback.`,
        node.id,
        model,
        503,
        settings.policy,
        true,
      );
    }

    if (settings.policy === 'reject') {
      throw new ConcurrencyLimitError(
        `Node "${node.id}" is at its concurrency limit (${settings.max}).`,
        node.id,
        model,
        429,
        settings.policy,
        false,
      );
    }

    return this.enqueueWaiter(key, node.id, model, settings);
  }

  getNodeStats(node: NodeConfig): ConcurrencyLimitSnapshot {
    const settings = this.getSettings(node);
    const state = this.states.get(this.buildKey(node.id));
    return {
      node: node.id,
      max_concurrency: settings.max,
      queue_timeout_ms: settings.queueTimeoutMs,
      queue_policy: settings.policy,
      active: state?.active ?? 0,
      queued: state?.queue.length ?? 0,
    };
  }

  getAllNodeStats(nodes: NodeConfig[]): ConcurrencyLimitSnapshot[] {
    return nodes.map((node) => this.getNodeStats(node));
  }

  publishClusterSnapshot(): void {
    if (!this.stateBackend?.isRedisConfigured()) return;
    const nodes = [...this.states.entries()].map(([node, state]) => ({
      node,
      active: state.active,
      queued: state.queue.length,
      max_concurrency: state.max,
    }));
    this.stateBackend
      .setJson('concurrency', 'local-node-summary', {
        updated_at: new Date().toISOString(),
        nodes,
      })
      .catch((err) =>
        this.logger.warn(`Concurrency state write skipped: ${(err as Error).message}`),
      );
  }

  private enqueueWaiter(
    key: string,
    nodeId: string,
    model: string,
    settings: LimitSettings,
  ): Promise<ConcurrencyLease> {
    const state = this.getState(key);

    return new Promise((resolve, reject) => {
      const entry: QueueEntry = {
        nodeId,
        model,
        timer: setTimeout(() => {
          this.removeQueueEntry(key, entry);
          reject(
            new ConcurrencyLimitError(
              `Timed out waiting ${settings.queueTimeoutMs}ms for a concurrency slot on node "${nodeId}".`,
              nodeId,
              model,
              503,
              settings.policy,
              true,
            ),
          );
        }, settings.queueTimeoutMs),
        resolve,
        reject,
      };

      state.queue.push(entry);
      this.publishClusterSnapshot();
      this.logger.debug(
        `Queued request for ${nodeId}:${model}; active=${state.active}, queued=${state.queue.length}`,
      );
    });
  }

  private release(key: string): void {
    const state = this.states.get(key);
    if (!state) return;

    state.active = Math.max(0, state.active - 1);
    this.drainQueue(key, state);
    this.publishClusterSnapshot();
  }

  private drainQueue(key: string, state: LimiterState): void {
    const max = state.max;
    if (!max) return;

    while (state.active < max && state.queue.length > 0) {
      const next = state.queue.shift()!;
      clearTimeout(next.timer);
      state.active += 1;
      next.resolve(this.createLease(key, next.nodeId, next.model));
    }
    this.publishClusterSnapshot();
  }

  private removeQueueEntry(key: string, entry: QueueEntry): void {
    const state = this.states.get(key);
    if (!state) return;

    const idx = state.queue.indexOf(entry);
    if (idx >= 0) {
      state.queue.splice(idx, 1);
      this.publishClusterSnapshot();
    }
  }

  private createLease(
    key: string,
    nodeId: string,
    model: string,
  ): ConcurrencyLease {
    let released = false;
    return {
      nodeId,
      model,
      release: () => {
        if (released) return;
        released = true;
        this.release(key);
      },
    };
  }

  private createNoopLease(nodeId: string, model: string): ConcurrencyLease {
    return {
      nodeId,
      model,
      release: () => undefined,
    };
  }

  private getState(key: string, max?: number | null): LimiterState {
    let state = this.states.get(key);
    if (!state) {
      state = { active: 0, queue: [], max: max ?? null };
      this.states.set(key, state);
    } else if (max !== undefined) {
      state.max = max;
    }
    return state;
  }

  private getSettings(node: NodeConfig): LimitSettings {
    const max =
      typeof node.max_concurrency === 'number' && node.max_concurrency > 0
        ? Math.floor(node.max_concurrency)
        : null;
    const queueTimeoutMs =
      typeof node.queue_timeout_ms === 'number' && node.queue_timeout_ms >= 0
        ? node.queue_timeout_ms
        : 10_000;
    const policy = this.normalizePolicy(node.queue_policy);

    return { max, queueTimeoutMs, policy };
  }

  private normalizePolicy(policy: NodeConfig['queue_policy']): QueuePolicy {
    if (policy === 'fallback' || policy === 'reject' || policy === 'wait') {
      return policy;
    }
    return 'wait';
  }

  private buildKey(nodeId: string): string {
    return nodeId;
  }

  private registerMetrics(): void {
    const activeGauge = this.telemetry.meter.createObservableGauge(
      'gateway.concurrency.active',
      {
        description: 'Current in-flight upstream requests by node',
        unit: '{request}',
      },
    );
    activeGauge.addCallback((observable) => {
      for (const [node, state] of this.states.entries()) {
        observable.observe(state.active, { node });
      }
    });

    const businessActiveGauge = this.telemetry.meter.createObservableGauge(
      'siftgate_concurrent_requests',
      {
        description: 'Current in-flight upstream requests by node',
        unit: '{request}',
      },
    );
    businessActiveGauge.addCallback((observable) => {
      for (const [node, state] of this.states.entries()) {
        observable.observe(state.active, { node });
      }
    });

    const queueGauge = this.telemetry.meter.createObservableGauge(
      'gateway.concurrency.queue_depth',
      {
        description: 'Current queued upstream requests by node',
        unit: '{request}',
      },
    );
    queueGauge.addCallback((observable) => {
      for (const [node, state] of this.states.entries()) {
        observable.observe(state.queue.length, { node });
      }
    });
  }
}
