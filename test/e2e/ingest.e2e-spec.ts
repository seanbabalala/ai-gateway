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
  // Non-Streaming — Images / Audio
  // ══════════════════════════════════════════════════════

  it('POST /v1/images/generations → 200 + OpenAI image response', async () => {
    const res = await harness.agent
      .post('/v1/images/generations')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        prompt: 'Draw SiftGate as a clean product render',
        size: '1024x1024',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].url).toContain('generated.png');
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/images/generations');
    expect(call.body.model).toBe('gpt-image-1');
  });

  it('POST /v1/images/edits accepts multipart pass-through and preserves safe call flow', async () => {
    const res = await harness.agent
      .post('/v1/images/edits')
      .set('Authorization', `Bearer ${API_KEY}`)
      .field('model', 'gpt-image-1')
      .field('prompt', 'Add a subtle blue accent')
      .attach('image', Buffer.from('fake-image-bytes'), 'image.png');

    expect(res.status).toBe(200);
    expect(res.body.data[0].b64_json).toBeDefined();
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/images/edits');
    expect(call.headers['Content-Type']).toContain('multipart/form-data');
    expect(call.rawBody?.toString('latin1')).toContain('name="model"');
  });

  it('POST /v1/audio/transcriptions accepts multipart audio pass-through', async () => {
    const res = await harness.agent
      .post('/v1/audio/transcriptions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .field('model', 'auto')
      .attach('file', Buffer.from('fake-audio-bytes'), 'sample.wav');

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('mock transcription');
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/audio/transcriptions');
    expect(call.headers['Content-Type']).toContain('multipart/form-data');
    expect(call.rawBody?.toString('latin1')).toContain('gpt-4o-mini-transcribe');
  });

  it('POST /v1/audio/speech returns binary provider audio', async () => {
    const res = await harness.agent
      .post('/v1/audio/speech')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'tts-1',
        input: 'hello from SiftGate',
        voice: 'alloy',
      })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect((res.body as Buffer).toString()).toBe('mock-mp3-bytes');
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/audio/speech');
    expect(call.body.model).toBe('tts-1');
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
