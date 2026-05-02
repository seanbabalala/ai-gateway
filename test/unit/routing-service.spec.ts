import { RoutingService } from '../../src/routing/routing.service';
import { mockConfigService } from '../helpers';
import { Tier } from '../../src/canonical/canonical.types';

function makeRoutingService(overrides: {
  tiers?: Record<string, any>;
  domainPreferences?: Record<string, string[]>;
  nodes?: any[];
  circuitBreaker?: any;
  momentum?: any;
  capabilityService?: any;
} = {}) {
  const config = mockConfigService({
    routing: {
      tiers: overrides.tiers || {
        simple: {
          primary: { node: 'n1', model: 'fast-model' },
          fallbacks: [{ node: 'n2', model: 'medium-model' }],
        },
        standard: {
          primary: { node: 'n2', model: 'medium-model' },
          fallbacks: [{ node: 'n1', model: 'fast-model' }],
        },
      },
      scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 },
      domain_preferences: overrides.domainPreferences,
    },
    nodes: overrides.nodes || [
      { id: 'n1', tags: ['fast', 'frontend'] },
      { id: 'n2', tags: ['backend', 'reasoning'] },
    ],
  });

  const circuitBreaker = overrides.circuitBreaker || {
    isAvailable: jest.fn().mockReturnValue(true),
  };

  const momentum = overrides.momentum || {
    apply: jest.fn().mockImplementation((tier: Tier, _score: number, _key?: string) => ({
      tier,
      adjusted: false,
    })),
  };

  const capabilityService = overrides.capabilityService || {
    resolveModelModalities: jest.fn().mockReturnValue(['text', 'vision']),
  };

  return new RoutingService(config, capabilityService, circuitBreaker, momentum);
}

describe('RoutingService', () => {
  // ── Normal routing ───────────────────────────────────────

  it('should resolve primary and fallbacks for a valid tier', () => {
    const svc = makeRoutingService();
    const decision = svc.resolve('simple' as Tier, 0.1);

    expect(decision.primary.node).toBe('n1');
    expect(decision.primary.model).toBe('fast-model');
    expect(decision.fallbacks).toHaveLength(1);
    expect(decision.fallbacks[0].node).toBe('n2');
    expect(decision.tier).toBe('simple');
    expect(decision.momentumAdjusted).toBe(false);
  });

  // ── Missing tier fallback ────────────────────────────────

  it('should fall back to first tier config when tier is missing', () => {
    const svc = makeRoutingService();
    const decision = svc.resolve('reasoning' as Tier, 0.9);

    // 'reasoning' not in tiers config, should fall back to first tier ('simple')
    expect(decision.primary.node).toBe('n1');
    expect(decision.tier).toBe('reasoning'); // tier stays as requested
  });

  // ── Circuit breaker filtering ────────────────────────────

  it('should filter out nodes with open circuit breakers', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockImplementation((node: string, _model: string) => node !== 'n1'),
    };
    const svc = makeRoutingService({ circuitBreaker });
    const decision = svc.resolve('simple' as Tier, 0.1);

    // n1 is unavailable, so n2 should be promoted to primary
    expect(decision.primary.node).toBe('n2');
    expect(decision.fallbacks).toHaveLength(0);
  });

  it('should use all targets as last resort when all circuits are open', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockReturnValue(false),
    };
    const svc = makeRoutingService({ circuitBreaker });
    const decision = svc.resolve('simple' as Tier, 0.1);

    // Should still return something (all targets as last resort)
    expect(decision.primary.node).toBe('n1');
    expect(decision.fallbacks).toHaveLength(1);
  });

  // ── Modality reordering ──────────────────────────────────

  it('should reorder targets based on modality compatibility', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockImplementation((_nodeId: string, model: string) => {
        if (model === 'fast-model') return ['text']; // n1 doesn't support vision
        return ['text', 'vision']; // n2 supports vision
      }),
    };
    const svc = makeRoutingService({ capabilityService });
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, null, ['text', 'vision']);

    // n2 supports vision, should be promoted over n1
    expect(decision.primary.node).toBe('n2');
  });

  // ── Domain hint (explicit config) ────────────────────────

  it('should reorder targets based on explicit domain preferences', () => {
    const svc = makeRoutingService({
      domainPreferences: { backend: ['n2', 'n1'] },
    });
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, 'backend');

    expect(decision.primary.node).toBe('n2');
    expect(decision.domainHint).toBe('backend');
  });

  // ── Domain hint (tag-based fallback) ─────────────────────

  it('should use tag-based domain preference when no explicit config', () => {
    const svc = makeRoutingService();
    // 'frontend' is a tag on n1; no explicit domain_preferences for 'frontend'
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, 'frontend');

    // n1 has tag 'frontend', so it should stay as primary (it already is)
    expect(decision.primary.node).toBe('n1');
    expect(decision.domainHint).toBe('frontend');
  });

  // ── Momentum smoothing ──────────────────────────────────

  it('should use momentum-adjusted tier', () => {
    const momentum = {
      apply: jest.fn().mockReturnValue({ tier: 'standard', adjusted: true }),
    };
    const svc = makeRoutingService({ momentum });
    const decision = svc.resolve('complex' as Tier, 0.7, 'session-1');

    expect(decision.tier).toBe('standard'); // momentum adjusted
    expect(decision.momentumAdjusted).toBe(true);
    expect(momentum.apply).toHaveBeenCalledWith('complex', 0.7, 'session-1');
  });

  // ── Score passthrough ────────────────────────────────────

  it('should pass through the original score', () => {
    const svc = makeRoutingService();
    const decision = svc.resolve('simple' as Tier, 0.42);
    expect(decision.score).toBe(0.42);
  });

  // ── Null domain hint ─────────────────────────────────────

  it('should handle null domain hint', () => {
    const svc = makeRoutingService();
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, null);
    expect(decision.domainHint).toBeNull();
  });

  // ── Domain hint reorder only when > 1 target ─────────────

  it('should not reorder when only one target is available', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockImplementation((node: string) => node === 'n1'),
    };
    const svc = makeRoutingService({
      circuitBreaker,
      domainPreferences: { backend: ['n2', 'n1'] },
    });
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, 'backend');

    // Only n1 is available, no reordering possible
    expect(decision.primary.node).toBe('n1');
  });

  // ── Unified targets + strategy schema ─────────────────────

  it('should use targets schema when present', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'weighted',
          targets: [
            { node: 'n1', model: 'fast-model', weight: 1 },
            { node: 'n2', model: 'medium-model', weight: 1 },
          ],
          primary: { node: 'n2', model: 'medium-model' },
          fallbacks: [],
        },
      },
    });

    const decision = svc.resolve('simple' as Tier, 0.1, 'sticky');

    expect(['n1', 'n2']).toContain(decision.primary.node);
    expect(decision.loadBalancing.source).toBe('targets');
    expect(decision.loadBalancing.strategy).toBe('weighted');
  });

  it('should rotate targets with round_robin strategy', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'round_robin',
          targets: [
            { node: 'n1', model: 'fast-model' },
            { node: 'n2', model: 'medium-model' },
          ],
        },
      },
    });

    expect(svc.resolve('simple' as Tier, 0.1).primary.node).toBe('n1');
    expect(svc.resolve('simple' as Tier, 0.1).primary.node).toBe('n2');
    expect(svc.resolve('simple' as Tier, 0.1).primary.node).toBe('n1');
  });

  it('should choose deterministic cold-start targets before least_latency metrics exist', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'least_latency',
          targets: [
            { node: 'n1', model: 'fast-model' },
            { node: 'n2', model: 'medium-model' },
          ],
        },
      },
    });

    expect(svc.resolve('simple' as Tier, 0.1).primary.node).toBe('n1');
    svc.recordTargetResult('n1', 'fast-model', 200, 200);
    expect(svc.resolve('simple' as Tier, 0.1).primary.node).toBe('n2');
  });

  it('should choose the lowest sliding-window latency once least_latency is warm', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'least_latency',
          targets: [
            { node: 'n1', model: 'fast-model' },
            { node: 'n2', model: 'medium-model' },
          ],
        },
      },
    });

    svc.recordTargetResult('n1', 'fast-model', 250, 200);
    svc.recordTargetResult('n2', 'medium-model', 80, 200);
    svc.recordTargetResult('n2', 'medium-model', 100, 200);

    const decision = svc.resolve('simple' as Tier, 0.1);

    expect(decision.primary.node).toBe('n2');
    expect(decision.loadBalancing.strategy).toBe('least_latency');
  });

  it('should expose recent selection and latency status for dashboard', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'least_latency',
          targets: [
            { node: 'n1', model: 'fast-model', weight: 30 },
            { node: 'n2', model: 'medium-model', weight: 70 },
          ],
        },
      },
    });
    svc.recordTargetResult('n1', 'fast-model', 120, 200);

    svc.resolve('simple' as Tier, 0.1);
    const status = svc.getRoutingStatus();

    expect(status.simple.strategy).toBe('least_latency');
    expect(status.simple.targets[0].avg_latency_ms).toBe(120);
    expect(status.simple.last_selected?.node).toBe('n2');
    expect(status.simple.last_selected?.reason).toContain('cold-start');
  });

  it('should keep split precedence over targets', () => {
    const svc = makeRoutingService({
      tiers: {
        simple: {
          strategy: 'round_robin',
          targets: [{ node: 'n2', model: 'medium-model', weight: 100 }],
          primary: { node: 'n1', model: 'fast-model' },
          fallbacks: [],
          split: [
            { node: 'n1', model: 'fast-model', weight: 100, name: 'legacy-split' },
          ],
        },
      },
    });

    const decision = svc.resolve('simple' as Tier, 0.1, 'session');

    expect(decision.primary.node).toBe('n1');
    expect(decision.experimentGroup).toBe('simple:legacy-split');
    expect(decision.loadBalancing.source).toBe('split');
  });
});
