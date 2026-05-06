import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type { TokenUsage } from '../canonical/canonical.types';
import { ConfigService } from '../config/config.service';
import type { ResolvedModelRoutingCapabilities } from '../config/capability.service';
import type { ProviderCacheType } from '../catalog/catalog.types';
import { StateBackendService } from '../state/state-backend.service';

const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const STATE_NAMESPACE = 'cache_affinity';

interface SessionCacheAffinityState {
  last_node_model: string;
  consecutive_count: number;
  last_cache_read_tokens: number;
  last_request_at: number;
  last_cache_hit_at: number | null;
}

export interface CacheAffinityResult {
  active: boolean;
  bonus: number;
  reason: string;
  provider_cache_ttl_seconds: number | null;
  time_since_last_cache_hit_seconds: number | null;
  estimated_cache_hit_probability: number | null;
  consecutive_count: number;
  cache_type: ProviderCacheType | null;
}

@Injectable()
export class CacheAffinityService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheAffinityService.name);
  private readonly sessions = new Map<string, SessionCacheAffinityState>();
  private readonly hydratingSessions = new Set<string>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly stateBackend?: StateBackendService,
  ) {
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  getCacheAffinity(
    sessionKey: string | undefined,
    candidateNode: string,
    candidateModel: string,
    capabilities: Pick<
      ResolvedModelRoutingCapabilities,
      | 'supports_cache'
      | 'cache_type'
      | 'cache_ttl_seconds'
    > = {},
  ): CacheAffinityResult {
    const cacheType = capabilities.cache_type ?? null;
    const providerCacheTtlSeconds =
      typeof capabilities.cache_ttl_seconds === 'number' &&
      capabilities.cache_ttl_seconds > 0
        ? capabilities.cache_ttl_seconds
        : null;
    const baseResult = (
      reason: string,
      overrides: Partial<CacheAffinityResult> = {},
    ): CacheAffinityResult => ({
      active: false,
      bonus: 0,
      reason,
      provider_cache_ttl_seconds: providerCacheTtlSeconds,
      time_since_last_cache_hit_seconds: null,
      estimated_cache_hit_probability: null,
      consecutive_count: 0,
      cache_type: cacheType,
      ...overrides,
    });

    if (!sessionKey) {
      return baseResult('session_key_missing');
    }

    const cfg = this.config.cacheAffinity;
    if (!cfg.enabled) {
      return baseResult('cache_affinity_disabled');
    }

    if (!capabilities.supports_cache || cacheType === 'none') {
      return baseResult('provider_cache_unsupported');
    }

    const state = this.getSessionState(sessionKey);
    if (!state) {
      return baseResult('no_session_history');
    }

    const now = Date.now();
    if (now - state.last_request_at > SESSION_TTL_MS) {
      this.sessions.delete(sessionKey);
      return baseResult('session_history_expired');
    }

    const candidateKey = this.nodeModelKey(candidateNode, candidateModel);
    const timeSinceLastCacheHitMs =
      state.last_cache_hit_at === null ? null : now - state.last_cache_hit_at;
    const timeSinceLastCacheHitSeconds =
      timeSinceLastCacheHitMs === null
        ? null
        : Number((timeSinceLastCacheHitMs / 1000).toFixed(3));

    const probability = this.estimateHitProbability(
      state,
      providerCacheTtlSeconds,
      cfg.min_consecutive_hits,
      now,
    );

    if (state.last_node_model !== candidateKey) {
      return baseResult('last_route_mismatch', {
        consecutive_count: state.consecutive_count,
        time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
        estimated_cache_hit_probability: probability,
      });
    }

    if (state.consecutive_count < cfg.min_consecutive_hits) {
      return baseResult('insufficient_consecutive_hits', {
        consecutive_count: state.consecutive_count,
        time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
        estimated_cache_hit_probability: probability,
      });
    }

    if (state.last_cache_read_tokens <= 0 || state.last_cache_hit_at === null) {
      return baseResult('no_confirmed_provider_cache_hit', {
        consecutive_count: state.consecutive_count,
        time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
        estimated_cache_hit_probability: probability,
      });
    }

    if (!providerCacheTtlSeconds) {
      return baseResult('provider_cache_ttl_unknown', {
        consecutive_count: state.consecutive_count,
        time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
        estimated_cache_hit_probability: probability,
      });
    }

    const allowedWindowMs =
      providerCacheTtlSeconds * 1000 * cfg.ttl_safety_margin;
    if (timeSinceLastCacheHitMs !== null && timeSinceLastCacheHitMs > allowedWindowMs) {
      return baseResult('provider_cache_ttl_elapsed', {
        consecutive_count: state.consecutive_count,
        time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
        estimated_cache_hit_probability: probability,
      });
    }

    return {
      active: true,
      bonus: cfg.bonus_weight,
      reason: 'cache_affinity_active',
      provider_cache_ttl_seconds: providerCacheTtlSeconds,
      time_since_last_cache_hit_seconds: timeSinceLastCacheHitSeconds,
      estimated_cache_hit_probability: probability,
      consecutive_count: state.consecutive_count,
      cache_type: cacheType,
    };
  }

  recordRouteResult(
    sessionKey: string | undefined,
    node: string,
    model: string,
    usage?: Pick<TokenUsage, 'cache_read_input_tokens'>,
  ): void {
    if (
      !sessionKey ||
      node === 'cache' ||
      node === 'semantic_cache' ||
      node === 'hook'
    ) {
      return;
    }

    const now = Date.now();
    const targetKey = this.nodeModelKey(node, model);
    const current = this.getSessionState(sessionKey);
    const readTokens = Math.max(0, Number(usage?.cache_read_input_tokens || 0));
    const next: SessionCacheAffinityState = {
      last_node_model: targetKey,
      consecutive_count:
        current &&
        now - current.last_request_at <= SESSION_TTL_MS &&
        current.last_node_model === targetKey
          ? current.consecutive_count + 1
          : 1,
      last_cache_read_tokens: readTokens,
      last_request_at: now,
      last_cache_hit_at:
        readTokens > 0
          ? now
          : current?.last_node_model === targetKey
            ? current.last_cache_hit_at
            : null,
    };

    this.sessions.set(sessionKey, next);
    this.persistState(sessionKey, next);
  }

  private getSessionState(
    sessionKey: string,
  ): SessionCacheAffinityState | undefined {
    const current = this.sessions.get(sessionKey);
    if (current) {
      return current;
    }

    this.hydrateSessionFromState(sessionKey);
    return undefined;
  }

  private hydrateSessionFromState(sessionKey: string): void {
    if (
      !this.stateBackend?.isRedisConfigured() ||
      this.hydratingSessions.has(sessionKey)
    ) {
      return;
    }

    this.hydratingSessions.add(sessionKey);
    this.stateBackend
      .getJson<SessionCacheAffinityState>(STATE_NAMESPACE, sessionKey)
      .then((state) => {
        if (!state || !this.isSessionState(state)) return;
        this.sessions.set(sessionKey, state);
      })
      .catch((err) => {
        this.logger.warn(
          `Cache affinity state read skipped: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.hydratingSessions.delete(sessionKey);
      });
  }

  private persistState(
    sessionKey: string,
    state: SessionCacheAffinityState,
  ): void {
    if (!this.stateBackend?.isRedisConfigured()) {
      return;
    }

    this.stateBackend
      .setJson(
        STATE_NAMESPACE,
        sessionKey,
        state,
        Math.ceil(SESSION_TTL_MS / 1000),
      )
      .catch((err) => {
        this.logger.warn(
          `Cache affinity state write skipped: ${(err as Error).message}`,
        );
      });
  }

  private estimateHitProbability(
    state: SessionCacheAffinityState,
    providerCacheTtlSeconds: number | null,
    minConsecutiveHits: number,
    now: number,
  ): number {
    const streakFactor = Math.min(
      1,
      state.consecutive_count / Math.max(minConsecutiveHits, 1),
    );
    const ttlFactor =
      state.last_cache_hit_at !== null &&
      providerCacheTtlSeconds !== null &&
      providerCacheTtlSeconds > 0
        ? Math.max(
            0,
            1 - (now - state.last_cache_hit_at) / (providerCacheTtlSeconds * 1000),
          )
        : 0.25;
    const confirmedHitBonus = state.last_cache_read_tokens > 0 ? 0.2 : 0;
    return Number(
      Math.min(
        0.99,
        Math.max(0, 0.2 + streakFactor * 0.45 + ttlFactor * 0.15 + confirmedHitBonus),
      ).toFixed(4),
    );
  }

  private isSessionState(value: unknown): value is SessionCacheAffinityState {
    const state = value as SessionCacheAffinityState;
    return (
      state !== null &&
      typeof state === 'object' &&
      typeof state.last_node_model === 'string' &&
      typeof state.consecutive_count === 'number' &&
      typeof state.last_cache_read_tokens === 'number' &&
      typeof state.last_request_at === 'number' &&
      (typeof state.last_cache_hit_at === 'number' ||
        state.last_cache_hit_at === null)
    );
  }

  private nodeModelKey(node: string, model: string): string {
    return `${node}:${model}`;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [sessionKey, state] of this.sessions.entries()) {
      if (now - state.last_request_at > SESSION_TTL_MS) {
        this.sessions.delete(sessionKey);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} stale cache-affinity sessions`);
    }
  }
}
