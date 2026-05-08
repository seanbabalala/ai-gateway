import * as path from 'path';
import { ConfigService } from '../../src/config/config.service';
import { PipelineService } from '../../src/pipeline/pipeline.service';
import { ProviderClientService } from '../../src/providers/provider-client.service';
import { CanonicalRequest } from '../../src/canonical/canonical.types';
import { NodeConfig } from '../../src/config/gateway.config';
import { createNoOpHookExecutor } from '../../src/plugins/testing';
import { TelemetryService } from '../../src/telemetry/telemetry.service';

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

  it('routes claude-* model names to the configured messages node without alias registration', () => {
    const config = new ConfigService();

    expect(config.resolveModel('claude-haiku-4-5-20251001')).toEqual({
      nodeId: 'ctrip-anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('pins Claude Code messages requests to the configured messages node with no cross-provider fallbacks', async () => {
    const config = new ConfigService();
    const capabilityService = {
      resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
        max_context_tokens: undefined,
        structured_output: null,
      }),
    };
    const service = new PipelineService(
      config,
      capabilityService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createNoOpHookExecutor() as never,
      new TelemetryService(),
      { enqueue: jest.fn() } as never,
      {} as never,
      { create: jest.fn(), save: jest.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    const route = await (service as any).resolveSmartRoute(makeMessagesRequest());

    expect(route.route.primary).toEqual({
      node: 'ctrip-anthropic',
      model: 'claude-opus-4-6-v1',
    });
    expect(route.route.fallbacks).toEqual([]);
    expect(route.tier).toBe('direct');
  });

  it('does not pin the profile-scoped Claude Code virtual model to direct Claude routing', async () => {
    const config = new ConfigService();
    const capabilityService = {
      resolveModelModalities: jest.fn().mockReturnValue(['text']),
      resolveNodeModalities: jest.fn().mockReturnValue(['text']),
      resolveModelRoutingCapabilities: jest.fn().mockReturnValue({
        max_context_tokens: undefined,
        structured_output: null,
      }),
    };
    const routingService = {
      resolve: jest.fn().mockReturnValue({
        primary: { node: 'openai', model: 'gpt-4o' },
        fallbacks: [],
        tier: 'standard',
        momentumAdjusted: false,
        experimentGroup: null,
        experimentGroupsByTarget: {},
      }),
    };
    const service = new PipelineService(
      config,
      capabilityService as never,
      {} as never,
      { score: jest.fn().mockReturnValue({ tier: 'standard', score: 0.5 }) } as never,
      routingService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createNoOpHookExecutor() as never,
      new TelemetryService(),
      { enqueue: jest.fn() } as never,
      {} as never,
      { create: jest.fn(), save: jest.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        matchVirtualModel: jest.fn().mockResolvedValue({
          profile: {
            id: 'profile-1',
            name: 'Claude Code',
            connector: 'claude_code',
          },
          virtual_model: 'claude-siftgate-auto',
          requested_model: 'claude-siftgate-auto',
          internal_model: 'auto',
        }),
      } as never,
    );
    const request = makeMessagesRequest({
      metadata: {
        source_format: 'messages',
        original_model: 'claude-siftgate-auto',
        api_key_id: 'key-1',
        api_key_permissions: {
          allow_auto: true,
          allow_direct: false,
          allowed_nodes: [],
          allowed_models: [],
          allowed_endpoints: [],
          allowed_modalities: [],
        },
        raw_headers: {
          'user-agent': 'claude-code/2.1.74',
          'anthropic-beta': 'claude-code-20250219',
        },
      },
    });

    const route = await (service as any).resolveSmartRoute(request);

    expect(route.tier).toBe('standard');
    expect(route.route.primary).toEqual({ node: 'openai', model: 'gpt-4o' });
    expect(routingService.resolve).toHaveBeenCalled();
    expect(request.metadata.original_model).toBe('auto');
    expect(request.metadata.agent_virtual_model).toBe('claude-siftgate-auto');
  });

  it('preserves native Anthropic headers and request shape for messages passthrough', async () => {
    const service = new ProviderClientService({} as never, new TelemetryService());
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
    const service = new ProviderClientService({} as never, new TelemetryService());
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
