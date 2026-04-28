/**
 * Controller-layer unit tests.
 *
 * Tests AuthController, HealthController, and ModelsController
 * in isolation with mocked dependencies.
 */

import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { HealthController } from '../../src/dashboard/health.controller';
import { ModelsController } from '../../src/ingest/models.controller';
import { CircuitState } from '../../src/routing/circuit-breaker.service';
import { mockConfigService } from '../helpers';

// ═══════════════════════════════════════════════════════════
// AuthController
// ═══════════════════════════════════════════════════════════

describe('AuthController', () => {
  function makeAuthService(overrides: Record<string, unknown> = {}): any {
    return {
      isAuthRequired: true,
      verifyPassword: jest.fn().mockResolvedValue(true),
      generateToken: jest.fn().mockReturnValue('jwt-token-123'),
      config: { dashboardPasswordHash: '$2b$10$hashedvalue' },
      ...overrides,
    };
  }

  function makeReq(ip = '127.0.0.1'): any {
    return { ip, connection: { remoteAddress: ip } };
  }

  it('should return empty token when auth is not required', async () => {
    const authService = makeAuthService({ isAuthRequired: false });
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    const result = await controller.login(makeReq(), { password: 'anything' });
    expect(result).toEqual({ token: '' });
  });

  it('should throw UnauthorizedException when password is missing', async () => {
    const authService = makeAuthService();
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    await expect(controller.login(makeReq(), {})).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for invalid password', async () => {
    const authService = makeAuthService({
      verifyPassword: jest.fn().mockResolvedValue(false),
    });
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    await expect(controller.login(makeReq(), { password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should return JWT token for valid password', async () => {
    const authService = makeAuthService();
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    const result = await controller.login(makeReq(), { password: 'correct' });
    expect(result.token).toBe('jwt-token-123');
    expect(authService.verifyPassword).toHaveBeenCalledWith(
      'correct',
      '$2b$10$hashedvalue',
    );
    expect(authService.generateToken).toHaveBeenCalled();
  });

  it('GET /api/auth/status should return authRequired status', () => {
    const authService = makeAuthService({ isAuthRequired: true });
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    expect(controller.getStatus()).toEqual({ authRequired: true });
  });

  it('GET /api/auth/status should reflect no-auth config', () => {
    const authService = makeAuthService({ isAuthRequired: false });
    const config = mockConfigService();
    const controller = new AuthController(authService, config);
    expect(controller.getStatus()).toEqual({ authRequired: false });
  });
});

// ═══════════════════════════════════════════════════════════
// HealthController
// ═══════════════════════════════════════════════════════════

describe('HealthController', () => {
  function makeCircuitBreaker(
    nodeStates: Record<string, CircuitState> = {},
  ): any {
    return {
      getNodeStatus: jest.fn().mockImplementation((nodeId: string) => ({
        state: nodeStates[nodeId] || CircuitState.CLOSED,
        consecutiveFailures: nodeStates[nodeId] === CircuitState.OPEN ? 3 : 0,
        lastFailureAt: nodeStates[nodeId] === CircuitState.OPEN ? Date.now() : null,
      })),
      getModelStatuses: jest.fn().mockReturnValue({}),
    };
  }

  function makeBudgetService(status: any[] = []): any {
    return {
      getStatus: jest.fn().mockResolvedValue(status),
    };
  }

  it('should return healthy when all nodes are CLOSED', async () => {
    const config = mockConfigService({
      nodes: [
        { id: 'openai', name: 'OpenAI', protocol: 'chat_completions', models: ['gpt-4o'] },
        { id: 'claude', name: 'Claude', protocol: 'messages', models: ['claude-3-opus'] },
      ],
    });
    const cb = makeCircuitBreaker();
    const budget = makeBudgetService();

    const controller = new HealthController(config, cb, budget);
    const result = await controller.check();

    expect(result.status).toBe('healthy');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].healthy).toBe(true);
    expect(result.nodes[1].healthy).toBe(true);
    expect(result.uptime_ms).toBeGreaterThanOrEqual(0);
    expect(result.uptime_human).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it('should return degraded when a node is OPEN', async () => {
    const config = mockConfigService({
      nodes: [
        { id: 'openai', name: 'OpenAI', protocol: 'chat_completions', models: ['gpt-4o'] },
        { id: 'claude', name: 'Claude', protocol: 'messages', models: ['claude-3-opus'] },
      ],
    });
    const cb = makeCircuitBreaker({ openai: CircuitState.OPEN });
    const budget = makeBudgetService();

    const controller = new HealthController(config, cb, budget);
    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.nodes[0].healthy).toBe(false);
    expect(result.nodes[0].circuit).toBe(CircuitState.OPEN);
    expect(result.nodes[1].healthy).toBe(true);
  });

  it('should include budget status', async () => {
    const config = mockConfigService({
      nodes: [{ id: 'n1', name: 'N1', protocol: 'chat_completions', models: ['m1'] }],
    });
    const cb = makeCircuitBreaker();
    const budget = makeBudgetService([
      { type: 'tokens', current: 500, limit: 1000, percentage: 0.5, isExceeded: false, isAlert: false },
    ]);

    const controller = new HealthController(config, cb, budget);
    const result = await controller.check();

    expect(result.budget).toHaveLength(1);
    expect(result.budget[0].type).toBe('tokens');
    expect(result.budget[0].percentage).toBe(50);
    expect(result.budget[0].exceeded).toBe(false);
  });

  it('should handle budget service errors gracefully', async () => {
    const config = mockConfigService({
      nodes: [{ id: 'n1', name: 'N1', protocol: 'chat_completions', models: ['m1'] }],
    });
    const cb = makeCircuitBreaker();
    const budget = {
      getStatus: jest.fn().mockRejectedValue(new Error('DB down')),
    };

    const controller = new HealthController(config, cb, budget as any);
    const result = await controller.check();

    expect(result.status).toBe('healthy');
    expect(result.budget).toEqual([]);
  });

  it('should include node metadata', async () => {
    const config = mockConfigService({
      nodes: [
        { id: 'openai', name: 'OpenAI GPT', protocol: 'chat_completions', models: ['gpt-4o'] },
      ],
    });
    const cb = makeCircuitBreaker();
    const budget = makeBudgetService();

    const controller = new HealthController(config, cb, budget);
    const result = await controller.check();

    expect(result.nodes[0].id).toBe('openai');
    expect(result.nodes[0].name).toBe('OpenAI GPT');
    expect(result.nodes[0].protocol).toBe('chat_completions');
  });
});

// ═══════════════════════════════════════════════════════════
// ModelsController
// ═══════════════════════════════════════════════════════════

describe('ModelsController', () => {
  it('should return OpenAI-compatible model list with "auto"', () => {
    const config = mockConfigService({
      listModels: jest.fn().mockReturnValue([
        { id: 'gpt-4o', node: 'openai', nodeName: 'OpenAI', aliases: ['openai'] },
        { id: 'claude-3-opus', node: 'claude', nodeName: 'Claude', aliases: ['claude'] },
      ]),
    });
    const controller = new ModelsController(config);
    const result = controller.list();

    expect(result.object).toBe('list');
    expect(Array.isArray(result.data)).toBe(true);

    // First entry should be "auto"
    expect(result.data[0].id).toBe('auto');
    expect(result.data[0].owned_by).toBe('ai-gateway');

    // Real models follow
    const gpt4o = result.data.find((m: any) => m.id === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.owned_by).toBe('openai');
    expect(gpt4o!.object).toBe('model');

    const claude = result.data.find((m: any) => m.id === 'claude-3-opus');
    expect(claude).toBeDefined();
    expect(claude!.owned_by).toBe('claude');
  });

  it('should include alias entries', () => {
    const config = mockConfigService({
      listModels: jest.fn().mockReturnValue([
        { id: 'gpt-4o', node: 'openai', nodeName: 'OpenAI', aliases: ['openai', 'gpt'] },
      ]),
    });
    const controller = new ModelsController(config);
    const result = controller.list();

    const aliasEntries = result.data.filter((m: any) => m.is_alias);
    expect(aliasEntries.length).toBe(2);

    const openaiAlias = aliasEntries.find((m: any) => m.id === 'openai');
    expect(openaiAlias).toBeDefined();
    expect((openaiAlias as any).resolves_to).toBe('gpt-4o');

    const gptAlias = aliasEntries.find((m: any) => m.id === 'gpt');
    expect(gptAlias).toBeDefined();
    expect((gptAlias as any).resolves_to).toBe('gpt-4o');
  });

  it('should deduplicate aliases across models', () => {
    const config = mockConfigService({
      listModels: jest.fn().mockReturnValue([
        { id: 'gpt-4o', node: 'openai', nodeName: 'OpenAI', aliases: ['shared-alias'] },
        { id: 'gpt-4o-mini', node: 'openai', nodeName: 'OpenAI', aliases: ['shared-alias'] },
      ]),
    });
    const controller = new ModelsController(config);
    const result = controller.list();

    const aliasEntries = result.data.filter((m: any) => m.is_alias);
    expect(aliasEntries.length).toBe(1);
    expect(aliasEntries[0].id).toBe('shared-alias');
  });

  it('should return empty data array (besides auto) when no models configured', () => {
    const config = mockConfigService({
      listModels: jest.fn().mockReturnValue([]),
    });
    const controller = new ModelsController(config);
    const result = controller.list();

    expect(result.data).toHaveLength(1); // only "auto"
    expect(result.data[0].id).toBe('auto');
  });
});
