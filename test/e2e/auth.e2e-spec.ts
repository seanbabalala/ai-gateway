/**
 * E2E tests — Auth endpoints (login, status, dashboard access)
 */

import { createE2EHarness, E2EHarness } from './setup';

describe('Auth (e2e)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('GET /api/auth/status → { authRequired: false }', async () => {
    const res = await harness.agent.get('/api/auth/status');

    expect(res.status).toBe(200);
    expect(res.body.authRequired).toBe(false);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.localLoginEnabled).toBe(false);
    expect(res.body.oidc.enabled).toBe(false);
  });

  it('POST /api/auth/login — no password configured → { token: "" }', async () => {
    const res = await harness.agent
      .post('/api/auth/login')
      .send({ password: 'anything' });

    // NestJS returns 201 for POST by default
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('');
  });

  it('POST /api/auth/login — missing body.password → still returns token (no password configured)', async () => {
    const res = await harness.agent
      .post('/api/auth/login')
      .send({});

    // When no password configured, authRequired is false,
    // so login returns token: '' regardless
    expect(res.status).toBe(201);
    expect(res.body.token).toBe('');
  });

  it('GET /api/dashboard/stats — no token, no password = open dashboard → 200', async () => {
    const res = await harness.agent.get('/api/dashboard/stats');

    expect(res.status).toBe(200);
    expect(res.body.total).toBeDefined();
  });

  it('GET /api/auth/oidc/start — OIDC disabled preserves local installs', async () => {
    const res = await harness.agent.get('/api/auth/oidc/start');

    expect(res.status).toBe(404);
    expect(res.body.error.type).toBe('oidc_disabled');
  });

  it('consecutive login attempts → rate limited after threshold', async () => {
    // Login rate limit is 5/min in our fixture
    // Previous tests may have consumed some attempts already
    // Send enough to definitely exceed the limit
    const results: number[] = [];

    for (let i = 0; i < 10; i++) {
      const res = await harness.agent
        .post('/api/auth/login')
        .send({ password: 'test' });
      results.push(res.status);
    }

    // At some point we should get 429
    expect(results).toContain(429);
    // And at least the first one should succeed
    expect(results[0]).toBe(201);
  });
});
