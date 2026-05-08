import { BUILTIN_PROVIDER_CATALOG } from '../../src/catalog/built-in-catalog';

describe('BUILTIN_PROVIDER_CATALOG cache-aware pricing', () => {
  const v24ProviderIds = [
    'deepinfra',
    'nebius',
    'novita',
    'friendli',
    'databricks',
    'github-models',
  ];

  it('ships the v2.4 provider ecosystem batch with governed compatibility metadata', () => {
    for (const providerId of v24ProviderIds) {
      const provider = BUILTIN_PROVIDER_CATALOG.find((entry) => entry.id === providerId);

      expect(provider).toBeDefined();
      expect(provider).toMatchObject({
        source: 'builtin',
        overridden: false,
        auth_type: 'bearer',
        pricing: expect.objectContaining({
          source_url: expect.stringMatching(/^https:\/\//),
          manual_review_required: true,
          pricing_confidence: 'low',
        }),
      });
      expect(provider?.capabilities).toEqual(expect.arrayContaining(['openai_compatible']));
      expect(provider?.compatibility_profile).toBe('openai_compatible');
      expect(provider?.compatibility_profiles).toEqual(expect.arrayContaining(['openai_compatible']));
      expect(provider?.model_buckets?.models?.length).toBeGreaterThan(0);
      expect(provider?.logo_id).toBe(providerId);
      expect(JSON.stringify(provider)).not.toMatch(/sk-[A-Za-z0-9._~+/-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,}/);

      for (const model of provider?.models || []) {
        expect(model).toMatchObject({
          provider: providerId,
          source: 'builtin',
          overridden: false,
          pricing: expect.objectContaining({
            source_url: expect.stringMatching(/^https:\/\//),
            manual_review_required: true,
            pricing_confidence: 'low',
          }),
        });
      }
    }
  });

  it('marks deployment and marketplace provider batch rows as review-only transport metadata', () => {
    const transportOnlyProviders = ['databricks', 'github-models'];

    for (const providerId of transportOnlyProviders) {
      const provider = BUILTIN_PROVIDER_CATALOG.find((entry) => entry.id === providerId);
      expect(provider?.capabilities).toEqual(
        expect.arrayContaining(
          providerId === 'databricks'
            ? ['deployment_pricing', 'enterprise']
            : ['model_marketplace', 'multi_provider'],
        ),
      );
      expect(provider?.pricing).toMatchObject({
        manual_review_required: true,
        review_reason: expect.stringContaining('Provider price depends on account'),
      });
    }
  });

  it('publishes official-docs cache pricing for the latest Gemini preview models', () => {
    const google = BUILTIN_PROVIDER_CATALOG.find((provider) => provider.id === 'google');
    expect(google?.read_cache).toBe(true);

    const pro = google?.models.find((model) => model.id === 'gemini-3.1-pro-preview');
    expect(pro?.read_cache).toBe(true);
    expect(pro?.pricing).toMatchObject({
      input: 2,
      output: 12,
      cache_read_input: 0.2,
      source_type: 'docs_review',
      manual_review_required: true,
      pricing_confidence: 'low',
    });
    expect(pro?.pricing?.source_url).toContain('ai.google.dev/gemini-api/docs/pricing');

    const flashLite = google?.models.find(
      (model) => model.id === 'gemini-3.1-flash-lite-preview',
    );
    expect(flashLite?.pricing).toMatchObject({
      input: 0.25,
      output: 1.5,
      cache_read_input: 0.025,
      source_type: 'docs_review',
      manual_review_required: true,
      pricing_confidence: 'low',
    });
  });

  it('publishes official-docs cache pricing for DeepSeek compatibility models', () => {
    const deepseek = BUILTIN_PROVIDER_CATALOG.find(
      (provider) => provider.id === 'deepseek',
    );
    expect(deepseek?.read_cache).toBe(true);

    for (const modelId of ['deepseek-chat', 'deepseek-reasoner']) {
      const model = deepseek?.models.find((entry) => entry.id === modelId);
      expect(model?.read_cache).toBe(true);
      expect(model?.pricing).toMatchObject({
        input: 0.14,
        output: 0.28,
        cache_read_input: 0.0028,
        source_type: 'docs_review',
        manual_review_required: true,
        pricing_confidence: 'low',
      });
      expect(model?.pricing?.source_url).toContain(
        'api-docs.deepseek.com/quick_start/pricing',
      );
    }
  });

  it('keeps OpenAI and Anthropic built-in cache pricing synced to official sources', () => {
    const openai = BUILTIN_PROVIDER_CATALOG.find((provider) => provider.id === 'openai');
    const gpt4o = openai?.models.find((model) => model.id === 'gpt-4o');
    expect(gpt4o?.pricing).toMatchObject({
      input: 2.5,
      output: 10,
      cache_read_input: 1.25,
      source_type: 'docs_review',
      manual_review_required: true,
      pricing_confidence: 'low',
    });

    const anthropic = BUILTIN_PROVIDER_CATALOG.find(
      (provider) => provider.id === 'anthropic',
    );
    const sonnet = anthropic?.models.find(
      (model) => model.id === 'claude-sonnet-4-20250514',
    );
    const haiku = anthropic?.models.find(
      (model) => model.id === 'claude-haiku-4-5-20251001',
    );

    expect(sonnet?.pricing).toMatchObject({
      input: 3,
      output: 15,
      cache_read_input: 0.3,
      cache_creation_input: 3.75,
      source_type: 'docs_review',
      manual_review_required: true,
      pricing_confidence: 'low',
    });
    expect(haiku?.pricing).toMatchObject({
      input: 1,
      output: 5,
      cache_read_input: 0.1,
      cache_creation_input: 1.25,
      source_type: 'docs_review',
      manual_review_required: true,
      pricing_confidence: 'low',
    });
  });
});
