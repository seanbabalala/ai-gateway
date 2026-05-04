import { ShadowTrafficService } from '../../src/shadow/shadow-traffic.service';
import { makeCanonicalResponse, makeRequest, mockConfigService } from '../helpers';

function makeRepo(): any {
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
    findOne: jest.fn(async ({ where }: any) =>
      store.find((row) => Object.entries(where || {}).every(([key, value]) => row[key] === value)) || null,
    ),
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
  const callLogRepo = overrides.callLogRepo || makeRepo();
  const service = new ShadowTrafficService(config, providerClient as any, repo as any, callLogRepo as any);
  return { service, config, providerClient, repo, callLogRepo };
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

  it('redacts stored comparison samples when explicit storage is enabled', async () => {
    const { service, repo } = makeService({
      config: {
        shadowTraffic: {
          enabled: true,
          sample_rate: 1,
          target_node: 'shadow-openai',
          target_model: 'gpt-4o-mini',
          timeout_ms: 0,
          max_recent_results: 100,
          compare: { store_prompts: true, store_responses: true, sample_max_chars: 200 },
        },
      },
    });

    await service.dispatchChat(
      'req-redact',
      makeRequest('secret sk-testsecret123456 user@example.com', { originalModel: 'gpt-4o' }),
      makeCanonicalResponse({ model: 'gpt-4o' }),
      'openai',
      'gpt-4o',
    );

    const saved = repo.save.mock.calls[0][0];
    expect(saved.prompt_sample).toContain('[redacted-key]');
    expect(saved.prompt_sample).toContain('[redacted-email]');
    expect(saved.prompt_sample).not.toContain('sk-testsecret123456');
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

  it('computes privacy-safe comparison reports from shadow rows and call logs', async () => {
    const repo = makeRepo();
    repo.find = jest.fn(async () => [
      {
        id: 1,
        timestamp: new Date(),
        request_id: 'req-a',
        kind: 'chat',
        namespace_id: 'team-alpha',
        api_key_id: 'key-1',
        api_key_name: 'default',
        source_format: 'chat_completions',
        primary_node: 'openai',
        primary_model: 'gpt-4o',
        shadow_node: 'shadow-openai',
        shadow_model: 'gpt-4o-mini',
        status: 'sent',
        latency_ms: 120,
        status_code: 200,
        error: null,
        input_tokens: 10,
        output_tokens: 5,
        prompt_sample: null,
        response_sample: null,
      },
      {
        id: 2,
        timestamp: new Date(),
        request_id: 'req-b',
        kind: 'chat',
        namespace_id: 'team-alpha',
        api_key_id: 'key-1',
        api_key_name: 'default',
        source_format: 'chat_completions',
        primary_node: 'openai',
        primary_model: 'gpt-4o',
        shadow_node: 'shadow-openai',
        shadow_model: 'gpt-4o-mini',
        status: 'failed',
        latency_ms: 300,
        status_code: 429,
        error: 'rate limited',
        input_tokens: 0,
        output_tokens: 0,
        prompt_sample: null,
        response_sample: null,
      },
    ]);
    const callLogRepo = {
      find: jest.fn(async () => [
        {
          request_id: 'req-a',
          node_id: 'openai',
          model: 'gpt-4o',
          status_code: 200,
          latency_ms: 100,
          cost_usd: 0.0001,
          input_tokens: 12,
          output_tokens: 6,
          is_fallback: false,
          fallback_reason: null,
        },
        {
          request_id: 'req-b',
          node_id: 'openai',
          model: 'gpt-4o',
          status_code: 200,
          latency_ms: 150,
          cost_usd: 0.0001,
          input_tokens: 10,
          output_tokens: 4,
          is_fallback: true,
          fallback_reason: 'timeout',
        },
      ]),
      findOne: jest.fn(),
    };
    const { service, config } = makeService({ repo, callLogRepo });
    config.getModelPricing.mockReturnValue({ input: 0.15, output: 0.6 });

    const report = await service.comparisonReport({
      namespaceId: 'team-alpha',
      apiKeyId: 'key-1',
      sourceFormat: 'chat_completions',
      period: '24h',
    });

    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        namespace_id: 'team-alpha',
        api_key_id: 'key-1',
        source_format: 'chat_completions',
      }),
    }));
    expect(report.primary_success_rate).toBe(1);
    expect(report.shadow_success_rate).toBe(0.5);
    expect(report.p50_latency_comparison.primary_ms).toBe(100);
    expect(report.p95_latency_comparison.shadow_ms).toBe(300);
    expect(report.fallback_delta).toBe(-0.5);
    expect(report.quality_sample_coverage).toBe(0);
    expect(report.risk_notes).toEqual(expect.arrayContaining([
      'shadow_success_rate_lower',
      'quality_samples_disabled',
    ]));
    expect(report.pairs[0]).toEqual(expect.objectContaining({
      primary_node: 'openai',
      shadow_node: 'shadow-openai',
      calls: 2,
    }));
  });

  it('returns single-result comparison details without leaking raw samples', async () => {
    const repo = makeRepo();
    const row = {
      id: 7,
      timestamp: new Date(),
      request_id: 'req-detail',
      kind: 'chat',
      namespace_id: 'team-alpha',
      api_key_id: 'key-1',
      api_key_name: 'default',
      source_format: 'chat_completions',
      primary_node: 'openai',
      primary_model: 'gpt-4o',
      shadow_node: 'shadow-openai',
      shadow_model: 'gpt-4o-mini',
      status: 'sent',
      latency_ms: 140,
      status_code: 200,
      error: null,
      input_tokens: 5,
      output_tokens: 3,
      prompt_sample: 'token sk-secret123456',
      response_sample: 'ok',
    };
    repo.findOne = jest.fn(async () => row);
    const callLogRepo = {
      find: jest.fn(),
      findOne: jest.fn(async () => ({
        request_id: 'req-detail',
        node_id: 'openai',
        model: 'gpt-4o',
        status_code: 200,
        latency_ms: 100,
        cost_usd: 0.0002,
        input_tokens: 5,
        output_tokens: 4,
        is_fallback: false,
        fallback_reason: null,
      })),
    };
    const { service, config } = makeService({ repo, callLogRepo });
    config.getModelPricing.mockReturnValue({ input: 0.15, output: 0.6 });

    const comparison = await service.comparisonForResult(7);

    expect(comparison?.deltas.latency_ms).toBe(40);
    expect(comparison?.samples.prompt_preview).toContain('[redacted-key]');
    expect(comparison?.samples.prompt_preview).not.toContain('sk-secret123456');
    expect(comparison?.privacy.provider_keys).toBe(false);
  });
});
