import { ShadowTrafficService } from '../../src/shadow/shadow-traffic.service';
import { makeCanonicalResponse, makeRequest, mockConfigService } from '../helpers';

function makeRepo() {
  const store: any[] = [];
  return {
    _store: store,
    create: jest.fn((partial: any) => ({ ...partial })),
    save: jest.fn(async (entity: any) => {
      const saved = { id: entity.id || store.length + 1, timestamp: new Date(), ...entity };
      store.push(saved);
      return saved;
    }),
    find: jest.fn(async () => []),
    delete: jest.fn(async () => ({ affected: 0 })),
  };
}

function makeService(overrides: Record<string, any> = {}) {
  const config = mockConfigService({
    nodes: [
      { id: 'shadow-openai', models: ['gpt-4o-mini'], embedding_models: ['text-embedding-3-small'] },
    ],
    shadowTraffic: {
      enabled: true,
      sample_rate: 1,
      target_node: 'shadow-openai',
      target_model: 'gpt-4o-mini',
      timeout_ms: 250,
      max_recent_results: 100,
      compare: { store_prompts: false, store_responses: false },
    },
    ...overrides.config,
  });
  config.getNode.mockImplementation((nodeId: string) =>
    config.nodes.find((node: { id: string }) => node.id === nodeId),
  );
  const providerClient = {
    forward: jest.fn().mockResolvedValue(makeCanonicalResponse({
      model: 'gpt-4o-mini',
      usage: { input_tokens: 11, output_tokens: 7 },
    })),
    forwardEmbeddings: jest.fn(),
    ...overrides.providerClient,
  };
  const repo = overrides.repo || makeRepo();
  const service = new ShadowTrafficService(config, providerClient as any, repo as any);
  return { service, config, providerClient, repo };
}

describe('ShadowTrafficService', () => {
  it('mirrors chat requests without storing prompts or responses by default', async () => {
    const { service, providerClient, repo } = makeService();
    const request = makeRequest('sensitive prompt', { originalModel: 'gpt-4o' });
    request.metadata.namespace_id = 'team-alpha';

    await service.dispatchChat(
      'req-1',
      request,
      makeCanonicalResponse({ model: 'gpt-4o' }),
      'openai',
      'gpt-4o',
    );

    expect(providerClient.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: false,
        metadata: expect.objectContaining({ raw_headers: {} }),
      }),
      'shadow-openai',
      'gpt-4o-mini',
      expect.objectContaining({ tier: 'direct' }),
      { timeoutMs: 250 },
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace_id: 'team-alpha',
        status: 'sent',
        prompt_sample: null,
        response_sample: null,
        input_tokens: 11,
        output_tokens: 7,
      }),
    );
  });

  it('stores comparison samples only when explicitly enabled', async () => {
    const { service, repo } = makeService({
      config: {
        shadowTraffic: {
          enabled: true,
          sample_rate: 1,
          target_node: 'shadow-openai',
          target_model: 'gpt-4o-mini',
          timeout_ms: 0,
          max_recent_results: 100,
          compare: { store_prompts: true, store_responses: true },
        },
      },
    });

    await service.dispatchChat(
      'req-2',
      makeRequest('compare this', { originalModel: 'gpt-4o' }),
      makeCanonicalResponse({ model: 'gpt-4o' }),
      'openai',
      'gpt-4o',
    );

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_sample: expect.stringContaining('compare this'),
        response_sample: expect.stringContaining('Hello there'),
      }),
    );
  });

  it('records skipped results for enabled shadow config without a target', async () => {
    const { service, repo, providerClient } = makeService({
      config: {
        shadowTraffic: {
          enabled: true,
          sample_rate: 1,
          target_node: undefined,
          target_model: undefined,
          timeout_ms: 0,
          max_recent_results: 100,
          compare: { store_prompts: false, store_responses: false },
        },
      },
    });

    await service.dispatchChat(
      'req-3',
      makeRequest('hello', { originalModel: 'gpt-4o' }),
      makeCanonicalResponse({ model: 'gpt-4o' }),
      'openai',
      'gpt-4o',
    );

    expect(providerClient.forward).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        error: expect.stringContaining('Shadow target'),
      }),
    );
  });
});
