import { ProviderClientService, ProviderError } from '../../src/providers/provider-client.service';
import { Tier, CanonicalMediaRequest, CanonicalRequest } from '../../src/canonical/canonical.types';
import { TelemetryService } from '../../src/telemetry/telemetry.service';

const routingMeta = { tier: 'standard' as Tier, score: 0.1, is_fallback: false };

function makeService(): ProviderClientService {
  return new ProviderClientService({} as any, new TelemetryService());
}

function makeServiceWithNode(nodeOverrides: Record<string, any> = {}): ProviderClientService {
  const node = {
    id: 'openai', name: 'OpenAI', protocol: 'chat_completions',
    base_url: 'https://api.openai.com', endpoint: '/v1/chat/completions',
    api_key: 'sk-test', models: ['gpt-4o'], model_aliases: {},
    timeout_ms: 5000,
    ...nodeOverrides,
  };
  return new ProviderClientService({
    getNode: jest.fn().mockReturnValue(node),
  } as any, new TelemetryService());
}

function makeServiceWithPool(
  nodeOverrides: Record<string, any>,
  pool: { getDispatcher: jest.Mock },
): ProviderClientService {
  const node = {
    id: 'openai', name: 'OpenAI', protocol: 'chat_completions',
    base_url: 'https://api.openai.com', endpoint: '/v1/chat/completions',
    api_key: 'sk-test', models: ['gpt-4o'], model_aliases: {},
    timeout_ms: 5000,
    ...nodeOverrides,
  };
  return new ProviderClientService({
    getNode: jest.fn().mockReturnValue(node),
  } as any, new TelemetryService(), pool as any);
}

function makeCanonical(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'Hi' }],
    stream: false,
    metadata: { source_format: 'chat_completions', raw_headers: {} },
    ...overrides,
  };
}

function makeMediaCanonical(
  overrides: Partial<CanonicalMediaRequest> = {},
): CanonicalMediaRequest {
  return {
    model: 'gpt-image-1',
    source_format: 'image_generation',
    payload: { model: 'gpt-image-1', prompt: 'Draw SiftGate' },
    content_type: 'application/json',
    is_multipart: false,
    metadata: {
      source_format: 'image_generation',
      original_model: 'gpt-image-1',
      raw_headers: {},
    },
    ...overrides,
  };
}

describe('ProviderClientService', () => {
  // ── Response Normalization ──────────────────────────────

  describe('normalizeResponse — chat_completions', () => {
    it('should normalize a simple text response', () => {
      const svc = makeService();
      const body = {
        id: 'chatcmpl-1',
        model: 'gpt-4o',
        choices: [
          { message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'openai', 'gpt-4o', 150);
      expect(result.id).toBe('chatcmpl-1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual(expect.objectContaining({ input_tokens: 10, output_tokens: 5 }));
      expect(result.model).toBe('gpt-4o');
      expect(result.routing.node).toBe('openai');
      expect(result.routing.latency_ms).toBe(150);
    });

    it('should normalize tool_calls', () => {
      const svc = makeService();
      const body = {
        id: 'chatcmpl-2',
        model: 'gpt-4o',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', function: { name: 'search', arguments: '{"q":"test"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'openai', 'gpt-4o', 200);
      expect(result.stop_reason).toBe('tool_use');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search');
        expect(result.content[0].input).toEqual({ q: 'test' });
      }
    });

    it('should map finish_reason "length" to "max_tokens"', () => {
      const svc = makeService();
      const body = {
        id: 'x', model: 'gpt-4o',
        choices: [{ message: { content: 'partial...' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'n', 'm', 100);
      expect(result.stop_reason).toBe('max_tokens');
    });
  });

  describe('normalizeResponse — messages', () => {
    it('should normalize Anthropic Messages response', () => {
      const svc = makeService();
      const body = {
        id: 'msg_1',
        model: 'claude-3-opus',
        content: [
          { type: 'text', text: 'Hello from Claude' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-opus', 300);
      expect(result.id).toBe('msg_1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello from Claude' });
      expect(result.stop_reason).toBe('end_turn');
      expect(result.usage).toEqual(expect.objectContaining({ input_tokens: 100, output_tokens: 50 }));
    });

    it('should handle tool_use blocks', () => {
      const svc = makeService();
      const body = {
        id: 'msg_2', model: 'claude-3-opus',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'search', input: { query: 'test' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 30 },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-opus', 200);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('search');
        expect(result.content[0].input).toEqual({ query: 'test' });
      }
    });
  });

  describe('normalizeResponse — responses', () => {
    it('should normalize OpenAI Responses API response', () => {
      const svc = makeService();
      const body = {
        id: 'resp_1',
        model: 'gpt-5.4',
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'Answer here' }] },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 250);
      expect(result.id).toBe('resp_1');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Answer here' });
      expect(result.stop_reason).toBe('end_turn');
    });

    it('should handle function_call outputs', () => {
      const svc = makeService();
      const body = {
        id: 'resp_2', model: 'gpt-5.4', status: 'completed',
        output: [
          { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 100);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].name).toBe('get_weather');
        expect(result.content[0].input).toEqual({ city: 'NYC' });
      }
    });

    it('should map incomplete status to max_tokens', () => {
      const svc = makeService();
      const body = {
        id: 'resp_3', model: 'gpt-5.4', status: 'incomplete',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '...' }] }],
        usage: { input_tokens: 10, output_tokens: 4096 },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-5.4', 100);
      expect(result.stop_reason).toBe('max_tokens');
    });
  });

  // ── ProviderError ───────────────────────────────────────

  describe('ProviderError', () => {
    it('should have statusCode and nodeId', () => {
      const err = new ProviderError('test error', 429, 'openai');
      expect(err.message).toBe('test error');
      expect(err.statusCode).toBe(429);
      expect(err.nodeId).toBe('openai');
      expect(err.name).toBe('ProviderError');
      expect(err instanceof Error).toBe(true);
    });
  });

  // ── Native Messages Passthrough (via private methods accessed indirectly) ──

  describe('denormalizeRequest — native messages passthrough', () => {
    it('should passthrough raw_body for messages → messages', () => {
      const svc = makeService();
      const canonical = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          original_model: 'claude-3-opus',
          raw_headers: {},
          raw_body: {
            model: 'claude-3-opus',
            stream: false,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 100,
          },
        },
      };
      // Access private method via any cast (matching existing test patterns)
      const body = (svc as any).denormalizeRequest(canonical, 'messages', 'claude-3-opus-20240229');
      expect(body.model).toBe('claude-3-opus-20240229'); // remapped to target model
      expect(body.stream).toBe(false);
      expect(body.messages).toBeDefined();
      expect(body.max_tokens).toBe(100);
    });

    it('should sanitize empty text blocks in native passthrough', () => {
      const svc = makeService();
      const canonical = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        stream: true,
        metadata: {
          source_format: 'messages' as const,
          original_model: 'claude-3-opus',
          raw_headers: {},
          raw_body: {
            model: 'claude-3-opus',
            stream: true,
            messages: [
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: '' },
                  { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { cmd: 'ls' } },
                ],
              },
            ],
          },
        },
      };
      const body = (svc as any).denormalizeRequest(canonical, 'messages', 'claude-3-opus');
      // Empty text block should be removed
      expect(body.messages[0].content).toHaveLength(1);
      expect(body.messages[0].content[0].type).toBe('tool_use');
    });

    it('should preserve native Anthropic structured-output output_config in passthrough', () => {
      const schema = {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      };
      const svc = makeService();
      const canonical = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
        stream: false,
        response_format: {
          type: 'json_schema' as const,
          source: 'messages.output_config.format' as const,
          raw: { type: 'json_schema', schema },
          json_schema: { schema },
        },
        structured_output: {
          requested: true,
          type: 'json_schema' as const,
          source: 'messages.output_config.format' as const,
          schema,
        },
        metadata: {
          source_format: 'messages' as const,
          original_model: 'claude-3-opus',
          raw_headers: {},
          raw_body: {
            model: 'claude-3-opus',
            stream: false,
            messages: [{ role: 'user', content: 'Hi' }],
            output_config: { format: { type: 'json_schema', schema } },
          },
        },
      };

      const body = (svc as any).denormalizeRequest(canonical, 'messages', 'claude-3-opus');

      expect(body.output_config).toEqual({
        format: { type: 'json_schema', schema },
      });
      expect(body.response_format).toBeUndefined();
      expect(body.text).toBeUndefined();
    });
  });

  // ── Header extraction ──────────────────────────────────

  describe('extractNativeMessageHeaders', () => {
    it('should forward anthropic-version header', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: { 'anthropic-version': '2023-06-01' },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should filter anthropic-beta to allowed values only', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: {
            'anthropic-beta': 'claude-code-20250219,some-unknown-beta,context-management-2025-06-27',
          },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-beta']).toBe('claude-code-20250219,context-management-2025-06-27');
    });

    it('should not set anthropic-beta if all betas are filtered out', () => {
      const svc = makeService();
      const canonical = {
        messages: [],
        stream: false,
        metadata: {
          source_format: 'messages' as const,
          raw_headers: { 'anthropic-beta': 'unknown-beta-1,unknown-beta-2' },
        },
      };
      const headers = (svc as any).extractNativeMessageHeaders(canonical);
      expect(headers['anthropic-beta']).toBeUndefined();
    });
  });

  // ── Cache Token Extraction ──────────────────────────────

  describe('normalizeResponse — cache token extraction', () => {
    it('should extract cache tokens from Anthropic Messages response', () => {
      const svc = makeService();
      const body = {
        id: 'msg_cache', model: 'claude-3-sonnet',
        content: [{ type: 'text', text: 'Cached response' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1000, output_tokens: 200,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 300,
        },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-sonnet', 100);
      expect(result.usage.cache_creation_input_tokens).toBe(500);
      expect(result.usage.cache_read_input_tokens).toBe(300);
    });

    it('should extract cached_tokens from OpenAI Chat Completions response', () => {
      const svc = makeService();
      const body = {
        id: 'chatcmpl-cache', model: 'gpt-4o',
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 500, completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 200 },
        },
      };
      const result = svc.normalizeResponse(body, 'chat_completions', routingMeta, 'openai', 'gpt-4o', 100);
      expect(result.usage.cache_read_input_tokens).toBe(200);
    });

    it('should extract cached_tokens from OpenAI Responses API response', () => {
      const svc = makeService();
      const body = {
        id: 'resp_cache', model: 'gpt-4.1', status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }],
        usage: {
          input_tokens: 800, output_tokens: 100,
          input_token_details: { cached_tokens: 400 },
        },
      };
      const result = svc.normalizeResponse(body, 'responses', routingMeta, 'openai', 'gpt-4.1', 100);
      expect(result.usage.cache_read_input_tokens).toBe(400);
    });

    it('should default cache tokens to 0 when not present', () => {
      const svc = makeService();
      const body = {
        id: 'msg_no_cache', model: 'claude-3-opus',
        content: [{ type: 'text', text: 'No cache' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };
      const result = svc.normalizeResponse(body, 'messages', routingMeta, 'claude', 'claude-3-opus', 100);
      expect(result.usage.cache_creation_input_tokens).toBe(0);
      expect(result.usage.cache_read_input_tokens).toBe(0);
    });
  });

  // ── Forward (end-to-end with mocked fetch) ────────────────

  describe('forward — with mocked fetch', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('should forward request and return normalized response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'chatcmpl-test', model: 'gpt-4o',
          choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      }) as any;

      const svc = makeServiceWithNode();
      const result = await svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta);
      expect(result.id).toBe('chatcmpl-test');
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('should forward embeddings to the embeddings endpoint', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          object: 'list',
          model: 'text-embedding-3-small',
          data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 12, total_tokens: 12 },
        }),
      });
      global.fetch = fetchMock as any;

      const svc = makeServiceWithNode({
        embedding_models: ['text-embedding-3-small'],
        embeddings_endpoint: '/v1/embeddings',
      });
      const result = await svc.forwardEmbeddings(
        {
          model: 'text-embedding-3-small',
          input: ['hello', 'world'],
          dimensions: 1536,
          metadata: { source_format: 'embeddings', raw_headers: {} },
        } as any,
        'openai',
        'text-embedding-3-small',
        routingMeta,
      );

      expect(result.data[0]).toEqual({ index: 0, embedding: [0.1, 0.2] });
      expect(result.usage.input_tokens).toBe(12);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/embeddings');
      expect(JSON.parse(opts.body)).toMatchObject({
        model: 'text-embedding-3-small',
        input: ['hello', 'world'],
        dimensions: 1536,
      });
    });

    it('should forward rerank requests to the rerank endpoint', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'rerank-1',
          object: 'rerank',
          model: 'rerank-english-v3',
          results: [{ index: 1, relevance_score: 0.92 }],
          usage: { prompt_tokens: 18, total_tokens: 18 },
        }),
      });
      global.fetch = fetchMock as any;

      const svc = makeServiceWithNode({
        rerank_models: ['rerank-english-v3'],
        rerank_endpoint: '/v1/rerank',
      });
      const result = await svc.forwardRerank(
        {
          model: 'rerank-english-v3',
          query: 'what is siftgate?',
          documents: ['gateway', 'migration'],
          top_n: 1,
          metadata: { source_format: 'rerank', raw_headers: {} },
        } as any,
        'openai',
        'rerank-english-v3',
        routingMeta,
      );

      expect(result.results[0]).toEqual({ index: 1, relevance_score: 0.92 });
      expect(result.usage.input_tokens).toBe(18);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/rerank');
      expect(JSON.parse(opts.body)).toMatchObject({
        model: 'rerank-english-v3',
        query: 'what is siftgate?',
        documents: ['gateway', 'migration'],
        top_n: 1,
      });
    });

    it('should forward image generation JSON to the configured media endpoint', async () => {
      const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({
        created: 123,
        model: 'upstream-image-model',
        data: [{ url: 'https://example.test/image.png' }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      global.fetch = fetchMock as any;

      const svc = makeServiceWithNode({
        image_models: ['gpt-image-1'],
        images_generations_endpoint: '/v1/images/generations',
      });
      const result = await svc.forwardMedia(
        makeMediaCanonical({ model: 'auto' }),
        'openai',
        'gpt-image-1',
        routingMeta,
      );

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect(JSON.parse(opts.body)).toMatchObject({
        model: 'gpt-image-1',
        prompt: 'Draw SiftGate',
      });
      expect(result.body).toMatchObject({
        data: [{ url: 'https://example.test/image.png' }],
      });
      expect(result.usage.input_tokens).toBe(7);
    });

    it('should return binary audio speech responses with content type', async () => {
      global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.from('audio-bytes'), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })) as any;

      const svc = makeServiceWithNode({
        audio_models: ['tts-1'],
        audio_speech_endpoint: '/v1/audio/speech',
      });
      const result = await svc.forwardMedia(
        makeMediaCanonical({
          model: 'tts-1',
          source_format: 'audio_speech',
          payload: { model: 'tts-1', input: 'hello', voice: 'alloy' },
          metadata: {
            source_format: 'audio_speech',
            original_model: 'tts-1',
            raw_headers: {},
          },
        }),
        'openai',
        'tts-1',
        routingMeta,
      );

      expect(Buffer.isBuffer(result.body)).toBe(true);
      expect(result.content_type).toBe('audio/mpeg');
      expect((result.body as Buffer).toString()).toBe('audio-bytes');
    });

    it('should throw ProviderError for non-OK response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Rate limited'),
      }) as any;

      const svc = makeServiceWithNode();
      await expect(svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta))
        .rejects.toThrow(ProviderError);
    });

    it('should throw ProviderError for network errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed')) as any;

      const svc = makeServiceWithNode();
      await expect(svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta))
        .rejects.toThrow(ProviderError);
    });

    it('should pass a configured dispatcher to fetch', async () => {
      const dispatcher = { dispatch: jest.fn() };
      const pool = { getDispatcher: jest.fn().mockReturnValue(dispatcher) };
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'chatcmpl-test', model: 'gpt-4o',
          choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      });
      global.fetch = fetchMock as any;

      const svc = makeServiceWithPool({
        connection: { pool_size: 4, keep_alive_ms: 30000 },
      }, pool);
      await svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta);

      expect(pool.getDispatcher).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai' }),
      );
      expect(fetchMock.mock.calls[0][1].dispatcher).toBe(dispatcher);
    });

    it('should map undici headers/body timeouts to ProviderError timeouts', async () => {
      const timeout = new Error('headers timeout');
      (timeout as any).name = 'HeadersTimeoutError';
      (timeout as any).code = 'UND_ERR_HEADERS_TIMEOUT';
      global.fetch = jest.fn().mockRejectedValue(timeout) as any;

      const svc = makeServiceWithNode();
      await expect(svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta))
        .rejects.toMatchObject({
          statusCode: 504,
          failureType: 'timeout',
        });
    });

    it('should map body read timeouts to ProviderError timeouts', async () => {
      const timeout = new Error('body timeout');
      (timeout as any).name = 'BodyTimeoutError';
      (timeout as any).code = 'UND_ERR_BODY_TIMEOUT';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(timeout),
      }) as any;

      const svc = makeServiceWithNode();
      await expect(svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta))
        .rejects.toMatchObject({
          statusCode: 504,
          failureType: 'timeout',
        });
    });

    it('should throw for unknown node', async () => {
      const svc = new ProviderClientService({
        getNode: jest.fn().mockReturnValue(undefined),
      } as any, new TelemetryService());
      await expect(svc.forward(makeCanonical(), 'unknown', 'model', routingMeta))
        .rejects.toThrow('Node not found');
    });

    it('should use x-api-key auth for messages protocol', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'msg_1', model: 'claude-3-opus',
          content: [{ type: 'text', text: 'Hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      });
      global.fetch = fetchMock as any;

      const svc = makeServiceWithNode({
        protocol: 'messages',
        base_url: 'https://api.anthropic.com',
        endpoint: '/v1/messages',
        api_key: 'sk-ant-test',
      });
      const canonical = makeCanonical();
      canonical.metadata.source_format = 'messages';
      await svc.forward(canonical, 'openai', 'claude-3-opus', routingMeta);

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    });

    it('should send debug message body when GATEWAY_DEBUG_MESSAGES_BODY is set', async () => {
      process.env.GATEWAY_DEBUG_MESSAGES_BODY = '1';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false, status: 400,
        text: jest.fn().mockResolvedValue('Bad request'),
      }) as any;

      const svc = makeServiceWithNode({ protocol: 'messages' });
      try {
        await svc.forward(makeCanonical(), 'openai', 'gpt-4o', routingMeta);
      } catch { /* expected */ }
      delete process.env.GATEWAY_DEBUG_MESSAGES_BODY;
    });
  });

  // ── ForwardStream (with mocked fetch returning ReadableStream) ──

  describe('forwardStream — with mocked fetch', () => {
    const originalFetch = global.fetch;
    afterEach(() => { global.fetch = originalFetch; });

    it('should stream events from provider', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
            'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
            'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
            'data: [DONE]\n\n',
          ));
          controller.close();
        },
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        body: stream,
      }) as any;

      const svc = makeServiceWithNode();
      const events = [];
      for await (const event of svc.forwardStream(makeCanonical({ stream: true }), 'openai', 'gpt-4o')) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0].type).toBe('start');
    });

    it('should stream through a configured dispatcher', async () => {
      const dispatcher = { dispatch: jest.fn() };
      const pool = { getDispatcher: jest.fn().mockReturnValue(dispatcher) };
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true, status: 200, body: stream,
      });
      global.fetch = fetchMock as any;

      const svc = makeServiceWithPool({
        connection: { pool_size: 4, body_timeout_ms: 300000 },
      }, pool);
      const events = [];
      for await (const event of svc.forwardStream(makeCanonical({ stream: true }), 'openai', 'gpt-4o')) {
        events.push(event);
      }

      expect(pool.getDispatcher).toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][1].dispatcher).toBe(dispatcher);
    });

    it('should throw for missing response body', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        body: null,
      }) as any;

      const svc = makeServiceWithNode();
      await expect(async () => {
        for await (const _ of svc.forwardStream(makeCanonical({ stream: true }), 'openai', 'gpt-4o')) {
          // should throw before yielding
        }
      }).rejects.toThrow('No response body');
    });

    it('should emit error event on stream read failure', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.error(new Error('Stream read failed'));
        },
      });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        body: stream,
      }) as any;

      const svc = makeServiceWithNode();
      const events = [];
      for await (const event of svc.forwardStream(makeCanonical({ stream: true }), 'openai', 'gpt-4o')) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThanOrEqual(1);
      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });
});
