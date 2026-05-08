import { ProviderExtensibilityService } from '../../src/dashboard/provider-extensibility.service';
import { CircuitState } from '../../src/routing/circuit-breaker.service';

function makeLog(overrides: Record<string, any> = {}) {
  return {
    request_id: overrides.request_id || 'req-1',
    timestamp: overrides.timestamp || new Date(),
    node_id: overrides.node_id || 'custom-acme',
    latency_ms: overrides.latency_ms ?? 120,
    status_code: overrides.status_code ?? 200,
  };
}

function makeService(rows: any[] = []) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  const config = {
    nodes: [
      {
        id: 'custom-acme',
        name: 'Acme AI',
        protocol: 'chat_completions',
        base_url: 'https://api.acme.test',
        endpoint: '/v1/chat/completions',
        api_key: '${env:ACME_API_KEY}',
        auth_type: 'custom-header',
        auth_header_name: 'api-key',
        models: ['acme-chat'],
        model_capabilities: {
          'acme-chat': {
            pricing: {
              input: 0.1,
              output: 0.2,
              source: 'operator_override',
              source_url: 'https://acme.test/pricing',
              last_updated: '2026-05-09',
              manual_review_required: true,
            },
          },
        },
      },
    ],
    getModelPricing: jest.fn((_model: string, nodeId?: string) =>
      nodeId === 'custom-acme'
        ? {
            input: 0.1,
            output: 0.2,
            source: 'operator_override',
            source_url: 'https://acme.test/pricing',
            last_updated: '2026-05-09',
            manual_review_required: true,
          }
        : undefined,
    ),
  };
  const activeHealth = {
    getNodeStatus: jest.fn().mockReturnValue({
      enabled: true,
      status: 'healthy',
      method: 'HEAD',
      target: 'https://api.acme.test/health',
      last_checked_at: '2026-05-09T00:00:00.000Z',
      last_success_at: '2026-05-09T00:00:00.000Z',
      latency_ms: 25,
      failure_reason: null,
      consecutive_failures: 0,
    }),
  };
  const circuitBreaker = {
    getNodeStatus: jest.fn().mockReturnValue({
      state: CircuitState.CLOSED,
      consecutiveFailures: 0,
      lastFailureAt: null,
    }),
  };
  const workspaceContext = {
    currentWorkspaceId: jest.fn(() => 'default-workspace'),
  };
  const callLogRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };

  return {
    service: new ProviderExtensibilityService(
      config as any,
      activeHealth as any,
      circuitBreaker as any,
      workspaceContext as any,
      callLogRepo as any,
    ),
    config,
    qb,
  };
}

describe('ProviderExtensibilityService', () => {
  it('previews custom provider templates with secret placeholders and manual review evidence', () => {
    const { service } = makeService();

    const result = service.previewCustomProviderTemplate({
      provider_id: 'custom-acme',
      provider_name: 'Acme AI',
      base_url: 'https://api.acme.test',
      protocol: 'chat_completions',
      auth_type: 'custom-header',
      auth_header_name: 'api-key',
      auth_header_prefix: 'Token',
      endpoints: { chat_completions: '/v1/chat/completions' },
      models: ['acme-chat'],
      compatibility_profiles: ['openai_compatible'],
      pricing: [
        {
          model: 'acme-chat',
          input_per_1m_tokens: 0.1,
          output_per_1m_tokens: 0.2,
          source_url: 'https://acme.test/pricing',
        },
      ],
      health_probe: { enabled: true, method: 'HEAD', path: '/health' },
    });

    expect(result.ok).toBe(true);
    expect(result.node_preview).toMatchObject({
      id: 'custom-acme',
      api_key: '${env:PROVIDER_API_KEY}',
      auth_type: 'custom-header',
      auth_header_name: 'api-key',
    });
    expect(JSON.stringify(result)).not.toContain('sk-');
    expect(result.catalog_manifest_preview.providers['custom-acme'].models[0].pricing).toMatchObject({
      manual_review_required: true,
      pricing_confidence: 'unknown',
    });
    expect(result.privacy).toMatchObject({
      prompt: false,
      response: false,
      raw_headers: false,
      provider_keys: false,
    });
  });

  it('flags invalid custom provider auth and endpoint mappings', () => {
    const { service } = makeService();

    const result = service.previewCustomProviderTemplate({
      provider_id: 'Bad Id!',
      provider_name: '',
      base_url: 'ftp://api.acme.test',
      protocol: 'chat_completions',
      auth_type: 'custom-header',
      endpoints: { chat_completions: 'v1/chat/completions' },
      models: [],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'provider_id_invalid',
        'provider_name_required',
        'base_url_protocol_invalid',
        'custom_auth_header_required',
        'models_required',
        'endpoint_path_invalid',
      ]),
    );
  });

  it('generates beta SDK skeleton files without secrets', () => {
    const { service } = makeService();

    const result = service.generateProviderSdk({
      provider_id: 'custom-acme',
      provider_name: 'Acme AI',
      base_url: 'https://api.acme.test',
      protocol: 'chat_completions',
      models: ['acme-chat'],
    });

    expect(result.beta).toBe(true);
    expect(result.manual_review_required).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'custom-acme/manifest.json',
        'custom-acme/adapter.ts',
        'custom-acme/adapter.spec.ts',
        'custom-acme/README.md',
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('sk-');
  });

  it('aggregates provider health from probes, circuits, logs, and pricing warnings', async () => {
    const { service, qb } = makeService([
      makeLog({ request_id: 'req-1', latency_ms: 100, status_code: 200 }),
      makeLog({ request_id: 'req-2', latency_ms: 300, status_code: 502 }),
    ]);

    const result = await service.providerHealthSummary('24h');

    expect(qb.andWhere).toHaveBeenCalledWith(
      '(log.workspace_id = :workspaceId OR log.workspace_id IS NULL)',
      { workspaceId: 'default-workspace' },
    );
    expect(result.totals).toMatchObject({
      nodes: 1,
      calls: 2,
      errors: 1,
      error_rate: 50,
      pricing_warning_count: 1,
    });
    expect(result.nodes[0]).toMatchObject({
      node_id: 'custom-acme',
      availability_status: 'degraded',
      metrics: {
        calls: 2,
        success: 1,
        errors: 1,
        error_rate: 50,
        avg_latency_ms: 200,
        p95_latency_ms: 300,
      },
      auth: {
        type: 'custom-header',
        custom_header_name: 'api-key',
        provider_key_returned: false,
      },
    });
    expect(result.nodes[0].pricing_warnings[0]).toContain('manual pricing review required');
    expect(result.privacy.provider_keys).toBe(false);
  });
});
