/**
 * CircuitBreakerService unit tests.
 *
 * Covers the full CLOSED → OPEN → HALF_OPEN → CLOSED state machine,
 * per-model isolation, getNodeStatus aggregation, getModelStatuses,
 * getAllStatuses, and reset variants.
 */

import { CircuitBreakerService, CircuitState } from '../../src/routing/circuit-breaker.service';

function makeBreaker(): CircuitBreakerService {
  return new CircuitBreakerService();
}

/** Trip the circuit for a node+model (3 consecutive failures = OPEN) */
function tripCircuit(cb: CircuitBreakerService, nodeId: string, model: string): void {
  cb.recordFailure(nodeId, model);
  cb.recordFailure(nodeId, model);
  cb.recordFailure(nodeId, model);
}

// ═══════════════════════════════════════════════════════════
// Basic State Machine: CLOSED → OPEN
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — CLOSED → OPEN', () => {
  it('should start in CLOSED state', () => {
    const cb = makeBreaker();
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.CLOSED);
  });

  it('should remain CLOSED with fewer than threshold failures', () => {
    const cb = makeBreaker();
    cb.recordFailure('node1', 'gpt-4');
    cb.recordFailure('node1', 'gpt-4');
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.CLOSED);
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(true);
  });

  it('should transition to OPEN after reaching failure threshold', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'node1', 'gpt-4');
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.OPEN);
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(false);
  });

  it('should reset consecutive failures on success in CLOSED state', () => {
    const cb = makeBreaker();
    cb.recordFailure('node1', 'gpt-4');
    cb.recordFailure('node1', 'gpt-4');
    cb.recordSuccess('node1', 'gpt-4');
    // After reset, need another 3 failures to trip
    cb.recordFailure('node1', 'gpt-4');
    cb.recordFailure('node1', 'gpt-4');
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.CLOSED);
  });
});

// ═══════════════════════════════════════════════════════════
// OPEN → HALF_OPEN (cooldown)
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — OPEN → HALF_OPEN', () => {
  it('should remain OPEN before cooldown elapses', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'node1', 'gpt-4');
    // Without advancing time, should stay OPEN
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(false);
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.OPEN);
  });

  it('should transition to HALF_OPEN when cooldown elapses', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'node1', 'gpt-4');

    // Advance time past cooldown (30s default)
    const realNow = Date.now;
    Date.now = jest.fn().mockReturnValue(realNow() + 31_000);
    try {
      expect(cb.isAvailable('node1', 'gpt-4')).toBe(true);
      expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.HALF_OPEN);
    } finally {
      Date.now = realNow;
    }
  });
});

// ═══════════════════════════════════════════════════════════
// HALF_OPEN: probe allow/reject, → CLOSED, → OPEN
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — HALF_OPEN', () => {
  function makeHalfOpen(cb: CircuitBreakerService, nodeId: string, model: string): void {
    tripCircuit(cb, nodeId, model);
    const realNow = Date.now;
    Date.now = jest.fn().mockReturnValue(realNow() + 31_000);
    cb.isAvailable(nodeId, model); // triggers transition to HALF_OPEN
    Date.now = realNow;
  }

  it('should allow one probe request in HALF_OPEN (halfOpenMax=1)', () => {
    const cb = makeBreaker();
    makeHalfOpen(cb, 'node1', 'gpt-4');
    // isAvailable in HALF_OPEN: first call allows probe (halfOpenProbes 0 → 1)
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(true);
    // Second call should be rejected (halfOpenProbes=1 >= halfOpenMax=1)
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(false);
  });

  it('should transition HALF_OPEN → CLOSED on success', () => {
    const cb = makeBreaker();
    makeHalfOpen(cb, 'node1', 'gpt-4');

    cb.recordSuccess('node1', 'gpt-4');
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.CLOSED);
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(true);
  });

  it('should transition HALF_OPEN → OPEN on failure', () => {
    const cb = makeBreaker();
    makeHalfOpen(cb, 'node1', 'gpt-4');

    cb.recordFailure('node1', 'gpt-4');
    expect(cb.getCircuitState('node1', 'gpt-4')).toBe(CircuitState.OPEN);
    expect(cb.isAvailable('node1', 'gpt-4')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Per-model isolation
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — per-model isolation', () => {
  it('should maintain independent circuits for different models on same node', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');

    expect(cb.getCircuitState('openai', 'gpt-4')).toBe(CircuitState.OPEN);
    expect(cb.getCircuitState('openai', 'gpt-4o-mini')).toBe(CircuitState.CLOSED);
    expect(cb.isAvailable('openai', 'gpt-4o-mini')).toBe(true);
  });

  it('should maintain independent circuits for different nodes', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');

    expect(cb.getCircuitState('openai', 'gpt-4')).toBe(CircuitState.OPEN);
    expect(cb.getCircuitState('claude', 'gpt-4')).toBe(CircuitState.CLOSED);
  });
});

// ═══════════════════════════════════════════════════════════
// getNodeStatus — aggregation
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — getNodeStatus', () => {
  it('should return CLOSED when no circuits exist', () => {
    const cb = makeBreaker();
    const status = cb.getNodeStatus('openai');
    expect(status.state).toBe(CircuitState.CLOSED);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastFailureAt).toBeNull();
  });

  it('should return OPEN if any model circuit is OPEN', () => {
    const cb = makeBreaker();
    cb.recordFailure('openai', 'gpt-4'); // 1 failure (still CLOSED)
    tripCircuit(cb, 'openai', 'gpt-4o-mini'); // 3 failures → OPEN

    const status = cb.getNodeStatus('openai');
    expect(status.state).toBe(CircuitState.OPEN);
    expect(status.consecutiveFailures).toBe(3);
  });

  it('should return HALF_OPEN if any model is HALF_OPEN and none are OPEN', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');

    // Advance time to trigger HALF_OPEN
    const realNow = Date.now;
    Date.now = jest.fn().mockReturnValue(realNow() + 31_000);
    cb.isAvailable('openai', 'gpt-4'); // triggers HALF_OPEN
    Date.now = realNow;

    const status = cb.getNodeStatus('openai');
    expect(status.state).toBe(CircuitState.HALF_OPEN);
  });

  it('should prefer OPEN over HALF_OPEN in aggregation', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');
    tripCircuit(cb, 'openai', 'gpt-4o-mini');

    // Make gpt-4 HALF_OPEN but gpt-4o-mini stays OPEN
    const realNow = Date.now;
    Date.now = jest.fn().mockReturnValue(realNow() + 31_000);
    cb.isAvailable('openai', 'gpt-4'); // gpt-4 → HALF_OPEN
    // gpt-4o-mini also transitions if checked, so don't check it
    Date.now = realNow;

    // Manually re-trip gpt-4o-mini to ensure it's OPEN
    cb.recordFailure('openai', 'gpt-4o-mini'); // back to OPEN from HALF_OPEN

    const status = cb.getNodeStatus('openai');
    expect(status.state).toBe(CircuitState.OPEN);
  });

  it('should track max consecutiveFailures and latest lastFailureAt', () => {
    const cb = makeBreaker();
    cb.recordFailure('openai', 'gpt-4');
    cb.recordFailure('openai', 'gpt-4');
    cb.recordFailure('openai', 'gpt-4o-mini');

    const status = cb.getNodeStatus('openai');
    expect(status.consecutiveFailures).toBe(2);
    expect(status.lastFailureAt).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════
// getModelStatuses
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — getModelStatuses', () => {
  it('should return per-model map', () => {
    const cb = makeBreaker();
    cb.recordFailure('openai', 'gpt-4');
    tripCircuit(cb, 'openai', 'gpt-4o-mini');

    const statuses = cb.getModelStatuses('openai');
    expect(statuses['gpt-4']).toBeDefined();
    expect(statuses['gpt-4'].state).toBe(CircuitState.CLOSED);
    expect(statuses['gpt-4'].consecutiveFailures).toBe(1);
    expect(statuses['gpt-4o-mini'].state).toBe(CircuitState.OPEN);
  });

  it('should return empty map for node with no circuits', () => {
    const cb = makeBreaker();
    const statuses = cb.getModelStatuses('unknown');
    expect(Object.keys(statuses)).toHaveLength(0);
  });

  it('should not include circuits from other nodes', () => {
    const cb = makeBreaker();
    cb.recordFailure('openai', 'gpt-4');
    cb.recordFailure('claude', 'claude-3-opus');

    const statuses = cb.getModelStatuses('openai');
    expect(statuses['gpt-4']).toBeDefined();
    expect(statuses['claude-3-opus']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// getAllStatuses
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — getAllStatuses', () => {
  it('should return all tracked circuits', () => {
    const cb = makeBreaker();
    cb.recordFailure('openai', 'gpt-4');
    tripCircuit(cb, 'claude', 'claude-3');

    const all = cb.getAllStatuses();
    expect(all.size).toBe(2);
    expect(all.get('openai:gpt-4')?.state).toBe(CircuitState.CLOSED);
    expect(all.get('claude:claude-3')?.state).toBe(CircuitState.OPEN);
  });

  it('should return empty map when no circuits tracked', () => {
    const cb = makeBreaker();
    const all = cb.getAllStatuses();
    expect(all.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Reset variants
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService — reset', () => {
  it('should reset a specific model circuit', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');
    tripCircuit(cb, 'openai', 'gpt-4o-mini');

    cb.reset('openai', 'gpt-4');

    // gpt-4 should be reset (returns CLOSED for new check)
    expect(cb.getCircuitState('openai', 'gpt-4')).toBe(CircuitState.CLOSED);
    // gpt-4o-mini should still be OPEN
    expect(cb.getCircuitState('openai', 'gpt-4o-mini')).toBe(CircuitState.OPEN);
  });

  it('should reset all model circuits for a node', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');
    tripCircuit(cb, 'openai', 'gpt-4o-mini');
    tripCircuit(cb, 'claude', 'claude-3');

    cb.reset('openai');

    expect(cb.getCircuitState('openai', 'gpt-4')).toBe(CircuitState.CLOSED);
    expect(cb.getCircuitState('openai', 'gpt-4o-mini')).toBe(CircuitState.CLOSED);
    // Claude should be untouched
    expect(cb.getCircuitState('claude', 'claude-3')).toBe(CircuitState.OPEN);
  });

  it('should resetAll to clear everything', () => {
    const cb = makeBreaker();
    tripCircuit(cb, 'openai', 'gpt-4');
    tripCircuit(cb, 'claude', 'claude-3');

    cb.resetAll();

    expect(cb.getAllStatuses().size).toBe(0);
    expect(cb.getCircuitState('openai', 'gpt-4')).toBe(CircuitState.CLOSED);
    expect(cb.getCircuitState('claude', 'claude-3')).toBe(CircuitState.CLOSED);
  });
});
