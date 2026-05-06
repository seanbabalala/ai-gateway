import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  buildCatalogSyncStatus,
  catalogSyncConfig,
  enabledCatalogSyncAdapters,
  syncCatalogProvider,
  supportedCatalogSyncAdapters,
} from '../../src/catalog/catalog-sync';
import type {
  CatalogInternalMaterialization,
  ProviderCatalog,
} from '../../src/catalog/catalog.types';

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
        endpoints: { responses: '/v1/responses' },
        source: 'sync_cache',
        overridden: false,
        synced: true,
        models: [
          {
            id: 'gpt-4o',
            provider: 'openai',
            modalities: ['text', 'vision'],
            endpoints: { responses: '/v1/responses' },
            capabilities: ['tools', 'structured_output', 'vision'],
            source: 'sync_cache',
            overridden: false,
            synced: true,
            pricing: {
              input: 5,
              output: 15,
              currency: 'USD',
              source: 'openrouter-public-api',
              source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
              last_updated: '2026-05-01',
              last_sync: '2026-05-01T00:00:00.000Z',
              manual_review_required: true,
              stale_after_days: 7,
              pricing_confidence: 'medium',
            },
            enrichment: {
              source: 'zeroeval',
              source_url:
                'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
              synced_at: '2026-05-01T00:00:00.000Z',
              enriched_from: 'zeroeval',
              match_strategy: 'explicit_alias',
              match_confidence: 'high',
              release_date: '2024-05-13',
              secondary_pricing_reference: {
                input: 2.5,
                output: 10,
                currency: 'USD',
                source: 'zeroeval',
                source_url:
                  'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
                last_updated: '2026-05-01',
                last_sync: '2026-05-01T00:00:00.000Z',
                manual_review_required: true,
                stale_after_days: 7,
                pricing_confidence: 'medium',
              },
            },
          },
        ],
      },
    ],
  };

  const internal: CatalogInternalMaterialization = {
    canonical_registry: {
      version: 1,
      primary_source: 'openrouter',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      generated_at: '2026-05-01T00:00:00.000Z',
      model_count: 1,
      models: [
        {
          canonical_id: 'openai/gpt-4o',
          source_model_id: 'openai/gpt-4o',
          source_provider_slug: 'openai',
          display_name: 'OpenAI: GPT-4o',
          canonical_slug: 'openai/gpt-4o',
          source_metadata: {
            source: 'openrouter-public-api',
            source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
            synced_at: '2026-05-01T00:00:00.000Z',
            dataset_role: 'canonical_primary',
          },
        },
      ],
    },
    diagnostics: {
      zeroeval_overlay: {
        source: 'zeroeval',
        source_url: 'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
        synced_at: '2026-05-01T00:00:00.000Z',
        canonical_model_count: 1,
        zeroeval_model_count: 2,
        matched_model_count: 1,
        projected_model_count: 1,
        high_confidence_match_count: 1,
        medium_confidence_match_count: 0,
        low_confidence_match_count: 1,
        unmatched_model_count: 0,
        ambiguous_match_count: 1,
      },
    },
  };

  it('keeps scheduled sync disabled unless a supported adapter is explicitly enabled', () => {
    expect(catalogSyncConfig(undefined).enabled).toBe(false);
    expect(enabledCatalogSyncAdapters({ sync: { enabled: true } })).toEqual([]);
    expect(
      enabledCatalogSyncAdapters({
        sync: {
          enabled: true,
          adapters: {
            anthropic: { enabled: true },
          },
        },
      }),
    ).toEqual([]);
    expect(
      enabledCatalogSyncAdapters({
        sync: {
          enabled: true,
          adapters: {
            openrouter: { enabled: true },
          },
        },
      }),
    ).toEqual(['openrouter']);
    expect(
      enabledCatalogSyncAdapters({
        sync: {
          enabled: true,
          adapters: {
            zeroeval: { enabled: true },
          },
        },
      }),
    ).toEqual(['zeroeval']);
    expect(supportedCatalogSyncAdapters()).toEqual(['openrouter', 'zeroeval']);
  });

  it('reports last sync, source URL, confidence, and canonical coverage for OpenRouter', () => {
    const status = buildCatalogSyncStatus({
      config: {
        sync: {
          enabled: true,
          interval_minutes: 60,
          adapters: { openrouter: { enabled: true } },
        },
      },
      catalog,
      internal,
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
      canonical_model_count: 1,
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
      internal,
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

  it('reports zeroeval overlay freshness and diagnostics from the internal canonical overlay materialization', () => {
    const status = buildCatalogSyncStatus({
      config: {
        sync: {
          enabled: true,
          adapters: { zeroeval: { enabled: true } },
        },
      },
      catalog,
      internal,
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
      canonical_model_count: 1,
      matched_model_count: 1,
      projected_model_count: 1,
      low_confidence_match_count: 1,
      ambiguous_match_count: 1,
    });
  });

  it('writes the OpenRouter canonical registry into the managed sync cache materialization', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-sync-openrouter-'));
    const result = await syncCatalogProvider({
      provider: 'openrouter',
      cwd,
      env: {},
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'openai/gpt-sync',
              canonical_slug: 'openai/gpt-sync-20260505',
              name: 'OpenAI: GPT Sync',
              created: 1778000212,
              context_length: 128000,
              architecture: {
                input_modalities: ['text'],
                output_modalities: ['text'],
              },
              pricing: {
                prompt: '0.0000015',
                completion: '0.0000025',
              },
              supported_parameters: ['tools'],
            },
          ],
        }),
      })) as unknown as typeof fetch,
    });

    const cachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    const exported = yaml.load(fs.readFileSync(cachePath, 'utf8')) as any;

    expect(result.status).toBe('synced');
    expect(result.written).toBe(true);
    expect(result.model_count).toBe(1);
    expect(result.priced_model_count).toBe(1);
    expect(result.canonical_model_count).toBe(1);
    expect(exported._siftgate_internal.canonical_registry).toMatchObject({
      version: 1,
      primary_source: 'openrouter',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      generated_at: '2026-05-06T00:00:00.000Z',
      model_count: 1,
      models: [
        {
          canonical_id: 'openai/gpt-sync-20260505',
          source_model_id: 'openai/gpt-sync',
          source_provider_slug: 'openai',
          pricing_reference: expect.objectContaining({
            input: 1.5,
            output: 2.5,
            source: 'openrouter-public-api',
            manual_review_required: true,
            pricing_confidence: 'medium',
          }),
        },
      ],
    });
    expect(exported.providers.openrouter.models[0]).toMatchObject({
      id: 'openai/gpt-sync',
      pricing: expect.objectContaining({
        input: 1.5,
        output: 2.5,
        source: 'openrouter-public-api',
        manual_review_required: false,
        pricing_confidence: 'high',
      }),
    });
  });

  it('writes ZeroEval canonical overlay diagnostics and provider projections into the managed sync cache', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-sync-zeroeval-'));
    const cachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      [
        'version: 1',
        '_siftgate_internal:',
        '  canonical_registry:',
        '    version: 1',
        '    primary_source: openrouter',
        '    source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '    generated_at: 2026-05-05T00:00:00.000Z',
        '    models:',
        '      - canonical_id: openai/gpt-4o',
        '        source_model_id: openai/gpt-4o',
        '        source_provider_slug: openai',
        '        display_name: "OpenAI: GPT-4o"',
        '        canonical_slug: openai/gpt-4o',
        '        input_modalities: [text, image]',
        '        output_modalities: [text]',
        '        supported_parameters: [tools, response_format]',
        '        pricing_reference:',
        '          input: 5',
        '          output: 15',
        '          source: openrouter-public-api',
        '          source_type: aggregator_api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          retrieved_at: 2026-05-05T00:00:00.000Z',
        '          last_verified_at: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: true',
        '          stale_after_days: 7',
        '          pricing_confidence: medium',
        '          currency: USD',
        '        source_metadata:',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          synced_at: 2026-05-05T00:00:00.000Z',
        '          dataset_role: canonical_primary',
        'providers: {}',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await syncCatalogProvider({
      provider: 'zeroeval',
      cwd,
      env: {},
      now: new Date('2026-05-06T00:00:00.000Z'),
      fetchImpl: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ([
          {
            model_id: 'chatgpt-4o-latest',
            name: 'ChatGPT-4o Latest',
            organization: 'OpenAI',
            organization_id: 'openai',
            context: 128000,
            release_date: '2024-05-13',
            announcement_date: '2024-05-13',
            multimodal: true,
            input_price: 2.5,
            output_price: 10,
            throughput: 132,
            gpqa_score: 0.84,
          },
        ]),
      })) as unknown as typeof fetch,
    });

    const exported = yaml.load(fs.readFileSync(cachePath, 'utf8')) as any;

    expect(result.status).toBe('synced');
    expect(result.model_count).toBe(1);
    expect(result.priced_model_count).toBe(1);
    expect(result.canonical_model_count).toBe(1);
    expect(result.matched_model_count).toBe(1);
    expect(result.projected_model_count).toBe(1);
    expect(exported.providers.openai.models[0]).toMatchObject({
      id: 'gpt-4o',
      pricing: expect.objectContaining({
        input: 5,
        output: 15,
        source: 'openrouter-public-api',
      }),
      enrichment: expect.objectContaining({
        source: 'zeroeval',
        match_strategy: 'explicit_alias',
        match_confidence: 'high',
        secondary_pricing_reference: expect.objectContaining({
          input: 2.5,
          output: 10,
          source: 'zeroeval',
        }),
      }),
    });
    expect(exported._siftgate_internal.diagnostics.zeroeval_overlay).toMatchObject({
      matched_model_count: 1,
      projected_model_count: 1,
      high_confidence_match_count: 1,
      low_confidence_match_count: 0,
      unmatched_model_count: 0,
    });
  });
});
