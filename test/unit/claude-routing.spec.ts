import * as path from 'path';
import { ConfigService } from '../../src/config/config.service';
import { PipelineService } from '../../src/pipeline/pipeline.service';
import { ProviderClientService } from '../../src/providers/provider-client.service';
import { CanonicalRequest } from '../../src/canonical/canonical.types';
import { NodeConfig } from '../../src/config/gateway.config';

function makeMessagesRequest(
  overrides: Partial<CanonicalRequest> = {},
): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: false,
    metadata: {
      source_format: 'messages',
      original_model: 'claude-opus-4-6',
      raw_headers: {
        'user-agent': 'claude-code/2.1.74',
        'anthropic-beta': 'claude-code-20250219,context-management-2025-06-27',
        'anthropic-version': '2023-06-01',
      },
      raw_body: {
        model: 'claude-opus-4-6',
        stream: false,
        messages: [{ role: 'user', content: 'Hello!' }],
      },
    },
    ...overrides,
  };
}

describe('Claude routing compatibility', () => {
  beforeEach(() => {
    process.env.GATEWAY_CONFIG_PATH = path.resolve(
      __dirname,
      '../../gateway.config.yaml',
    );
  });

  afterEach(() => {
    delete process.env.GATEWAY_CONFIG_PATH;
    jest.restoreAllMocks();
  });

  it('routes claude-* model names to the claude node without alias registration', () => {
    const config = new ConfigService();

    expect(config.resolveModel('claude-haiku-4-5-20251001')).toEqual({
      nodeId: 'claude',
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('pins Claude Code messages requests to claude with no cross-provider fallbacks', () => {
    const config = new ConfigService();
    const service = new PipelineService(
      config,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const route = (service as any).resolveSmartRoute(makeMessagesRequest());

    expect(route.route.primary).toEqual({
      node: 'claude',
      model: 'claude-opus-4-6-v1',
    });
    expect(route.route.fallbacks).toEqual([]);
    expect(route.tier).toBe('direct');
  });

  it('preserves native Anthropic headers and request shape for messages passthrough', async () => {
    const service = new ProviderClientService({} as never);
    const canonical = makeMessagesRequest({
      stream: true,
      metadata: {
        source_format: 'messages',
        original_model: 'claude-opus-4-6',
        raw_headers: {
          'anthropic-version': '2023-06-01',
          'anthropic-beta':
            'claude-code-20250219,context-management-2025-06-27,advanced-tool-use-2025-11-20',
        },
        raw_body: {
          model: 'claude-opus-4-6',
          stream: true,
          messages: [{ role: 'user', content: 'Hello!' }],
          tools: [{ name: 'echo', input_schema: { type: 'object' } }],
        },
      },
    });

    const requestBody = (service as any).denormalizeRequest(
      canonical,
      'messages',
      'claude-opus-4-6-v1',
    );

    expect(requestBody).toEqual({
      model: 'claude-opus-4-6-v1',
      stream: true,
      messages: [{ role: 'user', content: 'Hello!' }],
      tools: [{ name: 'echo', input_schema: { type: 'object' } }],
    });

    const node: NodeConfig = {
      id: 'claude',
      name: 'Claude',
      protocol: 'messages',
      base_url: 'http://example.com',
      endpoint: '/v1/messages',
      api_key: 'upstream-key',
      models: ['claude-opus-4-6-v1'],
      timeout_ms: 1000,
    };

    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_123',
          model: 'claude-opus-4-6',
          content: [{ type: 'text', text: 'OK' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    (global as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;

    try {
      await (service as any).sendRequest(node, requestBody, canonical);
    } finally {
      (global as typeof globalThis & { fetch: typeof fetch }).fetch =
        originalFetch;
    }

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toMatchObject({
      'x-api-key': 'upstream-key',
      'anthropic-version': '2023-06-01',
      'anthropic-beta':
        'claude-code-20250219,context-management-2025-06-27',
    });
  });

  it('removes empty assistant text blocks from native messages passthrough', () => {
    const service = new ProviderClientService({} as never);
    const canonical = makeMessagesRequest({
      metadata: {
        source_format: 'messages',
        original_model: 'claude-opus-4-6',
        raw_headers: {},
        raw_body: {
          model: 'claude-opus-4-6',
          stream: true,
          messages: [
            {
              role: 'assistant',
              content: [
                { type: 'text', text: '' },
                { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'pwd' } },
              ],
            },
          ],
        },
      },
    });

    const requestBody = (service as any).denormalizeRequest(
      canonical,
      'messages',
      'claude-opus-4-6-v1',
    );

    expect(requestBody).toEqual({
      model: 'claude-opus-4-6-v1',
      stream: false,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'pwd' } },
          ],
        },
      ],
    });
  });
});
