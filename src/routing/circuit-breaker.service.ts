// ===================================================================
// CircuitBreakerService — Per-node circuit breaker for health tracking
// ===================================================================
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
//
//   CLOSED:    Normal operation, track consecutive failures
//   OPEN:      Node is unhealthy, skip all requests
//   HALF_OPEN: Cooldown expired, allow one probe request
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

  /**
   * Check if a node is available (not in OPEN state).
   * Returns true if requests should be forwarded to this node.
   */
  isAvailable(nodeId: string): boolean {
    const status = this.getStatus(nodeId);

    switch (status.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if cooldown has elapsed → transition to HALF_OPEN
        if (Date.now() - status.openedAt >= this.config.cooldownMs) {
          status.state = CircuitState.HALF_OPEN;
          status.halfOpenProbes = 0;
          this.logger.log(`Circuit HALF_OPEN for node "${nodeId}" (cooldown elapsed)`);
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
   * Record a successful request to a node.
   * Resets the circuit to CLOSED if it was HALF_OPEN.
   */
  recordSuccess(nodeId: string): void {
    const status = this.getStatus(nodeId);

    if (status.state === CircuitState.HALF_OPEN) {
      this.logger.log(`Circuit CLOSED for node "${nodeId}" (probe succeeded)`);
    }

    // Reset to healthy state
    status.state = CircuitState.CLOSED;
    status.consecutiveFailures = 0;
    status.halfOpenProbes = 0;
  }

  /**
   * Record a failed request to a node.
   * May trigger OPEN state if threshold is reached.
   */
  recordFailure(nodeId: string): void {
    const status = this.getStatus(nodeId);
    status.consecutiveFailures++;
    status.lastFailureAt = Date.now();

    if (status.state === CircuitState.HALF_OPEN) {
      // Probe failed → back to OPEN
      status.state = CircuitState.OPEN;
      status.openedAt = Date.now();
      this.logger.warn(`Circuit re-OPENED for node "${nodeId}" (probe failed)`);
      return;
    }

    if (
      status.state === CircuitState.CLOSED &&
      status.consecutiveFailures >= this.config.failureThreshold
    ) {
      status.state = CircuitState.OPEN;
      status.openedAt = Date.now();
      this.logger.warn(
        `Circuit OPENED for node "${nodeId}" (${status.consecutiveFailures} consecutive failures)`,
      );
    }
  }

  /**
   * Get the current circuit state for a node.
   */
  getCircuitState(nodeId: string): CircuitState {
    return this.getStatus(nodeId).state;
  }

  /**
   * Get full status for a node (for dashboard/monitoring).
   */
  getNodeStatus(nodeId: string): {
    state: CircuitState;
    consecutiveFailures: number;
    lastFailureAt: number | null;
  } {
    const status = this.getStatus(nodeId);
    return {
      state: status.state,
      consecutiveFailures: status.consecutiveFailures,
      lastFailureAt: status.lastFailureAt || null,
    };
  }

  /**
   * Get status for all tracked nodes (for dashboard).
   */
  getAllStatuses(): Map<string, { state: CircuitState; consecutiveFailures: number }> {
    const result = new Map<string, { state: CircuitState; consecutiveFailures: number }>();
    for (const [nodeId, status] of this.circuits) {
      result.set(nodeId, {
        state: status.state,
        consecutiveFailures: status.consecutiveFailures,
      });
    }
    return result;
  }

  /**
   * Reset a specific node's circuit breaker (manual recovery).
   */
  reset(nodeId: string): void {
    this.circuits.delete(nodeId);
    this.logger.log(`Circuit reset for node "${nodeId}"`);
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    this.circuits.clear();
    this.logger.log('All circuits reset');
  }

  private getStatus(nodeId: string): CircuitStatus {
    if (!this.circuits.has(nodeId)) {
      this.circuits.set(nodeId, {
        state: CircuitState.CLOSED,
        consecutiveFailures: 0,
        lastFailureAt: 0,
        openedAt: 0,
        halfOpenProbes: 0,
      });
    }
    return this.circuits.get(nodeId)!;
  }
}
