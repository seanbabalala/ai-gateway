import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  assessCatalogPricing,
  catalogModelToModelPricing,
  collectCatalogPricingHygieneIssues,
  loadMergedCatalog,
  validateCatalogOverrideFile,
} from '../../src/catalog/catalog.service';
import { getCompatibilityProfile } from '../../src/catalog/compatibility-profiles';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/catalog', name);

describe('catalog service', () => {
  it('merges local overrides into the built-in provider catalog', () => {
    const result = loadMergedCatalog({
      cwd: path.dirname(fixture('catalog.override.yaml')),
      overridePath: fixture('catalog.override.yaml'),
      env: {},
    });

    const openai = result.catalog.providers.find((provider) => provider.id === 'openai');
    const customModel = openai?.models.find((model) => model.id === 'custom-chat-latest');
    const localLab = result.catalog.providers.find((provider) => provider.id === 'local-lab');

    expect(result.overrideFound).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(openai).toMatchObject({
      base_url: 'https://proxy.example/openai',
      overridden: true,
    });
    expect(customModel).toMatchObject({
      provider: 'openai',
      source: 'override',
      overridden: true,
      pricing: expect.objectContaining({ manual_review_required: false }),
    });
    expect(localLab).toMatchObject({
      name: 'Local Lab',
      auth_type: 'none',
      source: 'override',
      overridden: true,
    });
  });

  it('loads managed sync cache before user overrides so explicit overrides win', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-sync-'));
    const syncCachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(syncCachePath), { recursive: true });
    fs.writeFileSync(
      syncCachePath,
      [
        'version: 1',
        'providers:',
        '  openrouter:',
        '    name: OpenRouter',
        '    base_url: https://openrouter.ai/api',
        '    auth_type: bearer',
        '    models:',
        '      - id: openai/gpt-sync',
        '        modalities: [text]',
        '        endpoints:',
        '          chat_completions: /v1/chat/completions',
        '        capabilities: [streaming]',
        '        pricing:',
        '          input: 1',
        '          output: 2',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: false',
        '          stale_after_days: 7',
        '          pricing_confidence: high',
        '          currency: USD',
        '        enrichment:',
        '          source: zeroeval',
        '          source_url: https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
        '          synced_at: 2026-05-05T00:00:00.000Z',
        '          release_date: 2026-05-01',
        '          organization: OpenAI',
        '          organization_id: openai',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(cwd, 'catalog.override.yaml'),
      [
        'version: 1',
        'providers:',
        '  openrouter:',
        '    models:',
        '      - id: openai/gpt-sync',
        '        modalities: [text]',
        '        endpoints:',
        '          chat_completions: /v1/chat/completions',
        '        pricing:',
        '          input: 9',
        '          output: 10',
        '          source: operator-reviewed',
        '          source_url: https://example.com/pricing',
        '          last_updated: 2026-05-05',
        '          manual_review_required: false',
        '          stale_after_days: 30',
        '          pricing_confidence: high',
        '          currency: USD',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = loadMergedCatalog({ cwd, env: {} });
    const model = result.catalog.providers
      .find((provider) => provider.id === 'openrouter')
      ?.models.find((entry) => entry.id === 'openai/gpt-sync');

    expect(result.syncCacheFound).toBe(true);
    expect(model).toMatchObject({
      source: 'override',
      overridden: true,
      synced: true,
      pricing: expect.objectContaining({
        input: 9,
        output: 10,
        source: 'operator-reviewed',
      }),
      enrichment: expect.objectContaining({
        source: 'zeroeval',
        release_date: '2026-05-01',
        organization_id: 'openai',
        lifecycle: expect.objectContaining({
          release_date: '2026-05-01',
        }),
      }),
    });
  });

  it('accepts model enrichment metadata in sync cache overrides', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-zeroeval-'));
    const syncCachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(syncCachePath), { recursive: true });
    fs.writeFileSync(
      syncCachePath,
      [
        'version: 1',
        'providers:',
        '  openai:',
        '    models:',
        '      - id: gpt-4o',
        '        enrichment:',
        '          source: zeroeval',
        '          source_url: https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
        '          synced_at: 2026-05-05T00:00:00.000Z',
        '          organization: OpenAI',
        '          organization_id: openai',
        '          canonical_model_id: chatgpt-4o-latest',
        '          release_date: 2024-05-13',
        '          announcement_date: 2024-05-13',
        '          multimodal: true',
        '          throughput: 132',
        '          lifecycle:',
        '            release_date: 2024-05-13',
        '            announcement_date: 2024-05-13',
        '          specs:',
        '            throughput: 132',
        '            multimodal: true',
        '            params: 200000000000',
        '          benchmarks:',
        '            gpqa_score: 0.84',
        '          metadata:',
        '            params: 200000000000',
        '        pricing:',
        '          input: 2.5',
        '          output: 10',
        '          source: zeroeval',
        '          source_url: https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: true',
        '          stale_after_days: 7',
        '          pricing_confidence: medium',
        '          currency: USD',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = loadMergedCatalog({ cwd, env: {} });
    const model = result.catalog.providers
      .find((provider) => provider.id === 'openai')
      ?.models.find((entry) => entry.id === 'gpt-4o');

    expect(result.issues).toHaveLength(0);
    expect(model).toMatchObject({
      source: 'sync_cache',
      synced: true,
      pricing: expect.objectContaining({
        source: 'zeroeval',
        manual_review_required: true,
        pricing_confidence: 'medium',
      }),
      enrichment: expect.objectContaining({
        source: 'zeroeval',
        organization: 'OpenAI',
        canonical_model_id: 'chatgpt-4o-latest',
        release_date: '2024-05-13',
        throughput: 132,
        lifecycle: expect.objectContaining({
          release_date: '2024-05-13',
        }),
        specs: expect.objectContaining({
          throughput: 132,
          multimodal: true,
          params: 200000000000,
        }),
        benchmarks: expect.objectContaining({
          gpqa_score: 0.84,
        }),
      }),
    });
  });

  it('preserves internal canonical registry materialization from the managed sync cache', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-canonical-'));
    const syncCachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(syncCachePath), { recursive: true });
    fs.writeFileSync(
      syncCachePath,
      [
        'version: 1',
        '_siftgate_internal:',
        '  canonical_registry:',
        '    version: 1',
        '    primary_source: openrouter',
        '    source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '    generated_at: 2026-05-05T00:00:00.000Z',
        '    models:',
        '      - canonical_id: openai/gpt-sync-20260505',
        '        source_model_id: openai/gpt-sync',
        '        source_provider_slug: openai',
        '        display_name: "OpenAI: GPT Sync"',
        '        aliases: [openai/gpt-sync]',
        '        canonical_slug: openai/gpt-sync-20260505',
        '        context_length: 128000',
        '        input_modalities: [text]',
        '        output_modalities: [text]',
        '        supported_parameters: [tools]',
        '        pricing_reference:',
        '          input: 1.5',
        '          output: 2.5',
        '          source: openrouter-public-api',
        '          source_type: aggregator_api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          retrieved_at: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: true',
        '          stale_after_days: 7',
        '          pricing_confidence: medium',
        '          currency: USD',
        '        source_metadata:',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          synced_at: 2026-05-05T00:00:00.000Z',
        '          dataset_role: canonical_primary',
        'providers:',
        '  openrouter:',
        '    models:',
        '      - id: openai/gpt-sync',
        '        modalities: [text]',
        '        endpoints:',
        '          chat_completions: /v1/chat/completions',
        '        capabilities: [tools]',
        '        pricing:',
        '          input: 1.5',
        '          output: 2.5',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: false',
        '          stale_after_days: 7',
        '          pricing_confidence: high',
        '          currency: USD',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = loadMergedCatalog({ cwd, env: {} });
    const openrouter = result.catalog.providers.find((provider) => provider.id === 'openrouter');

    expect(result.issues).toHaveLength(0);
    expect(result.internal.canonical_registry).toMatchObject({
      version: 1,
      primary_source: 'openrouter',
      source_url: 'https://openrouter.ai/api/v1/models?output_modalities=all',
      model_count: 1,
      models: [
        {
          canonical_id: 'openai/gpt-sync-20260505',
          source_model_id: 'openai/gpt-sync',
          source_provider_slug: 'openai',
          pricing_reference: expect.objectContaining({
            source: 'openrouter-public-api',
            manual_review_required: true,
            pricing_confidence: 'medium',
          }),
        },
      ],
    });
    expect(openrouter?.models.find((model) => model.id === 'openai/gpt-sync')).toMatchObject({
      pricing: expect.objectContaining({
        input: 1.5,
        output: 2.5,
        source: 'openrouter-public-api',
      }),
      synced: true,
    });
  });

  it('projects active provider models from the canonical registry and suppresses stale built-in static model truth', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-provider-projection-'));
    const syncCachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(syncCachePath), { recursive: true });
    fs.writeFileSync(
      syncCachePath,
      [
        'version: 1',
        '_siftgate_internal:',
        '  canonical_registry:',
        '    version: 1',
        '    primary_source: openrouter',
        '    source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '    generated_at: 2026-05-06T00:00:00.000Z',
        '    models:',
        '      - canonical_id: openai/gpt-5.1-mini-20260506',
        '        source_model_id: openai/gpt-5.1-mini',
        '        source_provider_slug: openai',
        '        display_name: GPT-5.1 Mini',
        '        aliases: [openai/gpt-5.1-mini]',
        '        canonical_slug: openai/gpt-5.1-mini',
        '        context_length: 256000',
        '        input_modalities: [text]',
        '        output_modalities: [text]',
        '        supported_parameters: [tools, response_format]',
        '        pricing_reference:',
        '          input: 0.4',
        '          output: 1.6',
        '          input_per_1m_tokens: 0.4',
        '          output_per_1m_tokens: 1.6',
        '          source: openrouter-public-api',
        '          source_type: aggregator_api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-06',
        '          last_sync: 2026-05-06T00:00:00.000Z',
        '          retrieved_at: 2026-05-06T00:00:00.000Z',
        '          last_verified_at: 2026-05-06T00:00:00.000Z',
        '          manual_review_required: true',
        '          stale_after_days: 7',
        '          pricing_confidence: medium',
        '          currency: USD',
        '        source_metadata:',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          synced_at: 2026-05-06T00:00:00.000Z',
        '          dataset_role: canonical_primary',
        'providers: {}',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = loadMergedCatalog({ cwd, env: {} });
    const openai = result.catalog.providers.find((provider) => provider.id === 'openai');
    const providerIds = result.catalog.providers.map((provider) => provider.id);

    expect(new Set(providerIds).size).toBe(providerIds.length);
    expect(openai).toMatchObject({
      status: 'active',
      source: 'builtin',
    });
    expect(openai?.models.map((model) => model.id)).toEqual(['gpt-5.1-mini']);
    expect(openai?.models[0]).toMatchObject({
      source: 'sync_cache',
      synced: true,
      limits: expect.objectContaining({
        max_context_tokens: 256000,
      }),
      capabilities: expect.arrayContaining(['tools', 'structured_output']),
      pricing: expect.objectContaining({
        source: 'openrouter-public-api',
        input_per_1m_tokens: 0.4,
        output_per_1m_tokens: 1.6,
      }),
    });
    expect(openai?.models.map((model) => model.id)).not.toContain('gpt-4o');
  });

  it('preserves zeroeval overlay diagnostics from the managed sync cache internal materialization', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-zeroeval-diagnostics-'));
    const syncCachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(syncCachePath), { recursive: true });
    fs.writeFileSync(
      syncCachePath,
      [
        'version: 1',
        '_siftgate_internal:',
        '  canonical_registry:',
        '    version: 1',
        '    primary_source: openrouter',
        '    source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '    generated_at: 2026-05-05T00:00:00.000Z',
        '    models: []',
        '  diagnostics:',
        '    zeroeval_overlay:',
        '      source: zeroeval',
        '      source_url: https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
        '      synced_at: 2026-05-06T00:00:00.000Z',
        '      canonical_model_count: 20',
        '      zeroeval_model_count: 18',
        '      matched_model_count: 15',
        '      projected_model_count: 12',
        '      high_confidence_match_count: 10',
        '      medium_confidence_match_count: 5',
        '      low_confidence_match_count: 2',
        '      unmatched_model_count: 1',
        '      ambiguous_match_count: 1',
        '      low_confidence_matches:',
        '        - organization_id: anthropic',
        '          model_id: claude-sonnet-4-6',
        '          canonical_id: anthropic/claude-4.6-sonnet',
        '          match_strategy: ambiguous_candidate',
        '          match_confidence: low',
        '          reason: Multiple canonical candidates matched the same strict signature.',
        'providers: {}',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = loadMergedCatalog({ cwd, env: {} });

    expect(result.issues).toHaveLength(0);
    expect(result.internal.diagnostics?.zeroeval_overlay).toMatchObject({
      matched_model_count: 15,
      projected_model_count: 12,
      low_confidence_match_count: 2,
      ambiguous_match_count: 1,
      low_confidence_matches: [
        expect.objectContaining({
          model_id: 'claude-sonnet-4-6',
          match_strategy: 'ambiguous_candidate',
          match_confidence: 'low',
        }),
      ],
    });
  });

  it('rejects secret-looking fields in override files', () => {
    const result = validateCatalogOverrideFile(fixture('secret.catalog.override.yaml'));

    expect(result.override).not.toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'catalog_override_secret_field',
        }),
        expect.objectContaining({
          severity: 'warning',
          code: 'catalog_override_secret_value',
        }),
      ]),
    );
  });

  it('allows catalog token metadata fields without treating them as secrets', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-token-fields-'));
    const overridePath = path.join(cwd, 'catalog.override.yaml');
    fs.writeFileSync(
      overridePath,
      [
        'version: 1',
        'providers:',
        '  openrouter:',
        '    models:',
        '      - id: openai/gpt-token-metadata',
        '        modalities: [text]',
        '        limits:',
        '          max_context_tokens: 128000',
        '        pricing:',
        '          input: 1',
        '          output: 2',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-05',
        '          last_sync: 2026-05-05T00:00:00.000Z',
        '          manual_review_required: false',
        '          stale_after_days: 7',
        '          pricing_confidence: high',
        '          currency: USD',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = validateCatalogOverrideFile(overridePath);

    expect(result.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'catalog_override_secret_field',
        }),
      ]),
    );
  });

  it('adds pricing hygiene metadata and converts catalog pricing for cost fallback', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });
    const model = result.catalog.providers
      .flatMap((provider) => provider.models)
      .find((entry) => entry.id === 'gpt-4o');

    const pricing = catalogModelToModelPricing(model);
    expect(pricing).toMatchObject({
      input: 2.5,
      output: 10,
      currency: 'USD',
      catalog_source: 'builtin',
      pricing_used_from: 'builtin_catalog',
      source_type: 'docs_review',
    });

    const hygiene = assessCatalogPricing(model?.pricing, model?.modalities || [], new Date('2026-05-04T00:00:00.000Z'));
    expect(hygiene.status).toBe('placeholder');
    expect(hygiene.stale).toBe(false);
    expect(hygiene.pricing_confidence).toBe('low');
    expect(hygiene.source_type).toBe('docs_review');
    expect(hygiene.source_url_missing).toBe(false);
    expect(model?.pricing).toMatchObject({
      input_per_1m_tokens: 2.5,
      output_per_1m_tokens: 10,
      source_type: 'docs_review',
      last_verified_at: '2026-05-05',
    });
  });

  it('ships 50 plus built-in providers with reviewable pricing source URLs and v1.4 metadata', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });
    const providerIds = result.catalog.providers.map((provider) => provider.id);

    expect(providerIds.length).toBeGreaterThanOrEqual(50);
    expect(providerIds).toEqual(
      expect.arrayContaining([
        'aws-bedrock',
        'alibaba-qwen',
        'baidu-qianfan',
        'volcengine-ark',
        'zhipu',
        'moonshot',
        'minimax',
        'tencent-hunyuan',
        '01ai',
        'replicate',
        'perplexity',
        'nvidia-nim',
        'cerebras',
        'sambanova',
        'deepinfra',
        'nebius',
        'novita',
        'friendli',
        'databricks',
        'github-models',
        'huggingface',
        'cloudflare-workers-ai',
        'ibm-watsonx',
        'baseten',
        'lepton',
        'modal',
        'runpod',
        'predibase',
        'lamini',
        'ai21',
        'fal',
        'stability-ai',
        'black-forest-labs',
        'ideogram',
        'luma',
        'runway',
        'pika',
        'elevenlabs',
        'deepgram',
        'assemblyai',
        'cartesia',
        'speechmatics',
        'lm-studio',
        'llama-cpp',
        'huggingface-tgi',
        'sglang',
        'xinference',
      ]),
    );

    const qwen = result.catalog.providers.find((provider) => provider.id === 'alibaba-qwen');
    expect(qwen).toMatchObject({
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
      pricing: expect.objectContaining({
        source: 'provider-reference',
        source_url: expect.stringContaining('alibabacloud.com'),
        manual_review_required: true,
        pricing_confidence: 'low',
      }),
    });
    expect(qwen?.models.map((model) => model.id)).toEqual(
      expect.arrayContaining(['qwen-plus', 'text-embedding-v4', 'wan2.5-t2v-preview']),
    );

    const huggingFace = result.catalog.providers.find((provider) => provider.id === 'huggingface');
    expect(huggingFace).toMatchObject({
      status: 'transport_only',
      aliases: expect.arrayContaining(['hf']),
      family: 'aggregator',
      provider_type: 'aggregator',
      homepage_url: 'https://huggingface.co',
      docs_url: expect.stringContaining('huggingface.co/docs'),
      pricing_url: expect.stringContaining('huggingface.co/pricing'),
      logo_id: 'huggingface',
      compatibility_profile: 'openai_compatible',
      model_buckets: expect.objectContaining({
        models: expect.arrayContaining(['meta-llama/Llama-3.3-70B-Instruct']),
        embedding_models: expect.arrayContaining(['sentence-transformers/all-MiniLM-L6-v2']),
      }),
      pricing: expect.objectContaining({
        source: 'provider-reference',
        source_url: expect.stringContaining('huggingface.co'),
        manual_review_required: true,
        pricing_confidence: 'low',
      }),
    });

    const deepinfra = result.catalog.providers.find((provider) => provider.id === 'deepinfra');
    expect(deepinfra).toMatchObject({
      status: 'transport_only',
      base_url: 'https://api.deepinfra.com/v1/openai',
      compatibility_profile: 'openai_compatible',
      model_buckets: expect.objectContaining({
        models: expect.arrayContaining([
          'deepseek-ai/DeepSeek-V3',
          'meta-llama/Llama-3.3-70B-Instruct',
        ]),
      }),
      pricing: expect.objectContaining({
        source_url: expect.stringContaining('deepinfra.com'),
        manual_review_required: true,
        pricing_confidence: 'low',
      }),
    });

    const databricks = result.catalog.providers.find((provider) => provider.id === 'databricks');
    expect(databricks).toMatchObject({
      status: 'transport_only',
      family: 'cloud_platform',
      provider_type: 'cloud',
      capabilities: expect.arrayContaining(['deployment_pricing', 'enterprise']),
      model_buckets: expect.objectContaining({
        embedding_models: expect.arrayContaining(['databricks-bge-large-en']),
      }),
      pricing: expect.objectContaining({
        source_url: expect.stringContaining('databricks'),
        manual_review_required: true,
      }),
    });

    const githubModels = result.catalog.providers.find((provider) => provider.id === 'github-models');
    expect(githubModels).toMatchObject({
      status: 'transport_only',
      family: 'aggregator',
      provider_type: 'aggregator',
      capabilities: expect.arrayContaining(['model_marketplace', 'multi_provider']),
      endpoints: expect.objectContaining({
        chat_completions: '/orgs/{org}/inference/chat/completions',
      }),
      pricing: expect.objectContaining({
        source_url: expect.stringContaining('docs.github.com'),
        manual_review_required: true,
      }),
    });

    expect(result.catalog.providers.find((provider) => provider.id === 'openai-compatible')).toMatchObject({
      status: 'custom',
    });
  });

  it('normalizes v1.4 provider governance fields across the built-in catalog', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });

    for (const provider of result.catalog.providers.filter((entry) => entry.source === 'builtin')) {
      expect(provider.aliases?.length).toBeGreaterThan(0);
      expect(provider.family).toBeTruthy();
      expect(provider.category).toBeTruthy();
      expect(provider.provider_type).toMatch(/direct|aggregator|cloud|self_hosted|media|speech|local/);
      expect(provider.homepage_url).toMatch(/^https?:\/\//);
      expect(provider.docs_url).toBeTruthy();
      expect(provider.pricing_url).toBeTruthy();
      expect(provider.logo_id).toBeTruthy();
      expect(provider.input_types?.length).toBeGreaterThan(0);
      expect(provider.output_types?.length).toBeGreaterThan(0);
      expect(provider.model_buckets).toBeTruthy();
      expect(provider.compatibility_profile).toBeTruthy();
      expect(provider.pricing).toMatchObject({
        source: expect.any(String),
        source_url: expect.any(String),
        last_updated: expect.any(String),
        manual_review_required: expect.any(Boolean),
        pricing_confidence: expect.any(String),
      });
    }
  });

  it('ships catalog providers with valid compatibility profile references', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });

    for (const provider of result.catalog.providers) {
      expect(provider.compatibility_profiles?.length).toBeGreaterThan(0);
      for (const profile of provider.compatibility_profiles || []) {
        expect(getCompatibilityProfile(profile)).toBeDefined();
      }
    }

    expect(result.catalog.providers.find((provider) => provider.id === 'openai')?.compatibility_profiles).toEqual(
      expect.arrayContaining(['openai_compatible', 'openai_responses_compatible']),
    );
  });

  it('reports stale and modality-unit pricing hygiene issues', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });
    const provider = result.catalog.providers.find((entry) => entry.id === 'openai');
    const imageModel = provider?.models.find((model) => model.id === 'gpt-image-1');

    expect(imageModel?.pricing?.units?.image).toContain('image');
    const issues = collectCatalogPricingHygieneIssues(
      {
        ...result.catalog,
        providers: [
          {
            ...provider!,
            models: [
              {
                ...imageModel!,
                pricing: {
                  ...imageModel!.pricing!,
                  last_updated: '2025-01-01',
                  last_verified_at: '2025-01-01',
                  stale_after_days: 10,
                  units: { input: 'usd_per_1m_tokens', output: 'usd_per_1m_tokens' },
                },
              },
            ],
          },
        ],
      },
      new Date('2026-05-04T00:00:00.000Z'),
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'catalog_pricing_stale',
        'catalog_pricing_unit_mismatch',
      ]),
    );
  });
});
