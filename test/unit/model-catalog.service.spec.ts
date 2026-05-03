import { ModelCatalogService } from '../../src/config/model-catalog.service';
import { mockConfigService } from '../helpers';

function makeService(configOverrides: Record<string, unknown> = {}) {
  const config = mockConfigService({
    getFullConfig: jest.fn().mockReturnValue({
      nodes: [],
      models_pricing: {},
    }),
    ...configOverrides,
  });
  return { service: new ModelCatalogService(config), config };
}

describe('ModelCatalogService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes built-in catalog entries without remote refresh', () => {
    const { service } = makeService();
    const status = service.getStatus();

    expect(status.enabled).toBe(true);
    expect(status.source.builtin_models).toBeGreaterThan(0);
    expect(status.source.remote_enabled).toBe(false);
    expect(status.models.some((entry) => entry.model === 'gpt-4o-mini')).toBe(true);
  });

  it('looks up catalog metadata with provider inference', () => {
    const { service } = makeService();
    const entry = service.lookup('gpt-4o-mini', {
      id: 'openai',
      name: 'OpenAI',
      base_url: 'https://api.openai.com',
      protocol: 'chat_completions',
    });

    expect(entry).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      pricing: { input: 0.15, output: 0.6 },
    });
  });

  it('diagnoses unknown models and capability conflicts without blocking config', () => {
    const { service } = makeService({
      getFullConfig: jest.fn().mockReturnValue({
        models_pricing: {},
        nodes: [
          {
            id: 'private',
            name: 'Private proxy',
            protocol: 'chat_completions',
            base_url: 'https://proxy.example.test',
            endpoint: '/v1/chat/completions',
            models: ['private-model'],
          },
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            models: ['gpt-image-1'],
          },
        ],
      }),
    });

    const codes = service.getStatus().diagnostics.map((item) => item.code);
    expect(codes).toContain('catalog_unknown_model');
    expect(codes).toContain('catalog_capability_conflict');
  });

  it('refreshes an opt-in remote catalog without rewriting local config', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            modalities: ['text'],
            endpoints: ['chat_completions'],
            pricing: { input: 0.12, output: 0.5 },
            last_updated_at: '2026-05-03',
          },
        ],
      }),
    } as Response);
    const { service, config } = makeService({
      modelCatalog: {
        enabled: true,
        pricing_max_age_days: 90,
        remote: {
          enabled: true,
          url: 'https://catalog.example.test/siftgate.json',
          timeout_ms: 1000,
          refresh_interval_hours: undefined,
        },
      },
    });

    service.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    service.onModuleDestroy();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://catalog.example.test/siftgate.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(service.lookup('gpt-4o-mini')).toMatchObject({
      source: 'remote',
      pricing: { input: 0.12, output: 0.5 },
    });
    service.getStatus();
    expect(config.getFullConfig).toHaveBeenCalled();
  });
});
