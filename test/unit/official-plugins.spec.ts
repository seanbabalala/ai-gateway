import RedisCachePlugin from '../../plugins/redis-cache';
import AnalyticsSinkPlugin from '../../plugins/analytics-sink';
import RequestTransformPlugin from '../../plugins/request-transform';
import GuardrailsPlugin from '../../plugins/guardrails';
import type {
  CanonicalRequest,
  CanonicalResponse,
} from '../../src/canonical/canonical.types';

function makeRequest(overrides: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'Hello TICKET-123' }],
    stream: false,
    temperature: 0.7,
    metadata: {
      source_format: 'chat_completions',
      original_model: 'auto',
      raw_headers: {},
      api_key_name: 'default',
    },
    ...overrides,
  };
}

function makeResponse(overrides: Partial<CanonicalResponse> = {}): CanonicalResponse {
  return {
    id: 'resp-1',
    content: [{ type: 'text', text: 'cached answer' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 4 },
    model: 'gpt-test',
    routing: {
      tier: 'standard',
      node: 'openai',
      latency_ms: 12,
      score: 0.5,
      is_fallback: false,
    },
    ...overrides,
  };
}

function makeContext<T>(data: T): any {
  return {
    data,
    store: new Map(),
    pluginConfig: {},
    gatewayConfig: {},
    log: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
}

describe('official runtime plugins', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redis-cache stores and serves canonical responses only when explicitly enabled', async () => {
    const plugin = new RedisCachePlugin();
    await plugin.onLoad({
      enabled: true,
      url: 'redis://127.0.0.1:6379',
      store_responses: true,
      ttl_seconds: 60,
    });

    const memory = new Map<string, string>();
    const client = {
      get: jest.fn(async (key: string) => memory.get(key) || null),
      setEx: jest.fn(async (key: string, _ttl: number, value: string) => {
        memory.set(key, value);
      }),
    };
    (plugin as any).client = client;

    const request = makeRequest();
    const response = makeResponse();
    await plugin.hooks.postUpstream(
      makeContext({ request, response }),
    );

    const result = await plugin.hooks.preRequest(
      makeContext({ request }),
    );

    expect(client.setEx).toHaveBeenCalledWith(
      expect.stringMatching(/^siftgate:cache:/),
      60,
      JSON.stringify(response),
    );
    expect((result as any).shortCircuit).toEqual(response);
  });

  it('analytics-sink sends sanitized call-log metadata without prompts or raw headers', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(global, 'fetch' as any).mockImplementation(fetchMock);

    const plugin = new AnalyticsSinkPlugin();
    plugin.onLoad({
      enabled: true,
      endpoint: 'https://analytics.example.test/events',
      batch_size: 1,
    });

    plugin.enqueue({
      request_id: 'req-1',
      model: 'gpt-test',
      prompt: 'do not export',
      raw_headers: { authorization: 'Bearer secret' },
      input_tokens: 1,
      output_tokens: 2,
    });
    await plugin.flushForTests();
    await plugin.onDestroy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events[0]).toEqual({
      request_id: 'req-1',
      model: 'gpt-test',
      input_tokens: 1,
      output_tokens: 2,
    });
    expect(JSON.stringify(body)).not.toContain('do not export');
    expect(JSON.stringify(body)).not.toContain('authorization');
  });

  it('request-transform applies local rewrite rules without external IO', () => {
    const plugin = new RequestTransformPlugin();
    plugin.onLoad({
      enabled: true,
      rules: [
        {
          set: { temperature: 0, max_tokens: 64 },
          prepend_system: 'Follow local policy.',
          replacements: [
            { pattern: 'TICKET-[0-9]+', with: 'TICKET-[redacted]', roles: ['user'] },
          ],
        },
      ],
    });

    const result = plugin.hooks.preRequest(
      makeContext({ request: makeRequest() }),
    ) as any;

    expect(result.request.temperature).toBe(0);
    expect(result.request.max_tokens).toBe(64);
    expect(result.request.messages[0]).toEqual({
      role: 'system',
      content: 'Follow local policy.',
    });
    expect(result.request.messages[1].content).toBe('Hello TICKET-[redacted]');
  });

  it('guardrails can audit or block configured local policy matches', () => {
    const auditPlugin = new GuardrailsPlugin();
    auditPlugin.onLoad({
      enabled: true,
      mode: 'audit',
      input_patterns: ['secret project'],
    });
    const auditCtx = makeContext({
      request: makeRequest({
        messages: [{ role: 'user', content: 'Tell me about secret project' }],
      }),
    });

    const auditResult = auditPlugin.hooks.preRequest(auditCtx) as any;
    expect(auditResult).toEqual({ unchanged: true });
    expect(auditCtx.store.get('guardrails.findings')).toHaveLength(1);

    const blockPlugin = new GuardrailsPlugin();
    blockPlugin.onLoad({
      enabled: true,
      mode: 'block',
      input_patterns: ['secret project'],
      blocked_message: 'Blocked by test policy.',
    });

    const blockResult = blockPlugin.hooks.preRequest(
      makeContext({
        request: makeRequest({
          messages: [{ role: 'user', content: 'secret project' }],
        }),
      }),
    ) as any;

    expect(blockResult.shortCircuit.content).toEqual([
      { type: 'text', text: 'Blocked by test policy.' },
    ]);
  });
});
