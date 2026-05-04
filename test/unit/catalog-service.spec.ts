import * as path from 'path';
import {
  assessCatalogPricing,
  catalogModelToModelPricing,
  collectCatalogPricingHygieneIssues,
  loadMergedCatalog,
  validateCatalogOverrideFile,
} from '../../src/catalog/catalog.service';

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
    });

    const hygiene = assessCatalogPricing(model?.pricing, model?.modalities || [], new Date('2026-05-04T00:00:00.000Z'));
    expect(hygiene.status).toBe('placeholder');
    expect(hygiene.stale).toBe(false);
    expect(hygiene.pricing_confidence).toBe('low');
  });

  it('ships 30 plus built-in providers with reviewable pricing source URLs', () => {
    const result = loadMergedCatalog({ cwd: path.dirname(fixture('catalog.override.yaml')), env: {} });
    const providerIds = result.catalog.providers.map((provider) => provider.id);

    expect(providerIds.length).toBeGreaterThanOrEqual(30);
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
