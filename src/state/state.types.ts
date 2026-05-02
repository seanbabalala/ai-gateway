export type StateBackendType = 'memory' | 'redis';
export type StateUnavailablePolicy = 'fail_open' | 'fail_closed';

export interface StateRuntimeStatus {
  backend: StateBackendType;
  configured_backend: StateBackendType;
  redis_available: boolean;
  unavailable_policy: StateUnavailablePolicy;
  degraded: boolean;
  last_error: string | null;
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
