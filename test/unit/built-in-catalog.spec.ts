import { BUILTIN_PROVIDER_CATALOG } from '../../src/catalog/built-in-catalog';

describe('BUILTIN_PROVIDER_CATALOG cache-aware pricing', () => {
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
