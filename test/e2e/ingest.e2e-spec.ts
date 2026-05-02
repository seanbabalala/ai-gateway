/**
 * E2E tests — Ingest pipeline (chat/completions, messages, responses)
 *
 * Tests the full request chain:
 * HTTP → Guard → Normalize → Score → Route → Provider(mock) → Denormalize → Response
 */

import { createE2EHarness, E2EHarness, API_KEY } from './setup';

describe('Ingest (e2e)', () => {
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
  // Non-Streaming — Chat Completions
  // ══════════════════════════════════════════════════════

  it('POST /v1/chat/completions → 200 + OpenAI format response', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.choices).toBeDefined();
    expect(Array.isArray(res.body.choices)).toBe(true);
    expect(res.body.choices[0].message.content).toBeDefined();
    expect(res.body.usage).toBeDefined();
  });

  it('POST /v1/chat/completions — fetch called with correct URL and headers', async () => {
    await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
      });

    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
    const call = harness.fetchMock.calls[0];
    expect(call.url).toContain('mock-upstream.test');
    expect(call.headers['Authorization']).toBe('Bearer mock-openai-key');
    expect(call.body.model).toBe('gpt-4o');
    expect(call.body.stream).toBe(false);
  });

  it('POST /v1/chat/completions — model:"gpt-4o" routes to mock-openai', async () => {
    await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
      });

    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/chat/completions');
  });

  it('POST /v1/chat/completions — model:"auto" uses tier-based routing', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'hi' }],
      });

    expect(res.status).toBe(200);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // ══════════════════════════════════════════════════════
  // Non-Streaming — Messages (Anthropic)
  // ══════════════════════════════════════════════════════

  it('POST /v1/messages → 200 + Anthropic format response', async () => {
    const res = await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.content).toBeDefined();
    expect(Array.isArray(res.body.content)).toBe(true);
    expect(res.body.content[0].type).toBe('text');
    expect(res.body.content[0].text).toBeDefined();
  });

  it('POST /v1/messages — fetch uses x-api-key header', async () => {
    await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      });

    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
    const call = harness.fetchMock.calls[0];
    expect(call.headers['x-api-key']).toBe('mock-claude-key');
    expect(call.url).toBe('http://mock-upstream.test/v1/messages');
  });

  // ══════════════════════════════════════════════════════
  // Non-Streaming — Responses
  // ══════════════════════════════════════════════════════

  it('POST /v1/responses → 200 + Responses format', async () => {
    // The responses endpoint route: by default will go through auto-routing
    // to an OpenAI-compatible node since no "responses" protocol node exists
    const res = await harness.agent
      .post('/v1/responses')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        input: 'Hello world',
      });

    expect(res.status).toBe(200);
    // Response is denormalized back to responses format
    expect(res.body).toBeDefined();
  });

  // ══════════════════════════════════════════════════════
  // Non-Streaming — Embeddings
  // ══════════════════════════════════════════════════════

  it('POST /v1/embeddings → 200 + OpenAI embeddings format', async () => {
    const res = await harness.agent
      .post('/v1/embeddings')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        input: ['hello', 'world'],
        dimensions: 1536,
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      object: 'embedding',
      index: 0,
    });
    expect(Array.isArray(res.body.data[0].embedding)).toBe(true);
    expect(res.body.usage).toMatchObject({ prompt_tokens: 8, total_tokens: 8 });
  });

  it('POST /v1/embeddings — routes to embeddings endpoint with dimensions', async () => {
    await harness.agent
      .post('/v1/embeddings')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'text-embedding-3-small',
        input: 'hello',
        dimensions: 1536,
      });

    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/embeddings');
    expect(call.body).toMatchObject({
      model: 'text-embedding-3-small',
      input: 'hello',
      dimensions: 1536,
    });
  });

  // ══════════════════════════════════════════════════════
  // Non-Streaming — Rerank
  // ══════════════════════════════════════════════════════

  it('POST /v1/rerank → 200 + rerank response format', async () => {
    const res = await harness.agent
      .post('/v1/rerank')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        query: 'what is SiftGate?',
        documents: ['SiftGate routes AI traffic.', 'SQLite migration notes.'],
        top_n: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('rerank');
    expect(res.body.model).toBe('rerank-english-v3');
    expect(res.body.results).toEqual([
      { index: 0, relevance_score: 1 },
    ]);
    expect(res.body.usage).toMatchObject({ prompt_tokens: 16, total_tokens: 16 });
  });

  it('POST /v1/rerank — routes to configured rerank endpoint', async () => {
    await harness.agent
      .post('/v1/rerank')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'rerank-english-v3',
        query: 'gateway',
        documents: ['gateway', 'database'],
        top_n: 2,
      });

    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/rerank');
    expect(call.body).toMatchObject({
      model: 'rerank-english-v3',
      query: 'gateway',
      documents: ['gateway', 'database'],
      top_n: 2,
    });
  });

  // ══════════════════════════════════════════════════════
  // Validation
  // ══════════════════════════════════════════════════════

  it('POST /v1/chat/completions — empty messages → still processes (gateway delegates to provider)', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [],
      });

    // Gateway doesn't reject empty messages — it forwards to the provider
    // Mock responds 200, so we get 200
    expect(res.status).toBe(200);
  });

  // ══════════════════════════════════════════════════════
  // Streaming — Chat Completions
  // ══════════════════════════════════════════════════════

  it('POST /v1/chat/completions stream:true → SSE response', async () => {
    harness.fetchMock.setStreamingChatResponse(['Hello', ' World']);

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => { callback(null, data); });
      });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const body = res.body as unknown as string;
    expect(body).toContain('data:');
    expect(body).toContain('[DONE]');
  });

  it('POST /v1/chat/completions stream:true — SSE contains data lines', async () => {
    harness.fetchMock.setStreamingChatResponse(['Test']);

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => { callback(null, data); });
      });

    const body = res.body as unknown as string;
    const dataLines = body.split('\n').filter((l: string) => l.startsWith('data:'));
    expect(dataLines.length).toBeGreaterThanOrEqual(2);
  });

  // ══════════════════════════════════════════════════════
  // Streaming — Messages (Anthropic)
  // ══════════════════════════════════════════════════════

  it('POST /v1/messages stream:true → SSE events', async () => {
    harness.fetchMock.setStreamingMessagesResponse('Hello from Claude');

    const res = await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => { callback(null, data); });
      });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const body = res.body as unknown as string;
    // Anthropic SSE format has event: prefixed lines
    expect(body).toContain('event:');
    expect(body).toContain('message_start');
  });

  // ══════════════════════════════════════════════════════
  // Model Aliases
  // ══════════════════════════════════════════════════════

  it('model:"gpt4" alias → resolves to gpt-4o, routes to mock-openai', async () => {
    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt4',
        messages: [{ role: 'user', content: 'hi' }],
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/chat/completions');
    expect(call.body.model).toBe('gpt-4o');
  });

  it('model:"claude" alias → resolves to claude-sonnet-4-20250514', async () => {
    const res = await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'claude',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.body.model).toBe('claude-sonnet-4-20250514');
  });
});
