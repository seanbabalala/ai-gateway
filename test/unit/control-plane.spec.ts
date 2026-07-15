import { mockConfigService } from '../helpers';
import { ControlPlaneClientService } from '../../src/control-plane/control-plane-client.service';
import { GatewayRegistrationService } from '../../src/control-plane/gateway-registration.service';
import { PolicySyncService } from '../../src/control-plane/policy-sync.service';
import { TelemetryUploaderService } from '../../src/control-plane/telemetry-uploader.service';
import { CallLog } from '../../src/database/entities/call-log.entity';

function makeCallLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 1,
    request_id: 'req_123',
    timestamp: new Date('2026-04-30T00:00:00.000Z'),
    source_format: 'chat_completions',
    tier: 'standard',
    score: 0.12,
    node_id: 'openai',
    model: 'gpt-4o-mini',
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.0002,
    latency_ms: 850,
    status_code: 200,
    is_fallback: false,
    fallback_reason: null,
    session_key: null,
    error: null,
    api_key_name: 'prod',
    api_key_id: 'key_123',
    retry_count: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    experiment_group: null,
    ...overrides,
  } as CallLog;
}

function mockEnabledControlPlaneConfig(
  overrides: Record<string, unknown> = {},
): { config: any; unsubscribe: jest.Mock } {
  const unsubscribe = jest.fn();
  const config = mockConfigService({
    controlPlane: {
      enabled: true,
      url: 'https://cloud.example.com',
      gateway_id: 'gw_prod',
      registration_token: 'gw_reg_test',
      telemetry: {
        upload_interval_seconds: 5,
        include_prompt: false,
        include_response: false,
      },
    },
    onReloadSuccess: jest.fn().mockReturnValue({ unsubscribe }),
    ...overrides,
  });
  return { config, unsubscribe };
}

describe('ControlPlaneClientService', () => {
  it('is disabled when control_plane.enabled is false', () => {
    const client = new ControlPlaneClientService(mockConfigService());
    expect(client.enabled).toBe(false);
  });

  it('registers with the configured control plane without provider secrets', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'ws_123',
        gateway_id: 'gw_prod',
        access_token: 'cp_access',
      }),
    });
    global.fetch = fetchMock as never;

    const client = new ControlPlaneClientService(mockConfigService({
      controlPlane: {
        enabled: true,
        url: 'https://cloud.example.com',
        gateway_id: 'gw_prod',
        registration_token: 'gw_reg_test',
        telemetry: {
          upload_interval_seconds: 30,
          include_prompt: false,
          include_response: false,
        },
      },
    }));

    await expect(client.register()).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.stringify((init as RequestInit).body)).not.toContain('api_key');
    expect(JSON.stringify((init as RequestInit).body)).not.toContain('sk-');
    global.fetch = originalFetch;
  });

  it('times out control plane requests with the shared fetch helper', async () => {
    jest.useFakeTimers();
    const originalFetch = global.fetch;
    const fetchMock = jest.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );
    global.fetch = fetchMock as never;

    try {
      const client = new ControlPlaneClientService(mockConfigService({
        controlPlane: {
          enabled: true,
          url: 'https://cloud.example.com',
          gateway_id: 'gw_prod',
          registration_token: 'gw_reg_test',
          telemetry: {
            upload_interval_seconds: 30,
            include_prompt: false,
            include_response: false,
          },
        },
      }));

      const result = client.register();
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe(false);
      const [, init] = fetchMock.mock.calls[0];
      expect(init).toEqual(expect.objectContaining({
        signal: expect.any(AbortSignal),
      }));
    } finally {
      global.fetch = originalFetch;
      jest.useRealTimers();
    }
  });

  it('clears registration state after a successful config reload', async () => {
    let reloadHandler: (() => void) | undefined;
    const config = mockConfigService({
      controlPlane: {
        enabled: true,
        url: 'https://cloud.example.com',
        gateway_id: 'gw_prod',
        registration_token: 'gw_reg_test',
        telemetry: {
          upload_interval_seconds: 30,
          include_prompt: false,
          include_response: false,
        },
      },
      onReloadSuccess: jest.fn().mockImplementation((handler: () => void) => {
        reloadHandler = handler;
        return { unsubscribe: jest.fn() };
      }),
    });
    const client = new ControlPlaneClientService(config);

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        workspace_id: 'ws_123',
        gateway_id: 'gw_prod',
        access_token: 'cp_access',
      }),
    }) as never;

    try {
      client.onModuleInit();
      await client.register();
      expect(client.state.registered).toBe(true);

      reloadHandler?.();

      expect(client.state.registered).toBe(false);
    } finally {
      global.fetch = originalFetch;
      client.onModuleDestroy();
    }
  });
});

describe('TelemetryUploaderService', () => {
  it('builds privacy-preserving metadata from call logs', async () => {
    const client = {
      enabled: true,
      state: { workspaceId: 'ws_123', gatewayId: 'gw_prod', registered: true },
      uploadTelemetry: jest.fn().mockResolvedValue(true),
    };
    const uploader = new TelemetryUploaderService(mockConfigService(), client as never);

    uploader.enqueue(makeCallLog(), {
      domainHint: 'backend',
      modalities: ['text'],
      policyHits: ['budget-ok'],
    });
    await uploader.flush();

    expect(client.uploadTelemetry).toHaveBeenCalledWith([
      expect.objectContaining({
        workspace_id: 'ws_123',
        gateway_id: 'gw_prod',
        request_id: 'req_123',
        node_id: 'openai',
        model: 'gpt-4o-mini',
        domain_hint: 'backend',
        modality: ['text'],
        policy_hits: ['budget-ok'],
      }),
    ]);
    const payload = JSON.stringify(client.uploadTelemetry.mock.calls[0][0]);
    expect(payload).not.toContain('prompt');
    expect(payload).not.toContain('response');
    expect(payload).not.toContain('sk-');
  });

  it('does not enqueue anything when the control plane is disabled', async () => {
    const client = {
      enabled: false,
      state: { workspaceId: null, gatewayId: 'default', registered: false },
      uploadTelemetry: jest.fn(),
    };
    const uploader = new TelemetryUploaderService(mockConfigService(), client as never);

    uploader.enqueue(makeCallLog());
    await uploader.flush();

    expect(uploader.getQueueSize()).toBe(0);
    expect(client.uploadTelemetry).not.toHaveBeenCalled();
  });
});

describe('Control-plane timer lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('clears the gateway heartbeat interval on module destroy', () => {
    const { config, unsubscribe } = mockEnabledControlPlaneConfig();
    const client = {
      enabled: true,
      state: { workspaceId: 'ws_123', gatewayId: 'gw_prod', registered: true },
      ensureRegistered: jest.fn().mockResolvedValue(true),
      heartbeat: jest.fn().mockResolvedValue(true),
    };
    const service = new GatewayRegistrationService(config, client as never);

    service.onModuleInit();
    expect(client.ensureRegistered).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    service.onModuleDestroy();
    jest.advanceTimersByTime(90_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('clears the policy sync interval on module destroy', () => {
    const { config, unsubscribe } = mockEnabledControlPlaneConfig();
    const client = {
      enabled: true,
      fetchLatestPolicy: jest.fn().mockResolvedValue({ version: 1 }),
    };
    const service = new PolicySyncService(config, client as never);
    const refreshSpy = jest.spyOn(service, 'refresh');

    service.onModuleInit();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(refreshSpy).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    jest.advanceTimersByTime(180_000);

    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('clears the telemetry upload interval on module destroy', () => {
    const { config, unsubscribe } = mockEnabledControlPlaneConfig();
    const client = {
      enabled: true,
      state: { workspaceId: 'ws_123', gatewayId: 'gw_prod', registered: true },
      uploadTelemetry: jest.fn().mockResolvedValue(true),
    };
    const uploader = new TelemetryUploaderService(config, client as never);
    const flushSpy = jest.spyOn(uploader, 'flush');

    uploader.onModuleInit();
    jest.advanceTimersByTime(5_000);
    expect(flushSpy).toHaveBeenCalledTimes(1);

    uploader.onModuleDestroy();
    jest.advanceTimersByTime(15_000);

    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
