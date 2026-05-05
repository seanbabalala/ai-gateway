/**
 * E2E tests — Guards (API key, rate limit, body size, helmet)
 */

import { createE2EHarness, E2EHarness, API_KEY, API_KEY_2 } from './setup';

describe('Guards (e2e)', () => {
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

  // ── API Key Guard ──

  it('no Authorization header → 401', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(401);
    expect(res.headers['x-siftgate-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.headers['x-siftgate-request-id']);
    expect(res.body).toMatchObject({
      error: {
        type: 'authentication_error',
        message: 'Missing API key. Use Authorization: Bearer <key>',
        request_id: expect.any(String),
      },
    });
  });

  it('Bearer wrong-key → 401', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer wrong-key')
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(401);
  });

  it('Bearer e2e-test-key-1 → 200', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
  });

  it('Bearer e2e-test-key-2 → 200', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY_2}`)
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
  });

  it('GET /health without key → 200 (no guard)', async () => {
    const res = await harness.agent.get('/health');

    expect(res.status).toBe(200);
  });

  // ── Rate Limit Headers ──

  it('response includes X-RateLimit headers', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  // ── Body Size Limit ──

  it('oversized body → 413', async () => {
    // 2MB payload exceeds the 1mb body_limit
    const largeBody = 'x'.repeat(2 * 1024 * 1024);
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('Content-Type', 'application/json')
      .send(largeBody);

    expect(res.status).toBe(413);
    expect(res.headers['x-siftgate-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.headers['x-siftgate-request-id']);
    expect(res.body).toMatchObject({
      error: {
        type: 'payload_too_large',
        request_id: expect.any(String),
      },
    });
  });

  it('invalid JSON on /v1/messages → 400 + Anthropic-compatible error envelope', async () => {
    const res = await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('Content-Type', 'application/json')
      .send('{"model":"claude-sonnet-4-20250514",');

    expect(res.status).toBe(400);
    expect(res.headers['x-siftgate-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.headers['x-siftgate-request-id']);
    expect(res.body).toMatchObject({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        request_id: expect.any(String),
      },
    });
  });

  // ── Helmet Security Headers ──

  it('responses include helmet security headers', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
