import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  HealthCheckMethod,
  NodeConfig,
  NodeHealthCheckConfig,
} from '../config/gateway.config';
import { CircuitBreakerService } from './circuit-breaker.service';
import { AlertService } from '../alerts/alert.service';

export type ActiveProbeStatus = 'disabled' | 'unknown' | 'healthy' | 'unhealthy';

export interface ActiveHealthProbeSnapshot {
  enabled: boolean;
  status: ActiveProbeStatus;
  method: HealthCheckMethod | null;
  target: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  latency_ms: number | null;
  failure_reason: string | null;
  consecutive_failures: number;
}

interface NormalizedHealthCheck {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  method: HealthCheckMethod;
  path: string;
  lightweightModel?: string;
}

@Injectable()
export class ActiveHealthProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActiveHealthProbeService.name);
  private readonly statuses = new Map<string, ActiveHealthProbeSnapshot>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly timerIntervals = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    @Optional() private readonly alerts?: AlertService,
  ) {}

  onModuleInit(): void {
    this.refreshSchedules();
  }

  onModuleDestroy(): void {
    this.stopAll();
  }

  refreshSchedules(): void {
    const enabledNodes = new Map(
      this.config.nodes
        .filter((node) => this.normalizeHealthCheck(node).enabled)
        .map((node) => [node.id, node]),
    );

    for (const nodeId of this.timers.keys()) {
      if (!enabledNodes.has(nodeId)) {
        this.stopNodeTimer(nodeId);
      }
    }

    for (const node of enabledNodes.values()) {
      const check = this.normalizeHealthCheck(node);
      if (this.timers.has(node.id) && this.timerIntervals.get(node.id) === check.intervalMs) {
        continue;
      }
      this.stopNodeTimer(node.id);
      void this.probeNode(node.id);
      const timer = setInterval(() => {
        void this.probeNode(node.id);
      }, check.intervalMs);
      timer.unref?.();
      this.timers.set(node.id, timer);
      this.timerIntervals.set(node.id, check.intervalMs);
      this.logger.log(
        `Active health probe enabled for "${node.id}" (${check.intervalMs / 1000}s interval)`,
      );
    }

    for (const node of this.config.nodes) {
      if (!enabledNodes.has(node.id)) {
        this.statuses.set(node.id, this.initialSnapshot(node));
      }
    }
  }

  async probeNode(nodeId: string): Promise<ActiveHealthProbeSnapshot> {
    const node = this.config.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const check = this.normalizeHealthCheck(node);
    if (!check.enabled) {
      const snapshot = this.initialSnapshot(node);
      this.statuses.set(node.id, snapshot);
      return snapshot;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), check.timeoutMs);
    timeout.unref?.();

    try {
      const request = this.buildProbeRequest(node, check);
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - startedAt;
      if (response.ok) {
        return this.recordSuccess(node, check, latencyMs);
      }

      const responseText = await response.text().catch(() => '');
      return this.recordFailure(
        node,
        check,
        latencyMs,
        `HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 160)}` : ''}`,
      );
    } catch (err) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;
      const error = err as Error;
      const reason = error.name === 'AbortError'
        ? `Timed out after ${check.timeoutMs}ms`
        : error.message;
      return this.recordFailure(node, check, latencyMs, reason);
    }
  }

  getNodeStatus(nodeId: string): ActiveHealthProbeSnapshot {
    const node = this.config.getNode(nodeId);
    if (!node) {
      return {
        enabled: false,
        status: 'disabled',
        method: null,
        target: null,
        last_checked_at: null,
        last_success_at: null,
        latency_ms: null,
        failure_reason: 'Node not found',
        consecutive_failures: 0,
      };
    }

    const snapshot = this.statuses.get(nodeId) || this.initialSnapshot(node);
    const check = this.normalizeHealthCheck(node);
    return {
      ...snapshot,
      enabled: check.enabled,
      method: check.enabled ? check.method : null,
      target: check.enabled ? this.describeTarget(node, check) : null,
      status: check.enabled ? snapshot.status : 'disabled',
    };
  }

  getAllStatuses(): Record<string, ActiveHealthProbeSnapshot> {
    const result: Record<string, ActiveHealthProbeSnapshot> = {};
    for (const node of this.config.nodes) {
      result[node.id] = this.getNodeStatus(node.id);
    }
    return result;
  }

  private buildProbeRequest(
    node: NodeConfig,
    check: NormalizedHealthCheck,
  ): {
    url: string;
    method: HealthCheckMethod;
    headers: Record<string, string>;
    body?: string;
  } {
    const headers = this.buildHeaders(node, check.method);
    const url = this.buildUrl(node.base_url, check.path);
    if (check.method !== 'POST') {
      return { url, method: check.method, headers };
    }

    const model = check.lightweightModel || node.models[0];
    if (!model) {
      throw new Error(`Node "${node.id}" has no model available for POST health probe`);
    }

    return {
      url,
      method: 'POST',
      headers,
      body: JSON.stringify(this.buildSyntheticProbeBody(node, model)),
    };
  }

  private buildHeaders(
    node: NodeConfig,
    method: HealthCheckMethod,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const authType =
      node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'x-api-key') {
      headers['x-api-key'] = node.api_key;
      headers['anthropic-version'] = node.headers?.['anthropic-version'] || '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${node.api_key}`;
    }

    if (node.headers) Object.assign(headers, node.headers);
    return headers;
  }

  private buildSyntheticProbeBody(
    node: NodeConfig,
    model: string,
  ): Record<string, unknown> {
    if (node.protocol === 'responses') {
      return {
        model,
        stream: false,
        max_output_tokens: 1,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'health check' }],
          },
        ],
      };
    }

    if (node.protocol === 'messages') {
      return {
        model,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'health check' }],
      };
    }

    return {
      model,
      stream: false,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'health check' }],
    };
  }

  private recordSuccess(
    node: NodeConfig,
    check: NormalizedHealthCheck,
    latencyMs: number,
  ): ActiveHealthProbeSnapshot {
    const previous = this.statuses.get(node.id);
    const now = new Date().toISOString();
    const snapshot: ActiveHealthProbeSnapshot = {
      enabled: true,
      status: 'healthy',
      method: check.method,
      target: this.describeTarget(node, check),
      last_checked_at: now,
      last_success_at: now,
      latency_ms: latencyMs,
      failure_reason: null,
      consecutive_failures: 0,
    };
    this.statuses.set(node.id, snapshot);
    for (const model of this.modelsForCircuit(node)) {
      this.circuitBreaker.recordProbeSuccess(node.id, model);
    }
    if (previous?.status === 'unhealthy') {
      this.alerts?.emit({
        type: 'node_recovered',
        severity: 'info',
        message: `Node recovered: ${node.id}.`,
        dedupeKey: node.id,
        details: {
          node_id: node.id,
          method: check.method,
          target: this.describeTarget(node, check),
          latency_ms: latencyMs,
          previous_failure_reason: previous.failure_reason,
        },
      });
    }
    return snapshot;
  }

  private recordFailure(
    node: NodeConfig,
    check: NormalizedHealthCheck,
    latencyMs: number,
    reason: string,
  ): ActiveHealthProbeSnapshot {
    const previous = this.statuses.get(node.id);
    const snapshot: ActiveHealthProbeSnapshot = {
      enabled: true,
      status: 'unhealthy',
      method: check.method,
      target: this.describeTarget(node, check),
      last_checked_at: new Date().toISOString(),
      last_success_at: previous?.last_success_at ?? null,
      latency_ms: latencyMs,
      failure_reason: reason,
      consecutive_failures: (previous?.consecutive_failures ?? 0) + 1,
    };
    this.statuses.set(node.id, snapshot);
    for (const model of this.modelsForCircuit(node)) {
      this.circuitBreaker.markUnavailable(node.id, model, reason);
    }
    if (previous?.status !== 'unhealthy') {
      this.alerts?.emit({
        type: 'node_down',
        severity: 'critical',
        message: `Node down: ${node.id} (${reason}).`,
        dedupeKey: node.id,
        details: {
          node_id: node.id,
          method: check.method,
          target: this.describeTarget(node, check),
          latency_ms: latencyMs,
          failure_reason: reason,
          consecutive_failures: snapshot.consecutive_failures,
        },
      });
    }
    return snapshot;
  }

  private modelsForCircuit(node: NodeConfig): Array<string | undefined> {
    return node.models.length > 0 ? node.models : [undefined];
  }

  private initialSnapshot(node: NodeConfig): ActiveHealthProbeSnapshot {
    const check = this.normalizeHealthCheck(node);
    return {
      enabled: check.enabled,
      status: check.enabled ? 'unknown' : 'disabled',
      method: check.enabled ? check.method : null,
      target: check.enabled ? this.describeTarget(node, check) : null,
      last_checked_at: null,
      last_success_at: null,
      latency_ms: null,
      failure_reason: null,
      consecutive_failures: 0,
    };
  }

  private normalizeHealthCheck(node: NodeConfig): NormalizedHealthCheck {
    const raw: NodeHealthCheckConfig = node.health_check || {};
    const rawMethod = raw.method?.toUpperCase();
    const method: HealthCheckMethod =
      rawMethod === 'HEAD' || rawMethod === 'GET' || rawMethod === 'POST'
        ? rawMethod
        : raw.lightweight_model
          ? 'POST'
          : 'HEAD';

    return {
      enabled: raw.enabled ?? false,
      intervalMs: Math.max(1, raw.interval_seconds ?? 30) * 1000,
      timeoutMs: Math.max(1, raw.timeout_ms ?? Math.min(node.timeout_ms || 5000, 5000)),
      method,
      path: raw.path || node.endpoint,
      lightweightModel: raw.lightweight_model,
    };
  }

  private describeTarget(node: NodeConfig, check: NormalizedHealthCheck): string {
    const model = check.method === 'POST'
      ? ` model=${check.lightweightModel || node.models[0] || 'unknown'}`
      : '';
    return `${check.method} ${check.path}${model}`;
  }

  private buildUrl(baseUrl: string, probePath: string): string {
    if (/^https?:\/\//i.test(probePath)) {
      return probePath;
    }
    const base = baseUrl.replace(/\/+$/, '');
    const path = probePath.startsWith('/') ? probePath : `/${probePath}`;
    return `${base}${path}`;
  }

  private stopNodeTimer(nodeId: string): void {
    const timer = this.timers.get(nodeId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(nodeId);
      this.timerIntervals.delete(nodeId);
    }
  }

  private stopAll(): void {
    for (const nodeId of this.timers.keys()) {
      this.stopNodeTimer(nodeId);
    }
  }
}
