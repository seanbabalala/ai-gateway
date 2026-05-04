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
        'openai-compatible',
      ]),
    );
    expect(providers.length).toBeGreaterThanOrEqual(30);
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

  it('recognizes v1.0 providers and keeps pricing as review-required references', () => {
    const service = new ProviderCatalogService();
    const qwen = service.getProvider('alibaba-qwen');
    const bedrock = service.getProvider('aws-bedrock');

    expect(qwen).toMatchObject({
      auth_type: 'bearer',
      endpoints: expect.objectContaining({
        chat_completions: '/v1/chat/completions',
      }),
      pricing: expect.objectContaining({
        source: 'provider_docs',
        source_url: expect.stringContaining('alibabacloud.com'),
        manual_review_required: true,
        pricing_confidence: 'low',
      }),
    });
    expect(bedrock).toMatchObject({
      auth_type: 'custom',
      capabilities: expect.arrayContaining(['sigv4_required']),
    });

    const issues = diagnoseNodeAgainstCatalog(
      {
        id: 'qwen',
        name: 'Alibaba Qwen',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
        models: ['qwen-plus'],
      },
      'nodes[0]',
    );

    expect(codes(issues)).not.toContain('catalog_unknown_model');
    expect(codes(issues)).toContain('catalog_pricing_manual_review');
  });
});
