import { BudgetExceededError } from '../../src/budget/budget.service';
import {
  mapPublicGatewayError,
  PublicGatewayError,
  sendMappedPublicErrorResponse,
} from '../../src/http/public-error-handling';
import { ProviderError } from '../../src/providers/provider-client.service';

function mockReq(
  path = '/v1/chat/completions',
  headers: Record<string, string> = {},
): any {
  return {
    originalUrl: path,
    url: path,
    headers,
  };
}

function mockRes(): any {
  return {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
}

describe('public error handling', () => {
  it.each([
    {
      name: 'provider upstream 502',
      exception: new ProviderError(
        'Provider openai returned 502: sk-provider-secret-token',
        502,
        'openai',
        'http_error',
      ),
      path: '/v1/chat/completions',
      expected: {
        statusCode: 502,
        protocol: 'openai',
        type: 'upstream_error',
        message: 'Gateway request failed.',
      },
      forbidden: ['sk-provider-secret-token'],
    },
    {
      name: 'batch upstream 502',
      exception: Object.assign(new Error('batch provider leaked gw_sk_live_secret_123456'), {
        statusCode: 502,
      }),
      path: '/v1/batches/batch_123',
      expected: {
        statusCode: 502,
        protocol: 'openai',
        type: 'batch_proxy_error',
        message: 'Batch proxy request failed.',
      },
      forbidden: ['gw_sk_live_secret_123456'],
    },
    {
      name: 'realtime upstream 502',
      exception: Object.assign(new Error('realtime upstream leaked xai-provider-secret-123456'), {
        statusCode: 502,
      }),
      path: '/v1/realtime',
      expected: {
        statusCode: 502,
        protocol: 'openai',
        type: 'realtime_error',
        message: 'Realtime proxy request failed.',
      },
      forbidden: ['xai-provider-secret-123456'],
    },
    {
      name: 'validation JSON parse 400',
      exception: Object.assign(new SyntaxError('Unexpected token with sk-json-secret-token'), {
        status: 400,
        type: 'entity.parse.failed',
      }),
      path: '/v1/messages',
      expected: {
        statusCode: 400,
        protocol: 'anthropic',
        type: 'invalid_request_error',
        message: 'Request body is not valid JSON.',
      },
      forbidden: ['sk-json-secret-token'],
    },
    {
      name: 'payload too large 413',
      exception: {
        statusCode: 413,
        type: 'entity.too.large',
        message: 'payload included password=secret-value',
        limit: 1024,
        length: 2048,
      },
      path: '/v1/chat/completions',
      expected: {
        statusCode: 413,
        protocol: 'openai',
        type: 'payload_too_large',
        message: 'Request body is too large.',
      },
      expectedDetails: {
        source_type: 'entity.too.large',
        limit: 1024,
        length: 2048,
      },
      forbidden: ['password=secret-value'],
    },
    {
      name: 'budget 429',
      exception: new BudgetExceededError('tokens', 1200, 1000),
      path: '/v1/chat/completions',
      expected: {
        statusCode: 429,
        protocol: 'openai',
        type: 'budget_exceeded',
        code: 'tokens',
      },
      expectedDetails: {
        budget_type: 'tokens',
      },
      forbidden: [],
    },
    {
      name: 'unexpected messages 500',
      exception: new Error('database password leaked in stack context'),
      path: '/v1/messages',
      expected: {
        statusCode: 500,
        protocol: 'anthropic',
        type: 'internal_error',
        message: 'Gateway request failed.',
      },
      forbidden: ['database password'],
    },
  ])('maps $name into the stable public error contract', (testCase) => {
    const mapped = mapPublicGatewayError(
      testCase.exception,
      mockReq(testCase.path, { 'x-request-id': 'req_public_matrix' }),
    );

    expect(mapped).toMatchObject({
      ...testCase.expected,
      requestId: 'req_public_matrix',
    });
    if (testCase.expectedDetails) {
      expect(mapped.details).toMatchObject(testCase.expectedDetails);
    }
    const serialized = JSON.stringify(mapped);
    for (const forbidden of testCase.forbidden) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('maps budget exceeded errors into a stable 429 public contract', () => {
    const mapped = mapPublicGatewayError(
      new BudgetExceededError('tokens', 1200, 1000),
      mockReq('/v1/chat/completions'),
    );

    expect(mapped).toMatchObject({
      statusCode: 429,
      protocol: 'openai',
      type: 'budget_exceeded',
      code: 'tokens',
      requestId: expect.any(String),
    });
    expect(mapped.details).toMatchObject({
      budget_type: 'tokens',
    });
  });

  it('keeps Anthropic-compatible protocol mapping for /v1/messages parser errors', () => {
    const parserError = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      status: 400,
      type: 'entity.parse.failed',
    });

    const mapped = mapPublicGatewayError(parserError, mockReq('/v1/messages'));

    expect(mapped).toMatchObject({
      statusCode: 400,
      protocol: 'anthropic',
      type: 'invalid_request_error',
      message: 'Request body is not valid JSON.',
    });
  });

  it('adds the MCP compatibility request-id header on gateway-generated errors', () => {
    const res = mockRes();

    sendMappedPublicErrorResponse(
      res,
      mockReq('/mcp/local-docs'),
      new Error('socket closed'),
      { fallbackMessage: 'MCP proxy request failed.' },
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'x-siftgate-mcp-request-id',
      expect.any(String),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          request_id: expect.any(String),
        }),
      }),
    );
  });

  it('honors explicit status/type overrides for specialized proxy paths', () => {
    const mapped = mapPublicGatewayError(
      new Error('provider video status endpoint failed'),
      mockReq('/v1/videos/job_123/content'),
      {
        statusCode: 502,
        type: 'video_proxy_error',
        requestId: 'req_video_123',
      },
    );

    expect(mapped).toMatchObject({
      statusCode: 502,
      protocol: 'openai',
      type: 'video_proxy_error',
      requestId: 'req_video_123',
    });
  });

  it('does not expose arbitrary internal error messages for unknown 5xx errors', () => {
    const mapped = mapPublicGatewayError(
      new Error('database password leaked in stack context'),
      mockReq('/v1/chat/completions'),
    );

    expect(mapped).toMatchObject({
      statusCode: 500,
      type: 'internal_error',
      message: 'Gateway request failed.',
    });
    expect(mapped.message).not.toContain('database password');
  });

  it('preserves explicitly public gateway error messages', () => {
    const mapped = mapPublicGatewayError(
      new PublicGatewayError('Provider capacity exhausted.', {
        statusCode: 503,
        type: 'upstream_error',
        code: 'provider_unavailable',
      }),
      mockReq('/v1/chat/completions'),
    );

    expect(mapped).toMatchObject({
      statusCode: 503,
      type: 'upstream_error',
      code: 'provider_unavailable',
      message: 'Provider capacity exhausted.',
    });
  });
});
