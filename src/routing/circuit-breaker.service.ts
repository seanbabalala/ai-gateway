// ===================================================================
// CircuitBreakerService — Per-model circuit breaker for health tracking
// ===================================================================
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
//
//   CLOSED:    Normal operation, track consecutive failures
//   OPEN:      Model is unhealthy, skip all requests
//   HALF_OPEN: Cooldown expired, allow one probe request
//
// Key scheme: "${nodeId}:${model}" — each node+model pair has its own
// circuit breaker. Node-level status is aggregated from model-level:
//   - Any model OPEN → node is "degraded"
//   - All models CLOSED → node is "healthy"
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitStatus {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number;
  halfOpenProbes: number; // number of in-flight probes in HALF_OPEN
}

interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures to trigger OPEN
  cooldownMs: number;       // time in OPEN before moving to HALF_OPEN
  halfOpenMax: number;      // max probe requests in HALF_OPEN
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 30_000,   // 30 seconds
  halfOpenMax: 1,
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitStatus>();
  private readonly config: CircuitBreakerConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Build the internal key for a node+model pair */
  private buildKey(nodeId: string, model?: string): string {
    return model ? `${nodeId}:${model}` : nodeId;
  }

  /**
   * Check if a node+model pair is available (not in OPEN state).
   * Returns true if requests should be forwarded.
   */
  isAvailable(nodeId: string, model?: string): boolean {
    const key = this.buildKey(nodeId, model);
    const status = this.getStatus(key);

    switch (status.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if cooldown has elapsed → transition to HALF_OPEN
        if (Date.now() - status.openedAt >= this.config.cooldownMs) {
          status.state = CircuitState.HALF_OPEN;
          status.halfOpenProbes = 0;
          this.logger.log(`Circuit HALF_OPEN for "${key}" (cooldown elapsed)`);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited probe requests
        if (status.halfOpenProbes < this.config.halfOpenMax) {
          status.halfOpenProbes++;
          return true;
        }
        return false;
    }
  }

  /**
   * Record a successful request to a node+model.
   * Resets the circuit to CLOSED if it was HALF_OPEN.
   */
  recordSuccess(nodeId: string, model?: string): void {
    const key = this.buildKey(nodeId, model);
    const status = this.getStatus(key);

    if (status.state === CircuitState.HALF_OPEN) {
      this.logger.log(`Circuit CLOSED for "${key}" (probe succeeded)`);
    }

    // Reset to healthy state
    status.state = CircuitState.CLOSED;
    status.consecutiveFailures = 0;
    status.halfOpenProbes = 0;
  }

  /**
   * Record a failed request to a node+model.
   * May trigger OPEN state if threshold is reached.
   */
  recordFailure(nodeId: string, model?: string): void {
    const key = this.buildKey(nodeId, model);
    const status = this.getStatus(key);
    status.consecutiveFailures++;
    status.lastFailureAt = Date.now();

    if (status.state === CircuitState.HALF_OPEN) {
      // Probe failed → back to OPEN
      status.state = CircuitState.OPEN;
      status.openedAt = Date.now();
      this.logger.warn(`Circuit re-OPENED for "${key}" (probe failed)`);
      return;
    }

    if (
      status.state === CircuitState.CLOSED &&
      status.consecutiveFailures >= this.config.failureThreshold
    ) {
      status.state = CircuitState.OPEN;
      status.openedAt = Date.now();
      this.logger.warn(
        `Circuit OPENED for "${key}" (${status.consecutiveFailures} consecutive failures)`,
      );
    }
  }

  /**
   * Get the current circuit state for a node+model.
   */
  getCircuitState(nodeId: string, model?: string): CircuitState {
    return this.getStatus(this.buildKey(nodeId, model)).state;
  }

  /**
   * Get aggregated node-level status (for backward compatibility).
   * Aggregates across all models for the given node:
   *   - state: OPEN if any model is OPEN, HALF_OPEN if any is HALF_OPEN, else CLOSED
   *   - consecutiveFailures: max across all models
   *   - lastFailureAt: most recent across all models
   */
  getNodeStatus(nodeId: string): {
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureAt: number | null;
  } {
    const prefix = `${nodeId}:`;
    let worstState = CircuitState.CLOSED;
    let maxFailures = 0;
    let latestFailure: number | null = null;

    for (const [key, status] of this.circuits) {
      if (key === nodeId || key.startsWith(prefix)) {
        // State priority: OPEN > HALF_OPEN > CLOSED
        if (status.state === CircuitState.OPEN) {
          worstState = CircuitState.OPEN;
        } else if (status.state === CircuitState.HALF_OPEN && worstState !== CircuitState.OPEN) {
          worstState = CircuitState.HALF_OPEN;
        }

        if (status.consecutiveFailures > maxFailures) {
          maxFailures = status.consecutiveFailures;
        }

        if (status.lastFailureAt && (!latestFailure || status.lastFailureAt > latestFailure)) {
          latestFailure = status.lastFailureAt;
        }
      }
    }

    return {
      state: worstState,
      consecutiveFailures: maxFailures,
      lastFailureAt: latestFailure || null,
    };
  }

  /**
   * Get per-model circuit status for a node (for dashboard).
   * Returns a map of model → circuit info.
   */
  getModelStatuses(nodeId: string): Record<string, {
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureAt: number | null;
  }> {
    const prefix = `${nodeId}:`;
    const result: Record<string, {
      state: CircuitState;
      consecutiveFailures: number;
      lastFailureAt: number | null;
    }> = {};

    for (const [key, status] of this.circuits) {
      if (key.startsWith(prefix)) {
        const model = key.slice(prefix.length);
        result[model] = {
          state: status.state,
          consecutiveFailures: status.consecutiveFailures,
          lastFailureAt: status.lastFailureAt || null,
        };
      }
    }

    return result;
  }

  /**
   * Get status for all tracked circuits (for dashboard).
   */
  getAllStatuses(): Map<string, { state: CircuitState; consecutiveFailures: number }> {
    const result = new Map<string, { state: CircuitState; consecutiveFailures: number }>();
    for (const [key, status] of this.circuits) {
      result.set(key, {
        state: status.state,
        consecutiveFailures: status.consecutiveFailures,
      });
    }
    return result;
  }

  /**
   * Reset circuit breaker.
   * - reset(nodeId) — resets ALL models for that node
   * - reset(nodeId, model) — resets only the specific model
   */
  reset(nodeId: string, model?: string): void {
    if (model) {
      // Reset specific model
      const key = this.buildKey(nodeId, model);
      this.circuits.delete(key);
      this.logger.log(`Circuit reset for "${key}"`);
    } else {
      // Reset all models for this node
      const prefix = `${nodeId}:`;
      const keysToDelete: string[] = [];
      for (const key of this.circuits.keys()) {
        if (key === nodeId || key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.circuits.delete(key);
      }
      this.logger.log(`Circuit reset for node "${nodeId}" (${keysToDelete.length} circuits cleared)`);
    }
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    this.circuits.clear();
    this.logger.log('All circuits reset');
  }

  private getStatus(key: string): CircuitStatus {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: CircuitState.CLOSED,
        consecutiveFailures: 0,
        lastFailureAt: 0,
        openedAt: 0,
        halfOpenProbes: 0,
      });
    }
    return this.circuits.get(key)!;
  }
}
