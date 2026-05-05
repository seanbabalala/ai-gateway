/**
 * E2E tests — Ingest pipeline (chat/completions, messages, responses)
 *
 * Tests the full request chain:
 * HTTP → Guard → Normalize → Score → Route → Provider(mock) → Denormalize → Response
 */

import { createE2EHarness, E2EHarness, API_KEY, API_KEY_2 } from './setup';

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
    expect(res.headers['x-siftgate-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.headers['x-siftgate-request-id']);
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

    expect(res.status).toBeLessThan(300);
    expect(harness.fetchMock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /v1/chat/completions — preserves response_format json_schema upstream', async () => {
    const schema = {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
      additionalProperties: false,
    };
    harness.fetchMock.setHandler(async () =>
      new Response(JSON.stringify({
        id: 'chatcmpl-structured',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"ok":true}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Return JSON' }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Result', schema, strict: true },
        },
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Result', schema, strict: true },
    });
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
    expect(res.headers['x-siftgate-request-id']).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.headers['x-siftgate-request-id']);
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

  it('POST /v1/messages — preserves native output_config.format upstream', async () => {
    const schema = {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    };
    harness.fetchMock.setHandler(async () =>
      new Response(JSON.stringify({
        id: 'msg-structured',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await harness.agent
      .post('/v1/messages')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Return JSON' }],
        output_config: {
          format: { type: 'json_schema', schema },
        },
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.body.output_config).toEqual({
      format: { type: 'json_schema', schema },
    });
    expect(call.body.response_format).toBeUndefined();
    expect(call.body.text).toBeUndefined();
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

  it('POST /v1/responses — maps text.format json_schema to Chat response_format upstream', async () => {
    const schema = {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    };
    harness.fetchMock.setHandler(async () =>
      new Response(JSON.stringify({
        id: 'chatcmpl-structured-responses',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '{"ok":true}' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await harness.agent
      .post('/v1/responses')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'gpt-4o',
        input: 'Return JSON',
        text: {
          format: {
            type: 'json_schema',
            name: 'Result',
            schema,
            strict: true,
          },
        },
      });

    expect(res.status).toBe(200);
    const call = harness.fetchMock.calls[0];
    expect(call.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Result', schema, strict: true },
    });
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

  it('POST /v1/images/variations accepts multipart pass-through and logs safe media metadata', async () => {
    const res = await harness.agent
      .post('/v1/images/variations')
      .set('Authorization', `Bearer ${API_KEY}`)
      .field('model', 'auto')
      .field('response_format', 'b64_json')
      .attach('image', Buffer.from('fake-variation-bytes'), 'source.png');

    expect(res.status).toBe(200);
    expect(res.body.data[0].b64_json).toBeDefined();
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/images/variations');
    expect(call.rawBody?.toString('latin1')).toContain('gpt-image-1');

    const log = await harness.callLogRepo.findOneByOrFail({ source_format: 'image_variation' });
    expect(log.media_type).toBe('image');
    expect(log.media_operation).toBe('variation');
    expect(log.media_multipart).toBe(true);
    expect(log.media_file_count).toBe(1);
    expect(log.media_byte_size).toBeGreaterThan(0);
    expect(log.media_response_format).toBe('b64_json');
    expect(log.media_provider_response_type).toBe('application/json');
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

  it('POST /v1/audio/translations accepts multipart audio pass-through', async () => {
    const res = await harness.agent
      .post('/v1/audio/translations')
      .set('Authorization', `Bearer ${API_KEY}`)
      .field('model', 'auto')
      .field('response_format', 'json')
      .attach('file', Buffer.from('fake-audio-bytes'), 'sample.wav');

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('mock translation');
    const call = harness.fetchMock.calls[0];
    expect(call.url).toBe('http://mock-upstream.test/v1/audio/translations');
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

  it('POST /v1/videos/generations creates async job metadata and exposes status', async () => {
    const create = await harness.agent
      .post('/v1/videos/generations')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        prompt: 'A short product animation of SiftGate routing AI traffic',
        duration: 4,
        size: '1280x720',
        quality: 'standard',
      });

    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({
      id: 'vid-e2e-job-1',
      object: 'video.generation.job',
      model: 'veo-3-preview',
      status: 'queued',
    });

    const createCall = harness.fetchMock.calls[0];
    expect(createCall.url).toBe('http://mock-upstream.test/v1/videos/generations');
    expect(createCall.body.model).toBe('veo-3-preview');
    expect(createCall.body.prompt).toBe('A short product animation of SiftGate routing AI traffic');

    const log = await harness.callLogRepo.findOneByOrFail({ source_format: 'video_generation' });
    expect(log.media_type).toBe('video');
    expect(log.media_operation).toBe('generation');
    expect(log.media_multipart).toBe(false);
    expect(log.media_file_count).toBe(0);
    expect(log.media_byte_size).toBeGreaterThan(0);
    expect(log.media_provider_response_type).toBe('application/json');

    const status = await harness.agent
      .get('/v1/videos/vid-e2e-job-1')
      .set('Authorization', `Bearer ${API_KEY}`)
      .expect(200);

    expect(status.body).toMatchObject({
      id: 'vid-e2e-job-1',
      object: 'video.generation.job',
      status: 'completed',
      node: 'mock-openai',
      model: 'veo-3-preview',
    });
    expect(harness.fetchMock.calls[1].url).toBe('http://mock-upstream.test/v1/videos/vid-e2e-job-1');

    await harness.agent
      .get('/v1/videos/vid-e2e-job-1')
      .set('Authorization', `Bearer ${API_KEY_2}`)
      .expect(404);
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

  it('POST /v1/chat/completions stream:true — structured output does not fallback after SSE starts', async () => {
    harness.fetchMock.setStreamingChatResponse(['not json']);

    const res = await harness.agent
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        model: 'auto',
        messages: [{ role: 'user', content: 'Return JSON' }],
        stream: true,
        response_format: { type: 'json_object' },
      })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => { callback(null, data); });
      });

    expect(res.status).toBeLessThan(300);
    expect(harness.fetchMock.calls).toHaveLength(1);
    expect(res.body as unknown as string).toContain('[DONE]');
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
