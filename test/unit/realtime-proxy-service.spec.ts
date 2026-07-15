import { RealtimeProxyService } from '../../src/realtime/realtime-proxy.service';

const realtimeConfig = {
  enabled: true,
  path: '/v1/realtime',
  max_connections: 25,
  max_connections_per_node: 25,
  idle_timeout_ms: 300_000,
  upstream_connect_timeout_ms: 10_000,
  max_session_ms: 1_800_000,
  default_node: '',
  default_model: 'auto',
};

const realtimeNode = {
  id: 'mock-openai',
  name: 'Mock OpenAI',
  protocol: 'chat_completions',
  base_url: 'https://api.example.com',
  endpoint: '/v1/chat/completions',
  api_key: 'sk-config-secret',
  models: ['gpt-4o'],
  realtime_models: ['gpt-4o-realtime-preview'],
};

function makeService(stateBackend?: unknown, telemetry?: unknown): RealtimeProxyService {
  return new RealtimeProxyService(
    {
      realtime: realtimeConfig,
      nodes: [realtimeNode],
      getNode: jest.fn((nodeId: string) =>
        nodeId === realtimeNode.id ? realtimeNode : undefined,
      ),
      resolveRealtimeModel: jest.fn(),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    stateBackend as any,
    telemetry as any,
  );
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-test-session',
    requestId: 'rt_test_request',
    socket: {
      destroyed: false,
      write: jest.fn(),
      end: jest.fn(),
    },
    target: {
      node: realtimeNode,
      model: 'gpt-4o-realtime-preview',
      mode: 'direct',
    },
    apiKey: {
      name: 'Gateway key',
      namespace_id: null,
      workspace_id: 'workspace-a',
    },
    workspaceId: 'workspace-a',
    startedAt: Date.now() - 1000,
    lastActivityAt: Date.now() - 500,
    clientMessages: 0,
    upstreamMessages: 0,
    clientBytes: 0,
    upstreamBytes: 0,
    closed: false,
    buffer: Buffer.alloc(0),
    fragments: [],
    fragmentOpcode: null,
    pendingClientMessages: [],
    ...overrides,
  };
}

describe('RealtimeProxyService', () => {
  it.each([
    {
      statusCode: 429,
      message: 'Realtime connection limit exceeded',
      expectedType: 'rate_limit_exceeded',
    },
    {
      statusCode: 500,
      message: 'Realtime upgrade failed',
      expectedType: 'realtime_error',
    },
  ])(
    'writes stable JSON upgrade errors for HTTP $statusCode',
    ({ statusCode, message, expectedType }) => {
      const service = makeService();
      const socket = {
        destroyed: false,
        write: jest.fn(),
        destroy: jest.fn(),
      };

      (service as any).rejectUpgrade(socket, statusCode, message);

      const raw = socket.write.mock.calls[0][0] as string;
      const body = JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4));
      expect(raw).toContain(`HTTP/1.1 ${statusCode}`);
      expect(raw).toContain('Content-Type: application/json');
      expect(body).toEqual({
        error: {
          message,
          type: expectedType,
        },
      });
      expect(socket.destroy).toHaveBeenCalled();
    },
  );

  it.each(['client_error', 'upstream_error'] as const)(
    'redacts secret-bearing %s strings before recording close metadata',
    (reason) => {
      const stateBackend = {
        isRedisConfigured: jest.fn().mockReturnValue(true),
        setHashJson: jest.fn().mockResolvedValue(undefined),
      };
      const telemetry = { recordErrorRedaction: jest.fn() };
      const service = makeService(stateBackend, telemetry);
      const session = makeSession({ id: `rt-${reason}` });
      const secretError = [
        'Authorization failed for Bearer gw_sk_live_bearer_secret_123456',
        'gateway key gw_sk_live_gateway_secret_123456',
        'provider keys sk-provider-secret-123456 gsk-provider-secret-123456 xai-provider-secret-123456',
      ].join('; ');

      (service as any).closeSession(session, reason, 1011, secretError);

      const status = service.getStatus('workspace-a');
      const nodeStatus = service.getNodeStatus('mock-openai', 'workspace-a');
      const recent = status.recent[0];
      const persisted = stateBackend.setHashJson.mock.calls[0][3];
      const serializedMetadata = JSON.stringify({ nodeStatus, persisted, recent });

      expect(recent).toMatchObject({
        close_reason: reason,
        error: expect.any(String),
      });
      expect(nodeStatus.last_error).toBe(recent.error);
      expect(persisted.last_error).toBe(recent.error);
      expect(persisted.last_close_reason).toBe(reason);
      expect(serializedMetadata).toContain('Bearer [redacted]');
      expect(serializedMetadata).toContain('gw_sk_[redacted]');
      expect(serializedMetadata).toContain('sk-[redacted]');
      expect(serializedMetadata).toContain('[redacted-provider-key]');
      expect(serializedMetadata).not.toContain('gw_sk_live_bearer_secret_123456');
      expect(serializedMetadata).not.toContain('gw_sk_live_gateway_secret_123456');
      expect(serializedMetadata).not.toContain('sk-provider-secret-123456');
      expect(serializedMetadata).not.toContain('gsk-provider-secret-123456');
      expect(serializedMetadata).not.toContain('xai-provider-secret-123456');
      expect(telemetry.recordErrorRedaction).toHaveBeenCalledWith({
        surface: 'realtime',
        reason: 'bearer_token',
      });
      expect(telemetry.recordErrorRedaction).toHaveBeenCalledWith({
        surface: 'realtime',
        reason: 'provider_key',
      });
      expect(JSON.stringify(telemetry.recordErrorRedaction.mock.calls)).not.toContain(
        'gw_sk_live_gateway_secret_123456',
      );
    },
  );
});
