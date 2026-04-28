/**
 * E2E tests — GET /v1/models endpoint
 */

import { createE2EHarness, E2EHarness, API_KEY } from './setup';

describe('Models (e2e)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('GET /v1/models + valid key → 200 with models list', async () => {
    const res = await harness.agent
      .get('/v1/models')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].id).toBeDefined();
    expect(res.body.data[0].object).toBe('model');
  });

  it('GET /v1/models — data contains expected models and aliases', async () => {
    const res = await harness.agent
      .get('/v1/models')
      .set('Authorization', `Bearer ${API_KEY}`);

    const modelIds = res.body.data.map((m: any) => m.id);

    // Should include models from both mock nodes
    expect(modelIds).toContain('gpt-4o');
    expect(modelIds).toContain('gpt-4o-mini');
    expect(modelIds).toContain('claude-sonnet-4-20250514');
  });

  it('GET /v1/models — no key → 401', async () => {
    const res = await harness.agent.get('/v1/models');

    expect(res.status).toBe(401);
  });
});
