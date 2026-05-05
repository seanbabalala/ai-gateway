/**
 * DashboardController unit tests.
 *
 * Tests all dashboard REST endpoints with mocked TypeORM QueryBuilder
 * and service dependencies.
 */

import { HttpException } from '@nestjs/common';
import { DashboardController } from '../../src/dashboard/dashboard.controller';
import { CircuitState } from '../../src/routing/circuit-breaker.service';
import { mockConfigService } from '../helpers';
import { TelemetryService } from '../../src/telemetry/telemetry.service';
import { loadMergedCatalog } from '../../src/catalog/catalog.service';

// ── Mock Query Builder Factory ──────────────────────────

function mockQueryBuilder(rawResult: any = {}, rawMany: any[] = [], manyAndCount: [any[], number] = [[], 0]) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    getRawOne: jest.fn().mockResolvedValue(rawResult),
    getRawMany: jest.fn().mockResolvedValue(rawMany),
    getMany: jest.fn().mockResolvedValue(manyAndCount[0]),
    getManyAndCount: jest.fn().mockResolvedValue(manyAndCount),
  };
  return qb;
}

function mockRepo(qb: any) {
  return {
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
}

function makeDashboard(overrides: Record<string, any> = {}) {
  const config = mockConfigService({
    nodes: [
      {
        id: 'openai',
        name: 'OpenAI',
        protocol: 'chat_completions',
        base_url: 'https://api.openai.com',
        endpoint: '/v1/chat/completions',
        embeddings_endpoint: '/v1/embeddings',
        endpoints: { image: '/v1/images/generations' },
        models: ['gpt-4o'],
        embedding_models: ['text-embedding-3-small'],
        api_key: 'sk-test12345678rest',
        tags: [],
        model_aliases: {},
      },
      { id: 'claude', name: 'Claude', protocol: 'messages', base_url: 'https://api.anthropic.com', endpoint: '/v1/messages', models: ['claude-3-opus'], api_key: 'sk-ant-12345678rest', tags: [], model_aliases: {} },
    ],
    database: { type: 'sqlite', path: ':memory:', log_retention_days: 30 },
    getFullConfig: jest.fn().mockReturnValue({
      server: { port: 3000 },
      database: { type: 'sqlite' },
      auth: { api_keys: [{ name: 'default', key: 'gw_sk_dev_default_rest' }] },
      nodes: [
        { id: 'openai', name: 'OpenAI', api_key: 'sk-test12345678rest', models: ['gpt-4o'] },
      ],
      routing: {},
      budget: {},
      models_pricing: {},
    }),
    reload: jest.fn().mockReturnValue({
      success: true,
      message: 'Configuration reloaded',
      current: { version: 2 },
      previous: { version: 1 },
      changed: {},
      rolled_back: false,
    }),
    addNode: jest.fn(),
    updateNode: jest.fn(),
    deleteNode: jest.fn(),
    updateRouting: jest.fn(),
    getNodeModelDiagnostics: jest.fn().mockReturnValue([]),
    ...overrides.config,
  });

  const capabilityService = {
    getRegistry: jest.fn().mockReturnValue([]),
    getNodeCapabilities: jest.fn().mockReturnValue([]),
    resolveNodeModalities: jest.fn().mockReturnValue(['text']),
    resolveModelRoutingCapabilities: jest.fn().mockImplementation((_nodeId: string, model: string) => ({
      modalities: model.includes('embedding') ? ['text', 'embedding'] : ['text', 'image'],
      structured_output: model.includes('embedding') ? null : true,
      dimensions: model.includes('embedding') ? [512, 1536] : undefined,
      supports_streaming: !model.includes('embedding'),
      pricing: model.includes('embedding')
        ? { input: 0.02, output: 0 }
        : { input: 2.5, output: 10 },
    })),
    recommendTiers: jest.fn().mockReturnValue({}),
    recommendRouting: jest.fn().mockReturnValue({}),
    ...overrides.capabilityService,
  };

  const routingService = {
    getRoutingStatus: jest.fn().mockReturnValue({
      standard: {
        strategy: 'weighted',
        source: 'targets',
        targets: [],
        last_selected: null,
      },
    }),
    ...overrides.routingService,
  };

  const circuitBreaker = {
    getNodeStatus: jest.fn().mockReturnValue({ state: CircuitState.CLOSED, consecutiveFailures: 0, lastFailureAt: null }),
    getModelStatuses: jest.fn().mockReturnValue({}),
    reset: jest.fn(),
    ...overrides.circuitBreaker,
  };

  const concurrencyLimiter = {
    getNodeStats: jest.fn().mockImplementation((node: any) => ({
      node: node.id,
      max_concurrency: node.max_concurrency ?? null,
      queue_timeout_ms: node.queue_timeout_ms ?? 10000,
      queue_policy: node.queue_policy ?? 'wait',
      active: 0,
      queued: 0,
    })),
    ...overrides.concurrencyLimiter,
  };

  const activeHealth = {
    getNodeStatus: jest.fn().mockReturnValue({
      enabled: false,
      status: 'disabled',
      method: null,
      target: null,
      last_checked_at: null,
      last_success_at: null,
      latency_ms: null,
      failure_reason: null,
      consecutive_failures: 0,
    }),
    refreshSchedules: jest.fn(),
    ...overrides.activeHealth,
  };

  const budgetService = {
    getStatus: jest.fn().mockResolvedValue([]),
    resetRule: jest.fn().mockResolvedValue(undefined),
    getKeysWithBudgets: jest.fn().mockResolvedValue([]),
    ...overrides.budgetService,
  };

  const cacheService = {
    getStats: jest.fn().mockReturnValue({ entries: 0, hits: 0, misses: 0 }),
    clear: jest.fn(),
    ...overrides.cacheService,
  };

  const logEventBus = {
    events$: { pipe: jest.fn().mockReturnValue({ pipe: jest.fn() }) },
    ...overrides.logEventBus,
  };

  const gatewayApiKeys = {
    list: jest.fn().mockResolvedValue([]),
    getSummary: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    rotate: jest.fn(),
    remove: jest.fn(),
    ...overrides.gatewayApiKeys,
  };
  const teams = {
    list: jest.fn().mockResolvedValue([]),
    getSummary: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    ...overrides.teams,
  };
  const shadowTraffic = {
    getStatus: jest.fn().mockReturnValue({
      enabled: false,
      sample_rate: 0,
      target_node: null,
      target_model: null,
      timeout_ms: null,
      max_recent_results: 100,
      compare: { store_prompts: false, store_responses: false },
      privacy: {
        stores_prompts: false,
        stores_responses: false,
        raw_headers: false,
        provider_keys: false,
      },
    }),
    recent: jest.fn().mockResolvedValue([]),
    comparisonReport: jest.fn().mockResolvedValue({
      primary_success_rate: null,
      shadow_success_rate: null,
      latency_delta_ms: null,
      p50_latency_comparison: { primary_ms: null, shadow_ms: null, delta_ms: null },
      p95_latency_comparison: { primary_ms: null, shadow_ms: null, delta_ms: null },
      cost_delta_usd: 0,
      potential_savings_usd: 0,
      token_delta: 0,
      fallback_delta: 0,
      quality_sample_coverage: 0,
      confidence: { level: 'low', score: 0 },
      risk_notes: [],
      pairs: [],
    }),
    comparisonForResult: jest.fn().mockResolvedValue(null),
    ...overrides.shadowTraffic,
  };

  const routingRecommendations = {
    getRecommendations: jest.fn().mockResolvedValue({
      mode: 'recommendation_only',
      stats: { observed_calls: 0, targets: [], tiers: [] },
      recommendations: [],
    }),
    ...overrides.routingRecommendations,
  };
  const catalog = {
    load: jest.fn().mockReturnValue({
      catalog: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            base_url: 'https://api.openai.com',
            auth_type: 'bearer',
            endpoints: { chat_completions: '/v1/chat/completions' },
            models: [
              {
                id: 'gpt-4o',
                provider: 'openai',
                modalities: ['text', 'vision'],
                endpoints: { chat_completions: '/v1/chat/completions' },
                capabilities: ['streaming'],
                pricing: {
                  input: 2.5,
                  output: 10,
                  input_per_1m_tokens: 2.5,
                  output_per_1m_tokens: 10,
                  source: 'builtin-reference',
                  source_type: 'docs_review',
                  source_url: 'https://example.com/openai-pricing',
                  last_updated: '2026-05-05',
                  last_verified_at: '2026-05-05',
                  manual_review_required: true,
                  pricing_confidence: 'low',
                  stale_after_days: 90,
                },
                source: 'builtin',
                overridden: false,
              },
              {
                id: 'text-embedding-3-small',
                provider: 'openai',
                modalities: ['embedding'],
                endpoints: { embeddings: '/v1/embeddings' },
                capabilities: ['embedding'],
                source: 'builtin',
                overridden: false,
              },
            ],
            source: 'builtin',
            overridden: false,
          },
          {
            id: 'anthropic',
            name: 'Anthropic',
            base_url: 'https://api.anthropic.com',
            auth_type: 'x-api-key',
            endpoints: { messages: '/v1/messages' },
            models: [],
            source: 'builtin',
            overridden: false,
          },
          {
            id: 'openai-compatible',
            name: 'OpenAI Compatible',
            base_url: 'https://provider.example',
            auth_type: 'bearer',
            endpoints: { chat_completions: '/v1/chat/completions' },
            models: [],
            source: 'builtin',
            overridden: false,
          },
        ],
      },
      overridePath: 'catalog.override.yaml',
      overrideFound: false,
      syncCachePath: '.siftgate/catalog-sync-cache.yaml',
      syncCacheFound: false,
      issues: [],
    }),
    ...overrides.catalog,
  };

  const dataSource = {
    options: { type: 'better-sqlite3' },
    ...overrides.dataSource,
  };

  const qb = overrides.qb || mockQueryBuilder();
  const callLogRepo = overrides.callLogRepo || mockRepo(qb);
  const routeDecisionRepo = overrides.routeDecisionRepo || {
    ...mockRepo(qb),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
  const shadowTrafficRepo = overrides.shadowTrafficRepo || {
    ...mockRepo(qb),
    find: jest.fn().mockResolvedValue([]),
  };
  const providerCompatibility = {
    matrixForNodes: jest.fn().mockResolvedValue({}),
    compatibilityDiagnostics: jest.fn().mockReturnValue([]),
    runNodeMatrix: jest.fn().mockResolvedValue({
      success: true,
      status: 200,
      latency_ms: 1,
      message: 'Compatibility checks completed',
      matrix: [],
    }),
    ...overrides.providerCompatibility,
  };
  const configAudit = {
    recordReload: jest.fn().mockResolvedValue(null),
    listVersions: jest.fn().mockResolvedValue({ data: [], pagination: { limit: 50, count: 0 }, privacy: {} }),
    getVersion: jest.fn().mockResolvedValue(null),
    rollbackToVersion: jest.fn(),
    listEvents: jest.fn().mockResolvedValue({ data: [], pagination: { limit: 100, count: 0 }, privacy: {} }),
    recordManagementEvent: jest.fn().mockResolvedValue(null),
    trackChange: jest.fn((_input, mutation) => mutation()),
    ...overrides.configAudit,
  };
  const batchJobs = {
    dashboardSummary: jest.fn().mockResolvedValue({
      metadata_only: true,
      items: [],
      totals: { total: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
      filters: {
        period: '24h',
        status: null,
        node: null,
        namespace: null,
        api_key_id: null,
      },
    }),
    ...overrides.batchJobs,
  };

  const controller = new DashboardController(
    config,
    capabilityService as any,
    routingService as any,
    circuitBreaker as any,
    concurrencyLimiter as any,
    activeHealth as any,
    budgetService as any,
    cacheService as any,
    logEventBus as any,
    new TelemetryService(),
    routingRecommendations as any,
    gatewayApiKeys as any,
    teams as any,
    shadowTraffic as any,
    providerCompatibility as any,
    configAudit as any,
    catalog as any,
    batchJobs as any,
    overrides.realtime as any,
    dataSource as any,
    callLogRepo as any,
    routeDecisionRepo as any,
    shadowTrafficRepo as any,
    overrides.secretResolver as any,
    overrides.benchmarkReports as any,
    overrides.plugins as any,
    overrides.mcp as any,
  );

  return { controller, config, routingService, circuitBreaker, concurrencyLimiter, activeHealth, budgetService, cacheService, gatewayApiKeys, teams, shadowTraffic, providerCompatibility, configAudit, batchJobs, callLogRepo, routeDecisionRepo, shadowTrafficRepo, qb, capabilityService, routingRecommendations, catalog };
}

// ═══════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════

describe('DashboardController — getStats', () => {
  it('should return aggregated stats', async () => {
    const qb = mockQueryBuilder(
      { totalInputTokens: '1000', totalOutputTokens: '500', totalCost: '0.5', avgLatency: '200', uniqueSessions: '3' },
      [{ tier: 'standard', count: '5' }],
    );
    const repo = mockRepo(qb);
    repo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getStats();

    expect(result.total.calls).toBe(10);
    expect(result.total.success).toBe(8);
    expect(result.total.failed).toBe(2);
    expect(result.total.successRate).toBe(80);
    expect(result.total.inputTokens).toBe(1000);
    expect(result.total.outputTokens).toBe(500);
  });

  it('should handle zero calls gracefully', async () => {
    const qb = mockQueryBuilder({ totalInputTokens: null, totalOutputTokens: null, totalCost: null, avgLatency: null, uniqueSessions: null });
    const repo = mockRepo(qb);
    repo.count.mockResolvedValue(0);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getStats();

    expect(result.total.calls).toBe(0);
    expect(result.total.successRate).toBe(0);
    expect(result.total.inputTokens).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Cost Analytics
// ═══════════════════════════════════════════════════════════

describe('DashboardController — getCostAnalytics', () => {
  it('should return cost analytics for default 7d period', async () => {
    const qb = mockQueryBuilder(
      { calls: '10', cost: '1.5', inputTokens: '5000', outputTokens: '2000', avgCostPerCall: '0.15' },
      [{ model: 'gpt-4o', calls: '10', cost: '1.5', inputTokens: '5000', outputTokens: '2000', avgLatency: '200' }],
    );
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getCostAnalytics('7d', 'model');

    expect(result.period).toBe(7);
    expect(result.total.calls).toBe(10);
    expect(result.total.cost).toBe(1.5);
  });

  it('should handle 30d period', async () => {
    const qb = mockQueryBuilder({ calls: '0', cost: '0', inputTokens: '0', outputTokens: '0', avgCostPerCall: '0' });
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getCostAnalytics('30d', 'model');

    expect(result.period).toBe(30);
  });
});

describe('DashboardController — benchmark report', () => {
  it('should return a read-only benchmark report with filters', async () => {
    const benchmarkReports = {
      getReport: jest.fn().mockResolvedValue({
        summary: { total_requests: 0, success_rate: 0 },
        by_node_model: [],
        by_source_format: [],
      }),
    };
    const { controller } = makeDashboard({ benchmarkReports });

    const result = await controller.getBenchmarkReport(
      '7d',
      'team-alpha',
      undefined,
      'key_123',
      'openai',
      'gpt-4o',
      'chat_completions',
      '250',
    );

    expect(result.summary.total_requests).toBe(0);
    expect(benchmarkReports.getReport).toHaveBeenCalledWith({
      period: '7d',
      namespace: 'team-alpha',
      api_key: undefined,
      api_key_id: 'key_123',
      node: 'openai',
      model: 'gpt-4o',
      source_format: 'chat_completions',
      limit: 250,
    });
  });
});

describe('DashboardController — guardrails status', () => {
  it('should return metadata-only MCP Gateway preview status', () => {
    const mcp = {
      getDashboardSummary: jest.fn().mockReturnValue({
        enabled: true,
        path: '/mcp',
        metadata_only: true,
        servers: [
          {
            id: 'local-tools',
            name: 'Local Tools',
            tools: [{ name: 'search_docs' }],
          },
        ],
        recent_calls: [
          {
            id: 'req_1',
            server_id: 'local-tools',
            tool_name: 'search_docs',
            method: 'tools/call',
          },
        ],
        error_summary: [],
        totals: {
          servers: 1,
          enabled_servers: 1,
          tools: 1,
          recent_calls: 1,
          recent_errors: 0,
        },
      }),
    };
    const { controller } = makeDashboard({ mcp });

    const result = controller.getMcpGateway() as any;

    expect(mcp.getDashboardSummary).toHaveBeenCalled();
    expect(result.metadata_only).toBe(true);
    expect(result.servers[0].id).toBe('local-tools');
    expect(JSON.stringify(result)).not.toContain('tool arguments');
    expect(JSON.stringify(result)).not.toContain('Authorization');
  });

  it('should return privacy-safe guardrails plugin status', () => {
    const plugins = {
      getPluginStatus: jest.fn().mockReturnValue({
        enabled: true,
        mode: 'audit',
        findings: {
          total: 2,
          recent: [{ rule: 'secret.aws', action: 'webhook' }],
        },
        webhook: {
          enabled: true,
          last_status: 'sent',
          recent: [{ id: 'delivery_1', status: 'sent' }],
        },
        privacy: {
          prompt: false,
          response: false,
          raw_headers: false,
          provider_keys: false,
          media_bytes: false,
        },
      }),
    };
    const { controller } = makeDashboard({ plugins });

    const result = controller.getGuardrailsStatus() as any;

    expect(plugins.getPluginStatus).toHaveBeenCalledWith('guardrails');
    expect(result.enabled).toBe(true);
    expect(JSON.stringify(result)).not.toContain('https://hooks.example');
    expect(JSON.stringify(result)).not.toContain('Authorization');
  });
});

describe('DashboardController — sessions', () => {
  const logRows = [
    {
      id: 1,
      request_id: 'req_1',
      session_id: 'sess_1',
      session_key: 'sess_1',
      trace_id: 'trace_1',
      timestamp: new Date('2026-05-05T01:00:00Z'),
      source_format: 'chat_completions',
      tier: 'standard',
      score: 0.42,
      node_id: 'openai',
      model: 'gpt-4o',
      input_tokens: 100,
      output_tokens: 20,
      cost_usd: 0.001,
      latency_ms: 120,
      status_code: 200,
      is_fallback: false,
      fallback_reason: null,
      error: null,
      api_key_id: 'key_1',
      api_key_name: 'default',
      namespace_id: 'team-a',
    },
    {
      id: 2,
      request_id: 'req_2',
      session_id: 'sess_1',
      session_key: 'sess_1',
      trace_id: 'trace_1',
      timestamp: new Date('2026-05-05T01:01:00Z'),
      source_format: 'responses',
      tier: 'reasoning',
      score: 0.91,
      node_id: 'claude',
      model: 'claude-3-opus',
      input_tokens: 80,
      output_tokens: 40,
      cost_usd: 0.002,
      latency_ms: 240,
      status_code: 502,
      is_fallback: true,
      fallback_reason: 'upstream_error',
      error: 'upstream failed',
      api_key_id: 'key_1',
      api_key_name: 'default',
      namespace_id: 'team-a',
    },
  ];

  it('should list sessions grouped by session id with privacy metadata', async () => {
    const qb = mockQueryBuilder({}, [], [logRows, logRows.length]);
    qb.getMany.mockResolvedValue(logRows);
    const repo = mockRepo(qb);
    const { controller } = makeDashboard({ callLogRepo: repo, qb });

    const result = await controller.getSessions(
      '24h',
      'team-a',
      undefined,
      'key_1',
      undefined,
      undefined,
      1,
      25,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      session_id: 'sess_1',
      request_count: 2,
      error_count: 1,
      fallback_count: 1,
      model_switch_count: 1,
      total_tokens: 240,
    });
    expect(result.privacy).toMatchObject({
      prompt: false,
      response: false,
      raw_headers: false,
      provider_keys: false,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('log.namespace_id = :namespaceId', {
      namespaceId: 'team-a',
    });
  });

  it('should return a session timeline enriched with route, shadow, and guardrails metadata', async () => {
    const qb = mockQueryBuilder({}, [], [logRows, logRows.length]);
    qb.getMany.mockResolvedValue(logRows);
    const repo = mockRepo(qb);
    const routeDecisionRepo = {
      ...mockRepo(qb),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([
        {
          id: 10,
          request_id: 'req_2',
          trace_id: 'trace_1',
          selected_node_id: 'claude',
          selected_model: 'claude-3-opus',
          candidate_count: 3,
          filtered_count: 1,
          route_mode: 'auto',
          strategy: 'weighted',
          trace_json: JSON.stringify({
            trace_id: 'trace_1',
            final_selection: { reason: 'fallback selected' },
          }),
        },
      ]),
    };
    const shadowTrafficRepo = {
      ...mockRepo(qb),
      find: jest.fn().mockResolvedValue([
        {
          request_id: 'req_2',
          status: 'sent',
          shadow_node: 'shadow-openai',
          shadow_model: 'gpt-4o-mini',
          latency_ms: 90,
        },
      ]),
    };
    const plugins = {
      getPluginStatus: jest.fn().mockReturnValue({
        findings: {
          recent: [
            {
              request_id: 'req_2',
              kind: 'pii',
              action: 'audit',
              rule: 'pii.email',
            },
          ],
        },
      }),
    };
    const { controller } = makeDashboard({
      callLogRepo: repo,
      routeDecisionRepo,
      shadowTrafficRepo,
      plugins,
      qb,
    });

    const result = await controller.getSessionDetail(
      'sess_1',
      '7d',
      'team-a',
      undefined,
      'key_1',
      undefined,
      undefined,
      200,
    );

    expect(result.summary.request_count).toBe(2);
    expect(result.timeline[1]).toMatchObject({
      request_id: 'req_2',
      route_decision_link: '/route-decisions/req_2',
      has_route_decision: true,
      shadow: { count: 1 },
      guardrails: { count: 1, kinds: ['pii'] },
    });
    expect(JSON.stringify(result)).not.toContain('sk-test');
    expect(JSON.stringify(result)).not.toContain('Bearer ');
  });

  it('should return 404 when a session has no matching logs', async () => {
    const qb = mockQueryBuilder({}, [], [[], 0]);
    qb.getMany.mockResolvedValue([]);
    const repo = mockRepo(qb);
    const { controller } = makeDashboard({ callLogRepo: repo, qb });

    await expect(controller.getSessionDetail('missing')).rejects.toBeInstanceOf(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════

describe('DashboardController — getLogs', () => {
  it('should return paginated logs', async () => {
    const logs = [
      {
        id: 1,
        model: 'gpt-4o',
        reasoning_requested: true,
        reasoning_effort: 'high',
        reasoning_strategy: 'passthrough',
        reasoning_supported: true,
      },
      { id: 2, model: 'claude-3-opus' },
    ];
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([logs, 50]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getLogs(1, 50);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      reasoning_requested: true,
      reasoning_effort: 'high',
      reasoning_strategy: 'passthrough',
      reasoning_supported: true,
    });
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.total).toBe(50);
    expect(result.pagination.totalPages).toBe(1);
  });

  it('should apply filters', async () => {
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    await controller.getLogs(1, 50, 'standard', 'openai', '200');

    expect(qb.andWhere).toHaveBeenCalledTimes(3);
  });

  it('should clamp limit to max 200', async () => {
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getLogs(1, 999);

    expect(result.pagination.limit).toBe(200);
  });
});

describe('DashboardController — route decisions', () => {
  const trace = {
    version: 1,
    mode: 'auto',
    tier: 'standard',
    score: 0.45,
    domain_hints: { domain: 'backend', modalities: ['text'] },
    scoring: { tier: 'standard', score: 0.45, momentum_adjusted: false },
    constraints: {
      estimated_input_tokens: 12,
      estimated_output_tokens: 100,
      estimated_context_tokens: 112,
      requires_structured_output: false,
    },
    modality_evidence: {
      requested_modality: 'image',
      input_types: ['text'],
      output_types: ['image'],
      file_count: 1,
      byte_size: 2048,
      required_capabilities: ['image'],
      endpoint_strategy: 'image_generation',
      filtered_by_capability: [],
      filtered_by_file_size: [],
    },
    candidate_targets: [
      {
        node: 'openai',
        model: 'gpt-4o',
        weight: 70,
        position: 0,
        circuit_state: 'CLOSED',
        circuit_available: true,
        selected: true,
        fallback: false,
        filter_reasons: [],
        scores: { cost: 0.99, latency: 0.8, context: 0.99 },
        metrics: {
          estimated_cost_usd: 0.001,
          avg_latency_ms: 100,
          p95_latency_ms: 150,
          max_context_tokens: 128000,
          context_fit: 'safe',
          structured_output: true,
        },
        capability_evidence: {
          requested_modality: 'image',
          supported_modalities: ['text', 'vision', 'image'],
          input_types: ['text', 'image'],
          output_types: ['image'],
          required_capabilities: ['image'],
          matched_capabilities: ['image'],
          missing_capabilities: [],
          endpoint_strategy: 'image_generation',
          endpoint_status: 'default',
          endpoint: '/v1/images/generations',
          file_count: 1,
          byte_size: 2048,
          max_file_size: 10_000_000,
          filtered_by_capability: false,
          filtered_by_file_size: false,
          pricing_source: 'config',
          catalog_source: 'config',
        },
      },
    ],
    filters: [],
    load_balancing: {
      strategy: 'balanced',
      source: 'targets',
      selected: { node: 'openai', model: 'gpt-4o' },
      target_count: 1,
      reason: 'balanced local cost and latency score',
    },
    fallback_chain: [],
    cost_downgrade: null,
    final_selection: {
      node: 'openai',
      model: 'gpt-4o',
      reason: 'balanced local cost and latency score',
      is_fallback: false,
      fallback_reason: null,
    },
    privacy: {
      prompt: false,
      response: false,
      raw_headers: false,
      provider_keys: false,
    },
  };

  it('should list paginated route decision summaries', async () => {
    const item = {
      id: 1,
      request_id: 'req-1',
      timestamp: new Date(),
      source_format: 'chat_completions',
      tier: 'standard',
      score: 0.45,
      route_mode: 'auto',
      strategy: 'balanced',
      selected_node_id: 'openai',
      selected_model: 'gpt-4o',
      domain_hint: 'backend',
      candidate_count: 1,
      filtered_count: 0,
      status_code: 200,
      is_fallback: false,
      fallback_reason: null,
      api_key_name: 'prod',
      api_key_id: 'key_1',
      namespace_id: 'team-alpha',
      trace_json: JSON.stringify(trace),
    };
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[item], 1]);
    const routeDecisionRepo = {
      ...mockRepo(qb),
      findOne: jest.fn(),
    };
    const { controller } = makeDashboard({ routeDecisionRepo, qb });

    const result = await controller.getRouteDecisions(
      1,
      50,
      'standard',
      'openai',
      'chat_completions',
    );

    expect(result.data[0]).toMatchObject({
      request_id: 'req-1',
      selected: { node: 'openai', model: 'gpt-4o' },
      summary: {
        reason: 'balanced local cost and latency score',
      },
    });
    expect(result.data[0]).not.toHaveProperty('trace');
    expect(qb.andWhere).toHaveBeenCalledWith('decision.tier = :tier', { tier: 'standard' });
    expect(qb.andWhere).toHaveBeenCalledWith('decision.selected_node_id = :node', { node: 'openai' });
    expect(qb.andWhere).toHaveBeenCalledWith('decision.source_format = :sourceFormat', { sourceFormat: 'chat_completions' });
  });

  it('should return a full route decision trace by request id', async () => {
    const routeDecisionRepo = {
      ...mockRepo(mockQueryBuilder()),
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        request_id: 'req-1',
        timestamp: new Date(),
        source_format: 'chat_completions',
        tier: 'standard',
        score: 0.45,
        route_mode: 'auto',
        strategy: 'balanced',
        selected_node_id: 'openai',
        selected_model: 'gpt-4o',
        domain_hint: 'backend',
        candidate_count: 1,
        filtered_count: 0,
        status_code: 200,
        is_fallback: false,
        fallback_reason: null,
        api_key_name: null,
        api_key_id: null,
        namespace_id: null,
        trace_json: JSON.stringify(trace),
      }),
    };
    const { controller } = makeDashboard({ routeDecisionRepo });

    const result = await controller.getRouteDecision('req-1');

    expect(routeDecisionRepo.findOne).toHaveBeenCalledWith({
      where: { request_id: 'req-1' },
    });
    expect(result.trace).toMatchObject({
      modality_evidence: {
        requested_modality: 'image',
        byte_size: 2048,
      },
      candidate_targets: expect.any(Array),
      privacy: {
        prompt: false,
        response: false,
        raw_headers: false,
        provider_keys: false,
      },
    });
  });
});

describe('DashboardController — catalog', () => {
  it('returns merged provider catalog metadata for Dashboard forms', () => {
    const { controller } = makeDashboard();

    const result = controller.getCatalogProviders();

    expect(result.override_file).toBe('catalog.override.yaml');
    expect(result.override_found).toBe(false);
    expect(result.sync_status).toMatchObject({
      enabled: false,
      scheduled: false,
      write_to: 'cache',
    });
    expect(result.providers[0]).toMatchObject({
      id: 'openai',
      provider_id: 'openai',
      family: 'foundation',
      provider_type: 'direct',
      compatibility_profile: 'openai-compatible',
      logo_id: 'openai',
      aliases: expect.arrayContaining(['openai']),
      model_buckets: expect.objectContaining({
        models: expect.arrayContaining(['gpt-4o']),
        embedding_models: expect.arrayContaining(['text-embedding-3-small']),
      }),
      overridden: false,
      pricing_hygiene: expect.objectContaining({
        status: expect.any(String),
        source_type: expect.any(String),
        source_url_missing: false,
      }),
    });
  });

  it('filters catalog models by provider and modality', () => {
    const { controller } = makeDashboard();

    const result = controller.getCatalogModels('openai', 'vision');

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'gpt-4o',
        provider: 'openai',
        pricing_hygiene: expect.objectContaining({
          status: expect.any(String),
          source_type: expect.any(String),
        }),
        pricing: expect.objectContaining({
          source_type: expect.any(String),
          input_per_1m_tokens: expect.any(Number),
        }),
      }),
    ]);
  });

  it('returns v1.4 50 plus provider catalog entries from the merged catalog API shape', () => {
    const loaded = loadMergedCatalog({
      cwd: process.cwd(),
      overridePath: '/tmp/siftgate-missing-catalog.override.yaml',
      env: {},
    });
    const { controller } = makeDashboard({
      catalog: {
        load: jest.fn().mockReturnValue(loaded),
      },
    });

    const result = controller.getCatalogProviders();
    const providerIds = result.providers.map((provider: any) => provider.id);
    const huggingFace = result.providers.find((provider: any) => provider.id === 'huggingface');

    expect(providerIds.length).toBeGreaterThanOrEqual(50);
    expect(providerIds).toEqual(
      expect.arrayContaining(['huggingface', 'cloudflare-workers-ai', 'deepgram', 'xinference']),
    );
    expect(huggingFace).toMatchObject({
      provider_type: 'aggregator',
      logo_id: 'huggingface',
      model_buckets: expect.objectContaining({
        models: expect.arrayContaining(['meta-llama/Llama-3.3-70B-Instruct']),
      }),
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Log Export
// ═══════════════════════════════════════════════════════════

describe('DashboardController — exportLogs', () => {
  it('should export as JSON', async () => {
    const logs = [{ id: 1, model: 'gpt-4o', timestamp: new Date() }];
    const qb = mockQueryBuilder();
    qb.getMany.mockResolvedValue(logs);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportLogs('json', 7, undefined, undefined, undefined, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalled();
  });

  it('should export as CSV by default', async () => {
    const qb = mockQueryBuilder();
    qb.getMany.mockResolvedValue([]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportLogs('csv', 7, undefined, undefined, undefined, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    const csv = res.send.mock.calls[0][0] as string;
    expect(csv).toContain('timestamp,request_id');
  });
});

// ═══════════════════════════════════════════════════════════
// Budget
// ═══════════════════════════════════════════════════════════

describe('DashboardController — budget', () => {
  it('should return budget status', async () => {
    const { controller, budgetService } = makeDashboard({
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([
          { type: 'tokens', current: 500, limit: 1000, percentage: 0.5, isExceeded: false, isAlert: false, periodStart: new Date() },
        ]),
        resetRule: jest.fn(),
      },
    });
    const result = await controller.getBudget();
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].percentage).toBe(50);
  });

  it('should reset a budget rule', async () => {
    const { controller, budgetService } = makeDashboard();
    const result = await controller.resetBudget(1);
    expect(result.success).toBe(true);
    expect(budgetService.resetRule).toHaveBeenCalledWith(1);
  });
});

// ═══════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════

describe('DashboardController — cache', () => {
  it('should return cache stats', () => {
    const { controller } = makeDashboard();
    const result = controller.getCacheStats();
    expect(result).toHaveProperty('entries');
  });

  it('should clear cache', () => {
    const { controller, cacheService } = makeDashboard();
    const result = controller.clearCache();
    expect(result.success).toBe(true);
    expect(cacheService.clear).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════

describe('DashboardController — config', () => {
  it('should return sanitized config and keep client keys dashboard-managed', () => {
    const { controller } = makeDashboard();
    const result = controller.getConfig();

    expect(result.nodes[0].api_key).toContain('...');
    expect(result.nodes[0].api_key).not.toBe('sk-test12345678rest');
    expect(result.auth.api_keys).toEqual([]);
    expect(result.auth.managed_in_dashboard).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.routing_status.standard.strategy).toBe('weighted');
  });

  it('should include config diagnostics', () => {
    const diagnostics = [
      { severity: 'warning', code: 'duplicate_model_id', message: 'Duplicate', nodes: ['a', 'b'], model: 'm' },
    ];
    const { controller } = makeDashboard({
      config: { getNodeModelDiagnostics: jest.fn().mockReturnValue(diagnostics) },
    });
    expect(controller.getConfig().diagnostics).toBe(diagnostics);
  });

  it('should reload config', async () => {
    const { controller, config, activeHealth, configAudit } = makeDashboard();
    const result = await controller.reloadConfig();
    expect(result.success).toBe(true);
    expect(config.reload).toHaveBeenCalledWith({
      source: 'dashboard',
      throwOnError: false,
    });
    expect(configAudit.recordReload).toHaveBeenCalled();
    expect(activeHealth.refreshSchedules).toHaveBeenCalled();
  });

  it('should handle reload failure', async () => {
    const { controller } = makeDashboard({
      config: {
        reload: jest.fn().mockReturnValue({
          success: false,
          message: 'Configuration reload failed; retained previous config: Invalid YAML',
          error: { name: 'YAMLException', message: 'Invalid YAML' },
          current: { version: 1 },
          previous: { version: 1 },
          changed: {},
          rolled_back: true,
        }),
      },
    });
    await expect(controller.reloadConfig()).rejects.toThrow(HttpException);
  });

  it('should expose config version and audit event APIs', async () => {
    const { controller, configAudit } = makeDashboard({
      configAudit: {
        listVersions: jest.fn().mockResolvedValue({ data: [{ version_id: 'cfgv_1' }], pagination: { count: 1 } }),
        getVersion: jest.fn().mockResolvedValue({ version_id: 'cfgv_1', sanitized_config: { nodes: [] } }),
        rollbackToVersion: jest.fn().mockResolvedValue({
          success: true,
          message: 'Rolled back',
          target_version: { version_id: 'cfgv_1' },
          previous_version: null,
          restored_version: { version_id: 'cfgv_2' },
          reload: { success: true },
        }),
        listEvents: jest.fn().mockResolvedValue({ data: [{ event_id: 'cfge_1' }], pagination: { count: 1 } }),
      },
    });

    await expect(controller.getConfigVersions(25)).resolves.toEqual({
      data: [{ version_id: 'cfgv_1' }],
      pagination: { count: 1 },
    });
    await expect(controller.getConfigVersion('cfgv_1')).resolves.toEqual({
      version_id: 'cfgv_1',
      sanitized_config: { nodes: [] },
    });
    await expect(controller.rollbackConfigVersion('cfgv_1', { reason: 'test' })).resolves.toEqual(
      expect.objectContaining({ success: true, message: 'Rolled back' }),
    );
    await expect(controller.getConfigAuditEvents(10, 'config.node.create')).resolves.toEqual({
      data: [{ event_id: 'cfge_1' }],
      pagination: { count: 1 },
    });
    expect(configAudit.rollbackToVersion).toHaveBeenCalledWith('cfgv_1', {
      reason: 'test',
      actor: { type: 'dashboard', id: 'dashboard' },
      source: 'dashboard',
    });
  });

  it('should return 404 for missing config versions', async () => {
    const { controller } = makeDashboard({
      configAudit: { getVersion: jest.fn().mockResolvedValue(null) },
    });
    await expect(controller.getConfigVersion('missing')).rejects.toThrow(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Nodes
// ═══════════════════════════════════════════════════════════

describe('DashboardController — nodes', () => {
  it('should return node list with circuit and capability info', async () => {
    const { controller } = makeDashboard();
    const result = await controller.getNodes();

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe('openai');
    expect(result.nodes[0].healthy).toBe(true);
    expect(result.nodes[0].capabilities).toBeDefined();
    expect(result.nodes[0].modalities).toBeDefined();
    expect(result.nodes[0].embedding_models).toEqual(['text-embedding-3-small']);
    expect(result.nodes[0].endpoints).toEqual(
      expect.objectContaining({
        default: '/v1/chat/completions',
        embeddings: '/v1/embeddings',
        image: '/v1/images/generations',
      }),
    );
    expect(result.nodes[0].model_capabilities['gpt-4o']).toEqual(
      expect.objectContaining({
        modalities: ['text', 'image'],
        supports_streaming: true,
      }),
    );
    expect(result.nodes[0].model_capabilities['text-embedding-3-small']).toEqual(
      expect.objectContaining({
        modalities: ['text', 'embedding'],
        dimensions: [512, 1536],
      }),
    );
    expect(result.nodes[0].concurrency).toEqual(
      expect.objectContaining({ active: 0, queued: 0 }),
    );
    expect(result.nodes[0].active_probe.status).toBe('disabled');
    expect(result.nodes[0].compatibility_matrix).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('should include active probe state in node list', async () => {
    const { controller } = makeDashboard({
      activeHealth: {
        getNodeStatus: jest.fn().mockReturnValue({
          enabled: true,
          status: 'unhealthy',
          method: 'GET',
          target: 'GET /ready',
          last_checked_at: '2026-05-02T00:00:00.000Z',
          last_success_at: null,
          latency_ms: 42,
          failure_reason: 'HTTP 503',
          consecutive_failures: 2,
        }),
      },
    });
    const result = await controller.getNodes();

    expect(result.nodes[0].healthy).toBe(false);
    expect(result.nodes[0].active_probe.failure_reason).toBe('HTTP 503');
    expect(result.nodes[0].active_probe.last_checked_at).toBe('2026-05-02T00:00:00.000Z');
  });

  it('should show unhealthy when circuit is OPEN', async () => {
    const { controller } = makeDashboard({
      circuitBreaker: {
        getNodeStatus: jest.fn().mockReturnValue({ state: CircuitState.OPEN, consecutiveFailures: 3, lastFailureAt: Date.now() }),
        getModelStatuses: jest.fn().mockReturnValue({}),
        reset: jest.fn(),
      },
    });
    const result = await controller.getNodes();
    expect(result.nodes[0].healthy).toBe(false);
  });

  it('should reset circuit breaker for a node', () => {
    const { controller, circuitBreaker } = makeDashboard();
    const result = controller.resetNodeCircuit('openai');
    expect(result.success).toBe(true);
    expect(circuitBreaker.reset).toHaveBeenCalledWith('openai');
  });

  it('should reset circuit breaker for a specific model', () => {
    const { controller, circuitBreaker } = makeDashboard();
    const result = controller.resetNodeCircuit('openai', 'gpt-4o');
    expect(result.success).toBe(true);
    expect(circuitBreaker.reset).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('should refresh active health schedules after node mutations', async () => {
    const { controller, activeHealth } = makeDashboard();

    await controller.createNode({
      id: 'new-node',
      name: 'New Node',
      protocol: 'chat_completions',
      base_url: 'https://api.example.com',
      endpoint: '/v1/chat/completions',
      api_key: 'sk-test',
      models: ['gpt-4o-mini'],
      timeout_ms: 1000,
      health_check: { enabled: true, method: 'HEAD', path: '/healthz' },
    });
    await controller.updateNode('openai', { health_check: { enabled: false } });
    await controller.deleteNode('openai');

    expect(activeHealth.refreshSchedules).toHaveBeenCalledTimes(3);
  });
});

// ═══════════════════════════════════════════════════════════
// Node CRUD
// ═══════════════════════════════════════════════════════════

describe('DashboardController — Node CRUD', () => {
  it('should create a node', async () => {
    const { controller, config, configAudit } = makeDashboard();
    const dto = {
      id: 'new-node',
      name: 'New',
      protocol: 'chat_completions',
      base_url: 'https://example.com',
      endpoint: '/v1/chat/completions',
      api_key: 'sk-new',
      models: ['model-1'],
      video_generations_endpoint: '/v1/videos/generations',
      video_status_endpoint: '/v1/videos/{id}',
      video_models: ['video-1'],
      model_capabilities: {
        'video-1': { pricing: { input: 0.1, output: 0.2 } },
      },
      max_concurrency: 3,
      queue_timeout_ms: 250,
      queue_policy: 'fallback',
    } as any;
    const result = await controller.createNode(dto);

    expect(result.success).toBe(true);
    expect(configAudit.trackChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'config.node.create', target: 'node:new-node' }),
      expect.any(Function),
    );
    expect(config.addNode).toHaveBeenCalledWith(
      expect.objectContaining({
        max_concurrency: 3,
        queue_timeout_ms: 250,
        queue_policy: 'fallback',
        video_generations_endpoint: '/v1/videos/generations',
        video_status_endpoint: '/v1/videos/{id}',
        video_models: ['video-1'],
        model_capabilities: {
          'video-1': { pricing: { input: 0.1, output: 0.2 } },
        },
      }),
    );
  });

  it('should throw on duplicate node creation', async () => {
    const { controller } = makeDashboard({
      config: { addNode: jest.fn().mockImplementation(() => { throw new Error('Node already exists'); }) },
    });
    const dto = { id: 'openai', name: 'Dup' } as any;
    await expect(controller.createNode(dto)).rejects.toThrow(HttpException);
  });

  it('should update a node', async () => {
    const { controller, config } = makeDashboard();
    const result = await controller.updateNode('openai', { name: 'Updated OpenAI' } as any);
    expect(result.success).toBe(true);
    expect(config.updateNode).toHaveBeenCalled();
  });

  it('should not pass empty api_key on update', async () => {
    const { controller, config } = makeDashboard();
    await controller.updateNode('openai', { name: 'Updated', api_key: '' } as any);
    const updateArgs = config.updateNode.mock.calls[0][1];
    expect(updateArgs.api_key).toBeUndefined();
  });

  it('should delete a node', async () => {
    const { controller, config, circuitBreaker } = makeDashboard();
    const result = await controller.deleteNode('openai');
    expect(result.success).toBe(true);
    expect(circuitBreaker.reset).toHaveBeenCalledWith('openai');
    expect(config.deleteNode).toHaveBeenCalledWith('openai');
  });

  it('should throw on deleting last node', async () => {
    const { controller } = makeDashboard({
      config: { deleteNode: jest.fn().mockImplementation(() => { throw new Error('Cannot delete the last remaining node'); }) },
    });
    await expect(controller.deleteNode('openai')).rejects.toThrow(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Capabilities & Routing
// ═══════════════════════════════════════════════════════════

describe('DashboardController — capabilities & routing', () => {
  it('should return provider catalog entries', () => {
    const { controller } = makeDashboard();
    const result = controller.getCatalogProviders();
    expect(result.source).toBe('builtin_static');
    expect(result.auto_update).toBe(false);
    expect(result.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['openai', 'anthropic', 'openai-compatible']),
    );
  });

  it('should return filtered catalog models', () => {
    const { controller } = makeDashboard();
    const result = controller.getCatalogModels('openai', 'embedding');
    expect(result.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_id: 'openai',
          modalities: expect.arrayContaining(['embedding']),
        }),
      ]),
    );
  });

  it('should return capabilities registry', () => {
    const { controller } = makeDashboard();
    const result = controller.getCapabilities();
    expect(result).toHaveProperty('capabilities');
  });

  it('should recommend tiers', () => {
    const { controller, capabilityService } = makeDashboard();
    const result = controller.recommendTiers({ capabilities: ['reasoning', 'code'] });
    expect(capabilityService.recommendTiers).toHaveBeenCalledWith(['reasoning', 'code']);
  });

  it('should recommend routing', () => {
    const { controller } = makeDashboard();
    const result = controller.recommendRouting();
    expect(result).toHaveProperty('recommendations');
  });

  it('should return read-only adaptive routing recommendations', async () => {
    const { controller, routingRecommendations } = makeDashboard();
    const result = await controller.getAdaptiveRoutingRecommendations(12, 500);
    expect(result.mode).toBe('recommendation_only');
    expect(routingRecommendations.getRecommendations).toHaveBeenCalledWith({
      windowHours: 12,
      sampleLimit: 500,
    });
  });

  it('should update routing config', async () => {
    const { controller, config } = makeDashboard();
    const result = await controller.updateRouting({ scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 } });
    expect(result.success).toBe(true);
    expect(config.updateRouting).toHaveBeenCalled();
  });

  it('should throw on invalid routing update', async () => {
    const { controller } = makeDashboard({
      config: { updateRouting: jest.fn().mockImplementation(() => { throw new Error('Invalid node reference'); }) },
    });
    await expect(controller.updateRouting({ tiers: {} as any })).rejects.toThrow(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Per-Key Budget + API Key Filtering
// ═══════════════════════════════════════════════════════════

describe('DashboardController — per-key budget', () => {
  it('should return global + perKey rules when api_key query provided', async () => {
    const { controller } = makeDashboard({
      budgetService: {
        getStatus: jest.fn().mockImplementation((keyName?: string) => {
          if (keyName === 'intern') {
            return Promise.resolve([
              { id: 2, type: 'daily_cost', scope: 'api_key', apiKeyName: 'intern', apiKeyId: null, current: 3, limit: 5, percentage: 0.6, isExceeded: false, isAlert: false, periodStart: new Date(), resetAt: new Date() },
            ]);
          }
          return Promise.resolve([
            { id: 1, type: 'daily_cost', scope: 'global', apiKeyName: null, apiKeyId: null, current: 10, limit: 100, percentage: 0.1, isExceeded: false, isAlert: false, periodStart: new Date(), resetAt: new Date() },
          ]);
        }),
        resetRule: jest.fn(),
        getKeysWithBudgets: jest.fn().mockResolvedValue(['intern', 'sean']),
      },
    });

    const result = await controller.getBudget('intern');
    expect(result.rules).toHaveLength(1);
    expect((result as any).perKeyRules).toHaveLength(1);
    expect((result as any).apiKeyName).toBe('intern');
    expect((result as any).perKeyRules[0].limit).toBe(5);
  });

  it('should query per-key budget by api_key_id when provided', async () => {
    const getStatus = jest.fn().mockImplementation((_keyName?: string | null, keyId?: string | null) => {
      if (keyId === 'key_123') {
        return Promise.resolve([
          { id: 7, type: 'daily_tokens', scope: 'api_key', apiKeyName: 'production', apiKeyId: 'key_123', current: 2500, limit: 10000, percentage: 0.25, isExceeded: false, isAlert: false, periodStart: new Date(), resetAt: new Date() },
        ]);
      }
      return Promise.resolve([
        { id: 1, type: 'daily_tokens', scope: 'global', apiKeyName: null, apiKeyId: null, current: 5000, limit: 100000, percentage: 0.05, isExceeded: false, isAlert: false, periodStart: new Date(), resetAt: new Date() },
      ]);
    });
    const { controller } = makeDashboard({
      budgetService: {
        getStatus,
        resetRule: jest.fn(),
        getKeysWithBudgets: jest.fn().mockResolvedValue([]),
      },
    });

    const result = await controller.getBudget(undefined, 'key_123');
    expect(getStatus).toHaveBeenCalledWith(null, 'key_123');
    expect((result as any).apiKeyName).toBe('production');
    expect((result as any).apiKeyId).toBe('key_123');
    expect((result as any).perKeyRules[0]).toMatchObject({
      id: 7,
      apiKeyId: 'key_123',
      percentage: 25,
    });
  });

  it('should return only global rules when no api_key query', async () => {
    const { controller } = makeDashboard({
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([
          { type: 'daily_tokens', current: 50000, limit: 100000, percentage: 0.5, isExceeded: false, isAlert: false, periodStart: new Date() },
        ]),
        resetRule: jest.fn(),
        getKeysWithBudgets: jest.fn().mockResolvedValue([]),
      },
    });

    const result = await controller.getBudget();
    expect(result.rules).toHaveLength(1);
    expect((result as any).perKeyRules).toBeUndefined();
  });

  it('should return budget keys via GET /budget/keys', async () => {
    const { controller } = makeDashboard({
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([]),
        resetRule: jest.fn(),
        getKeysWithBudgets: jest.fn().mockResolvedValue(['intern', 'sean']),
      },
      gatewayApiKeys: {
        list: jest.fn().mockResolvedValue([
          {
            id: 'key_123',
            name: 'production',
            key_prefix: 'gw_sk_live_abcd...1234',
            daily_token_limit: 10000,
            daily_cost_limit: 5,
            rate_limit_per_minute: 60,
          },
        ]),
      },
    });

    const result = await controller.getBudgetKeys();
    expect(result.keys).toEqual(['intern', 'sean', 'production']);
    expect(result.items[0]).toMatchObject({
      id: 'key_123',
      name: 'production',
      daily_token_limit: 10000,
    });
  });
});

describe('DashboardController — api-keys', () => {
  const keySummary = {
    id: 'key_123',
    name: 'production',
    status: 'active',
    key_prefix: 'gw_sk_live_abcd...1234',
    namespace_id: 'team-alpha',
    allow_auto: true,
    allow_direct: true,
    allowed_nodes: ['openai'],
    allowed_models: ['gpt-4o'],
    allowed_endpoints: ['chat_completions', 'responses'],
    allowed_modalities: ['text'],
    daily_token_limit: 10000,
    daily_cost_limit: 5,
    rate_limit_per_minute: 60,
  };

  it('should return managed gateway api keys', async () => {
    const { controller } = makeDashboard({
      gatewayApiKeys: {
        list: jest.fn().mockResolvedValue([
          { id: '1', name: 'sean' },
          { id: '2', name: 'intern' },
        ]),
      },
    });
    const result = await controller.getApiKeyNames();
    expect(result.keys).toEqual(['sean', 'intern']);
    expect(result.items).toHaveLength(2);
  });

  it('should create API keys with endpoint and modality permissions and audit redacted metadata', async () => {
    const gatewayApiKeys = {
      create: jest.fn().mockResolvedValue({
        key: 'gw_sk_live_full_secret_value',
        item: keySummary,
      }),
    };
    const { controller, configAudit } = makeDashboard({ gatewayApiKeys });

    const result = await controller.createApiKey({
      name: 'production',
      allow_auto: true,
      allow_direct: true,
      allowed_nodes: ['openai'],
      allowed_models: ['gpt-4o'],
      allowed_endpoints: ['chat_completions', 'responses'],
      allowed_modalities: ['text'],
      namespace_id: 'team-alpha',
    });

    expect(result.key).toBe('gw_sk_live_full_secret_value');
    expect(gatewayApiKeys.create).toHaveBeenCalledWith(expect.objectContaining({
      allowed_endpoints: ['chat_completions', 'responses'],
      allowed_modalities: ['text'],
      namespace_id: 'team-alpha',
    }));
    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.create',
        afterSummary: expect.objectContaining({
          key_prefix: 'gw_sk_live_abcd...1234',
          allowed_endpoints: ['chat_completions', 'responses'],
          allowed_modalities: ['text'],
          secret: 'redacted',
        }),
      }),
    );
    const auditPayload = JSON.stringify(configAudit.recordManagementEvent.mock.calls[0][0]);
    expect(auditPayload).not.toContain('gw_sk_live_full_secret_value');
  });

  it('should audit API key policy updates with before and after summaries', async () => {
    const before = { ...keySummary, allowed_endpoints: ['chat_completions'] };
    const after = { ...keySummary, allowed_endpoints: ['embeddings'], allowed_modalities: ['embedding'] };
    const gatewayApiKeys = {
      getSummary: jest.fn().mockResolvedValue(before),
      update: jest.fn().mockResolvedValue(after),
    };
    const { controller, configAudit } = makeDashboard({ gatewayApiKeys });

    const result = await controller.updateApiKey('key_123', {
      allowed_endpoints: ['embeddings'],
      allowed_modalities: ['embedding'],
      daily_cost_limit: 10,
    });

    expect(result.item).toBe(after);
    expect(gatewayApiKeys.getSummary).toHaveBeenCalledWith('key_123');
    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.update',
        target: 'api_key:key_123',
        beforeSummary: expect.objectContaining({ allowed_endpoints: ['chat_completions'], secret: 'redacted' }),
        afterSummary: expect.objectContaining({ allowed_endpoints: ['embeddings'], allowed_modalities: ['embedding'], secret: 'redacted' }),
        metadata: { fields: ['allowed_endpoints', 'allowed_modalities', 'daily_cost_limit'] },
      }),
    );
  });

  it('should audit API key rotation and deletion without storing the one-time secret', async () => {
    const gatewayApiKeys = {
      getSummary: jest.fn().mockResolvedValue(keySummary),
      rotate: jest.fn().mockResolvedValue({
        key: 'gw_sk_live_rotated_secret_value',
        item: { ...keySummary, key_prefix: 'gw_sk_live_efgh...5678' },
      }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const { controller, configAudit } = makeDashboard({ gatewayApiKeys });

    await controller.rotateApiKey('key_123');
    await controller.deleteApiKey('key_123');

    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.rotate',
        beforeSummary: expect.objectContaining({ secret: 'redacted' }),
        afterSummary: expect.objectContaining({ key_prefix: 'gw_sk_live_efgh...5678', secret: 'redacted' }),
      }),
    );
    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.delete',
        beforeSummary: expect.objectContaining({ key_prefix: 'gw_sk_live_abcd...1234', secret: 'redacted' }),
      }),
    );
    const auditPayload = JSON.stringify(configAudit.recordManagementEvent.mock.calls);
    expect(auditPayload).not.toContain('gw_sk_live_rotated_secret_value');
  });
});

describe('DashboardController — local teams', () => {
  const teamSummary = {
    id: 'team_123',
    name: 'platform',
    description: 'Shared backend limits',
    status: 'active',
    namespace_id: 'team-alpha',
    namespace_name: 'Team Alpha',
    allowed_nodes: ['openai'],
    allowed_models: ['gpt-4o'],
    allowed_endpoints: ['chat_completions', 'responses'],
    allowed_modalities: ['text'],
    daily_token_limit: 100000,
    daily_cost_limit: 25,
    rate_limit_per_minute: 120,
    today: { calls: 0, errors: 0, error_rate: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
  };

  it('should list local teams with OSS-only enterprise markers', async () => {
    const { controller } = makeDashboard({
      teams: {
        list: jest.fn().mockResolvedValue([teamSummary]),
      },
    });

    const result = await controller.getTeams();

    expect(result.mode).toBe('local_only');
    expect(result.enterprise_features.sso).toBe(false);
    expect(result.teams[0]).toMatchObject({ id: 'team_123', name: 'platform' });
  });

  it('should audit team create/update/delete without secret material', async () => {
    const teams = {
      list: jest.fn().mockResolvedValue([]),
      getSummary: jest.fn().mockResolvedValue(teamSummary),
      create: jest.fn().mockResolvedValue(teamSummary),
      update: jest.fn().mockResolvedValue({ ...teamSummary, status: 'disabled' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const { controller, configAudit } = makeDashboard({ teams });

    await controller.createTeam({
      name: 'platform',
      namespace_id: 'team-alpha',
      allowed_endpoints: ['responses'],
      allowed_modalities: ['text'],
    });
    await controller.updateTeam('team_123', { status: 'disabled' });
    await controller.deleteTeam('team_123');

    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.create',
        afterSummary: expect.objectContaining({
          id: 'team_123',
          secret: 'not_applicable',
          enterprise: expect.objectContaining({ sso: false, scim: false }),
        }),
      }),
    );
    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.update',
        beforeSummary: expect.objectContaining({ status: 'active' }),
        afterSummary: expect.objectContaining({ status: 'disabled' }),
      }),
    );
    expect(configAudit.recordManagementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.delete',
        beforeSummary: expect.objectContaining({ secret: 'not_applicable' }),
      }),
    );
    expect(JSON.stringify(configAudit.recordManagementEvent.mock.calls)).not.toContain('gw_sk_live');
  });
});

describe('DashboardController — api_key filtering on logs', () => {
  it('should apply api_key filter on getLogs', async () => {
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    await controller.getLogs(1, 50, undefined, undefined, undefined, 'sean');

    // Should have been called with api_key filter
    expect(qb.andWhere).toHaveBeenCalledWith('log.api_key_name = :apiKey', { apiKey: 'sean' });
  });

  it('should prefer api_key_id filter on getLogs', async () => {
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    await controller.getLogs(1, 50, undefined, undefined, undefined, 'renamed-key', 'key_123');

    expect(qb.andWhere).toHaveBeenCalledWith('log.api_key_id = :apiKeyId', { apiKeyId: 'key_123' });
    expect(qb.andWhere).not.toHaveBeenCalledWith('log.api_key_name = :apiKey', { apiKey: 'renamed-key' });
  });

  it('should apply namespace filter on getLogs', async () => {
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    await controller.getLogs(1, 50, undefined, undefined, undefined, undefined, undefined, 'team-alpha');

    expect(qb.andWhere).toHaveBeenCalledWith('log.namespace_id = :namespaceId', { namespaceId: 'team-alpha' });
  });
});

describe('DashboardController — namespaces and shadow traffic', () => {
  it('should return local namespaces with budget status', async () => {
    const { controller, budgetService } = makeDashboard({
      config: {
        namespaces: [
          { id: 'team-alpha', name: 'Team Alpha', allowed_nodes: ['openai'] },
        ],
      },
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([]),
      },
    });

    const result = await controller.getNamespaces();

    expect(result.mode).toBe('local_only');
    expect(result.namespaces[0]).toEqual(expect.objectContaining({
      id: 'team-alpha',
      allowed_nodes: ['openai'],
    }));
    expect(budgetService.getStatus).toHaveBeenCalledWith(null, null, 'team-alpha');
  });

  it('should return read-only shadow traffic status and recent rows', async () => {
    const { controller, shadowTraffic } = makeDashboard({
      shadowTraffic: {
        recent: jest.fn().mockResolvedValue([
          { id: 1, status: 'sent', namespace_id: 'team-alpha' },
        ]),
      },
    });

    const result = await controller.getShadowTraffic('team-alpha', 10);

    expect(shadowTraffic.recent).toHaveBeenCalledWith('team-alpha', 10);
    expect(result.recent).toHaveLength(1);
    expect(result.status.privacy.provider_keys).toBe(false);
  });

  it('should return shadow comparison report with filters', async () => {
    const { controller, shadowTraffic } = makeDashboard({
      shadowTraffic: {
        comparisonReport: jest.fn().mockResolvedValue({
          primary_success_rate: 1,
          shadow_success_rate: 0.9,
          latency_delta_ms: -20,
          p50_latency_comparison: { primary_ms: 120, shadow_ms: 100, delta_ms: -20 },
          p95_latency_comparison: { primary_ms: 300, shadow_ms: 260, delta_ms: -40 },
          cost_delta_usd: -0.02,
          potential_savings_usd: 0.02,
          token_delta: -50,
          fallback_delta: -0.1,
          quality_sample_coverage: 0,
          confidence: { level: 'medium', score: 0.62 },
          risk_notes: ['quality_samples_disabled'],
          pairs: [],
        }),
      },
    });

    const result = await controller.getShadowComparisonReport(
      'team-alpha',
      'default',
      'key-1',
      'shadow-openai',
      'gpt-4o-mini',
      '24h',
      'chat_completions',
    );

    expect(shadowTraffic.comparisonReport).toHaveBeenCalledWith({
      namespaceId: 'team-alpha',
      apiKeyName: 'default',
      apiKeyId: 'key-1',
      node: 'shadow-openai',
      model: 'gpt-4o-mini',
      period: '24h',
      sourceFormat: 'chat_completions',
    });
    expect(result.potential_savings_usd).toBe(0.02);
  });

  it('should return one shadow result comparison or 404', async () => {
    const { controller, shadowTraffic } = makeDashboard({
      shadowTraffic: {
        comparisonForResult: jest.fn()
          .mockResolvedValueOnce({ result_id: 12, request_id: 'req-12' })
          .mockResolvedValueOnce(null),
      },
    });

    await expect(controller.getShadowResultComparison(12)).resolves.toEqual({
      result_id: 12,
      request_id: 'req-12',
    });
    expect(shadowTraffic.comparisonForResult).toHaveBeenCalledWith(12);
    await expect(controller.getShadowResultComparison(404)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('DashboardController — api_key filtering on stats', () => {
  it('should accept api_key param on getStats', async () => {
    const qb = mockQueryBuilder(
      { totalInputTokens: '500', totalOutputTokens: '200', totalCost: '0.1', avgLatency: '100', uniqueSessions: '1' },
      [{ tier: 'simple', count: '2' }],
    );
    const repo = mockRepo(qb);
    repo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(4);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getStats('sean');

    expect(result.total.calls).toBe(5);
  });

  it('should prefer api_key_id param on getStats', async () => {
    const qb = mockQueryBuilder(
      { totalInputTokens: '500', totalOutputTokens: '200', totalCost: '0.1', avgLatency: '100', uniqueSessions: '1' },
      [{ tier: 'simple', count: '2' }],
    );
    const repo = mockRepo(qb);
    repo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(4);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    await controller.getStats('renamed-key', 'key_123');

    expect(repo.count).toHaveBeenNthCalledWith(1, { where: { api_key_id: 'key_123' } });
    expect(repo.count).toHaveBeenNthCalledWith(2, { where: { status_code: 200, api_key_id: 'key_123' } });
    expect(qb.where).toHaveBeenCalledWith('log.api_key_id = :apiKeyId', { apiKeyId: 'key_123' });
  });
});
