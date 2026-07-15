import { ProviderCompatibilityService } from '../../src/dashboard/provider-compatibility.service';

const workspaceContext = {
  currentWorkspaceId: jest.fn(() => 'default-workspace'),
};

function makeService(repo: ReturnType<typeof makeRepo>, telemetry?: unknown) {
  return new ProviderCompatibilityService(
    workspaceContext as any,
    repo as any,
    undefined,
    telemetry as any,
  );
}

function makeRepo() {
  const rows: any[] = [];
  const matchesWhere = (row: any, where: any): boolean => {
    if (Array.isArray(where)) return where.some((entry) => matchesWhere(row, entry));
    return Object.entries(where || {}).every(([key, value]) => {
      if (key === 'workspace_id' && value && typeof value === 'object') {
        return row.workspace_id === null || row.workspace_id === undefined;
      }
      if (value && typeof value === 'object' && '_type' in (value as any)) {
        if ((value as any)._type === 'in') {
          return ((value as any)._value as unknown[]).includes(row[key]);
        }
        if ((value as any)._type === 'isNull') {
          return row[key] === null || row[key] === undefined;
        }
      }
      if (value && typeof value === 'object' && '_value' in (value as any)) {
        return row[key] === (value as any)._value;
      }
      return row[key] === value;
    });
  };
  return {
    rows,
    find: jest.fn(async (options?: any) =>
      options?.where ? rows.filter((row) => matchesWhere(row, options.where)) : rows,
    ),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((row) => matchesWhere(row, where)) || null,
    ),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      const idx = rows.findIndex((row) => row.node_id === value.node_id && row.capability === value.capability);
      const saved = { id: idx >= 0 ? rows[idx].id : rows.length + 1, ...value };
      if (idx >= 0) rows[idx] = saved;
      else rows.push(saved);
      return saved;
    }),
  };
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'chat_completions',
    base_url: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    api_key: 'sk-test',
    models: ['gpt-4o-mini'],
    timeout_ms: 10_000,
    ...overrides,
  } as any;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  workspaceContext.currentWorkspaceId.mockReturnValue('default-workspace');
  jest.restoreAllMocks();
});

describe('ProviderCompatibilityService', () => {
  it('builds an untested matrix without touching provider secrets', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const matrix = await service.matrixForNode(node({
      embedding_models: ['text-embedding-3-small'],
      realtime_models: ['gpt-4o-realtime-preview'],
    }));

    expect(matrix.find((item) => item.capability === 'chat')).toMatchObject({
      configured: true,
      tested: false,
    });
    expect(matrix.find((item) => item.capability === 'embeddings')).toMatchObject({
      configured: true,
      tested: false,
    });
    expect(matrix.find((item) => item.capability === 'realtime')).toMatchObject({
      configured: true,
      requires_confirmation: true,
    });
    expect(JSON.stringify(matrix)).not.toContain('sk-test');
  });

  it('marks capabilities unsupported by the node compatibility profile', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    const matrix = await service.matrixForNode(node({
      compatibility_profile: ['openai_compatible'],
      image_models: ['gpt-image-1'],
      batch_endpoint: '/v1/batches',
    }));

    expect(matrix.find((item) => item.capability === 'images')).toMatchObject({
      configured: false,
      profile_supported: false,
      compatibility_profiles: ['openai_compatible'],
    });
    expect(matrix.find((item) => item.capability === 'batch')).toMatchObject({
      configured: true,
      profile_supported: true,
      compatibility_profiles: ['openai_compatible'],
    });
  });

  it('runs safe low-token requests for text capabilities', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: jest.fn().mockResolvedValue('{"ok":true}'),
    });
    global.fetch = fetchMock as any;

    const result = await service.runNodeMatrix(node(), { capabilities: ['chat'] });

    expect(result.success).toBe(true);
    expect(result.matrix.find((item) => item.capability === 'chat')).toMatchObject({
      tested: true,
      last_status: 'pass',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      model: 'gpt-4o-mini',
      max_tokens: 1,
    }));
    expect(JSON.stringify(repo.rows)).not.toContain('{"ok":true}');
  });

  it('redacts compatibility failure reasons before storing matrix metadata', async () => {
    const repo = makeRepo();
    const telemetry = { recordErrorRedaction: jest.fn() };
    const service = makeService(repo, telemetry);
    const secretMessage =
      'provider rejected Bearer gw_sk_live_gateway_secret_123456 api_key=sk-query-secret-token gsk-provider-secret-token';
    global.fetch = jest.fn().mockRejectedValue(new Error(secretMessage));

    const result = await service.runNodeMatrix(node(), { capabilities: ['chat'] });
    const item = result.matrix.find((entry) => entry.capability === 'chat');
    const serialized = JSON.stringify({ item, rows: repo.rows });

    expect(item?.last_status).toBe('fail');
    expect(item?.failure_reason).toContain('Bearer [redacted]');
    expect(item?.failure_reason).toContain('api_key=[redacted]');
    expect(item?.failure_reason).toContain('[redacted-provider-key]');
    expect(serialized).not.toContain('gw_sk_live_gateway_secret_123456');
    expect(serialized).not.toContain('sk-query-secret-token');
    expect(serialized).not.toContain('gsk-provider-secret-token');
    expect(telemetry.recordErrorRedaction).toHaveBeenCalledWith({
      surface: 'compatibility',
      reason: 'bearer_token',
    });
    expect(telemetry.recordErrorRedaction).toHaveBeenCalledWith({
      surface: 'compatibility',
      reason: 'provider_key',
    });
    expect(JSON.stringify(telemetry.recordErrorRedaction.mock.calls)).not.toContain(
      'gw_sk_live_gateway_secret_123456',
    );
  });

  it('uses upstream model aliases for provider safe requests', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: jest.fn().mockResolvedValue('{"ok":true}'),
    });
    global.fetch = fetchMock as any;

    const result = await service.runNodeMatrix(
      node({
        protocol: 'messages',
        endpoint: '/v1/messages',
        models: ['claude-opus-4-7-enterprise'],
        upstream_model_aliases: {
          'claude-opus-4-7-enterprise': 'claude-opus-4-7',
        },
        compatibility_profile: ['anthropic_messages_compatible'],
        auth_type: 'bearer',
      }),
      { capabilities: ['messages'] },
    );

    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(
      expect.objectContaining({
        model: 'claude-opus-4-7',
        max_tokens: 1,
      }),
    );
  });

  it('uses node timeout and custom auth headers for safe requests', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: jest.fn().mockResolvedValue('{"ok":true}'),
    });
    global.fetch = fetchMock as any;

    await service.runNodeMatrix(
      node({
        auth_type: 'custom-header',
        auth_header_name: 'x-provider-token',
        auth_header_prefix: 'Token',
        timeout_ms: 1234,
      }),
      { capabilities: ['chat'] },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      'x-provider-token': 'Token sk-test',
    });
    expect(init.headers.Authorization).toBeUndefined();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
  });

  it('uses the minimum portable Responses output token limit', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: jest.fn().mockResolvedValue('{"ok":true}'),
    });
    global.fetch = fetchMock as any;

    const result = await service.runNodeMatrix(
      node({
        protocol: 'responses',
        endpoint: '/v1/responses',
        models: ['gpt-4.1'],
      }),
      { capabilities: ['responses'] },
    );

    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(expect.objectContaining({
      model: 'gpt-4.1',
      max_output_tokens: 16,
    }));
  });

  it('uses endpoint probes for realtime by default', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    const fetchMock = jest.fn().mockResolvedValue({
      status: 405,
      text: jest.fn().mockResolvedValue('method not allowed'),
    });
    global.fetch = fetchMock as any;

    const result = await service.runNodeMatrix(
      node({ realtime_models: ['gpt-4o-realtime-preview'] }),
      { capabilities: ['realtime'] },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('HEAD');
    expect(init.body).toBeUndefined();
    expect(result.matrix.find((item) => item.capability === 'realtime')).toMatchObject({
      tested: true,
      last_status: 'warning',
      test_mode: 'endpoint_probe',
    });
  });

  it('emits non-blocking diagnostics for failed or untested configured capabilities', async () => {
    const repo = makeRepo();
    const service = makeService(repo);
    global.fetch = jest.fn().mockResolvedValue({
      status: 401,
      text: jest.fn().mockResolvedValue('Unauthorized sk-secret'),
    }) as any;

    await service.runNodeMatrix(node(), { capabilities: ['chat'] });
    const matrices = await service.matrixForNodes([node({ embedding_models: ['text-embedding-3-small'] })]);
    const diagnostics = service.compatibilityDiagnostics(matrices);

    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['provider_compatibility_failed', 'provider_compatibility_untested']),
    );
    expect(JSON.stringify(diagnostics)).not.toContain('sk-secret');
  });
});
