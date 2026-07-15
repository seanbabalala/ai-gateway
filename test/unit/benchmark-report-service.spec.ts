import { BenchmarkReportService } from '../../src/dashboard/benchmark-report.service';

function makeLog(overrides: Record<string, any> = {}) {
  return {
    request_id: overrides.request_id ?? `req-${Math.random()}`,
    timestamp: overrides.timestamp ?? new Date(),
    source_format: overrides.source_format ?? 'chat_completions',
    tier: overrides.tier ?? 'standard',
    score: overrides.score ?? 0.45,
    node_id: overrides.node_id ?? 'openai',
    model: overrides.model ?? 'gpt-4o',
    input_tokens: overrides.input_tokens ?? 100,
    output_tokens: overrides.output_tokens ?? 50,
    cost_usd: overrides.cost_usd ?? 0.002,
    latency_ms: overrides.latency_ms ?? 100,
    status_code: overrides.status_code ?? 200,
    is_fallback: overrides.is_fallback ?? false,
    fallback_reason: overrides.fallback_reason ?? null,
    cache_creation_input_tokens: overrides.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: overrides.cache_read_input_tokens ?? 0,
    error: overrides.error ?? null,
    api_key_id: overrides.api_key_id ?? null,
    namespace_id: overrides.namespace_id ?? null,
  };
}

function makeService(rows: any[], traceCount = 0, config?: any) {
  const callQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  const traceQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(traceCount),
  };
  const callRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(callQb),
  };
  const routeDecisionRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(traceQb),
  };
  const catalog = {
    models: jest.fn().mockReturnValue([
      {
        id: 'gpt-4o',
        provider: 'openai',
        modalities: ['text', 'vision'],
        pricing: { source: 'provider_docs' },
        source: 'builtin',
      },
    ]),
  };
  const workspaceContext = {
    currentWorkspaceId: jest.fn(() => 'default-workspace'),
  };
  return {
    service: new BenchmarkReportService(
      callRepo as any,
      routeDecisionRepo as any,
      catalog as any,
      config,
      workspaceContext as any,
    ),
    callQb,
    traceQb,
  };
}

describe('BenchmarkReportService', () => {
  it('summarizes latency, throughput, fallback, cache, cost, tokens, and source families', async () => {
    const base = Date.now();
    const rows = [
      makeLog({ request_id: 'req-1', timestamp: new Date(base - 120_000), latency_ms: 100 }),
      makeLog({
        request_id: 'req-2',
        timestamp: new Date(base - 90_000),
        latency_ms: 200,
        cache_read_input_tokens: 50,
      }),
      makeLog({
        request_id: 'req-3',
        timestamp: new Date(base - 60_000),
        latency_ms: 800,
        status_code: 429,
        is_fallback: true,
        error:
          'Bearer sk-secret123456 failed gateway=gw_sk_live_gateway_secret_123456 api_key=sk-query-secret-token gsk-provider-secret-token',
      }),
      makeLog({
        request_id: 'req-4',
        timestamp: new Date(base - 30_000),
        node_id: 'claude',
        model: 'claude-3',
        latency_ms: 500,
        source_format: 'messages',
      }),
      makeLog({
        request_id: 'req-5',
        timestamp: new Date(base - 15_000),
        node_id: 'openai',
        model: 'gpt-image-1',
        latency_ms: 700,
        source_format: 'image_variation',
        media_byte_size: 1024,
      }),
      makeLog({
        request_id: 'req-6',
        timestamp: new Date(base - 10_000),
        node_id: 'openai',
        model: 'tts-1',
        latency_ms: 900,
        source_format: 'audio_speech',
      }),
      makeLog({
        request_id: 'req-7',
        timestamp: new Date(base - 5_000),
        node_id: 'openai',
        model: 'veo-3.1-generate-preview',
        latency_ms: 1200,
        source_format: 'video_generation',
      }),
    ];
    const { service } = makeService(rows, 4);

    const report = await service.getReport({ period: '24h' });

    expect(report.summary.calls).toBe(7);
    expect(report.summary.total_requests).toBe(7);
    expect(report.summary.success).toBe(6);
    expect(report.summary.success_rate).toBe(85.7);
    expect(report.summary.error_rate).toBe(14.3);
    expect(report.summary.fallback_rate).toBe(14.3);
    expect(report.summary.cache_hit_rate).toBe(14.3);
    expect(report.summary.cache_miss_rate).toBe(85.7);
    expect(report.summary.latency_ms.p50_ms).toBe(700);
    expect(report.summary.latency_ms.p75_ms).toBe(900);
    expect(report.summary.latency_ms.p95_ms).toBe(1200);
    expect(report.summary.throughput.requests_per_minute).toBeGreaterThan(0);
    expect(report.summary.cost_summary.total_usd).toBeGreaterThan(0);
    expect(report.summary.token_summary.total_tokens).toBeGreaterThan(0);
    expect(report.by_node_model[0]).toHaveProperty('catalog');
    expect(report.by_node_model[0].catalog).toMatchObject({
      pricing_source: 'provider_docs',
      pricing_used_from: 'builtin_catalog',
    });
    expect(report.by_source_format.map((item) => item.source_format)).toEqual(
      expect.arrayContaining([
        'chat_completions',
        'responses',
        'messages',
        'embeddings',
        'rerank',
        'image_generation',
        'image_edit',
        'image_variation',
        'audio_transcription',
        'audio_translation',
        'audio_speech',
        'video_generation',
        'realtime',
      ]),
    );
    expect(report.by_source_family.map((item) => item.source_family)).toEqual(
      expect.arrayContaining(['chat', 'messages', 'images', 'audio', 'video', 'realtime']),
    );
    expect(report.route_trace_coverage).toEqual({
      matched_requests: 4,
      coverage_rate: 57.1,
    });
    expect(report.top_errors[0].error).toContain('Bearer [redacted]');
    expect(report.top_errors[0].error).toContain('gw_sk_[redacted]');
    expect(report.top_errors[0].error).toContain('api_key=[redacted]');
    expect(report.top_errors[0].error).toContain('[redacted-provider-key]');
    expect(report.top_errors[0].error).not.toContain('gw_sk_live_gateway_secret_123456');
    expect(report.top_errors[0].error).not.toContain('sk-query-secret-token');
    expect(report.top_errors[0].error).not.toContain('gsk-provider-secret-token');
    expect(report.privacy.prompt_response_stored).toBe(false);
    expect(report.privacy.media_bytes_stored).toBe(false);
  });

  it('applies filters and clamps sample limit', async () => {
    const { service, callQb } = makeService([]);

    const report = await service.getReport({
      period: '7d',
      api_key_id: 'key_123',
      namespace: 'team-alpha',
      node: 'openai',
      model: 'gpt-4o',
      source_format: 'responses',
      limit: 999_999,
    });

    expect(report.period).toBe('7d');
    expect(report.window.sample_limit).toBe(20_000);
    expect(callQb.andWhere).toHaveBeenCalledWith('log.api_key_id = :apiKeyId', {
      apiKeyId: 'key_123',
    });
    expect(callQb.andWhere).toHaveBeenCalledWith('log.namespace_id = :namespaceId', {
      namespaceId: 'team-alpha',
    });
    expect(callQb.andWhere).toHaveBeenCalledWith('log.node_id = :nodeId', {
      nodeId: 'openai',
    });
    expect(callQb.andWhere).toHaveBeenCalledWith('log.model = :model', {
      model: 'gpt-4o',
    });
    expect(callQb.andWhere).toHaveBeenCalledWith('log.source_format = :sourceFormat', {
      sourceFormat: 'responses',
    });
  });

  it('uses the shared pricing resolver when benchmark logs lack recorded cost', async () => {
    const rows = [
      makeLog({
        request_id: 'req-priced',
        cost_usd: 0,
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_input_tokens: 200_000,
      }),
    ];
    const config = {
      getModelPricing: jest.fn().mockReturnValue({
        input: 2,
        output: 4,
        cache_read_input: 0.5,
        source: 'catalog:openai:builtin-reference',
        pricing_used_from: 'builtin_catalog',
      }),
    };
    const { service } = makeService(rows, 0, config);

    const report = await service.getReport({ period: '24h' });

    expect(config.getModelPricing).toHaveBeenCalledWith('gpt-4o', 'openai');
    expect(report.summary.cost_summary.total_usd).toBe(3.7);
  });
});
