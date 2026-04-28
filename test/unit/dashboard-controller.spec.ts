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
    reload: jest.fn(),
    addNode: jest.fn(),
    updateNode: jest.fn(),
    deleteNode: jest.fn(),
    updateRouting: jest.fn(),
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

  const budgetService = {
    getStatus: jest.fn().mockResolvedValue([]),
    resetRule: jest.fn().mockResolvedValue(undefined),
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
    budgetService as any,
    cacheService as any,
    logEventBus as any,
    dataSource as any,
    callLogRepo as any,
  );

  return { controller, config, circuitBreaker, budgetService, cacheService, callLogRepo, qb, capabilityService };
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
    await controller.exportLogs('json', 7, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    expect(res.send).toHaveBeenCalled();
  });

  it('should export as CSV by default', async () => {
    const qb = mockQueryBuilder();
    qb.getMany.mockResolvedValue([]);
    const repo = mockRepo(qb);

    const { controller } = makeDashboard({ callLogRepo: repo, qb });
    const res: any = { setHeader: jest.fn(), send: jest.fn() };
    await controller.exportLogs('csv', 7, res);

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
  it('should return sanitized config (API keys masked)', () => {
    const { controller } = makeDashboard();
    const result = controller.getConfig();

    expect(result.nodes[0].api_key).toContain('...');
    expect(result.nodes[0].api_key).not.toBe('sk-test12345678rest');
    expect(result.auth.api_keys[0].key).toContain('...');
  });

  it('should reload config', () => {
    const { controller, config } = makeDashboard();
    const result = controller.reloadConfig();
    expect(result.success).toBe(true);
    expect(config.reload).toHaveBeenCalled();
  });

  it('should handle reload failure', () => {
    const { controller } = makeDashboard({
      config: { reload: jest.fn().mockImplementation(() => { throw new Error('Invalid YAML'); }) },
    });
    const result = controller.reloadConfig();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid YAML');
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
    const dto = { id: 'new-node', name: 'New', protocol: 'chat_completions', base_url: 'https://example.com', endpoint: '/v1/chat/completions', api_key: 'sk-new', models: ['model-1'] } as any;
    const result = controller.createNode(dto);

    expect(result.success).toBe(true);
    expect(config.addNode).toHaveBeenCalled();
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
