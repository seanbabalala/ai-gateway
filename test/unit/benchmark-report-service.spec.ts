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
    cache_read_input_tokens: overrides.cache_read_input_tokens ?? 0,
    error: overrides.error ?? null,
  };
}

function makeService(rows: any[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  return {
    service: new BenchmarkReportService(repo as any),
    qb,
  };
}

describe('BenchmarkReportService', () => {
  it('summarizes latency, throughput, fallback, cache, and node:model groups', async () => {
    const base = Date.now();
    const rows = [
      makeLog({ timestamp: new Date(base - 120_000), latency_ms: 100 }),
      makeLog({
        timestamp: new Date(base - 90_000),
        latency_ms: 200,
        cache_read_input_tokens: 50,
      }),
      makeLog({
        timestamp: new Date(base - 60_000),
        latency_ms: 800,
        status_code: 429,
        is_fallback: true,
        error: 'Bearer sk-secret123456 failed',
      }),
      makeLog({
        timestamp: new Date(base - 30_000),
        node_id: 'claude',
        model: 'claude-3',
        latency_ms: 500,
        source_format: 'messages',
      }),
    ];
    const { service } = makeService(rows);

    const report = await service.getReport({ period: '24h' });

    expect(report.summary.calls).toBe(4);
    expect(report.summary.success).toBe(3);
    expect(report.summary.success_rate).toBe(75);
    expect(report.summary.fallback_rate).toBe(25);
    expect(report.summary.cache_hit_rate).toBe(25);
    expect(report.summary.latency_ms.p50_ms).toBe(200);
    expect(report.summary.latency_ms.p95_ms).toBe(800);
    expect(report.by_node_model).toHaveLength(2);
    expect(report.by_source_format.map((item) => item.source_format)).toEqual([
      'chat_completions',
      'messages',
    ]);
    expect(report.top_errors[0].error).toContain('Bearer [redacted]');
    expect(report.privacy.prompt_response_stored).toBe(false);
  });

  it('applies filters and clamps sample limit', async () => {
    const { service, qb } = makeService([]);

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
    expect(qb.andWhere).toHaveBeenCalledWith('log.api_key_id = :apiKeyId', {
      apiKeyId: 'key_123',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.namespace_id = :namespaceId', {
      namespaceId: 'team-alpha',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.node_id = :nodeId', {
      nodeId: 'openai',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.model = :model', {
      model: 'gpt-4o',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.source_format = :sourceFormat', {
      sourceFormat: 'responses',
    });
  });
});
