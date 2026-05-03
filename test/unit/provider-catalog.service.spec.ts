import {
  diagnoseNodeAgainstCatalog,
  ProviderCatalogService,
} from '../../src/catalog/provider-catalog.service';

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('ProviderCatalogService', () => {
  it('lists required providers and metadata', () => {
    const service = new ProviderCatalogService();
    const providers = service.listProviders();

    expect(service.getMetadata()).toMatchObject({
      source: 'builtin_static',
      auto_update: false,
    });
    expect(providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining([
        'openai',
        'anthropic',
        'google-gemini',
        'google-vertex',
        'azure-openai',
        'openrouter',
        'groq',
        'mistral',
        'deepseek',
        'xai',
        'cohere',
        'voyage',
        'jina',
        'together',
        'fireworks',
        'ollama',
        'vllm',
        'openai-compatible',
      ]),
    );
  });

  it('distinguishes protocol modalities including video and rerank', () => {
    const service = new ProviderCatalogService();
    const videoModels = service.listModels({ modality: 'video' });
    const rerankModels = service.listModels({ modality: 'rerank' });

    expect(videoModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_id: 'google-gemini',
          endpoints: expect.arrayContaining(['video_generations']),
        }),
      ]),
    );
    expect(rerankModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_id: 'cohere',
          supports_rerank: true,
        }),
      ]),
    );
  });

  it('filters models by provider and endpoint', () => {
    const service = new ProviderCatalogService();
    const models = service.listModels({
      provider: 'openai',
      endpoint: 'embeddings',
    });

    expect(models.every((model) => model.provider_id === 'openai')).toBe(true);
    expect(models.map((model) => model.id)).toEqual(
      expect.arrayContaining(['text-embedding-3-small']),
    );
  });

  it('warns when a known provider lists an unknown model', () => {
    const issues = diagnoseNodeAgainstCatalog(
      {
        id: 'openai',
        name: 'OpenAI',
        base_url: 'https://api.openai.com',
        models: ['future-private-model'],
      },
      'nodes[0]',
    );

    expect(codes(issues)).toContain('catalog_unknown_model');
  });

  it('does not warn for unknown dynamic model names on custom providers', () => {
    const issues = diagnoseNodeAgainstCatalog(
      {
        id: 'local-vllm',
        name: 'Local vLLM',
        base_url: 'http://localhost:8000',
        models: ['company/model-snapshot'],
      },
      'nodes[0]',
    );

    expect(codes(issues)).not.toContain('catalog_unknown_model');
  });
});
