import { BadRequestException } from '@nestjs/common';
import { PlaygroundController } from '../../src/ingest/playground.controller';
import { GatewayApiKeyContext } from '../../src/auth/gateway-api-key.service';
import { mockConfigService } from '../helpers';

function makePipeline(overrides: Record<string, unknown> = {}): any {
  return {
    process: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { id: 'resp_1', choices: [{ message: { content: 'ok' } }] },
      contentType: 'application/json',
    }),
    processEmbeddings: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { object: 'list', data: [] },
      contentType: 'application/json',
    }),
    processRerank: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { object: 'rerank', results: [] },
      contentType: 'application/json',
    }),
    processMedia: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { data: [] },
      contentType: 'application/json',
    }),
    processStream: jest.fn().mockImplementation(async (_canonical: unknown, res: any) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"delta":"ok"}\n\n');
      res.end('data: [DONE]\n\n');
    }),
    ...overrides,
  };
}

function makeController(options: {
  pipeline?: any;
  config?: any;
  gatewayApiKeys?: any;
  callLogRepo?: any;
  routeDecisionRepo?: any;
} = {}) {
  const pipeline = options.pipeline || makePipeline();
  const config = options.config || mockConfigService({
    namespaces: [
      {
        id: 'team-alpha',
        name: 'Team Alpha',
        allowed_nodes: ['openai'],
        allowed_models: ['gpt-4o-mini'],
        rate_limit: { requests_per_minute: 30 },
      },
    ],
    realtime: {
      enabled: false,
      path: '/v1/realtime',
      max_connections: 10,
      max_connections_per_node: 2,
    },
    nodes: [
      {
        id: 'openai',
        realtime_models: ['gpt-realtime'],
        realtime_endpoint: '/v1/realtime',
      },
    ],
  });
  const apiKeyContext: GatewayApiKeyContext = {
    id: 'key_1',
    name: 'Playground Key',
    status: 'active',
    allow_auto: true,
    allow_direct: true,
    allowed_nodes: ['openai', 'anthropic'],
    allowed_models: ['gpt-4o-mini', 'claude-sonnet'],
    allowed_endpoints: ['chat_completions'],
    allowed_modalities: ['text'],
    namespace_id: null,
    namespace_name: null,
    rate_limit_per_minute: 120,
  };
  const gatewayApiKeys = options.gatewayApiKeys || {
    getContextById: jest.fn().mockResolvedValue(apiKeyContext),
  };
  const callLogRepo = options.callLogRepo || {
    findOne: jest.fn().mockResolvedValue({
      request_id: 'req_play_1',
      session_key: 'playground-test',
      input_tokens: 12,
      output_tokens: 4,
      cost_usd: 0.00042,
      latency_ms: 88,
    }),
  };
  const routeDecisionRepo = options.routeDecisionRepo || {
    findOne: jest.fn().mockResolvedValue({ request_id: 'req_play_1' }),
  };

  return {
    controller: new PlaygroundController(
      pipeline,
      config,
      gatewayApiKeys,
      callLogRepo,
      routeDecisionRepo,
    ),
    pipeline,
    config,
    gatewayApiKeys,
    callLogRepo,
    routeDecisionRepo,
  };
}

describe('PlaygroundController', () => {
  it('runs chat probes through the pipeline with selected API key and namespace scope', async () => {
    const { controller, pipeline, gatewayApiKeys, callLogRepo, routeDecisionRepo } = makeController();

    const result = await controller.run({
      endpoint: 'chat_completions',
      model: 'gpt-4o-mini',
      api_key_id: 'key_1',
      namespace_id: 'team-alpha',
      routing_hint: { optimization: 'balanced' },
      body: {
        model: 'ignored',
        messages: [{ role: 'user', content: 'minimal probe' }],
        max_tokens: 8,
      },
    });

    expect(result).toMatchObject({
      success: true,
      endpoint: 'chat_completions',
      operation: 'chat_completions',
      request: {
        path: '/v1/chat/completions',
        model: 'gpt-4o-mini',
        api_key_id: 'key_1',
        namespace_id: 'team-alpha',
      },
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        total_tokens: 16,
      },
      cost_usd: 0.00042,
      latency_ms: 88,
      route_decision: {
        request_id: 'req_play_1',
        link: '/route-decisions/req_play_1',
        available: true,
      },
      privacy: {
        prompt_response_stored: false,
        raw_headers_stored: false,
        provider_keys_exposed: false,
        media_bytes_stored: false,
        standard_call_log_metadata: true,
      },
    });
    expect(gatewayApiKeys.getContextById).toHaveBeenCalledWith('key_1');
    expect(callLogRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { session_key: expect.stringMatching(/^playground-/) },
    }));
    expect(routeDecisionRepo.findOne).toHaveBeenCalledWith({
      where: { request_id: 'req_play_1' },
    });

    const canonical = pipeline.process.mock.calls[0][0];
    expect(canonical.model).toBeUndefined();
    expect(canonical.metadata.original_model).toBe('gpt-4o-mini');
    expect(canonical.metadata.api_key_id).toBe('key_1');
    expect(canonical.metadata.namespace_id).toBe('team-alpha');
    expect(canonical.metadata.api_key_permissions).toEqual({
      allow_auto: true,
      allow_direct: true,
      allowed_nodes: ['openai'],
      allowed_models: ['gpt-4o-mini'],
      allowed_endpoints: ['chat_completions'],
      allowed_modalities: ['text'],
    });
    expect(canonical.metadata.raw_headers['x-siftgate-playground']).toBe('true');
    expect(canonical.metadata.raw_headers['x-siftgate-routing-hint']).toBe('{"optimization":"balanced"}');
  });

  it('captures streaming responses without storing raw prompt or response fields', async () => {
    const { controller, pipeline } = makeController({
      callLogRepo: { findOne: jest.fn().mockResolvedValue(null) },
      routeDecisionRepo: { findOne: jest.fn() },
    });

    const result = await controller.run({
      endpoint: 'responses',
      model: 'auto',
      stream: true,
      body: { input: 'minimal probe' },
    });

    expect(pipeline.processStream).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      stream: true,
      response_summary: {
        body_type: 'sse',
        event_count: 2,
      },
      route_decision: null,
      privacy: {
        prompt_response_stored: false,
        raw_headers_stored: false,
      },
    });
  });

  it('returns a probe-only response for disabled realtime without opening a websocket', async () => {
    const { controller, pipeline } = makeController();

    const result = await controller.run({
      endpoint: 'realtime',
      model: 'gpt-realtime',
      operation: 'realtime_probe',
    });

    expect(pipeline.process).not.toHaveBeenCalled();
    expect(pipeline.processStream).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      endpoint: 'realtime',
      operation: 'realtime_probe',
      status_code: 400,
      request: {
        method: 'GET',
        path: '/v1/realtime',
        model: 'gpt-realtime',
      },
      privacy: {
        standard_call_log_metadata: false,
      },
    });
    expect(result.response_summary.body_preview).toContain('Realtime preview is disabled');
  });

  it('rejects unsupported playground endpoints', async () => {
    const { controller } = makeController();

    await expect(controller.run({
      endpoint: 'files' as never,
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
