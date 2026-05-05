import { CapabilityService } from '../../src/config/capability.service';
import { CAPABILITY_REGISTRY } from '../../src/config/capabilities';
import { mockConfigService } from '../helpers';

function makeService(overrides: Record<string, unknown> = {}): CapabilityService {
  const config = mockConfigService(overrides);
  return new CapabilityService(config);
}

describe('CapabilityService', () => {
  // ── getRegistry ──────────────────────────────────────────

  describe('getRegistry', () => {
    it('should return all 11 capability definitions', () => {
      const svc = makeService();
      const reg = svc.getRegistry();
      expect(reg).toBe(CAPABILITY_REGISTRY);
      expect(reg.length).toBe(11);
    });

    it('should include expected capability IDs', () => {
      const svc = makeService();
      const ids = svc.getRegistry().map((c) => c.id);
      expect(ids).toContain('coding');
      expect(ids).toContain('reasoning');
      expect(ids).toContain('fast');
      expect(ids).toContain('vision');
    });
  });

  // ── getNodeCapabilities ──────────────────────────────────

  describe('getNodeCapabilities', () => {
    it('should return empty array for unknown node', () => {
      const svc = makeService();
      expect(svc.getNodeCapabilities('nonexistent')).toEqual([]);
    });

    it('should return explicit capabilities (filtered to valid IDs)', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        capabilities: ['coding', 'reasoning', 'invalid_cap'],
        tags: ['frontend'],
      });
      const svc = new CapabilityService(config);
      const caps = svc.getNodeCapabilities('n1');
      expect(caps).toContain('coding');
      expect(caps).toContain('reasoning');
      expect(caps).not.toContain('invalid_cap');
    });

    it('should infer from tags when no explicit capabilities', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        capabilities: [],
        tags: ['frontend', 'fast'],
      });
      const svc = new CapabilityService(config);
      const caps = svc.getNodeCapabilities('n1');
      expect(caps).toContain('coding_frontend');
      expect(caps).toContain('fast');
    });

    it('should return empty array when no capabilities and no tags', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({ id: 'n1' });
      const svc = new CapabilityService(config);
      expect(svc.getNodeCapabilities('n1')).toEqual([]);
    });
  });

  // ── inferCapabilitiesFromTags ────────────────────────────

  describe('inferCapabilitiesFromTags', () => {
    it('should map known tags to capability IDs', () => {
      const svc = makeService();
      const caps = svc.inferCapabilitiesFromTags(['code', 'math', 'vision']);
      expect(caps).toContain('coding');
      expect(caps).toContain('reasoning');
      expect(caps).toContain('vision');
    });

    it('should deduplicate mapped capabilities', () => {
      const svc = makeService();
      const caps = svc.inferCapabilitiesFromTags(['code', 'coding', 'programming']);
      // All map to 'coding'
      expect(caps).toEqual(['coding']);
    });

    it('should skip unknown tags', () => {
      const svc = makeService();
      const caps = svc.inferCapabilitiesFromTags(['unknown_tag', 'nonsense']);
      expect(caps).toEqual([]);
    });
  });

  // ── recommendTiers ───────────────────────────────────────

  describe('recommendTiers', () => {
    it('should return default recommendations for empty capabilities', () => {
      const svc = makeService();
      const recs = svc.recommendTiers([]);
      expect(recs).toHaveLength(4);
      expect(recs[0].tier).toBeDefined();
    });

    it('should give high reasoning score for reasoning capability', () => {
      const svc = makeService();
      const recs = svc.recommendTiers(['reasoning']);
      const reasoning = recs.find((r) => r.tier === 'reasoning');
      expect(reasoning!.score).toBe(1.0);
      expect(reasoning!.suitable).toBe(true);
      expect(reasoning!.label).toBe('Best fit');
    });

    it('should give high simple score for fast capability', () => {
      const svc = makeService();
      const recs = svc.recommendTiers(['fast']);
      const simple = recs.find((r) => r.tier === 'simple');
      expect(simple!.score).toBe(1.0);
      expect(simple!.suitable).toBe(true);
    });

    it('should sort results by score descending', () => {
      const svc = makeService();
      const recs = svc.recommendTiers(['coding']);
      for (let i = 1; i < recs.length; i++) {
        expect(recs[i - 1].score).toBeGreaterThanOrEqual(recs[i].score);
      }
    });
  });

  // ── resolveNodeModalities ────────────────────────────────

  describe('resolveNodeModalities', () => {
    it('should return default for unknown node', () => {
      const svc = makeService();
      expect(svc.resolveNodeModalities('nope')).toEqual(['text']);
    });

    it('should use explicit modalities when configured', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        modalities: ['text', 'vision', 'audio'],
        models: ['custom-model'],
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveNodeModalities('n1')).toEqual(['text', 'vision', 'audio']);
    });

    it('should infer from model names when no explicit modalities', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['gpt-4o', 'gpt-3.5-turbo'],
      });
      const svc = new CapabilityService(config);
      const mods = svc.resolveNodeModalities('n1');
      expect(mods).toContain('text');
      expect(mods).toContain('vision');
    });

    it('should fall back to vision capability when model names are unknown', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['totally-unknown-model'],
        capabilities: ['vision'],
      });
      const svc = new CapabilityService(config);
      const mods = svc.resolveNodeModalities('n1');
      expect(mods).toContain('vision');
    });

    it('should return text-only when nothing is known', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['totally-unknown-model'],
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveNodeModalities('n1')).toEqual(['text']);
    });

    it('should union model-level v0.6 modality declarations for node summaries', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        modalities: ['text'],
        models: ['gpt-4o', 'rerank-v1'],
        embedding_models: ['text-embedding-3-small'],
        model_capabilities: {
          'gpt-4o': { modalities: ['text', 'image'] },
          'rerank-v1': { supports_rerank: true },
          'text-embedding-3-small': { dimensions: [512, 1536] },
        },
      });
      const svc = new CapabilityService(config);
      const mods = svc.resolveNodeModalities('n1');
      expect(mods).toEqual(expect.arrayContaining(['text', 'image', 'rerank', 'embedding']));
    });
  });

  // ── resolveModelModalities ────────────────────────────────

  describe('resolveModelModalities', () => {
    it('should use explicit node modalities if set', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        modalities: ['text', 'audio'],
        models: [],
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveModelModalities('n1', 'anything')).toEqual(['text', 'audio']);
    });

    it('should infer from specific model name', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['gpt-4o'],
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveModelModalities('n1', 'gpt-4o')).toEqual(['text', 'vision']);
    });

    it('should return default for unknown node', () => {
      const svc = makeService();
      expect(svc.resolveModelModalities('nope', 'gpt-4o')).toEqual(['text']);
    });

    it('should prefer model-level modalities over node defaults', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        modalities: ['text'],
        models: ['image-model'],
        model_capabilities: {
          'image-model': { modalities: ['text', 'image'] },
        },
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveModelModalities('n1', 'image-model')).toEqual(['text', 'image']);
    });

    it('should infer embedding, rerank, and realtime modalities from v0.6 capability fields', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['realtime-model', 'rerank-model'],
        embedding_models: ['embed-model'],
        model_capabilities: {
          'realtime-model': { supports_realtime: true },
          'rerank-model': { endpoints: { rerank: '/v1/rerank' } },
          'embed-model': { dimensions: 1536 },
        },
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveModelModalities('n1', 'realtime-model')).toContain('realtime');
      expect(svc.resolveModelModalities('n1', 'rerank-model')).toContain('rerank');
      expect(svc.resolveModelModalities('n1', 'embed-model')).toEqual(
        expect.arrayContaining(['text', 'embedding']),
      );
    });
  });

  describe('resolveModelRoutingCapabilities', () => {
    it('should merge node defaults with model-specific v0.6 capability metadata', () => {
      const config = mockConfigService();
      config.getNode.mockReturnValue({
        id: 'n1',
        models: ['gpt-4o'],
        endpoints: { image: '/v1/images/generations' },
        input_types: ['text'],
        output_types: ['text'],
        max_file_size: 10_000,
        supports_streaming: true,
        model_capabilities: {
          'gpt-4o': {
            modalities: ['text', 'image'],
            endpoints: { responses: '/v1/responses' },
            input_types: ['text', 'image'],
            supports_realtime: true,
            max_context_tokens: 128000,
            structured_output: true,
            pricing: { input: 2.5, output: 10 },
          },
        },
      });
      config.getModelPricing.mockImplementation((model: string, nodeId?: string) => {
        const node = config.getNode(nodeId);
        return node?.model_capabilities?.[model]?.pricing ?? { input: 1, output: 2 };
      });
      const svc = new CapabilityService(config);
      expect(svc.resolveModelRoutingCapabilities('n1', 'gpt-4o')).toEqual(
        expect.objectContaining({
          modalities: expect.arrayContaining(['text', 'image', 'realtime']),
          endpoints: {
            image: '/v1/images/generations',
            responses: '/v1/responses',
          },
          input_types: ['text', 'image'],
          output_types: ['text'],
          max_file_size: 10_000,
          supports_streaming: true,
          supports_realtime: true,
          max_context_tokens: 128000,
          structured_output: true,
          pricing: { input: 2.5, output: 10 },
        }),
      );
    });
  });

  // ── recommendRouting ─────────────────────────────────────

  describe('recommendRouting', () => {
    it('should return 4 tier recommendations', () => {
      const config = mockConfigService({
        nodes: [
          { id: 'n1', models: ['gpt-4o'], capabilities: ['coding', 'reasoning'], tags: [] },
        ],
      });
      config.getModelPricing.mockReturnValue({ input: 5, output: 15 });
      config.getNode.mockImplementation((id: string) =>
        config.nodes.find((n: any) => n.id === id),
      );
      const svc = new CapabilityService(config);
      const recs = svc.recommendRouting();
      expect(recs).toHaveLength(4);
      expect(recs.map((r) => r.tier)).toEqual(['simple', 'standard', 'complex', 'reasoning']);
    });

    it('should set primary and fallbacks', () => {
      const config = mockConfigService({
        nodes: [
          { id: 'n1', models: ['gpt-4o'], capabilities: ['fast'], tags: [] },
          { id: 'n2', models: ['claude-3-opus'], capabilities: ['reasoning'], tags: [] },
        ],
      });
      config.getModelPricing.mockReturnValue(undefined);
      config.getNode.mockImplementation((id: string) =>
        config.nodes.find((n: any) => n.id === id),
      );
      const svc = new CapabilityService(config);
      const recs = svc.recommendRouting();
      const simple = recs.find((r) => r.tier === 'simple')!;
      expect(simple.primary).toBeDefined();
      expect(simple.primary!.node).toBeDefined();
    });
  });
});
