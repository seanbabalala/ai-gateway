import { BudgetExceededError } from '../../src/budget/budget.service';
import {
  mapPublicGatewayError,
  sendMappedPublicErrorResponse,
} from '../../src/http/public-error-handling';

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
});
