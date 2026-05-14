import { Injectable } from '@nestjs/common';
import {
  CredentialPoolConfig,
  CredentialPoolStrategy,
  CredentialStickyBy,
  NodeConfig,
  NodeCredentialConfig,
} from '../config/gateway.config';
import { CanonicalRequestMetadata } from '../canonical/canonical.types';

const DEFAULT_RETRY_STATUSES = [429, 500, 502, 503, 504];
const AUTH_FAILURE_STATUSES = [401, 403];

export interface CredentialSelection {
  nodeId: string;
  credential: NodeCredentialConfig;
  strategy: CredentialPoolStrategy;
  stickyBy: CredentialStickyBy;
  cooldownMs: number;
  maxFailures: number;
  retryOnStatus: number[];
  synthetic: boolean;
}

export interface CredentialRuntimeStatus {
  id: string;
  enabled: boolean;
  weight: number;
  active: number;
  failures: number;
  cooldown_until: string | null;
  last_status: number | null;
  last_error: string | null;
  updated_at: string | null;
}

interface CredentialState {
  active: number;
  failures: number;
  cooldownUntil: number;
  lastStatus: number | null;
  lastError: string | null;
  updatedAt: number | null;
}

interface SelectionContext {
  metadata?: CanonicalRequestMetadata;
  triedCredentialIds?: Set<string>;
}

interface ReportResult {
  statusCode?: number;
  failureType?: string;
  error?: string | null;
  retryAfter?: string | null;
}

@Injectable()
export class CredentialPoolService {
  private readonly states = new Map<string, CredentialState>();
  private readonly roundRobinCursors = new Map<string, number>();
  private readonly stickyAssignments = new Map<string, string>();

  select(node: NodeConfig, context: SelectionContext = {}): CredentialSelection {
    const credentials = this.listCredentials(node);
    if (credentials.length === 0) {
      throw new Error(`Node "${node.id}" must define api_key or credentials`);
    }

    const pool = this.resolvePool(node);
    const enabled = credentials.filter((entry) => entry.enabled !== false);
    if (enabled.length === 0) {
      throw new Error(`Node "${node.id}" has no enabled provider credentials`);
    }

    const tried = context.triedCredentialIds || new Set<string>();
    const untried = enabled.filter((entry) => !tried.has(entry.id));
    const candidates = this.availableCredentials(node.id, untried.length ? untried : enabled);
    const stickyKey = this.stickyKey(node.id, pool.sticky_by, context.metadata);
    if (stickyKey) {
      const assignedId = this.stickyAssignments.get(stickyKey);
      const assigned = assignedId
        ? candidates.find((entry) => entry.id === assignedId)
        : undefined;
      if (assigned) {
        this.markActive(node.id, assigned.id);
        return this.toSelection(node, assigned, pool, credentials);
      }
    }

    const selected =
      pool.strategy === 'weighted_round_robin'
        ? this.selectWeightedRoundRobin(node.id, candidates)
        : this.selectLeastInFlight(node.id, candidates);

    if (stickyKey) {
      this.stickyAssignments.set(stickyKey, selected.id);
    }
    this.markActive(node.id, selected.id);
    return this.toSelection(node, selected, pool, credentials);
  }

  complete(selection: CredentialSelection, result: ReportResult): void {
    const state = this.stateFor(selection.nodeId, selection.credential.id);
    state.active = Math.max(0, state.active - 1);

    const statusCode = result.statusCode ?? null;
    state.lastStatus = statusCode;
    state.lastError = result.error || null;
    state.updatedAt = Date.now();

    if (statusCode !== null && statusCode >= 200 && statusCode < 400) {
      state.failures = 0;
      state.cooldownUntil = 0;
      return;
    }

    if (statusCode === 400 || statusCode === 499) {
      return;
    }

    const pool = this.resolvePoolFromSelection(selection);
    if (
      statusCode !== null &&
      AUTH_FAILURE_STATUSES.includes(statusCode)
    ) {
      state.failures = Math.max(state.failures + 1, pool.max_failures);
      state.cooldownUntil = Date.now() + Math.max(pool.cooldown_ms, 300_000);
      return;
    }

    if (
      result.failureType === 'timeout' ||
      result.failureType === 'network_error' ||
      statusCode === 0 ||
      (statusCode !== null && pool.retry_on_status.includes(statusCode))
    ) {
      state.failures += 1;
      const retryAfterMs = parseRetryAfterMs(result.retryAfter);
      const baseCooldown = retryAfterMs ?? pool.cooldown_ms;
      state.cooldownUntil = Date.now() + Math.max(0, baseCooldown);
    }
  }

  shouldRetry(
    node: NodeConfig,
    statusCode: number,
    failureType?: string,
  ): boolean {
    const credentials = this.listCredentials(node).filter((entry) => entry.enabled !== false);
    if (credentials.length <= 1 || this.resolvePool(node).enabled === false) return false;
    if (AUTH_FAILURE_STATUSES.includes(statusCode)) return true;
    if (failureType === 'timeout' || failureType === 'network_error') return true;
    return this.resolvePool(node).retry_on_status.includes(statusCode);
  }

  attemptLimit(node: NodeConfig): number {
    const credentials = this.listCredentials(node).filter((entry) => entry.enabled !== false);
    if (credentials.length <= 1 || this.resolvePool(node).enabled === false) return 1;
    return credentials.length;
  }

  getNodeStatus(node: NodeConfig): {
    enabled: boolean;
    strategy: CredentialPoolStrategy;
    sticky_by: CredentialStickyBy;
    cooldown_ms: number;
    max_failures: number;
    retry_on_status: number[];
    credentials: CredentialRuntimeStatus[];
  } {
    const pool = this.resolvePool(node);
    return {
      enabled: pool.enabled !== false && this.listCredentials(node).length > 1,
      strategy: pool.strategy,
      sticky_by: pool.sticky_by,
      cooldown_ms: pool.cooldown_ms,
      max_failures: pool.max_failures,
      retry_on_status: [...pool.retry_on_status],
      credentials: this.listCredentials(node).map((credential) => {
        const state = this.stateFor(node.id, credential.id);
        return {
          id: credential.id,
          enabled: credential.enabled !== false,
          weight: this.weightOf(credential),
          active: state.active,
          failures: state.failures,
          cooldown_until:
            state.cooldownUntil > Date.now()
              ? new Date(state.cooldownUntil).toISOString()
              : null,
          last_status: state.lastStatus,
          last_error: state.lastError,
          updated_at: state.updatedAt
            ? new Date(state.updatedAt).toISOString()
            : null,
        };
      }),
    };
  }

  listCredentials(node: NodeConfig): NodeCredentialConfig[] {
    if (Array.isArray(node.credentials) && node.credentials.length > 0) {
      return node.credentials.map((credential) => ({
        ...credential,
        weight: this.weightOf(credential),
        enabled: credential.enabled !== false,
      }));
    }
    if (typeof node.api_key === 'string' && node.api_key.trim()) {
      return [
        {
          id: 'default',
          api_key: node.api_key,
          weight: 1,
          enabled: true,
        },
      ];
    }
    return [];
  }

  private availableCredentials(
    nodeId: string,
    credentials: NodeCredentialConfig[],
  ): NodeCredentialConfig[] {
    const now = Date.now();
    const available = credentials.filter(
      (credential) => this.stateFor(nodeId, credential.id).cooldownUntil <= now,
    );
    return available.length > 0 ? available : credentials;
  }

  private selectLeastInFlight(
    nodeId: string,
    credentials: NodeCredentialConfig[],
  ): NodeCredentialConfig {
    return [...credentials].sort((a, b) => {
      const aState = this.stateFor(nodeId, a.id);
      const bState = this.stateFor(nodeId, b.id);
      const aScore = aState.active / this.weightOf(a);
      const bScore = bState.active / this.weightOf(b);
      return (
        aScore - bScore ||
        aState.failures - bState.failures ||
        (aState.updatedAt || 0) - (bState.updatedAt || 0) ||
        a.id.localeCompare(b.id)
      );
    })[0];
  }

  private selectWeightedRoundRobin(
    nodeId: string,
    credentials: NodeCredentialConfig[],
  ): NodeCredentialConfig {
    const totalWeight = credentials.reduce(
      (sum, credential) => sum + this.weightOf(credential),
      0,
    );
    const nextCursor = (this.roundRobinCursors.get(nodeId) || 0) % totalWeight;
    this.roundRobinCursors.set(nodeId, nextCursor + 1);

    let seen = 0;
    for (const credential of credentials) {
      seen += this.weightOf(credential);
      if (nextCursor < seen) return credential;
    }
    return credentials[0];
  }

  private markActive(nodeId: string, credentialId: string): void {
    this.stateFor(nodeId, credentialId).active += 1;
  }

  private toSelection(
    node: NodeConfig,
    credential: NodeCredentialConfig,
    pool: Required<CredentialPoolConfig>,
    allCredentials: NodeCredentialConfig[],
  ): CredentialSelection {
    return {
      nodeId: node.id,
      credential,
      strategy: pool.strategy,
      stickyBy: pool.sticky_by,
      cooldownMs: pool.cooldown_ms,
      maxFailures: pool.max_failures,
      retryOnStatus: [...pool.retry_on_status],
      synthetic: allCredentials.length === 1 && credential.id === 'default' && !node.credentials?.length,
    };
  }

  private stickyKey(
    nodeId: string,
    stickyBy: CredentialStickyBy,
    metadata?: CanonicalRequestMetadata,
  ): string | null {
    if (!metadata || stickyBy === 'none') return null;
    const value =
      stickyBy === 'agent_session'
        ? metadata.agent_session_id || metadata.session_id || metadata.session_key
        : stickyBy === 'api_key'
          ? metadata.api_key_id || metadata.api_key_name
          : stickyBy === 'team'
            ? metadata.team_id || metadata.team_name
            : metadata.namespace_id || metadata.namespace_name;
    return value ? `${nodeId}:${stickyBy}:${value}` : null;
  }

  private resolvePool(node: NodeConfig): Required<CredentialPoolConfig> {
    const configured = node.credential_pool || {};
    return {
      enabled: configured.enabled ?? true,
      strategy: configured.strategy || 'least_in_flight',
      sticky_by: configured.sticky_by || 'agent_session',
      cooldown_ms: configured.cooldown_ms ?? 60_000,
      max_failures: configured.max_failures ?? 3,
      retry_on_status: configured.retry_on_status || DEFAULT_RETRY_STATUSES,
    };
  }

  private resolvePoolFromSelection(
    selection: CredentialSelection,
  ): Required<CredentialPoolConfig> {
    return {
      enabled: true,
      strategy: selection.strategy,
      sticky_by: selection.stickyBy,
      cooldown_ms: selection.cooldownMs,
      max_failures: selection.maxFailures,
      retry_on_status: selection.retryOnStatus,
    };
  }

  private stateFor(nodeId: string, credentialId: string): CredentialState {
    const key = `${nodeId}:${credentialId}`;
    let state = this.states.get(key);
    if (!state) {
      state = {
        active: 0,
        failures: 0,
        cooldownUntil: 0,
        lastStatus: null,
        lastError: null,
        updatedAt: null,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private weightOf(credential: NodeCredentialConfig): number {
    const value = Number(credential.weight ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
}

function parseRetryAfterMs(value?: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}
