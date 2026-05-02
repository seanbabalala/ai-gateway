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
      { id: 'openai', name: 'OpenAI', protocol: 'chat_completions', base_url: 'https://api.openai.com', endpoint: '/v1/chat/completions', models: ['gpt-4o'], api_key: 'sk-test12345678rest', tags: [], model_aliases: {} },
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
    recommendTiers: jest.fn().mockReturnValue({}),
    recommendRouting: jest.fn().mockReturnValue({}),
    ...overrides.capabilityService,
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
    create: jest.fn(),
    update: jest.fn(),
    rotate: jest.fn(),
    remove: jest.fn(),
    ...overrides.gatewayApiKeys,
  };

  const dataSource = {
    options: { type: 'better-sqlite3' },
    ...overrides.dataSource,
  };

  const qb = overrides.qb || mockQueryBuilder();
  const callLogRepo = overrides.callLogRepo || mockRepo(qb);

  const controller = new DashboardController(
    config,
    capabilityService as any,
    circuitBreaker as any,
    concurrencyLimiter as any,
    budgetService as any,
    cacheService as any,
    logEventBus as any,
    new TelemetryService(),
    gatewayApiKeys as any,
    dataSource as any,
    callLogRepo as any,
  );

  return { controller, config, circuitBreaker, concurrencyLimiter, budgetService, cacheService, gatewayApiKeys, callLogRepo, qb, capabilityService };
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

// ═══════════════════════════════════════════════════════════
// Logs
// ═══════════════════════════════════════════════════════════

describe('DashboardController — getLogs', () => {
  it('should return paginated logs', async () => {
    const logs = [{ id: 1, model: 'gpt-4o' }, { id: 2, model: 'claude-3-opus' }];
    const qb = mockQueryBuilder();
    qb.getManyAndCount.mockResolvedValue([logs, 50]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const result = await controller.getLogs(1, 50);

    expect(result.data).toHaveLength(2);
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
    await controller.exportLogs('json', 7, undefined, undefined, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalled();
  });

  it('should export as CSV by default', async () => {
    const qb = mockQueryBuilder();
    qb.getMany.mockResolvedValue([]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportLogs('csv', 7, undefined, undefined, res);

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

  it('should reload config', () => {
    const { controller, config } = makeDashboard();
    const result = controller.reloadConfig();
    expect(result.success).toBe(true);
    expect(config.reload).toHaveBeenCalledWith({
      source: 'dashboard',
      throwOnError: false,
    });
  });

  it('should handle reload failure', () => {
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
    expect(() => controller.reloadConfig()).toThrow(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Nodes
// ═══════════════════════════════════════════════════════════

describe('DashboardController — nodes', () => {
  it('should return node list with circuit and capability info', () => {
    const { controller } = makeDashboard();
    const result = controller.getNodes();

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe('openai');
    expect(result.nodes[0].healthy).toBe(true);
    expect(result.nodes[0].capabilities).toBeDefined();
    expect(result.nodes[0].modalities).toBeDefined();
    expect(result.nodes[0].concurrency).toEqual(
      expect.objectContaining({ active: 0, queued: 0 }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('should show unhealthy when circuit is OPEN', () => {
    const { controller } = makeDashboard({
      circuitBreaker: {
        getNodeStatus: jest.fn().mockReturnValue({ state: CircuitState.OPEN, consecutiveFailures: 3, lastFailureAt: Date.now() }),
        getModelStatuses: jest.fn().mockReturnValue({}),
        reset: jest.fn(),
      },
    });
    const result = controller.getNodes();
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
});

// ═══════════════════════════════════════════════════════════
// Node CRUD
// ═══════════════════════════════════════════════════════════

describe('DashboardController — Node CRUD', () => {
  it('should create a node', () => {
    const { controller, config } = makeDashboard();
    const dto = {
      id: 'new-node',
      name: 'New',
      protocol: 'chat_completions',
      base_url: 'https://example.com',
      endpoint: '/v1/chat/completions',
      api_key: 'sk-new',
      models: ['model-1'],
      max_concurrency: 3,
      queue_timeout_ms: 250,
      queue_policy: 'fallback',
    } as any;
    const result = controller.createNode(dto);

    expect(result.success).toBe(true);
    expect(config.addNode).toHaveBeenCalledWith(
      expect.objectContaining({
        max_concurrency: 3,
        queue_timeout_ms: 250,
        queue_policy: 'fallback',
      }),
    );
  });

  it('should throw on duplicate node creation', () => {
    const { controller } = makeDashboard({
      config: { addNode: jest.fn().mockImplementation(() => { throw new Error('Node already exists'); }) },
    });
    const dto = { id: 'openai', name: 'Dup' } as any;
    expect(() => controller.createNode(dto)).toThrow(HttpException);
  });

  it('should update a node', () => {
    const { controller, config } = makeDashboard();
    const result = controller.updateNode('openai', { name: 'Updated OpenAI' } as any);
    expect(result.success).toBe(true);
    expect(config.updateNode).toHaveBeenCalled();
  });

  it('should not pass empty api_key on update', () => {
    const { controller, config } = makeDashboard();
    controller.updateNode('openai', { name: 'Updated', api_key: '' } as any);
    const updateArgs = config.updateNode.mock.calls[0][1];
    expect(updateArgs.api_key).toBeUndefined();
  });

  it('should delete a node', () => {
    const { controller, config, circuitBreaker } = makeDashboard();
    const result = controller.deleteNode('openai');
    expect(result.success).toBe(true);
    expect(circuitBreaker.reset).toHaveBeenCalledWith('openai');
    expect(config.deleteNode).toHaveBeenCalledWith('openai');
  });

  it('should throw on deleting last node', () => {
    const { controller } = makeDashboard({
      config: { deleteNode: jest.fn().mockImplementation(() => { throw new Error('Cannot delete the last remaining node'); }) },
    });
    expect(() => controller.deleteNode('openai')).toThrow(HttpException);
  });
});

// ═══════════════════════════════════════════════════════════
// Capabilities & Routing
// ═══════════════════════════════════════════════════════════

describe('DashboardController — capabilities & routing', () => {
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

  it('should update routing config', () => {
    const { controller, config } = makeDashboard();
    const result = controller.updateRouting({ scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 } });
    expect(result.success).toBe(true);
    expect(config.updateRouting).toHaveBeenCalled();
  });

  it('should throw on invalid routing update', () => {
    const { controller } = makeDashboard({
      config: { updateRouting: jest.fn().mockImplementation(() => { throw new Error('Invalid node reference'); }) },
    });
    expect(() => controller.updateRouting({ tiers: {} as any })).toThrow(HttpException);
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
