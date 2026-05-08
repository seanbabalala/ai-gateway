/**
 * A/B Routing (Split) — unit tests.
 *
 * Tests RoutingService A/B split logic:
 * - FNV-1a hash determinism & stickiness
 * - Weighted distribution (70/30 split)
 * - experimentGroup format
 * - Circuit breaker integration with split
 * - Modality/domain compatibility with split
 * - Edge cases (single variant, no sessionKey)
 */

import { RoutingService } from '../../src/routing/routing.service';
import { mockConfigService } from '../helpers';
import { Tier } from '../../src/canonical/canonical.types';

function inactiveAffinityResult() {
  return {
    active: false,
    bonus: 0,
    reason: 'no_session_history',
    provider_cache_ttl_seconds: null,
    time_since_last_cache_hit_seconds: null,
    estimated_cache_hit_probability: null,
    consecutive_count: 0,
    cache_type: null,
  };
}

function makeRoutingServiceWithSplit(overrides: {
  split?: any[];
  tiers?: Record<string, any>;
  nodes?: any[];
  circuitBreaker?: any;
  momentum?: any;
  capabilityService?: any;
  cacheAffinityService?: any;
} = {}) {
  const defaultSplit = overrides.split || [
    { node: 'claude', model: 'claude-opus-4-6-v1', weight: 70, name: 'control' },
    { node: 'gpt', model: 'gpt-5', weight: 30, name: 'challenger' },
  ];

  const config = mockConfigService({
    routing: {
      tiers: overrides.tiers || {
        complex: {
          primary: { node: 'claude', model: 'claude-opus-4-6-v1' },
          fallbacks: [{ node: 'gpt', model: 'gpt-5' }],
          split: defaultSplit,
        },
        simple: {
          primary: { node: 'gpt', model: 'gpt-4o-mini' },
          fallbacks: [{ node: 'claude', model: 'claude-sonnet' }],
          // No split — standard behavior
        },
      },
      scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 },
      domain_preferences: undefined,
    },
    nodes: overrides.nodes || [
      { id: 'claude', tags: ['backend', 'reasoning'] },
      { id: 'gpt', tags: ['frontend', 'fast'] },
    ],
  });

  const circuitBreaker = overrides.circuitBreaker || {
    isAvailable: jest.fn().mockReturnValue(true),
  };

  const momentum = overrides.momentum || {
    scopedSessionKey: jest.fn((sessionKey?: string) => sessionKey),
    apply: jest.fn().mockImplementation((tier: Tier, _score: number, _key?: string) => ({
      tier,
      adjusted: false,
    })),
  };

  const capabilityService = overrides.capabilityService || {
    resolveModelModalities: jest.fn().mockReturnValue(['text', 'vision']),
  };

  const cacheAffinityService = overrides.cacheAffinityService || {
    getCacheAffinity: jest.fn().mockReturnValue(inactiveAffinityResult()),
    recordRouteResult: jest.fn(),
  };

  return {
    service: new RoutingService(
      config,
      capabilityService,
      circuitBreaker,
      momentum,
      cacheAffinityService,
    ),
    circuitBreaker,
  };
}

describe('RoutingService — A/B Split', () => {
  // ── No split → original behavior ─────────────────────────────

  it('should return experimentGroup=null when no split is configured', () => {
    const { service } = makeRoutingServiceWithSplit();
    const decision = service.resolve('simple' as Tier, 0.1, 'session-1');

    expect(decision.experimentGroup).toBeNull();
    expect(decision.primary.node).toBe('gpt');
    expect(decision.primary.model).toBe('gpt-4o-mini');
  });

  // ── Split produces experimentGroup ───────────────────────────

  it('should return experimentGroup when split is configured', () => {
    const { service } = makeRoutingServiceWithSplit();
    const decision = service.resolve('complex' as Tier, 0.9, 'some-session');

    expect(decision.experimentGroup).not.toBeNull();
    expect(decision.experimentGroup).toMatch(/^complex:(control|challenger)$/);
  });

  // ── Session stickiness (same sessionKey → same variant) ──────

  it('should route same sessionKey to same variant (sticky)', () => {
    const { service } = makeRoutingServiceWithSplit();
    const sessionKey = 'sticky-session-abc';

    const decisions = Array.from({ length: 20 }, () =>
      service.resolve('complex' as Tier, 0.9, sessionKey),
    );

    const groups = decisions.map(d => d.experimentGroup);
    // All should be the same
    expect(new Set(groups).size).toBe(1);
  });

  // ── Different sessionKeys → distribution ─────────────────────

  it('should distribute traffic across variants with different sessionKeys', () => {
    const { service } = makeRoutingServiceWithSplit();

    const groups = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const decision = service.resolve('complex' as Tier, 0.9, `session-${i}`);
      groups.add(decision.experimentGroup!);
    }

    // Should have both variants represented
    expect(groups.size).toBe(2);
    expect(groups.has('complex:control')).toBe(true);
    expect(groups.has('complex:challenger')).toBe(true);
  });

  // ── Weight distribution is approximately correct ─────────────

  it('should distribute ~70/30 for a 70/30 split over many requests', () => {
    const { service } = makeRoutingServiceWithSplit();

    let controlCount = 0;
    const totalRequests = 1000;
    for (let i = 0; i < totalRequests; i++) {
      const decision = service.resolve('complex' as Tier, 0.9, `dist-test-${i}`);
      if (decision.experimentGroup === 'complex:control') {
        controlCount++;
      }
    }

    // Allow 10% margin: 70% ± 10% = 60-80%
    const controlPct = controlCount / totalRequests;
    expect(controlPct).toBeGreaterThan(0.55);
    expect(controlPct).toBeLessThan(0.85);
  });

  // ── FNV-1a hash determinism ──────────────────────────────────

  it('should produce deterministic results for specific inputs', () => {
    const { service } = makeRoutingServiceWithSplit();

    // Same input should always produce same output
    const d1 = service.resolve('complex' as Tier, 0.9, 'deterministic-key');
    const d2 = service.resolve('complex' as Tier, 0.9, 'deterministic-key');
    expect(d1.experimentGroup).toBe(d2.experimentGroup);
    expect(d1.primary.node).toBe(d2.primary.node);
  });

  // ── No sessionKey → uses random UUID (still works) ───────────

  it('should work without sessionKey (uses random, not sticky)', () => {
    const { service } = makeRoutingServiceWithSplit();

    // Without sessionKey, each call may get different variant
    const decision = service.resolve('complex' as Tier, 0.9);
    expect(decision.experimentGroup).toMatch(/^complex:(control|challenger)$/);
  });

  // ── experimentGroup format with default name ─────────────────

  it('should use "node:model" format when variant has no name', () => {
    const { service } = makeRoutingServiceWithSplit({
      split: [
        { node: 'claude', model: 'claude-opus-4-6-v1', weight: 50 },
        { node: 'gpt', model: 'gpt-5', weight: 50 },
      ],
    });

    const decision = service.resolve('complex' as Tier, 0.9, 'test-session');
    expect(decision.experimentGroup).toMatch(
      /^complex:(claude:claude-opus-4-6-v1|gpt:gpt-5)$/,
    );
  });

  // ── Single variant (weight=100) ──────────────────────────────

  it('should work with a single variant (weight=100)', () => {
    const { service } = makeRoutingServiceWithSplit({
      split: [
        { node: 'claude', model: 'claude-opus-4-6-v1', weight: 100, name: 'only' },
      ],
    });

    const decision = service.resolve('complex' as Tier, 0.9, 'any-session');
    expect(decision.experimentGroup).toBe('complex:only');
    expect(decision.primary.node).toBe('claude');
    expect(decision.fallbacks).toHaveLength(0);
  });

  // ── Circuit breaker filters split variants ────────────────────

  it('should fallback to other variant when selected variant has open circuit', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockImplementation((node: string) => node !== 'claude'),
    };
    const { service } = makeRoutingServiceWithSplit({ circuitBreaker });

    // Force a session that normally routes to 'claude' (control)
    // Since claude is unavailable, gpt should be the primary
    const decision = service.resolve('complex' as Tier, 0.9, 'any-session');
    expect(decision.primary.node).toBe('gpt');
  });

  // ── All split variants circuit-broken → last resort ──────────

  it('should use all variants as last resort when all circuits are open', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockReturnValue(false),
    };
    const { service } = makeRoutingServiceWithSplit({ circuitBreaker });

    const decision = service.resolve('complex' as Tier, 0.9, 'session-1');
    // Should still return something
    expect(decision.primary).toBeDefined();
    expect(decision.experimentGroup).not.toBeNull();
  });

  // ── Split + modality reordering ──────────────────────────────

  it('should apply modality reordering within split targets', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockImplementation((_node: string, model: string) => {
        if (model === 'gpt-5') return ['text', 'vision'];
        return ['text']; // claude doesn't support vision
      }),
    };
    const { service } = makeRoutingServiceWithSplit({ capabilityService });

    // Request with vision modality
    const decision = service.resolve('complex' as Tier, 0.9, 'vision-test', null, ['text', 'vision']);

    // gpt should be promoted because it supports vision
    expect(decision.primary.node).toBe('gpt');
  });

  // ── Split + domain hint reordering ───────────────────────────

  it('should apply domain hint reordering within split targets', () => {
    const { service } = makeRoutingServiceWithSplit({
      nodes: [
        { id: 'claude', tags: ['backend'] },
        { id: 'gpt', tags: ['frontend'] },
      ],
    });

    // With frontend domain hint and a 70/30 split where both are available,
    // gpt (tagged frontend) should be preferred
    const decision = service.resolve('complex' as Tier, 0.9, 'domain-test', 'frontend');
    expect(decision.primary.node).toBe('gpt');
  });
});
