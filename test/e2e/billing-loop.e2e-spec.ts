/**
 * E2E tests — Billing loop invariants.
 *
 * These tests exercise the real HTTP path:
 * Dashboard key creation → proxy auth → routing permissions → budget usage →
 * call logs and dashboard filtering by immutable api_key_id.
 */

import { createE2EHarness, E2EHarness } from './setup';

async function createGatewayKey(
  harness: E2EHarness,
  overrides: Record<string, unknown> = {},
) {
  const res = await harness.agent
    .post('/api/dashboard/api-keys')
    .send({
      name: `billing-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      allow_auto: true,
      allow_direct: true,
      allowed_nodes: ['mock-openai'],
      allowed_models: ['gpt-4o', 'gpt-4o-mini'],
      daily_token_limit: 100000,
      daily_cost_limit: 1,
      rate_limit_per_minute: 1000,
      ...overrides,
    });

  expect(res.status).toBe(201);
  expect(res.body.key).toMatch(/^gw_sk_live_/);
  expect(res.body.item.id).toBeDefined();
  return res.body as {
    key: string;
    item: {
      id: string;
      name: string;
      daily_token_limit: number | null;
      daily_cost_limit: number | null;
    };
  };
}

describe('Billing Loop (e2e)', () => {
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

  it('generated Gateway key records auto/direct usage under the same api_key_id', async () => {
    const created = await createGatewayKey(harness);

    const autoRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'hello' }],
      });

    expect(autoRes.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
    expect(harness.fetchMock.calls[0].url).toBe('http://mock-upstream.test/v1/chat/completions');

    harness.fetchMock.reset();
    const directRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'direct request' }],
      });

    expect(directRes.status).toBe(200);
    expect(harness.fetchMock.calls[0].body.model).toBe('gpt-4o');

    const logsRes = await harness.agent
      .get(`/api/dashboard/logs?limit=20&api_key_id=${encodeURIComponent(created.item.id)}`);

    expect(logsRes.status).toBe(200);
    expect(logsRes.body.data).toHaveLength(2);
    for (const log of logsRes.body.data) {
      expect(log.api_key_id).toBe(created.item.id);
      expect(log.api_key_name).toBe(created.item.name);
      expect(log.input_tokens + log.output_tokens).toBe(15);
      expect(log.cost_usd).toBeGreaterThan(0);
      expect(log.status_code).toBe(200);
    }
    expect(logsRes.body.data.map((log: any) => log.tier)).toEqual(
      expect.arrayContaining(['direct']),
    );

    const statsRes = await harness.agent
      .get(`/api/dashboard/stats?api_key_id=${encodeURIComponent(created.item.id)}`);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.total.calls).toBe(2);
    expect(statsRes.body.total.success).toBe(2);
    expect(statsRes.body.total.totalTokens).toBe(30);

    const budgetRes = await harness.agent
      .get(`/api/dashboard/budget?api_key_id=${encodeURIComponent(created.item.id)}`);

    expect(budgetRes.status).toBe(200);
    expect(budgetRes.body.apiKeyId).toBe(created.item.id);
    expect(budgetRes.body.apiKeyName).toBe(created.item.name);
    expect(budgetRes.body.perKeyRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'api_key',
          apiKeyId: created.item.id,
          apiKeyName: created.item.name,
          type: 'daily_tokens',
          current: 30,
        }),
        expect.objectContaining({
          scope: 'api_key',
          apiKeyId: created.item.id,
          apiKeyName: created.item.name,
          type: 'daily_cost',
        }),
      ]),
    );
    const costRule = budgetRes.body.perKeyRules.find((rule: any) => rule.type === 'daily_cost');
    expect(costRule.current).toBeGreaterThan(0);
  });

  it('routing permissions are enforced before upstream calls', async () => {
    const created = await createGatewayKey(harness, {
      name: `auto-only-e2e-${Date.now()}`,
      allow_auto: true,
      allow_direct: false,
    });

    const directRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'should be blocked' }],
      });

    expect(directRes.status).toBe(403);
    expect(directRes.body.error.message).toContain('not allowed to use direct');
    expect(harness.fetchMock.calls).toHaveLength(0);

    const autoRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'auto is allowed' }],
      });

    expect(autoRes.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('over-budget responses return 429 with the generated api_key_id and no upstream call', async () => {
    const created = await createGatewayKey(harness, {
      name: `tiny-budget-e2e-${Date.now()}`,
      daily_token_limit: 1,
      daily_cost_limit: 1,
    });

    const firstRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'consume tiny budget' }],
      });

    expect(firstRes.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);

    harness.fetchMock.reset();
    const blockedRes = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${created.key}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'should be blocked by budget' }],
      });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatchObject({
      type: 'budget_exceeded',
      details: {
        scope: 'api_key',
        api_key_id: created.item.id,
        api_key_name: created.item.name,
        budget_type: 'daily_tokens',
      },
    });
    expect(harness.fetchMock.calls).toHaveLength(0);
  });
});
