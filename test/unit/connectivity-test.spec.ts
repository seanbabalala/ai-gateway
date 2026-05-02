/**
 * Connectivity test (runConnectivityTest) — unit tests.
 *
 * Tests the dashboard's node connectivity checker: protocol body building,
 * auth header construction, HTTP status classification, network error handling,
 * extra headers merging, and URL cleanup.
 *
 * Mocks global `fetch` to simulate provider responses.
 */

import { DashboardController } from '../../src/dashboard/dashboard.controller';
import { TelemetryService } from '../../src/telemetry/telemetry.service';

// ── Minimal mock for DashboardController dependencies ──

function makeDashboard(configOverrides: Record<string, any> = {}): DashboardController {
  const config = {
    database: { log_retention_days: 0 },
    auth: { api_keys: [] },
    nodes: [],
    getNode: jest.fn().mockReturnValue(undefined),
    ...configOverrides,
  };
  const capabilityService = {} as any;
  const circuitBreaker = {} as any;
  const activeHealth = { getNodeStatus: jest.fn(), refreshSchedules: jest.fn() } as any;
  const budgetService = {} as any;
  const cacheService = {} as any;
  const logEventBus = {} as any;
  const gatewayApiKeys = {} as any;
  const dataSource = {} as any;
  const callLogRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    }),
  } as any;

  return new DashboardController(
    config as any, capabilityService, circuitBreaker, activeHealth, budgetService,
    cacheService, logEventBus, new TelemetryService(), gatewayApiKeys, dataSource, callLogRepo,
  );
}

// ── Mock fetch helper ──

function mockFetchResponse(
  status: number,
  body: string = '',
  ok?: boolean,
): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: ok ?? (status >= 200 && status < 300),
    status,
    text: jest.fn().mockResolvedValue(body),
  });
  return fn;
}

function mockFetchNetworkError(error: Error): jest.Mock {
  return jest.fn().mockRejectedValue(error);
}

// ── Access the private method via the public testNodeConnectivity ──

async function runTest(
  dashboard: DashboardController,
  params: Record<string, any>,
): Promise<any> {
  return (dashboard as any).runConnectivityTest(params);
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════
// Protocol Body Building
// ═══════════════════════════════════════════════════════════

describe('runConnectivityTest — protocol body building', () => {
  it('should build Anthropic messages body with max_tokens:16', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'messages', base_url: 'https://api.anthropic.com',
      endpoint: '/v1/messages', api_key: 'sk-ant-test', model: 'claude-3-opus',
    });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-3-opus');
    expect(body.max_tokens).toBe(16);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.stream).toBe(false);
  });

  it('should build OpenAI responses body with max_output_tokens:16', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'responses', base_url: 'https://api.openai.com',
      endpoint: '/v1/responses', api_key: 'sk-test', model: 'gpt-4.1',
    });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4.1');
    expect(body.max_output_tokens).toBe(16);
    expect(body.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message', role: 'user' }),
    ]));
  });

  it('should build chat_completions body as default', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(16);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

// ═══════════════════════════════════════════════════════════
// Auth Headers
// ═══════════════════════════════════════════════════════════

describe('runConnectivityTest — auth headers', () => {
  it('should use x-api-key for messages protocol by default', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'messages', base_url: 'https://api.anthropic.com',
      endpoint: '/v1/messages', api_key: 'sk-ant-123', model: 'claude-3',
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('sk-ant-123');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('should use Bearer for chat_completions by default', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer sk-test');
    expect(opts.headers['x-api-key']).toBeUndefined();
  });

  it('should use custom auth_type override', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://custom.com',
      endpoint: '/api', api_key: 'mykey', model: 'model',
      auth_type: 'x-api-key',
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['x-api-key']).toBe('mykey');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });
});

// ═══════════════════════════════════════════════════════════
// Extra Headers & URL Cleanup
// ═══════════════════════════════════════════════════════════

describe('runConnectivityTest — extra headers & URL cleanup', () => {
  it('should merge extra headers', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
      headers: { 'X-Custom': 'value' },
    });

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['X-Custom']).toBe('value');
  });

  it('should strip trailing slashes from base_url', async () => {
    const fetchMock = mockFetchResponse(200);
    global.fetch = fetchMock;
    const dashboard = makeDashboard();

    await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com///',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
  });
});

// ═══════════════════════════════════════════════════════════
// HTTP Status Code Classification
// ═══════════════════════════════════════════════════════════

describe('runConnectivityTest — HTTP status codes', () => {
  it('should return success for 200 OK', async () => {
    global.fetch = mockFetchResponse(200, '{"id":"msg_123"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('Connected successfully');
  });

  it('should return auth failure for 401', async () => {
    global.fetch = mockFetchResponse(401, 'Unauthorized');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'bad-key', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toContain('Authentication failed');
  });

  it('should return auth failure for 403', async () => {
    global.fetch = mockFetchResponse(403, 'Forbidden');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'bad-key', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.message).toContain('Authentication failed');
  });

  it('should return not found for 404', async () => {
    global.fetch = mockFetchResponse(404, 'Not Found');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/wrong/path', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.message).toContain('Endpoint not found');
  });

  it('should detect model-not-found for 400 with "model not found"', async () => {
    global.fetch = mockFetchResponse(400, '{"error":"The model `gpt-99` does not exist or model not found"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-99',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.message).toContain('not recognized');
  });

  it('should detect model-not-found for 422 with "not exist"', async () => {
    global.fetch = mockFetchResponse(422, '{"error":"model does not exist"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-99',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.message).toContain('not recognized');
  });

  it('should detect model-not-found for "invalid" + "model" in response', async () => {
    global.fetch = mockFetchResponse(400, '{"error":"invalid model specified"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'bad-model',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not recognized');
  });

  it('should return success with config tuning hint for 400 without model error', async () => {
    global.fetch = mockFetchResponse(400, '{"error":"max_tokens must be positive"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(400);
    expect(result.message).toContain('config tuning');
  });

  it('should return success with config tuning hint for 422 without model error', async () => {
    global.fetch = mockFetchResponse(422, '{"error":"invalid parameter"}');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(422);
    expect(result.message).toContain('config tuning');
  });

  it('should return success for 429 rate limited', async () => {
    global.fetch = mockFetchResponse(429, 'Rate limited');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(429);
    expect(result.message).toContain('Rate limited');
  });

  it('should return generic error for 500+', async () => {
    global.fetch = mockFetchResponse(500, 'Internal Server Error');
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.message).toContain('HTTP 500');
  });

  it('should truncate long response text to 200 chars for 5xx', async () => {
    const longText = 'A'.repeat(500);
    global.fetch = mockFetchResponse(502, longText);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.message.length).toBeLessThan(300); // 200 chars body + "Provider returned..." prefix
  });
});

// ═══════════════════════════════════════════════════════════
// Network Error Classification
// ═══════════════════════════════════════════════════════════

describe('runConnectivityTest — network errors', () => {
  it('should detect timeout/abort errors', async () => {
    const err = new Error('The operation was aborted');
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain('timed out');
  });

  it('should detect DNS resolution failure (ENOTFOUND)', async () => {
    const err = new Error('fetch failed');
    (err as any).cause = { message: 'getaddrinfo ENOTFOUND bad-host.example.com', code: 'ENOTFOUND' };
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://bad-host.example.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain('DNS resolution failed');
  });

  it('should detect connection refused (ECONNREFUSED)', async () => {
    const err = new Error('fetch failed');
    (err as any).cause = { message: 'connect ECONNREFUSED 127.0.0.1:443', code: 'ECONNREFUSED' };
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://localhost',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain('Connection refused');
  });

  it('should detect SSL/TLS errors', async () => {
    const err = new Error('fetch failed');
    (err as any).cause = { message: 'SSL routines: certificate verify failed', code: '' };
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://self-signed.example.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain('SSL/TLS error');
  });

  it('should detect TLS cert errors', async () => {
    const err = new Error('fetch failed');
    (err as any).cause = { message: 'unable to verify the first cert', code: '' };
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://bad-cert.example.com',
      endpoint: '/api', api_key: 'sk-test', model: 'model',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('SSL/TLS error');
  });

  it('should return generic connection error for unknown errors', async () => {
    const err = new Error('some unexpected network error');
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(0);
    expect(result.message).toContain('Connection error');
  });

  it('should use cause message in generic error when available', async () => {
    const err = new Error('fetch failed');
    (err as any).cause = { message: 'socket hang up', code: '' };
    global.fetch = mockFetchNetworkError(err);
    const dashboard = makeDashboard();

    const result = await runTest(dashboard, {
      protocol: 'chat_completions', base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions', api_key: 'sk-test', model: 'gpt-4o',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('socket hang up');
  });
});
