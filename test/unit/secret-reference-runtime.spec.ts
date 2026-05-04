import { SecretReferenceResolverService } from '../../src/config/secret-reference-resolver.service';
import { ProviderClientService } from '../../src/providers/provider-client.service';
import { TelemetryService } from '../../src/telemetry/telemetry.service';
import { Tier, CanonicalRequest } from '../../src/canonical/canonical.types';
import { ActiveHealthProbeService } from '../../src/routing/active-health-probe.service';
import { CircuitBreakerService } from '../../src/routing/circuit-breaker.service';
import { ControlPlaneClientService } from '../../src/control-plane/control-plane-client.service';
import { RealtimeProxyService } from '../../src/realtime/realtime-proxy.service';
import { NodeConfig } from '../../src/config/gateway.config';

function makeResolver() {
  return new SecretReferenceResolverService({
    secretManager: {
      cache_ttl_seconds: 0,
      failure_policy: 'fail_closed',
      backends: {
        env: { enabled: true },
        vault: {
          enabled: false,
          address: '',
          token: '',
          mount: 'secret',
          kv_version: 2,
          timeout_ms: 5000,
        },
        aws_sm: {
          enabled: false,
          region: '',
          endpoint: '',
          access_key_id: '',
          secret_access_key: '',
          session_token: '',
          timeout_ms: 5000,
        },
        gcp_sm: {
          enabled: false,
          project_id: '',
          endpoint: '',
          access_token: '',
          use_metadata: true,
          timeout_ms: 5000,
        },
      },
    },
  } as any);
}

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.example.com',
    endpoint: '/v1/chat/completions',
    api_key: '${env:SIFTGATE_PROVIDER_SECRET}',
    auth_type: 'bearer',
    models: ['gpt-4o'],
    timeout_ms: 5000,
    headers: {
      'X-Provider-Org': '${env:SIFTGATE_PROVIDER_ORG}',
    },
    ...overrides,
  };
}

const routingMeta = {
  tier: 'standard' as Tier,
  score: 0.1,
  is_fallback: false,
};

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.SIFTGATE_PROVIDER_SECRET = 'sk-runtime';
  process.env.SIFTGATE_PROVIDER_ORG = 'org-runtime';
  process.env.SIFTGATE_CONTROL_TOKEN = 'control-runtime';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.SIFTGATE_PROVIDER_SECRET;
  delete process.env.SIFTGATE_PROVIDER_ORG;
  delete process.env.SIFTGATE_CONTROL_TOKEN;
});

describe('secret reference runtime integration', () => {
  it('resolves provider api_key and headers before upstream forwarding', async () => {
    const node = makeNode();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        id: 'chatcmpl-secret',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    global.fetch = fetchMock as any;
    const service = new ProviderClientService(
      { getNode: jest.fn().mockReturnValue(node) } as any,
      new TelemetryService(),
      undefined,
      makeResolver(),
    );
    const canonical: CanonicalRequest = {
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
      metadata: { source_format: 'chat_completions', raw_headers: {} },
    };

    await service.forward(canonical, 'openai', 'gpt-4o', routingMeta);

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer sk-runtime',
        'X-Provider-Org': 'org-runtime',
      }),
    );
  });

  it('resolves secrets for active health probes', async () => {
    const node = makeNode({
      health_check: { enabled: true, method: 'HEAD', path: '/healthz' },
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: jest.fn().mockResolvedValue(''),
    });
    global.fetch = fetchMock as any;
    const service = new ActiveHealthProbeService(
      {
        nodes: [node],
        getNode: jest.fn().mockReturnValue(node),
      } as any,
      new CircuitBreakerService(),
      undefined,
      makeResolver(),
    );

    await service.probeNode('openai');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer sk-runtime',
        'X-Provider-Org': 'org-runtime',
      }),
    );
  });

  it('resolves realtime upstream auth headers without exposing the secret in status', async () => {
    const service = new RealtimeProxyService(
      {
        realtime: {
          enabled: true,
          path: '/v1/realtime',
          max_connections: 25,
          max_connections_per_node: 25,
          idle_timeout_ms: 300000,
          upstream_connect_timeout_ms: 10000,
          max_session_ms: 1800000,
        },
      } as any,
      {} as any,
      {} as any,
      makeResolver(),
    );

    const headers = await (service as any).buildUpstreamHeaders(makeNode());

    expect(headers.Authorization).toBe('Bearer sk-runtime');
    expect(headers['X-Provider-Org']).toBe('org-runtime');
    expect(JSON.stringify(service.getStatus())).not.toContain('sk-runtime');
  });

  it('resolves control-plane registration token at send time', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        workspace_id: 'ws_123',
        gateway_id: 'gw_123',
        access_token: 'access-token',
      }),
    });
    global.fetch = fetchMock as any;
    const service = new ControlPlaneClientService(
      {
        controlPlane: {
          enabled: true,
          url: 'https://cloud.example.com',
          gateway_id: 'gw_123',
          registration_token: '${env:SIFTGATE_CONTROL_TOKEN}',
          telemetry: {
            upload_interval_seconds: 30,
            include_prompt: false,
            include_response: false,
          },
        },
      } as any,
      makeResolver(),
    );

    await expect(service.register()).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer control-runtime',
      }),
    );
    expect((init as RequestInit).body).not.toContain('control-runtime');
  });
});
