import {
  buildCatalogSyncStatus,
  catalogSyncConfig,
  enabledCatalogSyncAdapters,
  supportedCatalogSyncAdapters,
} from '../../src/catalog/catalog-sync';
import type { ProviderCatalog } from '../../src/catalog/catalog.types';

describe('catalog sync', () => {
  const catalog: ProviderCatalog = {
    version: 1,
    generated_at: '2026-05-05T00:00:00.000Z',
    providers: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        base_url: 'https://openrouter.ai/api',
        auth_type: 'bearer',
        endpoints: { chat_completions: '/v1/chat/completions' },
        source: 'sync_cache',
        overridden: false,
        synced: true,
        pricing: {
          input: 1,
          output: 2,
          currency: 'USD',
          source: 'openrouter-public-api',
          source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
          last_updated: '2026-05-01',
          last_sync: '2026-05-01T00:00:00.000Z',
          manual_review_required: false,
          stale_after_days: 7,
          pricing_confidence: 'high',
        },
        models: [],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        base_url: 'https://api.openai.com',
        auth_type: 'bearer',
        endpoints: { chat_completions: '/v1/chat/completions' },
        source: 'sync_cache',
        overridden: false,
        synced: true,
        models: [
          {
            id: 'gpt-4o',
            provider: 'openai',
            modalities: ['text', 'vision'],
            endpoints: { chat_completions: '/v1/chat/completions' },
            capabilities: ['streaming'],
            source: 'sync_cache',
            overridden: false,
            synced: true,
            pricing: {
              input: 2.5,
              output: 10,
              currency: 'USD',
              source: 'zeroeval',
              source_url: 'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
              last_updated: '2026-05-01',
              last_sync: '2026-05-01T00:00:00.000Z',
              manual_review_required: true,
              stale_after_days: 7,
              pricing_confidence: 'medium',
            },
            enrichment: {
              source: 'zeroeval',
              source_url: 'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
              synced_at: '2026-05-01T00:00:00.000Z',
              release_date: '2024-05-13',
            },
          },
        ],
      },
    ],
  };

  it('keeps scheduled sync disabled unless a supported adapter is explicitly enabled', () => {
    expect(catalogSyncConfig(undefined).enabled).toBe(false);
    expect(enabledCatalogSyncAdapters({ sync: { enabled: true } })).toEqual([]);
    expect(enabledCatalogSyncAdapters({
      sync: {
        enabled: true,
        adapters: {
          anthropic: { enabled: true },
        },
      },
    })).toEqual([]);
    expect(enabledCatalogSyncAdapters({
      sync: {
        enabled: true,
        adapters: {
          openrouter: { enabled: true },
        },
      },
    })).toEqual(['openrouter']);
    expect(enabledCatalogSyncAdapters({
      sync: {
        enabled: true,
        adapters: {
          zeroeval: { enabled: true },
        },
      },
    })).toEqual(['zeroeval']);
    expect(supportedCatalogSyncAdapters()).toEqual(['openrouter', 'zeroeval']);
  });

  it('reports last sync, source URL, confidence, and stale state for Dashboard', () => {
    const status = buildCatalogSyncStatus({
      config: {
        sync: {
          enabled: true,
          interval_minutes: 60,
          adapters: { openrouter: { enabled: true } },
        },
      },
      catalog,
      now: new Date('2026-05-05T00:00:00.000Z'),
      cachePath: '/tmp/catalog-sync-cache.yaml',
      cacheFound: true,
      overridePath: '/tmp/catalog.override.yaml',
      overrideFound: false,
    });

    expect(status).toMatchObject({
      enabled: true,
      scheduled: true,
      write_to: 'cache',
      enabled_adapters: ['openrouter'],
    });
    expect(status.providers.find((entry) => entry.provider === 'openrouter')).toMatchObject({
      status: 'fresh',
      last_sync: '2026-05-01T00:00:00.000Z',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      confidence: 'high',
      stale: false,
    });
  });

  it('surfaces stale warnings when automatic pricing has not synced recently', () => {
    const status = buildCatalogSyncStatus({
      config: {
        sync: {
          enabled: true,
          adapters: { openrouter: { enabled: true } },
        },
      },
      catalog,
      now: new Date('2026-05-20T00:00:00.000Z'),
      cachePath: '/tmp/catalog-sync-cache.yaml',
      cacheFound: true,
      overridePath: '/tmp/catalog.override.yaml',
      overrideFound: false,
    });

    expect(status.providers.find((entry) => entry.provider === 'openrouter')).toMatchObject({
      status: 'stale',
      stale: true,
      age_days: 19,
    });
  });

  it('reports zeroeval sync freshness from enriched model metadata across providers', () => {
    const status = buildCatalogSyncStatus({
      config: {
        sync: {
          enabled: true,
          adapters: { zeroeval: { enabled: true } },
        },
      },
      catalog,
      now: new Date('2026-05-05T00:00:00.000Z'),
      cachePath: '/tmp/catalog-sync-cache.yaml',
      cacheFound: true,
      overridePath: '/tmp/catalog.override.yaml',
      overrideFound: false,
    });

    expect(status.providers.find((entry) => entry.provider === 'zeroeval')).toMatchObject({
      status: 'fresh',
      last_sync: '2026-05-01T00:00:00.000Z',
      source_url: 'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
      confidence: 'medium',
      stale: false,
    });
  });
});
