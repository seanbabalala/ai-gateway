import { ProviderCompatibilityService } from '../../src/dashboard/provider-compatibility.service';

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    find: jest.fn(async () => rows),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find((row) => row.node_id === where.node_id && row.capability === where.capability) || null,
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
  jest.restoreAllMocks();
});

describe('ProviderCompatibilityService', () => {
  it('builds an untested matrix without touching provider secrets', async () => {
    const repo = makeRepo();
    const service = new ProviderCompatibilityService(repo as any);

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

  it('runs safe low-token requests for text capabilities', async () => {
    const repo = makeRepo();
    const service = new ProviderCompatibilityService(repo as any);
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

  it('uses endpoint probes for realtime by default', async () => {
    const repo = makeRepo();
    const service = new ProviderCompatibilityService(repo as any);
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
    const service = new ProviderCompatibilityService(repo as any);
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
