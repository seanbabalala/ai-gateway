/**
 * E2E tests — Dashboard API endpoints
 */

import * as fs from 'fs';
import { createE2EHarness, E2EHarness, API_KEY } from './setup';

describe('Dashboard (e2e)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(() => {
    harness.fetchMock.reset();
  });

  // ══════════════════════════════════════════════════════
  // Stats & Logs
  // ══════════════════════════════════════════════════════

  it('GET /api/dashboard/stats → returns correct shape', async () => {
    const res = await harness.agent.get('/api/dashboard/stats');

    expect(res.status).toBe(200);
    expect(res.body.total).toBeDefined();
    expect(typeof res.body.total.calls).toBe('number');
    expect(typeof res.body.total.success).toBe('number');
    expect(typeof res.body.total.failed).toBe('number');
    expect(res.body.total.successRate).toBeDefined();
    expect(res.body.last24h).toBeDefined();
    expect(Array.isArray(res.body.tierDistribution)).toBe(true);
    expect(Array.isArray(res.body.nodeDistribution)).toBe(true);
  });

  it('GET /api/dashboard/logs → { data: [], pagination }', async () => {
    const res = await harness.agent.get('/api/dashboard/logs');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(typeof res.body.pagination.page).toBe('number');
    expect(typeof res.body.pagination.limit).toBe('number');
    expect(typeof res.body.pagination.total).toBe('number');
    expect(typeof res.body.pagination.totalPages).toBe('number');
  });

  it('GET /api/dashboard/logs?page=1&limit=5 → pagination works', async () => {
    const res = await harness.agent.get('/api/dashboard/logs?page=1&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
  });

  // ══════════════════════════════════════════════════════
  // Budget
  // ══════════════════════════════════════════════════════

  it('GET /api/dashboard/budget → { rules: [...] }', async () => {
    const res = await harness.agent.get('/api/dashboard/budget');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rules)).toBe(true);
    // Should have token + cost rules based on our config
    expect(res.body.rules.length).toBeGreaterThanOrEqual(1);

    const rule = res.body.rules[0];
    expect(rule.type).toBeDefined();
    expect(typeof rule.limit).toBe('number');
    expect(typeof rule.current).toBe('number');
    expect(typeof rule.percentage).toBe('number');
  });

  // ══════════════════════════════════════════════════════
  // Nodes CRUD
  // ══════════════════════════════════════════════════════

  it('GET /api/dashboard/nodes → returns mock-openai + mock-claude', async () => {
    const res = await harness.agent.get('/api/dashboard/nodes');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.nodes)).toBe(true);
    const nodeIds = res.body.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('mock-openai');
    expect(nodeIds).toContain('mock-claude');
    expect(res.body.nodes[0].active_probe).toBeDefined();
    expect(res.body.nodes[0].active_probe.status).toBeDefined();
  });

  it('POST /api/dashboard/nodes → create + GET verify + DELETE', async () => {
    // Create (timeout_ms is required by DTO)
    const createRes = await harness.agent
      .post('/api/dashboard/nodes')
      .send({
        id: 'test-node-crud',
        name: 'Test CRUD Node',
        protocol: 'chat_completions',
        base_url: 'http://test.example',
        endpoint: '/v1/chat/completions',
        api_key: 'test-key',
        models: ['test-model'],
        timeout_ms: 30000,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);

    // Verify it exists
    const listRes = await harness.agent.get('/api/dashboard/nodes');
    const nodeIds = listRes.body.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('test-node-crud');

    // Delete
    const deleteRes = await harness.agent.delete('/api/dashboard/nodes/test-node-crud');
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify it's gone
    const listRes2 = await harness.agent.get('/api/dashboard/nodes');
    const nodeIds2 = listRes2.body.nodes.map((n: any) => n.id);
    expect(nodeIds2).not.toContain('test-node-crud');
  });

  it('PUT /api/dashboard/nodes/:id → update node', async () => {
    const res = await harness.agent
      .put('/api/dashboard/nodes/mock-openai')
      .send({
        name: 'Updated Mock OpenAI',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Restore original name
    await harness.agent
      .put('/api/dashboard/nodes/mock-openai')
      .send({ name: 'Mock OpenAI' });
  });

  it('POST /api/dashboard/nodes/:id/reset → reset circuit breaker', async () => {
    const res = await harness.agent
      .post('/api/dashboard/nodes/mock-openai/reset');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  // ══════════════════════════════════════════════════════
  // Config
  // ══════════════════════════════════════════════════════

  it('GET /api/dashboard/config → returns config with sanitized keys', async () => {
    const res = await harness.agent.get('/api/dashboard/config');

    expect(res.status).toBe(200);
    expect(res.body.server).toBeDefined();
    expect(res.body.nodes).toBeDefined();
    expect(res.body.routing).toBeDefined();
    expect(res.body.auth).toBeDefined();

    // API keys should be sanitized
    if (res.body.auth.api_keys?.length) {
      const key = res.body.auth.api_keys[0].key;
      expect(key).toContain('...');
    }

    // Node API keys should be sanitized
    if (res.body.nodes?.length) {
      const nodeKey = res.body.nodes[0].api_key;
      expect(nodeKey).toContain('...');
    }
  });

  it('POST /api/dashboard/config/reload → success', async () => {
    const res = await harness.agent.post('/api/dashboard/config/reload');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/dashboard/config/reload → failure keeps previous config', async () => {
    const original = fs.readFileSync(harness.configPath, 'utf8');
    const before = await harness.agent.get('/api/dashboard/config');
    const beforeNodeIds = before.body.nodes.map((node: any) => node.id);

    try {
      fs.writeFileSync(harness.configPath, 'nodes: [', 'utf8');
      const res = await harness.agent.post('/api/dashboard/config/reload');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.rolled_back).toBe(true);
      expect(res.body.message).toContain('retained previous config');

      const after = await harness.agent.get('/api/dashboard/config');
      expect(after.body.nodes.map((node: any) => node.id)).toEqual(beforeNodeIds);
    } finally {
      fs.writeFileSync(harness.configPath, original, 'utf8');
      await harness.agent.post('/api/dashboard/config/reload');
    }
  });

  // ══════════════════════════════════════════════════════
  // Routing
  // ══════════════════════════════════════════════════════

  it('PUT /api/dashboard/routing → update tiers', async () => {
    const res = await harness.agent
      .put('/api/dashboard/routing')
      .send({
        tiers: {
          simple: {
            primary: { node: 'mock-openai', model: 'gpt-4o-mini' },
            fallbacks: [{ node: 'mock-claude', model: 'claude-sonnet-4-20250514' }],
          },
          standard: {
            primary: { node: 'mock-openai', model: 'gpt-4o' },
            fallbacks: [{ node: 'mock-claude', model: 'claude-sonnet-4-20250514' }],
          },
          complex: {
            primary: { node: 'mock-claude', model: 'claude-sonnet-4-20250514' },
            fallbacks: [{ node: 'mock-openai', model: 'gpt-4o' }],
          },
          reasoning: {
            primary: { node: 'mock-claude', model: 'claude-sonnet-4-20250514' },
            fallbacks: [{ node: 'mock-openai', model: 'gpt-4o' }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /api/dashboard/routing/recommendations → read-only recommendation mode', async () => {
    const res = await harness.agent.get('/api/dashboard/routing/recommendations?window_hours=24&sample_limit=1000');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('recommendation_only');
    expect(res.body.stats).toBeDefined();
    expect(Array.isArray(res.body.stats.targets)).toBe(true);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations[0]).toHaveProperty('reasons');
    expect(res.body.recommendations[0]).toHaveProperty('confidence');
    expect(res.body.recommendations[0]).toHaveProperty('potential_savings');
    expect(res.body.recommendations[0]).toHaveProperty('risks');
  });

  // ══════════════════════════════════════════════════════
  // Cache & Analytics
  // ══════════════════════════════════════════════════════

  it('GET /api/dashboard/cache → cache stats shape', async () => {
    const res = await harness.agent.get('/api/dashboard/cache');

    expect(res.status).toBe(200);
    // Cache service returns stats object
    expect(res.body).toBeDefined();
  });

  it('GET /api/dashboard/analytics/cost → analytics shape', async () => {
    const res = await harness.agent.get('/api/dashboard/analytics/cost');

    expect(res.status).toBe(200);
    expect(res.body.period).toBeDefined();
    expect(res.body.total).toBeDefined();
    expect(Array.isArray(res.body.dailyTrend)).toBe(true);
    expect(Array.isArray(res.body.byModel)).toBe(true);
    expect(Array.isArray(res.body.byNode)).toBe(true);
  });

  it('GET /api/dashboard/benchmarks/report → benchmark report shape', async () => {
    const res = await harness.agent.get('/api/dashboard/benchmarks/report?period=24h&limit=100');

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('24h');
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.latency_ms).toBeDefined();
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(Array.isArray(res.body.by_node_model)).toBe(true);
    expect(res.body.privacy).toEqual(
      expect.objectContaining({
        prompt_response_stored: false,
        raw_headers_stored: false,
        provider_keys_exposed: false,
      }),
    );
  });
});
