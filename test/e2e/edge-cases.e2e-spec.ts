/**
 * E2E tests — Edge cases (fallback, errors, cross-feature interactions)
 */

import { createE2EHarness, E2EHarness, API_KEY } from './setup';

describe('Edge Cases (e2e)', () => {
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

  it('primary returns 500 → fallback used → 200', async () => {
    let callCount = 0;
    harness.fetchMock.setHandler(async (url, init) => {
      callCount++;
      if (callCount === 1) {
        // Primary fails
        return new Response(
          JSON.stringify({ error: { message: 'Internal error' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Fallback succeeds — detect protocol from URL
      if (url.includes('/v1/messages')) {
        return new Response(JSON.stringify({
          id: 'msg-fallback',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'Fallback response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-fallback',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Fallback response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test fallback' }],
      });

    expect(res.status).toBe(200);
    // Should have made at least 2 fetch calls (primary + fallback)
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('all providers fail → 502 error response', async () => {
    harness.fetchMock.setError(500, 'All backends down');

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test error' }],
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
  });

  it('ingest request → log appears in dashboard logs', async () => {
    // First, send an ingest request
    await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'log test' }],
      });

    // Small delay for async log write
    await new Promise((r) => setTimeout(r, 200));

    // Then check dashboard logs
    const logRes = await harness.agent.get('/api/dashboard/logs?limit=10');

    expect(logRes.status).toBe(200);
    expect(logRes.body.data.length).toBeGreaterThanOrEqual(1);
    // Verify the log entry has expected fields
    const log = logRes.body.data[0];
    expect(log.node_id).toBeDefined();
    expect(log.model).toBeDefined();
    expect(log.status_code).toBeDefined();
  });

  it('model:"gpt4" alias → resolves to gpt-4o on mock-openai', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt4',
        messages: [{ role: 'user', content: 'alias test' }],
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.body.model).toBe('gpt-4o');
    expect(call.url).toContain('mock-upstream.test');
  });

  it('model:"nonexistent" → fallthrough to auto routing → 200', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'unknown model test' }],
      });

    // Should succeed — unknown models fall through to auto routing
    expect(res.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('model:"auto" with no model header → scoring-based routing', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'simple question' }],
      });

    expect(res.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
