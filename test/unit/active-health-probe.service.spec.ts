import { ActiveHealthProbeService } from '../../src/routing/active-health-probe.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '../../src/routing/circuit-breaker.service';
import { NodeConfig } from '../../src/config/gateway.config';

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.example.com',
    endpoint: '/v1/chat/completions',
    api_key: 'sk-test',
    auth_type: 'bearer',
    models: ['gpt-4o'],
    timeout_ms: 10_000,
    ...overrides,
  };
}

function makeService(nodes: NodeConfig[], alerts: { emit: jest.Mock } = { emit: jest.fn() }) {
  const config = {
    nodes,
    getNode: jest.fn((nodeId: string) => nodes.find((node) => node.id === nodeId)),
  };
  const circuitBreaker = new CircuitBreakerService();
  const service = new ActiveHealthProbeService(config as any, circuitBreaker, alerts as any);
  return { service, circuitBreaker, config, alerts };
}

function mockFetchResponse(status: number, body = ''): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(body),
  });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('ActiveHealthProbeService', () => {
  it('does not probe disabled nodes', () => {
    global.fetch = jest.fn() as any;
    const { service } = makeService([
      makeNode({ health_check: { enabled: false, path: '/healthz' } }),
    ]);

    service.onModuleInit();
    const status = service.getNodeStatus('openai');
    service.onModuleDestroy();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(status.enabled).toBe(false);
    expect(status.status).toBe('disabled');
    expect(status.last_checked_at).toBeNull();
  });

  it('records a successful HEAD probe without sending a body', async () => {
    const fetchMock = mockFetchResponse(204);
    global.fetch = fetchMock as any;
    const { service, circuitBreaker } = makeService([
      makeNode({
        models: ['gpt-4o', 'gpt-4o-mini'],
        health_check: {
          enabled: true,
          method: 'HEAD',
          path: '/healthz',
          timeout_ms: 500,
        },
      }),
    ]);

    const status = await service.probeNode('openai');
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.example.com/healthz');
    expect(init.method).toBe('HEAD');
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(status.status).toBe('healthy');
    expect(status.failure_reason).toBeNull();
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o')).toBe(CircuitState.CLOSED);
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o-mini')).toBe(CircuitState.CLOSED);
  });

  it('marks all node models unavailable when a probe fails', async () => {
    global.fetch = mockFetchResponse(503, 'maintenance') as any;
    const alerts = { emit: jest.fn() };
    const { service, circuitBreaker } = makeService([
      makeNode({
        models: ['gpt-4o', 'gpt-4o-mini'],
        health_check: { enabled: true, method: 'GET', path: '/ready' },
      }),
    ], alerts);

    const status = await service.probeNode('openai');

    expect(status.status).toBe('unhealthy');
    expect(status.failure_reason).toContain('HTTP 503');
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o')).toBe(CircuitState.OPEN);
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o-mini')).toBe(CircuitState.OPEN);
    expect(alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'node_down',
        dedupeKey: 'openai',
      }),
    );
  });

  it('closes circuits again after a recovery probe succeeds', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: jest.fn().mockResolvedValue('bad gateway'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('ok'),
    });
    global.fetch = fetchMock as any;
    const alerts = { emit: jest.fn() };
    const { service, circuitBreaker } = makeService([
      makeNode({ health_check: { enabled: true, method: 'GET', path: '/ready' } }),
    ], alerts);

    await service.probeNode('openai');
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o')).toBe(CircuitState.OPEN);

    const recovered = await service.probeNode('openai');

    expect(recovered.status).toBe('healthy');
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o')).toBe(CircuitState.CLOSED);
    expect(alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'node_recovered',
        dedupeKey: 'openai',
      }),
    );
  });

  it('records timeout failures and opens the circuit', async () => {
    global.fetch = jest.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    })) as any;
    const { service, circuitBreaker } = makeService([
      makeNode({ health_check: { enabled: true, method: 'GET', path: '/slow', timeout_ms: 1 } }),
    ]);

    const status = await service.probeNode('openai');

    expect(status.status).toBe('unhealthy');
    expect(status.failure_reason).toBe('Timed out after 1ms');
    expect(circuitBreaker.getCircuitState('openai', 'gpt-4o')).toBe(CircuitState.OPEN);
  });

  it('uses lightweight_model for synthetic POST probes', async () => {
    const fetchMock = mockFetchResponse(200, '{}');
    global.fetch = fetchMock as any;
    const { service } = makeService([
      makeNode({
        protocol: 'responses',
        endpoint: '/v1/responses',
        models: ['expensive-model'],
        health_check: {
          enabled: true,
          lightweight_model: 'cheap-health-model',
        },
      }),
    ]);

    const status = await service.probeNode('openai');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(init.method).toBe('POST');
    expect(body.model).toBe('cheap-health-model');
    expect(body.max_output_tokens).toBe(1);
    expect(JSON.stringify(body)).toContain('health check');
    expect(JSON.stringify(body)).not.toContain('hi');
    expect(status.status).toBe('healthy');
  });

  it('uses custom header auth for active health probes', async () => {
    const fetchMock = mockFetchResponse(204);
    global.fetch = fetchMock as any;
    const { service } = makeService([
      makeNode({
        auth_type: 'custom-header',
        auth_header_name: 'api-key',
        auth_header_prefix: 'Token',
        api_key: 'sk-custom-health',
        health_check: {
          enabled: true,
          method: 'HEAD',
          path: '/healthz',
        },
      }),
    ]);

    const status = await service.probeNode('openai');
    const [, init] = fetchMock.mock.calls[0];

    expect(init.headers['api-key']).toBe('Token sk-custom-health');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['x-api-key']).toBeUndefined();
    expect(status.status).toBe('healthy');
  });
});
