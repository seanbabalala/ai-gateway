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
    harness.fetchMock.setHandler(async (url, _init) => {
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
        model: 'auto',
        messages: [{ role: 'user', content: 'test fallback' }],
      });

    expect(res.status).toBe(200);
    // Should have made at least 2 fetch calls (primary + fallback)
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(2);

    await new Promise((r) => setTimeout(r, 200));
    const logRes = await harness.agent.get('/api/dashboard/logs?limit=1');
    expect(logRes.status).toBe(200);
    expect(logRes.body.data[0].is_fallback).toBe(true);
    expect(logRes.body.data[0].fallback_reason).toBe('upstream_error');
  });

  it('structured-output parse failure → fallback used → log records reason', async () => {
    let callCount = 0;
    harness.fetchMock.setHandler(async (url) => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          id: 'chatcmpl-invalid-json',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'not json' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      expect(url).toContain('/v1/messages');
      return new Response(JSON.stringify({
        id: 'msg-valid-json',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'Return JSON' }],
        response_format: { type: 'json_object' },
      });

    expect(res.status).toBe(200);
    expect(harness.fetchMock.calls).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 200));
    const logRes = await harness.agent.get('/api/dashboard/logs?limit=1');
    expect(logRes.status).toBe(200);
    expect(logRes.body.data[0]).toMatchObject({
      is_fallback: true,
      fallback_reason: 'structured_output_parse_failed',
      structured_output_requested: true,
      structured_output_type: 'json_object',
    });
  });

  it('all providers return 500 → upstream error response', async () => {
    harness.fetchMock.setError(500, 'All backends down');

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test error' }],
      });

    expect(res.status).toBe(500);
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

  it('model:"nonexistent" with a generated key → clear direct-model error', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'nonexistent',
        messages: [{ role: 'user', content: 'unknown model test' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain('not configured');
    expect(harness.fetchMock.calls.length).toBe(0);
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
