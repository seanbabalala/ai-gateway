export type StateBackendType = 'memory' | 'redis';
export type StateUnavailablePolicy = 'fail_open' | 'fail_closed';
export type StateCategoryName =
  | 'rate_limit'
  | 'circuit_breaker'
  | 'cache_affinity'
  | 'momentum'
  | 'prompt_cache'
  | 'semantic_cache'
  | 'concurrency'
  | 'health_probe'
  | 'realtime_session';

export interface StateCategoryRuntimeStatus {
  name: StateCategoryName;
  unavailable_policy: StateUnavailablePolicy;
  ttl_seconds: number;
  shared: boolean;
}

export interface StateRuntimeStatus {
  backend: StateBackendType;
  configured_backend: StateBackendType;
  key_prefix: string;
  redis_available: boolean;
  unavailable_policy: StateUnavailablePolicy;
  degraded: boolean;
  last_error: string | null;
  recent_errors: Array<{
    category: StateCategoryName;
    message: string;
    at: string;
  }>;
  categories: Record<StateCategoryName, StateCategoryRuntimeStatus>;
}

export interface StateRateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
  degraded: boolean;
}

export class StateBackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateBackendUnavailableError';
  }
}
