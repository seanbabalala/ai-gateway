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
    const { service, providerClient, repo, config } = makeService();
    config.getModelPricing.mockImplementation((model: string) =>
      model === 'gpt-4o'
        ? { input: 5, output: 15 }
        : { input: 0.15, output: 0.6 },
    );
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
        primary_latency_ms: 100,
        primary_input_tokens: 10,
        primary_output_tokens: 5,
        primary_cost_usd: 0.000125,
        shadow_cost_usd: 0.00000585,
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
        primary_latency_ms: 100,
      }),
    );
  });

  it('builds a read-only comparison report from sanitized shadow rows', () => {
    const { service } = makeService();
    const report = service.buildComparisonReport([
      {
        id: 1,
        timestamp: new Date(),
        request_id: 'req-1',
        kind: 'chat',
        namespace_id: 'team-alpha',
        api_key_id: null,
        api_key_name: null,
        source_format: 'chat_completions',
        primary_node: 'openai',
        primary_model: 'gpt-4o',
        shadow_node: 'shadow-openai',
        shadow_model: 'gpt-4o-mini',
        status: 'sent',
        latency_ms: 80,
        primary_latency_ms: 120,
        status_code: 200,
        error: null,
        input_tokens: 9,
        output_tokens: 5,
        primary_input_tokens: 10,
        primary_output_tokens: 5,
        primary_cost_usd: 0.001,
        shadow_cost_usd: 0.0002,
        prompt_sample: null,
        primary_response_sample: JSON.stringify({ content: [{ type: 'text', text: 'ship it' }] }),
        response_sample: JSON.stringify({ content: [{ type: 'text', text: 'ship it now' }] }),
      },
      {
        id: 2,
        timestamp: new Date(),
        request_id: 'req-2',
        kind: 'chat',
        namespace_id: 'team-alpha',
        api_key_id: null,
        api_key_name: null,
        source_format: 'chat_completions',
        primary_node: 'openai',
        primary_model: 'gpt-4o',
        shadow_node: 'shadow-openai',
        shadow_model: 'gpt-4o-mini',
        status: 'failed',
        latency_ms: 200,
        primary_latency_ms: 110,
        status_code: 429,
        error: 'rate limited',
        input_tokens: 0,
        output_tokens: 0,
        primary_input_tokens: 10,
        primary_output_tokens: 4,
        primary_cost_usd: 0.001,
        shadow_cost_usd: 0,
        prompt_sample: null,
        primary_response_sample: null,
        response_sample: null,
      },
    ], 'team-alpha');

    expect(report.window).toEqual(expect.objectContaining({
      rows: 2,
      compared: 2,
      namespace_id: 'team-alpha',
    }));
    expect(report.success.shadow_success_rate).toBe(0.5);
    expect(report.latency.delta_ms).toBe(25);
    expect(report.cost.potential_savings_usd).toBe(0.0018);
    expect(report.quality.evaluated).toBe(1);
    expect(report.recommendation.decision).toBe('not_enough_data');
  });
});
