import { RoutingService } from '../../src/routing/routing.service';
import { mockConfigService } from '../helpers';
import { Tier } from '../../src/canonical/canonical.types';

function makeRoutingService(overrides: {
  tiers?: Record<string, any>;
  domainPreferences?: Record<string, string[]>;
  optimization?: any;
  nodes?: any[];
  resolveEmbeddingModel?: any;
  resolveRerankModel?: any;
  resolveImageModel?: any;
  resolveAudioModel?: any;
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
      optimization: overrides.optimization,
      domain_preferences: overrides.domainPreferences,
    },
    nodes: overrides.nodes || [
      { id: 'n1', tags: ['fast', 'frontend'] },
      { id: 'n2', tags: ['backend', 'reasoning'] },
    ],
  });
  config.resolveEmbeddingModel = overrides.resolveEmbeddingModel || jest.fn().mockImplementation((model: string) => {
    for (const node of config.nodes) {
      if (node.embedding_models?.includes(model)) {
        return { nodeId: node.id, model };
      }
    }
    return null;
  });
  config.resolveRerankModel = overrides.resolveRerankModel || jest.fn().mockImplementation((model: string) => {
    for (const node of config.nodes) {
      if (node.rerank_models?.includes(model)) {
        return { nodeId: node.id, model };
      }
    }
    return null;
  });
  config.resolveImageModel = overrides.resolveImageModel || jest.fn().mockImplementation((model: string) => {
    for (const node of config.nodes) {
      if (node.image_models?.includes(model)) {
        return { nodeId: node.id, model };
      }
    }
    return null;
  });
  config.resolveAudioModel = overrides.resolveAudioModel || jest.fn().mockImplementation((model: string) => {
    for (const node of config.nodes) {
      if (node.audio_models?.includes(model)) {
        return { nodeId: node.id, model };
      }
    }
    return null;
  });

  const circuitBreaker = overrides.circuitBreaker || {
    isAvailable: jest.fn().mockReturnValue(true),
    getCircuitState: jest.fn().mockReturnValue('CLOSED'),
  };

  const momentum = overrides.momentum || {
    apply: jest.fn().mockImplementation((tier: Tier, _score: number, _key?: string) => ({
      tier,
      adjusted: false,
    })),
  };

  const capabilityService = overrides.capabilityService || {
    resolveModelModalities: jest.fn().mockReturnValue(['text', 'vision']),
    resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
      structured_output: null,
      pricing: undefined,
    }),
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
      getCircuitState: jest.fn().mockImplementation((node: string) => node === 'n1' ? 'OPEN' : 'CLOSED'),
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
      getCircuitState: jest.fn().mockReturnValue('OPEN'),
    };
    const svc = makeRoutingService({ circuitBreaker });
    const decision = svc.resolve('simple' as Tier, 0.1);

    // Should still return something (all targets as last resort)
    expect(decision.primary.node).toBe('n1');
    expect(decision.fallbacks).toHaveLength(1);
  });

  // ── Modality filtering ───────────────────────────────────

  it('should filter targets based on modality compatibility', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockImplementation((_nodeId: string, model: string) => {
        if (model === 'fast-model') return ['text']; // n1 doesn't support vision
        return ['text', 'vision']; // n2 supports vision
      }),
    };
    const svc = makeRoutingService({ capabilityService });
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, null, ['text', 'vision']);

    // n2 supports vision, n1 is removed rather than kept as a fallback
    expect(decision.primary.node).toBe('n2');
    expect(decision.fallbacks).toHaveLength(0);
  });

  it('should treat configured image modality as compatible with legacy vision hints', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockImplementation((_nodeId: string, model: string) => {
        if (model === 'fast-model') return ['text'];
        return ['text', 'image'];
      }),
    };
    const svc = makeRoutingService({ capabilityService });
    const decision = svc.resolve('simple' as Tier, 0.1, undefined, null, ['text', 'vision']);

    expect(decision.primary.node).toBe('n2');
    expect(decision.fallbacks).toHaveLength(0);
  });

  it('should reject automatic routes when no target supports required modalities', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
    };
    const svc = makeRoutingService({ capabilityService });

    expect(() =>
      svc.resolve('simple' as Tier, 0.1, undefined, null, ['text', 'audio']),
    ).toThrow('No route targets for tier "simple" support required modalities');
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

  it('should include route decision trace candidates, filters, and scores', () => {
    const circuitBreaker = {
      isAvailable: jest.fn().mockImplementation((node: string) => node !== 'n2'),
      getCircuitState: jest.fn().mockImplementation((node: string) => node === 'n2' ? 'OPEN' : 'CLOSED'),
    };
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockImplementation((_node: string, model: string) => ({
        max_context_tokens: model === 'fast-model' ? 128000 : 1000,
        structured_output: model === 'fast-model',
        pricing: model === 'fast-model'
          ? { input: 1, output: 2 }
          : { input: 10, output: 20 },
      })),
    };
    const svc = makeRoutingService({ circuitBreaker, capabilityService });
    const decision = svc.resolve(
      'simple' as Tier,
      0.42,
      'session-1',
      'backend',
      ['text'],
      {
        estimated_input_tokens: 100,
        estimated_output_tokens: 50,
        estimated_context_tokens: 1200,
        requires_structured_output: true,
      },
    );

    expect(decision.trace).toMatchObject({
      mode: 'auto',
      tier: 'simple',
      score: 0.42,
      domain_hints: { domain: 'backend', modalities: ['text'] },
      constraints: {
        estimated_context_tokens: 1200,
        requires_structured_output: true,
      },
      final_selection: {
        node: 'n1',
        model: 'fast-model',
      },
      privacy: {
        prompt: false,
        response: false,
        raw_headers: false,
        provider_keys: false,
      },
    });
    expect(decision.trace.candidate_targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: 'n1',
          selected: true,
          scores: expect.objectContaining({
            cost: expect.any(Number),
            context: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          node: 'n2',
          circuit_state: 'OPEN',
          filter_reasons: expect.arrayContaining(['circuit_open']),
        }),
      ]),
    );
    expect(decision.trace.filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: 'n2', stage: 'circuit_breaker' }),
      ]),
    );
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
      getCircuitState: jest.fn().mockImplementation((node: string) => node === 'n1' ? 'CLOSED' : 'OPEN'),
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

  it('should prefer the lowest estimated cost when routing.optimization is cost', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockImplementation((_nodeId: string, model: string) => ({
        structured_output: null,
        pricing:
          model === 'cheap-model'
            ? { input: 0.1, output: 0.2 }
            : { input: 5, output: 15 },
      })),
    };
    const svc = makeRoutingService({
      optimization: 'cost',
      capabilityService,
      tiers: {
        standard: {
          strategy: 'weighted',
          targets: [
            { node: 'n2', model: 'expensive-model', weight: 100 },
            { node: 'n1', model: 'cheap-model', weight: 1 },
          ],
        },
      },
    });

    const decision = svc.resolve('standard' as Tier, 0.4, undefined, null, undefined, {
      estimated_input_tokens: 1000,
      estimated_output_tokens: 500,
      estimated_context_tokens: 1500,
    });

    expect(decision.primary.model).toBe('cheap-model');
    expect(decision.loadBalancing.strategy).toBe('cost');
  });

  it('should remove targets whose configured context window is too small', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockImplementation((_nodeId: string, model: string) => ({
        structured_output: null,
        max_context_tokens: model === 'short-model' ? 8000 : 32000,
      })),
    };
    const svc = makeRoutingService({
      capabilityService,
      tiers: {
        standard: {
          targets: [
            { node: 'n1', model: 'short-model' },
            { node: 'n2', model: 'long-model' },
          ],
        },
      },
    });

    const decision = svc.resolve('standard' as Tier, 0.4, undefined, null, undefined, {
      estimated_context_tokens: 9000,
    });

    expect(decision.primary.model).toBe('long-model');
    expect(decision.fallbacks).toHaveLength(0);
  });

  it('should demote near-limit context targets when a longer-context target exists', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockImplementation((_nodeId: string, model: string) => ({
        structured_output: null,
        max_context_tokens: model === 'near-model' ? 10000 : 50000,
      })),
    };
    const svc = makeRoutingService({
      capabilityService,
      tiers: {
        standard: {
          targets: [
            { node: 'n1', model: 'near-model' },
            { node: 'n2', model: 'long-model' },
          ],
        },
      },
    });

    const decision = svc.resolve('standard' as Tier, 0.4, undefined, null, undefined, {
      estimated_context_tokens: 9000,
    });

    expect(decision.primary.model).toBe('long-model');
    expect(decision.fallbacks[0].model).toBe('near-model');
  });

  it('should reject automatic routes when every configured target is over context window', () => {
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
        structured_output: null,
        max_context_tokens: 4000,
      }),
    };
    const svc = makeRoutingService({
      capabilityService,
      tiers: {
        standard: {
          targets: [
            { node: 'n1', model: 'short-a' },
            { node: 'n2', model: 'short-b' },
          ],
        },
      },
    });

    expect(() =>
      svc.resolve('standard' as Tier, 0.4, undefined, null, undefined, {
        estimated_context_tokens: 5000,
      }),
    ).toThrow('No route targets for tier "standard" can fit');
  });
});

describe('RoutingService — embeddings', () => {
  const embeddingNodes = [
    {
      id: 'cheap',
      tags: ['fast'],
      embedding_models: ['text-embedding-3-small'],
    },
    {
      id: 'quality',
      tags: ['quality'],
      embedding_models: ['text-embedding-3-large'],
    },
  ];

  it('should choose the lowest priced embedding target for auto routing', () => {
    const svc = makeRoutingService({
      nodes: embeddingNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockImplementation((_node: string, model: string) => ({
          structured_output: null,
          dimensions: model.includes('small') ? [512, 1536] : [1024, 3072],
          pricing: model.includes('small')
            ? { input: 0.02, output: 0 }
            : { input: 0.13, output: 0 },
        })),
      },
    });

    const route = svc.resolveEmbeddingRoute('auto', 1536);

    expect(route.mode).toBe('auto');
    expect(route.primary).toEqual({ node: 'cheap', model: 'text-embedding-3-small' });
    expect(route.fallbacks).toHaveLength(0);
  });

  it('should filter embedding targets by requested dimensions', () => {
    const svc = makeRoutingService({
      nodes: embeddingNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockImplementation((_node: string, model: string) => ({
          structured_output: null,
          dimensions: model.includes('small') ? [512, 1536] : [1024, 3072],
          pricing: model.includes('small')
            ? { input: 0.02, output: 0 }
            : { input: 0.13, output: 0 },
        })),
      },
    });

    const route = svc.resolveEmbeddingRoute('auto', 3072);

    expect(route.primary).toEqual({ node: 'quality', model: 'text-embedding-3-large' });
  });

  it('should resolve direct embedding models and keep compatible fallbacks', () => {
    const svc = makeRoutingService({
      nodes: embeddingNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
          structured_output: null,
          dimensions: [1536],
          pricing: { input: 0.1, output: 0 },
        }),
      },
    });

    const route = svc.resolveEmbeddingRoute('text-embedding-3-small', 1536);

    expect(route.mode).toBe('direct');
    expect(route.primary).toEqual({ node: 'cheap', model: 'text-embedding-3-small' });
  });
});

describe('RoutingService — rerank', () => {
  const rerankNodes = [
    {
      id: 'cheap',
      tags: ['fast'],
      rerank_models: ['rerank-small'],
    },
    {
      id: 'quality',
      tags: ['quality'],
      rerank_models: ['rerank-large'],
    },
  ];

  it('should choose the lowest priced healthy rerank target for auto routing', () => {
    const svc = makeRoutingService({
      nodes: rerankNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockImplementation((_node: string, model: string) => ({
          structured_output: null,
          pricing: model.includes('small')
            ? { input: 0.01, output: 0 }
            : { input: 0.1, output: 0 },
        })),
      },
    });

    const route = svc.resolveRerankRoute('auto');

    expect(route.mode).toBe('auto');
    expect(route.primary).toEqual({ node: 'cheap', model: 'rerank-small' });
    expect(route.fallbacks).toEqual([{ node: 'quality', model: 'rerank-large' }]);
  });

  it('should filter rerank targets by API key/namespace permissions', () => {
    const svc = makeRoutingService({
      nodes: rerankNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
          structured_output: null,
          pricing: { input: 0.1, output: 0 },
        }),
      },
    });

    const route = svc.resolveRerankRoute('auto', (target) => target.node === 'quality');

    expect(route.primary).toEqual({ node: 'quality', model: 'rerank-large' });
    expect(route.fallbacks).toHaveLength(0);
  });

  it('should keep unhealthy rerank targets out of auto routing', () => {
    const svc = makeRoutingService({
      nodes: rerankNodes,
      circuitBreaker: {
        isAvailable: jest.fn().mockImplementation((node: string) => node !== 'cheap'),
      },
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['text']),
        resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
          structured_output: null,
          pricing: { input: 0.1, output: 0 },
        }),
      },
    });

    const route = svc.resolveRerankRoute('auto');

    expect(route.primary).toEqual({ node: 'quality', model: 'rerank-large' });
  });
});

describe('RoutingService — images and audio', () => {
  const mediaNodes = [
    {
      id: 'cheap-media',
      tags: ['fast'],
      image_models: ['gpt-image-mini'],
      audio_models: ['tts-mini'],
    },
    {
      id: 'quality-media',
      tags: ['quality'],
      image_models: ['gpt-image-1'],
      audio_models: ['gpt-4o-mini-transcribe'],
    },
  ];

  it('should choose the lowest priced image target for auto routing', () => {
    const svc = makeRoutingService({
      nodes: mediaNodes,
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['vision']),
        resolveModelRoutingCapabilities: jest.fn().mockImplementation((_node: string, model: string) => ({
          structured_output: null,
          pricing: model.includes('mini')
            ? { input: 0.5, output: 0 }
            : { input: 5, output: 0 },
        })),
      },
    });

    const route = svc.resolveMediaRoute('image_generation', 'auto');

    expect(route.mode).toBe('auto');
    expect(route.primary).toEqual({ node: 'cheap-media', model: 'gpt-image-mini' });
    expect(route.fallbacks[0]).toEqual({ node: 'quality-media', model: 'gpt-image-1' });
    expect(svc.resolveMediaRoute('image_variation', 'auto').primary).toEqual({
      node: 'cheap-media',
      model: 'gpt-image-mini',
    });
  });

  it('should resolve direct audio models and apply target permissions', () => {
    const svc = makeRoutingService({ nodes: mediaNodes });

    expect(() =>
      svc.resolveMediaRoute(
        'audio_speech',
        'tts-mini',
        (target) => target.node !== 'cheap-media',
      ),
    ).toThrow('This API key is not allowed');
  });

  it('should skip unavailable media targets when healthy alternatives exist', () => {
    const svc = makeRoutingService({
      nodes: mediaNodes,
      circuitBreaker: {
        isAvailable: jest.fn().mockImplementation((node: string) => node !== 'cheap-media'),
      },
      capabilityService: {
        resolveModelModalities: jest.fn().mockReturnValue(['audio']),
        resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
          structured_output: null,
          pricing: { input: 1, output: 0 },
        }),
      },
    });

    const route = svc.resolveMediaRoute('audio_transcription', 'auto');

    expect(route.primary).toEqual({ node: 'quality-media', model: 'gpt-4o-mini-transcribe' });
    expect(svc.resolveMediaRoute('audio_translation', 'auto').primary).toEqual({
      node: 'quality-media',
      model: 'gpt-4o-mini-transcribe',
    });
  });
});
