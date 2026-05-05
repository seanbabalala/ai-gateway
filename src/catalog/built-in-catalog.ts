import type { CatalogProvider, CatalogPricing } from './catalog.types';
import { inferCatalogCompatibilityProfiles } from './compatibility-profiles';

const LAST_UPDATED = '2026-05-05';
const STALE_AFTER_DAYS = 90;

function pricing(
  input: number,
  output: number,
  notes?: string,
  overrides: Partial<CatalogPricing> = {},
): CatalogPricing {
  return {
    input,
    output,
    input_per_1m_tokens: input,
    output_per_1m_tokens: output,
    currency: 'USD',
    billing_unit: 'usd_per_1m_tokens',
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      ...overrides.units,
    },
    source_type: 'docs_review',
    source: 'builtin-reference',
    source_url: 'https://github.com/seanbabalala/ai-gateway/blob/main/docs/PROVIDER_CATALOG.md',
    retrieved_at: LAST_UPDATED,
    last_verified_at: LAST_UPDATED,
    last_updated: LAST_UPDATED,
    manual_review_required: true,
    review_reason: 'Built-in reference prices require operator review before production cost routing.',
    stale_after_days: STALE_AFTER_DAYS,
    pricing_confidence: 'low',
    ...(notes ? { notes } : {}),
    ...overrides,
  };
}

function promptCachingPricing(
  input: number,
  output: number,
  cacheReadInput: number,
  cacheCreationInput: number,
  notes?: string,
): CatalogPricing {
  return pricing(input, output, notes, {
    cache_read_input: cacheReadInput,
    cache_creation_input: cacheCreationInput,
    cache_read_per_1m_tokens: cacheReadInput,
    cache_write_per_1m_tokens: cacheCreationInput,
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      cache_read_input: 'usd_per_1m_cache_read_input_tokens',
      cache_creation_input: 'usd_per_1m_cache_write_input_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      cache_read_per_1m_tokens: 'usd_per_1m_cache_read_input_tokens',
      cache_write_per_1m_tokens: 'usd_per_1m_cache_write_input_tokens',
    },
  });
}

function referencePricing(
  sourceUrl: string,
  notes: string,
  overrides: Partial<CatalogPricing> = {},
): CatalogPricing {
  return {
    currency: overrides.currency || 'USD',
    billing_unit: overrides.billing_unit || overrides.unit || 'review_required',
    unit: overrides.unit || 'review_required',
    units: overrides.units,
    source_type: overrides.source_type || 'docs_review',
    source: overrides.source || 'provider-reference',
    source_url: sourceUrl,
    retrieved_at: overrides.retrieved_at || overrides.last_updated || LAST_UPDATED,
    last_verified_at: overrides.last_verified_at || overrides.last_updated || LAST_UPDATED,
    last_updated: overrides.last_updated || LAST_UPDATED,
    manual_review_required: true,
    review_reason:
      overrides.review_reason ||
      'Provider price depends on account, region, or SKU; verify official docs before production routing.',
    stale_after_days: overrides.stale_after_days || STALE_AFTER_DAYS,
    pricing_confidence: overrides.pricing_confidence || 'low',
    notes,
    ...overrides,
  };
}

function embeddingPricing(input: number, notes?: string): CatalogPricing {
  return pricing(input, 0, notes, {
    embedding: input,
    embedding_per_1m_tokens: input,
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      embedding: 'usd_per_1m_embedding_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      embedding_per_1m_tokens: 'usd_per_1m_embedding_tokens',
    },
  });
}

function imagePricing(input: number, notes?: string): CatalogPricing {
  return pricing(input, 0, notes, {
    image: input,
    image_per_generation: input,
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      image: 'usd_per_image_or_token_equivalent',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      image_per_generation: 'usd_per_image_generation_or_token_equivalent',
    },
  });
}

function audioPricing(input: number, output = 0, notes?: string): CatalogPricing {
  return pricing(input, output, notes, {
    audio: input,
    audio_per_minute: input,
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      audio: 'usd_per_audio_minute_or_token_equivalent',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      audio_per_minute: 'usd_per_audio_minute_or_token_equivalent',
    },
  });
}

function rerankPricing(input: number, notes?: string): CatalogPricing {
  return pricing(input, 0, notes, {
    rerank: input,
    rerank_per_1k_requests: input,
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      rerank: 'usd_per_1k_rerank_requests_or_token_equivalent',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      rerank_per_1k_requests: 'usd_per_1k_rerank_requests_or_token_equivalent',
    },
  });
}

type BuiltinCatalogModelInput = Omit<
  CatalogProvider['models'][number],
  'provider' | 'source' | 'overridden'
> &
  Partial<Pick<CatalogProvider['models'][number], 'provider' | 'source' | 'overridden'>>;

type BuiltinCatalogProviderInput = Omit<CatalogProvider, 'source' | 'overridden' | 'models'> & {
  models: BuiltinCatalogModelInput[];
};

function provider(providerConfig: BuiltinCatalogProviderInput): CatalogProvider {
  const providerPricing = providerConfig.pricing
    ? { ...providerConfig.pricing }
    : providerConfig.models.find((model) => model.pricing)?.pricing;
  const models = providerConfig.models.map((model) => ({
    ...model,
    provider: model.provider || providerConfig.id,
    source: 'builtin' as const,
    overridden: false,
  }));
  return {
    ...providerConfig,
    aliases: providerConfig.aliases || defaultProviderAliases(providerConfig),
    family: providerConfig.family || inferProviderFamily(providerConfig),
    category: providerConfig.category || inferProviderFamily(providerConfig),
    provider_type: providerConfig.provider_type || inferProviderType(providerConfig),
    homepage_url: providerConfig.homepage_url || defaultProviderHomepage(providerConfig),
    docs_url: providerConfig.docs_url || providerPricing?.source_url || defaultProviderHomepage(providerConfig),
    pricing_url: providerConfig.pricing_url || providerPricing?.source_url || defaultProviderHomepage(providerConfig),
    logo_id: providerConfig.logo_id || providerConfig.id,
    modalities: providerConfig.modalities || inferProviderModalities(models),
    input_types: providerConfig.input_types || inferProviderInputTypes(models),
    output_types: providerConfig.output_types || inferProviderOutputTypes(models),
    model_buckets: providerConfig.model_buckets || inferProviderModelBuckets(models),
    compatibility_profile: providerConfig.compatibility_profile || inferCompatibilityProfile(providerConfig),
    pricing: providerPricing ? { ...providerPricing } : undefined,
    compatibility_profiles:
      providerConfig.compatibility_profiles ||
      inferCatalogCompatibilityProfiles(providerConfig as CatalogProvider),
    source: 'builtin',
    overridden: false,
    models,
  };
}

function defaultProviderAliases(providerConfig: BuiltinCatalogProviderInput): string[] {
  return Array.from(
    new Set([
      providerConfig.id,
      providerConfig.name,
      ...(providerConfig.model_prefixes || []),
    ].map((item) => item.toLowerCase())),
  );
}

function defaultProviderHomepage(providerConfig: BuiltinCatalogProviderInput): string {
  try {
    const url = new URL(providerConfig.base_url.replace('{resource}', 'example').replace('{region}', 'us-east-1'));
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return providerConfig.base_url;
  }
}

function inferProviderFamily(providerConfig: BuiltinCatalogProviderInput): string {
  if (providerConfig.id === 'openai-compatible') return 'custom';
  if (providerConfig.capabilities?.includes('china_region')) return 'china_provider';
  if (providerConfig.capabilities?.includes('local')) return 'self_hosted';
  if (providerConfig.capabilities?.includes('model_marketplace') || providerConfig.capabilities?.includes('multi_provider')) return 'aggregator';
  if (providerConfig.modalities?.some((modality) => modality === 'image' || modality === 'video')) return 'media';
  if (providerConfig.modalities?.includes('audio')) return 'speech_audio';
  if (providerConfig.capabilities?.includes('managed_models')) return 'cloud_platform';
  return 'foundation_model';
}

function inferProviderType(providerConfig: BuiltinCatalogProviderInput): NonNullable<CatalogProvider['provider_type']> {
  if (providerConfig.capabilities?.includes('local')) return 'local';
  if (providerConfig.capabilities?.includes('self_hosted')) return 'self_hosted';
  if (providerConfig.capabilities?.includes('model_marketplace') || providerConfig.capabilities?.includes('multi_provider')) return 'aggregator';
  if (providerConfig.capabilities?.includes('managed_models') || providerConfig.capabilities?.includes('cloud_platform')) return 'cloud';
  if (providerConfig.modalities?.some((modality) => modality === 'image' || modality === 'video')) return 'media';
  if (providerConfig.modalities?.includes('audio')) return 'speech';
  return 'direct';
}

function inferProviderInputTypes(models: CatalogProvider['models']): string[] {
  return Array.from(new Set(models.flatMap((model) => model.modalities).map((modality) => {
    if (modality === 'vision' || modality === 'image') return 'image';
    if (modality === 'embedding' || modality === 'rerank') return 'text';
    if (modality === 'realtime') return 'events';
    if (modality === 'batch') return 'file';
    return modality;
  })));
}

function inferProviderModalities(models: CatalogProvider['models']): NonNullable<CatalogProvider['modalities']> {
  return Array.from(new Set(models.flatMap((model) => model.modalities)));
}

function inferProviderOutputTypes(models: CatalogProvider['models']): string[] {
  return Array.from(new Set(models.flatMap((model) => model.modalities).map((modality) => {
    if (modality === 'vision') return 'text';
    if (modality === 'embedding') return 'embedding';
    if (modality === 'rerank') return 'ranked_documents';
    if (modality === 'realtime') return 'events';
    if (modality === 'batch') return 'file';
    return modality;
  })));
}

function inferProviderModelBuckets(models: CatalogProvider['models']): NonNullable<CatalogProvider['model_buckets']> {
  const buckets: NonNullable<CatalogProvider['model_buckets']> = {};
  for (const model of models) {
    const endpoints = Object.keys(model.endpoints);
    const push = (key: keyof NonNullable<CatalogProvider['model_buckets']>) => {
      buckets[key] = Array.from(new Set([...(buckets[key] || []), model.id]));
    };
    if (model.modalities.includes('embedding') || endpoints.includes('embeddings')) push('embedding_models');
    if (model.modalities.includes('rerank') || endpoints.includes('rerank')) push('rerank_models');
    if (model.modalities.includes('image') || endpoints.includes('image')) push('image_models');
    if (model.modalities.includes('audio') || endpoints.includes('audio') || endpoints.includes('audio_speech')) push('audio_models');
    if (model.modalities.includes('video') || endpoints.includes('video')) push('video_models');
    if (model.modalities.includes('realtime') || endpoints.includes('realtime')) push('realtime_models');
    if (model.modalities.includes('batch') || endpoints.includes('batch')) push('batch_models');
    if (model.modalities.includes('text') || model.modalities.includes('vision')) push('models');
  }
  return buckets;
}

function inferCompatibilityProfile(providerConfig: BuiltinCatalogProviderInput): string | string[] {
  if (providerConfig.id === 'aws-bedrock') return 'aws_bedrock_converse';
  if (providerConfig.id === 'google') return ['google_gemini_compatible', 'google_vertex_compatible'];
  if (providerConfig.id === 'anthropic') return 'anthropic_messages_compatible';
  if (providerConfig.capabilities?.includes('local')) return 'openai_compatible_local';
  if (providerConfig.capabilities?.includes('async_predictions')) return 'media_generation_async';
  if (providerConfig.capabilities?.includes('speech')) return 'speech_compatible';
  if (providerConfig.capabilities?.includes('openai_compatible')) return 'openai_compatible';
  return 'provider_native';
}

export const BUILTIN_PROVIDER_CATALOG: CatalogProvider[] = [
  provider({
    id: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/chat/completions',
      responses: '/v1/responses',
      embeddings: '/v1/embeddings',
      image: '/v1/images/generations',
      audio: '/v1/audio/transcriptions',
      realtime: '/v1/realtime',
      batch: '/v1/batches',
    },
    model_prefixes: ['gpt', 'o', 'text-embedding', 'dall-e'],
    capabilities: ['structured_output', 'streaming', 'tools', 'prompt_cache', 'read_cache'],
    prompt_cache: true,
    read_cache: true,
    models: [
      {
        id: 'gpt-4o',
        provider: 'openai',
        modalities: ['text', 'vision', 'batch'],
        endpoints: { chat_completions: '/v1/chat/completions', responses: '/v1/responses', batch: '/v1/batches' },
        capabilities: ['structured_output', 'streaming', 'tools', 'prompt_cache', 'read_cache'],
        limits: { max_context_tokens: 128000 },
        pricing: promptCachingPricing(2.5, 10, 1.25, 2.5),
        prompt_cache: true,
        read_cache: true,
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        modalities: ['text', 'vision', 'batch'],
        endpoints: { chat_completions: '/v1/chat/completions', responses: '/v1/responses', batch: '/v1/batches' },
        capabilities: ['structured_output', 'streaming', 'tools', 'prompt_cache', 'read_cache'],
        limits: { max_context_tokens: 128000 },
        pricing: promptCachingPricing(0.15, 0.6, 0.075, 0.15),
        prompt_cache: true,
        read_cache: true,
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'text-embedding-3-small',
        provider: 'openai',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        limits: { dimensions: [512, 1536] },
        pricing: embeddingPricing(0.02),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'gpt-image-1',
        provider: 'openai',
        modalities: ['image'],
        endpoints: { image: '/v1/images/generations' },
        capabilities: ['image_generation'],
        pricing: imagePricing(5, 'Image pricing varies by size and quality.'),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'gpt-4o-realtime-preview',
        provider: 'openai',
        modalities: ['text', 'audio', 'realtime'],
        endpoints: { realtime: '/v1/realtime' },
        capabilities: ['realtime', 'streaming'],
        pricing: audioPricing(5, 20, 'Realtime pricing varies by input/output modality.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'anthropic',
    name: 'Anthropic',
    base_url: 'https://api.anthropic.com',
    auth_type: 'x-api-key',
    endpoints: { messages: '/v1/messages' },
    model_prefixes: ['claude'],
    capabilities: ['streaming', 'tools', 'vision', 'prompt_cache', 'read_cache', 'write_cache'],
    prompt_cache: true,
    read_cache: true,
    write_cache: true,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        modalities: ['text', 'vision'],
        endpoints: { messages: '/v1/messages' },
        capabilities: ['streaming', 'tools', 'vision', 'prompt_cache', 'read_cache', 'write_cache'],
        limits: { max_context_tokens: 200000 },
        pricing: promptCachingPricing(3, 15, 0.3, 3.75),
        prompt_cache: true,
        read_cache: true,
        write_cache: true,
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'claude-haiku-4-20250514',
        provider: 'anthropic',
        modalities: ['text', 'vision'],
        endpoints: { messages: '/v1/messages' },
        capabilities: ['streaming', 'tools', 'vision', 'prompt_cache', 'read_cache', 'write_cache'],
        limits: { max_context_tokens: 200000 },
        pricing: promptCachingPricing(0.8, 4, 0.08, 1),
        prompt_cache: true,
        read_cache: true,
        write_cache: true,
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'google',
    name: 'Google Gemini / Vertex',
    base_url: 'https://generativelanguage.googleapis.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1beta/openai/chat/completions', embeddings: '/v1beta/openai/embeddings' },
    model_prefixes: ['gemini'],
    capabilities: ['vision', 'long_context'],
    models: [
      {
        id: 'gemini-2.5-pro',
        provider: 'google',
        modalities: ['text', 'vision', 'audio', 'video'],
        endpoints: { chat_completions: '/v1beta/openai/chat/completions' },
        capabilities: ['vision', 'long_context'],
        limits: { max_context_tokens: 1000000 },
        pricing: pricing(1.25, 10),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'text-embedding-004',
        provider: 'google',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1beta/openai/embeddings' },
        capabilities: ['embeddings'],
        pricing: embeddingPricing(0.01),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'azure-openai',
    name: 'Azure OpenAI',
    base_url: 'https://{resource}.openai.azure.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/openai/deployments/{deployment}/chat/completions', embeddings: '/openai/deployments/{deployment}/embeddings' },
    model_prefixes: ['gpt', 'text-embedding'],
    capabilities: ['structured_output', 'streaming'],
    models: [
      {
        id: 'gpt-4o',
        provider: 'azure-openai',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/openai/deployments/{deployment}/chat/completions' },
        capabilities: ['structured_output', 'streaming'],
        pricing: pricing(2.5, 10, 'Azure pricing depends on region and deployment.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'openrouter',
    name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['openai', 'anthropic', 'google', 'meta-llama', 'mistralai'],
    capabilities: ['openai_compatible', 'multi_provider'],
    models: [
      {
        id: 'openai/gpt-4o-mini',
        provider: 'openrouter',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['openai_compatible'],
        pricing: pricing(0.15, 0.6, 'OpenRouter pricing may include router-specific markups.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'groq',
    name: 'Groq',
    base_url: 'https://api.groq.com/openai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['llama', 'mixtral', 'gemma'],
    capabilities: ['openai_compatible', 'low_latency'],
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        provider: 'groq',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'low_latency'],
        pricing: pricing(0.59, 0.79),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'mistral',
    name: 'Mistral AI',
    base_url: 'https://api.mistral.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['mistral', 'codestral', 'pixtral'],
    capabilities: ['openai_compatible', 'vision'],
    models: [
      {
        id: 'mistral-large-latest',
        provider: 'mistral',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'tools'],
        pricing: pricing(2, 6),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'pixtral-large-latest',
        provider: 'mistral',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['vision'],
        pricing: pricing(2, 6),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'deepseek',
    name: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['deepseek'],
    capabilities: ['openai_compatible', 'reasoning'],
    models: [
      {
        id: 'deepseek-chat',
        provider: 'deepseek',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming'],
        pricing: pricing(0.27, 1.1),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'deepseek-reasoner',
        provider: 'deepseek',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['reasoning'],
        pricing: pricing(0.55, 2.19),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'xai',
    name: 'xAI',
    base_url: 'https://api.x.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['grok'],
    capabilities: ['openai_compatible', 'vision'],
    models: [
      {
        id: 'grok-3',
        provider: 'xai',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'vision'],
        pricing: pricing(3, 15),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'cohere',
    name: 'Cohere',
    base_url: 'https://api.cohere.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v2/chat', rerank: '/v2/rerank', embeddings: '/v2/embed' },
    model_prefixes: ['command', 'embed', 'rerank'],
    capabilities: ['rerank', 'embeddings'],
    models: [
      {
        id: 'command-r-plus',
        provider: 'cohere',
        modalities: ['text'],
        endpoints: { chat_completions: '/v2/chat' },
        capabilities: ['streaming', 'tools'],
        pricing: pricing(2.5, 10),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'rerank-v3.5',
        provider: 'cohere',
        modalities: ['text', 'rerank'],
        endpoints: { rerank: '/v2/rerank' },
        capabilities: ['rerank'],
        pricing: rerankPricing(0.01, 'Rerank pricing is often request-based; verify manually.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'voyage',
    name: 'Voyage AI',
    base_url: 'https://api.voyageai.com',
    auth_type: 'bearer',
    endpoints: { embeddings: '/v1/embeddings', rerank: '/v1/rerank' },
    model_prefixes: ['voyage', 'rerank'],
    capabilities: ['embeddings', 'rerank'],
    models: [
      {
        id: 'voyage-3-large',
        provider: 'voyage',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        limits: { dimensions: [256, 512, 1024, 2048] },
        pricing: embeddingPricing(0.18),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'jina',
    name: 'Jina AI',
    base_url: 'https://api.jina.ai',
    auth_type: 'bearer',
    endpoints: { embeddings: '/v1/embeddings', rerank: '/v1/rerank' },
    model_prefixes: ['jina'],
    capabilities: ['embeddings', 'rerank'],
    models: [
      {
        id: 'jina-embeddings-v3',
        provider: 'jina',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        pricing: embeddingPricing(0.02),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'together',
    name: 'Together AI',
    base_url: 'https://api.together.xyz',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['meta-llama', 'mistralai', 'Qwen'],
    capabilities: ['openai_compatible', 'open_weights'],
    models: [
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        provider: 'together',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming'],
        pricing: pricing(0.88, 0.88),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'fireworks',
    name: 'Fireworks AI',
    base_url: 'https://api.fireworks.ai/inference',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['accounts/fireworks/models', 'llama'],
    capabilities: ['openai_compatible', 'open_weights'],
    models: [
      {
        id: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
        provider: 'fireworks',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming'],
        pricing: pricing(0.9, 0.9),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'ollama',
    name: 'Ollama',
    base_url: 'http://localhost:11434',
    auth_type: 'none',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['llama', 'qwen', 'mistral', 'gemma'],
    capabilities: ['local', 'openai_compatible'],
    models: [
      {
        id: 'llama3.1',
        provider: 'ollama',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['local'],
        pricing: pricing(0, 0, 'Local model; hardware cost is not included.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'vllm',
    name: 'vLLM',
    base_url: 'http://localhost:8000',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['local', 'llama', 'qwen', 'mistral'],
    capabilities: ['local', 'openai_compatible'],
    models: [
      {
        id: 'local-model',
        provider: 'vllm',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['local', 'streaming'],
        pricing: pricing(0, 0, 'Local model; hardware cost is not included.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    base_url: 'https://bedrock-runtime.{region}.amazonaws.com',
    auth_type: 'none',
    endpoints: {
      chat_completions: '/model/{modelId}/converse',
      embeddings: '/model/{modelId}/invoke',
      image: '/model/{modelId}/invoke',
    },
    model_prefixes: ['amazon.', 'anthropic.', 'cohere.', 'meta.', 'mistral.', 'us.amazon.', 'us.anthropic.'],
    capabilities: ['managed_models', 'sigv4_required', 'region_pricing'],
    pricing: referencePricing(
      'https://aws.amazon.com/bedrock/pricing/',
      'Bedrock pricing varies by region, model provider, provisioned throughput, and inference profile. Configure verified local prices before cost routing.',
    ),
    models: [
      {
        id: 'us.amazon.nova-pro-v1:0',
        provider: 'aws-bedrock',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/model/us.amazon.nova-pro-v1:0/converse' },
        capabilities: ['managed_models', 'vision'],
        pricing: referencePricing(
          'https://aws.amazon.com/bedrock/pricing/',
          'Amazon Nova rates are region and throughput dependent.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        provider: 'aws-bedrock',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/model/anthropic.claude-3-5-sonnet-20241022-v2:0/converse' },
        capabilities: ['managed_models', 'vision', 'tools'],
        pricing: referencePricing(
          'https://aws.amazon.com/bedrock/pricing/',
          'Anthropic Bedrock pricing should be checked against the target AWS region.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'amazon.titan-embed-text-v2:0',
        provider: 'aws-bedrock',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/model/amazon.titan-embed-text-v2:0/invoke' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://aws.amazon.com/bedrock/pricing/',
          'Titan embedding prices vary by region.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'alibaba-qwen',
    name: 'Alibaba Qwen / Tongyi',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
      image: '/v1/images/generations',
      audio: '/v1/audio/transcriptions',
      video: '/v1/videos/generations',
    },
    model_prefixes: ['qwen', 'qwq', 'qvq', 'text-embedding', 'wan'],
    capabilities: ['openai_compatible', 'vision', 'multilingual', 'china_region'],
    pricing: referencePricing(
      'https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio',
      'DashScope prices vary by region, model family, and international/China billing plan.',
    ),
    models: [
      {
        id: 'qwen-plus',
        provider: 'alibaba-qwen',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'tools', 'structured_output'],
        pricing: referencePricing(
          'https://www.alibabacloud.com/help/en/model-studio/qwen-api',
          'Qwen chat aliases should be reviewed against Model Studio model/version docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'qwen-turbo',
        provider: 'alibaba-qwen',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'fast'],
        pricing: referencePricing(
          'https://www.alibabacloud.com/help/en/model-studio/qwen-api',
          'Qwen Turbo rates are docs-review references.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'qwen-vl-max',
        provider: 'alibaba-qwen',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['vision'],
        pricing: referencePricing(
          'https://www.alibabacloud.com/help/en/model-studio/qwen-vl-api',
          'Qwen-VL model availability and prices require local review.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'text-embedding-v4',
        provider: 'alibaba-qwen',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api',
          'Embedding prices vary by model and region.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'wan2.5-t2v-preview',
        provider: 'alibaba-qwen',
        modalities: ['video'],
        endpoints: { video: '/v1/videos/generations' },
        capabilities: ['video_generation'],
        pricing: referencePricing(
          'https://www.alibabacloud.com/help/en/model-studio/wan-video-generation',
          'Wan video generation is treated as async preview metadata in SiftGate.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'baidu-qianfan',
    name: 'Baidu Qianfan / Wenxin',
    base_url: 'https://qianfan.baidubce.com',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v2/chat/completions',
      embeddings: '/v2/embeddings',
      image: '/v2/images/generations',
    },
    model_prefixes: ['ernie', 'wenxin', 'bge'],
    capabilities: ['multilingual', 'china_region', 'openai_compatible'],
    pricing: referencePricing(
      'https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a',
      'Baidu Qianfan pricing depends on model, region, account plan, and token unit. Review locally before cost routing.',
    ),
    models: [
      {
        id: 'ernie-4.5-turbo-128k',
        provider: 'baidu-qianfan',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v2/chat/completions' },
        capabilities: ['streaming', 'long_context', 'vision'],
        limits: { max_context_tokens: 128000 },
        pricing: referencePricing(
          'https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43',
          'ERNIE model names and token prices should be checked against Qianfan docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'ernie-x1-turbo-32k',
        provider: 'baidu-qianfan',
        modalities: ['text'],
        endpoints: { chat_completions: '/v2/chat/completions' },
        capabilities: ['reasoning', 'streaming'],
        limits: { max_context_tokens: 32000 },
        pricing: referencePricing(
          'https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43',
          'ERNIE X1 pricing is a docs-review reference.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'volcengine-ark',
    name: 'Volcengine Ark / Doubao',
    base_url: 'https://ark.cn-beijing.volces.com/api',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v3/chat/completions',
      embeddings: '/v3/embeddings',
      image: '/v3/images/generations',
      audio: '/v3/audio/transcriptions',
      video: '/v3/videos/generations',
    },
    model_prefixes: ['doubao', 'ep-'],
    capabilities: ['openai_compatible', 'multimodal', 'china_region'],
    pricing: referencePricing(
      'https://www.volcengine.com/docs/82379/1949118',
      'Volcengine Ark model prices are deployment and endpoint dependent; operators should pin endpoint IDs and verified rates.',
    ),
    models: [
      {
        id: 'doubao-seed-1-6',
        provider: 'volcengine-ark',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v3/chat/completions' },
        capabilities: ['streaming', 'tools', 'vision'],
        pricing: referencePricing(
          'https://www.volcengine.com/docs/82379/1624284',
          'Doubao model catalog should be reviewed for exact endpoint IDs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'doubao-embedding-large-text',
        provider: 'volcengine-ark',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v3/embeddings' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://www.volcengine.com/docs/82379/1099522',
          'Doubao embedding prices are review-required references.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'doubao-seedance-1-0-pro',
        provider: 'volcengine-ark',
        modalities: ['video'],
        endpoints: { video: '/v3/videos/generations' },
        capabilities: ['video_generation'],
        pricing: referencePricing(
          'https://www.volcengine.com/docs/82379/1520757',
          'Seedance video generation is async/provider-specific and should be verified before routing.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'zhipu',
    name: 'Zhipu AI / GLM',
    base_url: 'https://open.bigmodel.cn/api/paas',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v4/chat/completions',
      embeddings: '/v4/embeddings',
      image: '/v4/images/generations',
    },
    model_prefixes: ['glm', 'chatglm', 'embedding', 'cogview'],
    capabilities: ['openai_compatible', 'reasoning', 'vision', 'china_region'],
    pricing: referencePricing(
      'https://docs.bigmodel.cn/cn/guide/models/price',
      'Zhipu pricing is published by model family and should be reviewed for the active account plan.',
    ),
    models: [
      {
        id: 'glm-4.5',
        provider: 'zhipu',
        modalities: ['text'],
        endpoints: { chat_completions: '/v4/chat/completions' },
        capabilities: ['reasoning', 'streaming', 'tools'],
        pricing: referencePricing(
          'https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5',
          'GLM-4.5 pricing is a review-required reference.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'glm-4.5v',
        provider: 'zhipu',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v4/chat/completions' },
        capabilities: ['vision', 'reasoning'],
        pricing: referencePricing(
          'https://docs.bigmodel.cn/cn/guide/models/multimodal/glm-4.5v',
          'GLM vision rates should be reviewed before cost routing.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'embedding-3',
        provider: 'zhipu',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v4/embeddings' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3',
          'Embedding model metadata is review-required.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'moonshot',
    name: 'Moonshot AI / Kimi',
    base_url: 'https://api.moonshot.cn',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['moonshot', 'kimi'],
    capabilities: ['openai_compatible', 'long_context', 'reasoning', 'china_region'],
    pricing: referencePricing(
      'https://platform.moonshot.cn/docs/pricing/chat',
      'Moonshot/Kimi pricing is review-required and varies by model family.',
    ),
    models: [
      {
        id: 'kimi-k2',
        provider: 'moonshot',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'tools', 'long_context'],
        pricing: referencePricing(
          'https://platform.moonshot.cn/docs/guide/use-kimi-k2',
          'Kimi K2 model versioning and prices should be reviewed before production routing.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'moonshot-v1-128k',
        provider: 'moonshot',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['long_context', 'streaming'],
        limits: { max_context_tokens: 128000 },
        pricing: referencePricing(
          'https://platform.moonshot.cn/docs/pricing/chat',
          'Moonshot v1 rates are docs-review references.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'minimax',
    name: 'MiniMax',
    base_url: 'https://api.minimax.io',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/text/chatcompletion_v2',
      audio: '/v1/t2a_v2',
      image: '/v1/image_generation',
      video: '/v1/video_generation',
    },
    model_prefixes: ['MiniMax', 'abab', 'speech', 'hailuo'],
    capabilities: ['multimodal', 'china_region'],
    pricing: referencePricing(
      'https://platform.minimaxi.com/document/price',
      'MiniMax prices vary by API family. Review text, speech, image, and video units separately.',
    ),
    models: [
      {
        id: 'MiniMax-M2',
        provider: 'minimax',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/text/chatcompletion_v2' },
        capabilities: ['streaming', 'tools'],
        pricing: referencePricing(
          'https://platform.minimaxi.com/docs/api-reference/text/chat-completion',
          'MiniMax text model aliases and prices require docs review.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'speech-02-hd',
        provider: 'minimax',
        modalities: ['audio'],
        endpoints: { audio_speech: '/v1/t2a_v2' },
        capabilities: ['speech'],
        pricing: referencePricing(
          'https://platform.minimaxi.com/docs/api-reference/audio/text-to-speech',
          'MiniMax speech pricing is unit-specific and review-required.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'hailuo-02',
        provider: 'minimax',
        modalities: ['video'],
        endpoints: { video: '/v1/video_generation' },
        capabilities: ['video_generation'],
        pricing: referencePricing(
          'https://platform.minimaxi.com/docs/api-reference/video/video-generation',
          'Hailuo video generation is async/provider-specific.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'tencent-hunyuan',
    name: 'Tencent Hunyuan',
    base_url: 'https://api.hunyuan.cloud.tencent.com',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
      image: '/v1/images/generations',
      video: '/v1/videos/generations',
    },
    model_prefixes: ['hunyuan', 'hy-'],
    capabilities: ['openai_compatible', 'multimodal', 'china_region'],
    pricing: referencePricing(
      'https://cloud.tencent.com/document/product/1729/97731',
      'Tencent Hunyuan prices vary by model, region, and API surface.',
    ),
    models: [
      {
        id: 'hunyuan-turbos-latest',
        provider: 'tencent-hunyuan',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'tools'],
        pricing: referencePricing(
          'https://cloud.tencent.com/document/product/1729/111007',
          'Hunyuan text models should be reviewed against Tencent Cloud docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'hunyuan-vision',
        provider: 'tencent-hunyuan',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['vision'],
        pricing: referencePricing(
          'https://cloud.tencent.com/document/product/1729/111007',
          'Hunyuan vision model availability varies by account and region.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'hunyuan-video',
        provider: 'tencent-hunyuan',
        modalities: ['video'],
        endpoints: { video: '/v1/videos/generations' },
        capabilities: ['video_generation'],
        pricing: referencePricing(
          'https://cloud.tencent.com/document/product/1823/130078',
          'Hunyuan video generation is async/provider-specific and review-required.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: '01ai',
    name: '01.AI / Yi',
    base_url: 'https://api.lingyiwanwu.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['yi-'],
    capabilities: ['openai_compatible', 'china_region'],
    pricing: referencePricing(
      'https://platform.lingyiwanwu.com/docs',
      '01.AI/Yi public API availability and pricing should be verified by the operator.',
    ),
    models: [
      {
        id: 'yi-lightning',
        provider: '01ai',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'fast'],
        pricing: referencePricing(
          'https://platform.lingyiwanwu.com/docs',
          'Yi model metadata is a review-required reference.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'replicate',
    name: 'Replicate',
    base_url: 'https://api.replicate.com',
    auth_type: 'bearer',
    endpoints: {
      image: '/v1/models/{owner}/{model}/predictions',
      video: '/v1/models/{owner}/{model}/predictions',
      chat_completions: '/v1/models/{owner}/{model}/predictions',
    },
    model_prefixes: ['black-forest-labs/', 'minimax/', 'stability-ai/', 'meta/'],
    capabilities: ['model_marketplace', 'async_predictions', 'manual_adapter_required'],
    pricing: referencePricing(
      'https://replicate.com/pricing',
      'Replicate pricing is model and hardware dependent. SiftGate treats these entries as routing metadata until an operator pins exact model costs.',
    ),
    models: [
      {
        id: 'black-forest-labs/flux-schnell',
        provider: 'replicate',
        modalities: ['image'],
        endpoints: { image: '/v1/models/black-forest-labs/flux-schnell/predictions' },
        capabilities: ['image_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://replicate.com/black-forest-labs/flux-schnell',
          'Replicate model prices are hardware/version dependent.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'minimax/hailuo-02',
        provider: 'replicate',
        modalities: ['video'],
        endpoints: { video: '/v1/models/minimax/hailuo-02/predictions' },
        capabilities: ['video_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://replicate.com/minimax/hailuo-02',
          'Replicate video pricing is model and runtime dependent.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'perplexity',
    name: 'Perplexity',
    base_url: 'https://api.perplexity.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/chat/completions' },
    model_prefixes: ['sonar'],
    capabilities: ['search_grounded', 'openai_compatible'],
    pricing: referencePricing(
      'https://docs.perplexity.ai/guides/pricing',
      'Perplexity prices include model/token and search request components. Review before using cost routing.',
    ),
    models: [
      {
        id: 'sonar',
        provider: 'perplexity',
        modalities: ['text'],
        endpoints: { chat_completions: '/chat/completions' },
        capabilities: ['search_grounded', 'streaming'],
        pricing: referencePricing(
          'https://docs.perplexity.ai/guides/model-cards',
          'Sonar pricing includes search-specific units.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'sonar-pro',
        provider: 'perplexity',
        modalities: ['text'],
        endpoints: { chat_completions: '/chat/completions' },
        capabilities: ['search_grounded', 'streaming'],
        pricing: referencePricing(
          'https://docs.perplexity.ai/guides/pricing',
          'Sonar Pro pricing should be checked against current docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    base_url: 'https://integrate.api.nvidia.com',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
      rerank: '/v1/ranking',
    },
    model_prefixes: ['nvidia/', 'meta/', 'mistralai/', 'qwen/'],
    capabilities: ['openai_compatible', 'hosted_inference', 'rerank', 'embedding'],
    pricing: referencePricing(
      'https://docs.nvidia.com/nim/large-language-models/latest/pricing.html',
      'NVIDIA NIM pricing depends on hosted API plan or self-hosted infrastructure.',
    ),
    models: [
      {
        id: 'meta/llama-3.1-70b-instruct',
        provider: 'nvidia-nim',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'open_weights'],
        pricing: referencePricing(
          'https://build.nvidia.com/models',
          'NIM hosted model catalog changes frequently; verify exact model IDs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'nvidia/llama-3.2-nv-embedqa-1b-v2',
        provider: 'nvidia-nim',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://build.nvidia.com/models',
          'Embedding model prices depend on hosted/self-hosted plan.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'cerebras',
    name: 'Cerebras',
    base_url: 'https://api.cerebras.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['gpt-oss', 'llama', 'qwen'],
    capabilities: ['openai_compatible', 'low_latency'],
    pricing: referencePricing(
      'https://inference-docs.cerebras.ai/support/pricing',
      'Cerebras inference prices and available models should be reviewed before cost routing.',
    ),
    models: [
      {
        id: 'gpt-oss-120b',
        provider: 'cerebras',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'low_latency'],
        pricing: referencePricing(
          'https://inference-docs.cerebras.ai/introduction',
          'Cerebras model availability is docs-review metadata.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'llama3.1-8b',
        provider: 'cerebras',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'low_latency'],
        pricing: referencePricing(
          'https://inference-docs.cerebras.ai/introduction',
          'Cerebras rates should be verified against current pricing docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'sambanova',
    name: 'SambaNova Cloud',
    base_url: 'https://api.sambanova.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['Meta-Llama', 'Llama', 'DeepSeek', 'Qwen'],
    capabilities: ['openai_compatible', 'open_weights'],
    pricing: referencePricing(
      'https://docs.sambanova.ai/cloud/docs/get-started/pricing',
      'SambaNova Cloud pricing and model availability should be verified by the operator.',
    ),
    models: [
      {
        id: 'Meta-Llama-3.3-70B-Instruct',
        provider: 'sambanova',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'open_weights'],
        pricing: referencePricing(
          'https://docs.sambanova.ai/cloud/docs/capabilities/models',
          'SambaNova model IDs should be reviewed against current model docs.',
        ),
        source: 'builtin',
        overridden: false,
      },
      {
        id: 'Llama-4-Maverick-17B-128E-Instruct',
        provider: 'sambanova',
        modalities: ['text', 'vision'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['vision', 'streaming', 'open_weights'],
        pricing: referencePricing(
          'https://docs.sambanova.ai/cloud/docs/capabilities/models',
          'SambaNova multimodal model support should be verified before production routing.',
        ),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
  provider({
    id: 'huggingface',
    name: 'Hugging Face',
    aliases: ['hf', 'huggingface', 'hugging face', 'inference providers', 'tgi'],
    family: 'aggregator',
    provider_type: 'aggregator',
    homepage_url: 'https://huggingface.co',
    docs_url: 'https://huggingface.co/docs/inference-providers',
    pricing_url: 'https://huggingface.co/pricing#inference-providers',
    logo_id: 'huggingface',
    base_url: 'https://router.huggingface.co',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['meta-llama/', 'mistralai/', 'Qwen/', 'sentence-transformers/'],
    capabilities: ['openai_compatible', 'multi_provider', 'hosted_inference', 'model_marketplace'],
    pricing: referencePricing(
      'https://huggingface.co/pricing#inference-providers',
      'Hugging Face Inference Providers route across multiple upstream providers; model prices and routing providers should be reviewed per model.',
    ),
    models: [
      {
        id: 'meta-llama/Llama-3.3-70B-Instruct',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'open_weights'],
        pricing: referencePricing(
          'https://huggingface.co/docs/inference-providers/pricing',
          'Inference Provider prices depend on selected routed provider and model.',
        ),
      },
      {
        id: 'sentence-transformers/all-MiniLM-L6-v2',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings'],
        pricing: referencePricing(
          'https://huggingface.co/docs/inference-providers/tasks/feature-extraction',
          'Feature extraction cost depends on selected inference provider.',
        ),
      },
    ],
  }),
  provider({
    id: 'cloudflare-workers-ai',
    name: 'Cloudflare Workers AI',
    aliases: ['cloudflare', 'workers ai', 'cf ai'],
    family: 'cloud_platform',
    provider_type: 'cloud',
    homepage_url: 'https://developers.cloudflare.com/workers-ai/',
    docs_url: 'https://developers.cloudflare.com/workers-ai/',
    pricing_url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    logo_id: 'cloudflare',
    base_url: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/v1/chat/completions',
      embeddings: '/v1/embeddings',
      image: '/run/{model}',
    },
    model_prefixes: ['@cf/', '@hf/'],
    capabilities: ['cloud_platform', 'openai_compatible', 'edge_inference'],
    pricing: referencePricing(
      'https://developers.cloudflare.com/workers-ai/platform/pricing/',
      'Workers AI pricing uses neurons, requests, and model-specific units. Add reviewed local rates before cost routing.',
    ),
    models: [
      {
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['streaming', 'edge_inference'],
        pricing: referencePricing(
          'https://developers.cloudflare.com/workers-ai/models/',
          'Workers AI model availability and pricing are plan/model dependent.',
        ),
      },
      {
        id: '@cf/baai/bge-base-en-v1.5',
        modalities: ['text', 'embedding'],
        endpoints: { embeddings: '/v1/embeddings' },
        capabilities: ['embeddings', 'edge_inference'],
        pricing: referencePricing(
          'https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/',
          'Workers AI embedding pricing should be reviewed against Cloudflare model docs.',
        ),
      },
    ],
  }),
  provider({
    id: 'ibm-watsonx',
    name: 'IBM watsonx.ai',
    aliases: ['ibm', 'watsonx', 'watsonx.ai'],
    family: 'cloud_platform',
    provider_type: 'cloud',
    homepage_url: 'https://www.ibm.com/products/watsonx-ai',
    docs_url: 'https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-api.html',
    pricing_url: 'https://www.ibm.com/products/watsonx-ai/pricing',
    logo_id: 'ibm',
    base_url: 'https://{region}.ml.cloud.ibm.com',
    auth_type: 'bearer',
    endpoints: {
      chat_completions: '/ml/v1/text/chat?version=2023-05-29',
      embeddings: '/ml/v1/text/embeddings?version=2023-05-29',
    },
    model_prefixes: ['ibm/', 'meta-llama/', 'mistralai/'],
    capabilities: ['cloud_platform', 'managed_models', 'enterprise'],
    pricing: referencePricing(
      'https://www.ibm.com/products/watsonx-ai/pricing',
      'watsonx.ai pricing depends on deployment region, account plan, and foundation model units.',
    ),
    models: [
      {
        id: 'ibm/granite-3-8b-instruct',
        modalities: ['text'],
        endpoints: { chat_completions: '/ml/v1/text/chat?version=2023-05-29' },
        capabilities: ['enterprise', 'streaming'],
        pricing: referencePricing(
          'https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-models.html',
          'IBM Granite model prices should be reviewed against watsonx account pricing.',
        ),
      },
      {
        id: 'meta-llama/llama-3-3-70b-instruct',
        modalities: ['text'],
        endpoints: { chat_completions: '/ml/v1/text/chat?version=2023-05-29' },
        capabilities: ['open_weights'],
        pricing: referencePricing(
          'https://dataplatform.cloud.ibm.com/docs/content/wsj/analyze-data/fm-models.html',
          'Third-party watsonx model prices are docs-review references.',
        ),
      },
    ],
  }),
  provider({
    id: 'baseten',
    name: 'Baseten',
    aliases: ['baseten', 'truss'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://www.baseten.co',
    docs_url: 'https://docs.baseten.co',
    pricing_url: 'https://www.baseten.co/pricing',
    logo_id: 'baseten',
    base_url: 'https://model-{model_id}.api.baseten.co',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['baseten-', 'custom-'],
    capabilities: ['self_hosted', 'openai_compatible', 'deployment_pricing'],
    pricing: referencePricing(
      'https://www.baseten.co/pricing',
      'Baseten costs depend on deployment hardware and autoscaling. Store exact deployment costs in local overrides.',
    ),
    models: [
      {
        id: 'baseten/custom-chat-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['self_hosted', 'streaming'],
        pricing: referencePricing(
          'https://docs.baseten.co/deploy/invoke/model-apis',
          'Baseten model APIs are deployment-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'lepton',
    name: 'Lepton AI',
    aliases: ['lepton', 'lepton ai'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://www.lepton.ai',
    docs_url: 'https://www.lepton.ai/docs',
    pricing_url: 'https://www.lepton.ai/pricing',
    logo_id: 'lepton',
    base_url: 'https://api.lepton.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/api/v1/chat/completions', embeddings: '/api/v1/embeddings' },
    model_prefixes: ['llama', 'qwen', 'mistral', 'custom'],
    capabilities: ['self_hosted', 'openai_compatible', 'deployment_pricing'],
    pricing: referencePricing(
      'https://www.lepton.ai/pricing',
      'Lepton pricing depends on endpoint deployment resources and selected hosted models.',
    ),
    models: [
      {
        id: 'llama3.1-8b',
        modalities: ['text'],
        endpoints: { chat_completions: '/api/v1/chat/completions' },
        capabilities: ['streaming', 'open_weights'],
        pricing: referencePricing(
          'https://www.lepton.ai/docs/guides/inference',
          'Lepton model IDs and prices are deployment-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'modal',
    name: 'Modal',
    aliases: ['modal', 'modal labs'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://modal.com',
    docs_url: 'https://modal.com/docs',
    pricing_url: 'https://modal.com/pricing',
    logo_id: 'modal',
    base_url: 'https://{workspace}--{app}.modal.run',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['modal-', 'custom-', 'llama'],
    capabilities: ['self_hosted', 'openai_compatible', 'serverless_gpu'],
    pricing: referencePricing(
      'https://modal.com/pricing',
      'Modal costs depend on GPU/CPU resources, duration, and custom app behavior.',
    ),
    models: [
      {
        id: 'modal/custom-openai-compatible',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['self_hosted', 'serverless_gpu'],
        pricing: referencePricing(
          'https://modal.com/docs/examples/vllm_inference',
          'Modal OpenAI-compatible serving is app-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'runpod',
    name: 'RunPod',
    aliases: ['runpod', 'runpod serverless'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://www.runpod.io',
    docs_url: 'https://docs.runpod.io',
    pricing_url: 'https://www.runpod.io/pricing',
    logo_id: 'runpod',
    base_url: 'https://api.runpod.ai/v2/{endpoint_id}',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/openai/v1/chat/completions', embeddings: '/openai/v1/embeddings' },
    model_prefixes: ['runpod-', 'llama', 'qwen', 'custom'],
    capabilities: ['self_hosted', 'openai_compatible', 'serverless_gpu'],
    pricing: referencePricing(
      'https://www.runpod.io/pricing',
      'RunPod pricing depends on GPU type, endpoint mode, runtime duration, and storage/network usage.',
    ),
    models: [
      {
        id: 'runpod/vllm-openai-compatible',
        modalities: ['text'],
        endpoints: { chat_completions: '/openai/v1/chat/completions' },
        capabilities: ['self_hosted', 'streaming'],
        pricing: referencePricing(
          'https://docs.runpod.io/serverless/workers/vllm/get-started',
          'RunPod vLLM endpoints are deployment-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'predibase',
    name: 'Predibase',
    aliases: ['predibase', 'lorax'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://predibase.com',
    docs_url: 'https://docs.predibase.com',
    pricing_url: 'https://predibase.com/pricing',
    logo_id: 'predibase',
    base_url: 'https://serving.app.predibase.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['predibase/', 'llama', 'mistral'],
    capabilities: ['self_hosted', 'openai_compatible', 'fine_tuning'],
    pricing: referencePricing(
      'https://predibase.com/pricing',
      'Predibase prices depend on serving deployment, fine-tuned adapter, and compute tier.',
    ),
    models: [
      {
        id: 'predibase/llama-3-1-8b-instruct',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['fine_tuning', 'streaming'],
        pricing: referencePricing(
          'https://docs.predibase.com/user-guide/inference/overview',
          'Predibase model endpoints and adapters are deployment-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'lamini',
    name: 'Lamini',
    aliases: ['lamini'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://www.lamini.ai',
    docs_url: 'https://docs.lamini.ai',
    pricing_url: 'https://www.lamini.ai/pricing',
    logo_id: 'lamini',
    base_url: 'https://api.lamini.ai',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: ['lamini', 'llama', 'custom'],
    capabilities: ['fine_tuning', 'enterprise', 'deployment_pricing'],
    pricing: referencePricing(
      'https://www.lamini.ai/pricing',
      'Lamini pricing depends on hosted/private deployment and fine-tuning plan.',
    ),
    models: [
      {
        id: 'lamini/custom-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['fine_tuning'],
        pricing: referencePricing(
          'https://docs.lamini.ai',
          'Lamini model IDs and deployment costs are operator-specific.',
        ),
      },
    ],
  }),
  provider({
    id: 'ai21',
    name: 'AI21 Labs',
    aliases: ['ai21', 'jamba'],
    family: 'foundation_model',
    provider_type: 'direct',
    homepage_url: 'https://www.ai21.com',
    docs_url: 'https://docs.ai21.com',
    pricing_url: 'https://www.ai21.com/pricing',
    logo_id: 'ai21',
    base_url: 'https://api.ai21.com',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/studio/v1/chat/completions' },
    model_prefixes: ['jamba'],
    capabilities: ['streaming', 'tools', 'enterprise'],
    pricing: referencePricing(
      'https://www.ai21.com/pricing',
      'AI21 pricing should be reviewed by model family and plan.',
    ),
    models: [
      {
        id: 'jamba-large',
        modalities: ['text'],
        endpoints: { chat_completions: '/studio/v1/chat/completions' },
        capabilities: ['streaming', 'tools'],
        pricing: referencePricing(
          'https://docs.ai21.com/docs/jamba-foundation-models',
          'Jamba model availability and rates are docs-review metadata.',
        ),
      },
    ],
  }),
  provider({
    id: 'fal',
    name: 'fal.ai',
    aliases: ['fal', 'fal.ai'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://fal.ai',
    docs_url: 'https://docs.fal.ai',
    pricing_url: 'https://fal.ai/pricing',
    logo_id: 'fal',
    base_url: 'https://queue.fal.run',
    auth_type: 'bearer',
    endpoints: { image: '/fal-ai/{model}', video: '/fal-ai/{model}' },
    model_prefixes: ['fal-ai/', 'black-forest-labs/', 'luma/'],
    capabilities: ['image_generation', 'video_generation', 'async_predictions'],
    pricing: referencePricing(
      'https://fal.ai/pricing',
      'fal.ai pricing depends on model, queue/runtime, resolution, and generation parameters.',
      { units: { image: 'usd_per_generation', video: 'usd_per_generation_or_second' } },
    ),
    models: [
      {
        id: 'fal-ai/flux/dev',
        modalities: ['image'],
        endpoints: { image: '/fal-ai/flux/dev' },
        capabilities: ['image_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://fal.ai/models/fal-ai/flux/dev',
          'fal.ai image model prices are model-specific.',
          { units: { image: 'usd_per_generation' } },
        ),
      },
      {
        id: 'fal-ai/veo3',
        modalities: ['video'],
        endpoints: { video: '/fal-ai/veo3' },
        capabilities: ['video_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://fal.ai/models/fal-ai/veo3',
          'fal.ai video model prices vary by duration and model.',
          { units: { video: 'usd_per_generation_or_second' } },
        ),
      },
    ],
  }),
  provider({
    id: 'stability-ai',
    name: 'Stability AI',
    aliases: ['stability', 'stability ai', 'stable diffusion'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://stability.ai',
    docs_url: 'https://platform.stability.ai/docs',
    pricing_url: 'https://platform.stability.ai/pricing',
    logo_id: 'stability',
    base_url: 'https://api.stability.ai',
    auth_type: 'bearer',
    endpoints: { image: '/v2beta/stable-image/generate/core', image_edit: '/v2beta/stable-image/edit' },
    model_prefixes: ['stable-', 'sd3'],
    capabilities: ['image_generation', 'image_edit'],
    pricing: referencePricing(
      'https://platform.stability.ai/pricing',
      'Stability AI pricing uses credits and image/video endpoint-specific units.',
      { units: { image: 'usd_or_credits_per_image' } },
    ),
    models: [
      {
        id: 'stable-image-core',
        modalities: ['image'],
        endpoints: { image: '/v2beta/stable-image/generate/core' },
        capabilities: ['image_generation'],
        pricing: referencePricing(
          'https://platform.stability.ai/docs/api-reference#tag/Generate',
          'Stable Image Core credit costs should be reviewed against current Stability pricing.',
          { units: { image: 'credits_per_image' } },
        ),
      },
    ],
  }),
  provider({
    id: 'black-forest-labs',
    name: 'Black Forest Labs',
    aliases: ['black forest labs', 'bfl', 'flux'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://blackforestlabs.ai',
    docs_url: 'https://docs.bfl.ai',
    pricing_url: 'https://docs.bfl.ai/pricing',
    logo_id: 'black-forest-labs',
    base_url: 'https://api.bfl.ai',
    auth_type: 'bearer',
    endpoints: { image: '/v1/flux-pro-1.1' },
    model_prefixes: ['flux'],
    capabilities: ['image_generation', 'async_predictions'],
    pricing: referencePricing(
      'https://docs.bfl.ai/pricing',
      'Black Forest Labs pricing is image model and parameter dependent.',
      { units: { image: 'usd_per_image' } },
    ),
    models: [
      {
        id: 'flux-pro-1.1',
        modalities: ['image'],
        endpoints: { image: '/v1/flux-pro-1.1' },
        capabilities: ['image_generation'],
        pricing: referencePricing(
          'https://docs.bfl.ai',
          'FLUX model prices should be reviewed against current BFL docs.',
          { units: { image: 'usd_per_image' } },
        ),
      },
    ],
  }),
  provider({
    id: 'ideogram',
    name: 'Ideogram',
    aliases: ['ideogram'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://ideogram.ai',
    docs_url: 'https://developer.ideogram.ai',
    pricing_url: 'https://ideogram.ai/pricing',
    logo_id: 'ideogram',
    base_url: 'https://api.ideogram.ai',
    auth_type: 'bearer',
    endpoints: { image: '/v1/ideogram-v3/generate', image_edit: '/v1/ideogram-v3/edit' },
    model_prefixes: ['ideogram'],
    capabilities: ['image_generation', 'image_edit'],
    pricing: referencePricing(
      'https://ideogram.ai/pricing',
      'Ideogram API costs depend on plan, generation endpoint, and image parameters.',
      { units: { image: 'usd_or_credits_per_image' } },
    ),
    models: [
      {
        id: 'ideogram-v3',
        modalities: ['image'],
        endpoints: { image: '/v1/ideogram-v3/generate' },
        capabilities: ['image_generation'],
        pricing: referencePricing(
          'https://developer.ideogram.ai/api-reference/api-reference/generate',
          'Ideogram image generation prices should be verified against current API pricing.',
          { units: { image: 'credits_per_image' } },
        ),
      },
    ],
  }),
  provider({
    id: 'luma',
    name: 'Luma AI',
    aliases: ['luma', 'luma ai', 'dream machine'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://lumalabs.ai',
    docs_url: 'https://docs.lumalabs.ai',
    pricing_url: 'https://lumalabs.ai/api/pricing',
    logo_id: 'luma',
    base_url: 'https://api.lumalabs.ai',
    auth_type: 'bearer',
    endpoints: { video: '/dream-machine/v1/generations', video_status: '/dream-machine/v1/generations/{id}' },
    model_prefixes: ['ray', 'dream-machine'],
    capabilities: ['video_generation', 'async_predictions'],
    pricing: referencePricing(
      'https://lumalabs.ai/api/pricing',
      'Luma video/image pricing varies by model, duration, and generation settings.',
      { units: { video: 'usd_per_generation_or_second' } },
    ),
    models: [
      {
        id: 'ray-2',
        modalities: ['video'],
        endpoints: { video: '/dream-machine/v1/generations' },
        capabilities: ['video_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://docs.lumalabs.ai/docs/api',
          'Luma generation costs are async and model-specific.',
          { units: { video: 'usd_per_generation_or_second' } },
        ),
      },
    ],
  }),
  provider({
    id: 'runway',
    name: 'Runway',
    aliases: ['runway', 'runwayml', 'gen-4'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://runwayml.com',
    docs_url: 'https://docs.dev.runwayml.com',
    pricing_url: 'https://runwayml.com/pricing',
    logo_id: 'runway',
    base_url: 'https://api.dev.runwayml.com',
    auth_type: 'bearer',
    endpoints: { video: '/v1/image_to_video', video_status: '/v1/tasks/{id}' },
    model_prefixes: ['gen4', 'gen3'],
    capabilities: ['video_generation', 'async_predictions'],
    pricing: referencePricing(
      'https://runwayml.com/pricing',
      'Runway API pricing depends on plan, credits, model generation type, and duration.',
      { units: { video: 'credits_per_generation_or_second' } },
    ),
    models: [
      {
        id: 'gen4_turbo',
        modalities: ['video'],
        endpoints: { video: '/v1/image_to_video' },
        capabilities: ['video_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://docs.dev.runwayml.com/api/',
          'Runway model IDs and credit costs should be reviewed before routing.',
          { units: { video: 'credits_per_generation_or_second' } },
        ),
      },
    ],
  }),
  provider({
    id: 'pika',
    name: 'Pika',
    aliases: ['pika', 'pika labs'],
    family: 'media',
    provider_type: 'media',
    homepage_url: 'https://pika.art',
    docs_url: 'https://docs.pika.art',
    pricing_url: 'https://pika.art/pricing',
    logo_id: 'pika',
    base_url: 'https://api.pika.art',
    auth_type: 'bearer',
    endpoints: { video: '/v1/videos', video_status: '/v1/videos/{id}' },
    model_prefixes: ['pika'],
    capabilities: ['video_generation', 'async_predictions'],
    pricing: referencePricing(
      'https://pika.art/pricing',
      'Pika API pricing and availability are plan/model dependent.',
      { units: { video: 'credits_per_generation_or_second' } },
    ),
    models: [
      {
        id: 'pika-2.2',
        modalities: ['video'],
        endpoints: { video: '/v1/videos' },
        capabilities: ['video_generation', 'async_predictions'],
        pricing: referencePricing(
          'https://docs.pika.art',
          'Pika video generation metadata should be reviewed against current docs.',
          { units: { video: 'credits_per_generation_or_second' } },
        ),
      },
    ],
  }),
  provider({
    id: 'elevenlabs',
    name: 'ElevenLabs',
    aliases: ['elevenlabs', 'eleven labs', '11labs'],
    family: 'speech_audio',
    provider_type: 'speech',
    homepage_url: 'https://elevenlabs.io',
    docs_url: 'https://elevenlabs.io/docs',
    pricing_url: 'https://elevenlabs.io/pricing',
    logo_id: 'elevenlabs',
    base_url: 'https://api.elevenlabs.io',
    auth_type: 'x-api-key',
    endpoints: { audio_speech: '/v1/text-to-speech/{voice_id}', audio: '/v1/speech-to-text' },
    model_prefixes: ['eleven_', 'scribe_'],
    capabilities: ['speech', 'transcription', 'voice'],
    pricing: referencePricing(
      'https://elevenlabs.io/pricing',
      'ElevenLabs pricing uses character/minute and plan-specific units. Configure verified local rates for billing.',
      { units: { audio: 'usd_per_character_or_minute' } },
    ),
    models: [
      {
        id: 'eleven_multilingual_v2',
        modalities: ['audio'],
        endpoints: { audio_speech: '/v1/text-to-speech/{voice_id}' },
        capabilities: ['speech', 'voice'],
        pricing: referencePricing(
          'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
          'ElevenLabs TTS costs are character/plan dependent.',
          { units: { audio: 'characters_or_credits' } },
        ),
      },
      {
        id: 'scribe_v1',
        modalities: ['audio'],
        endpoints: { audio: '/v1/speech-to-text' },
        capabilities: ['transcription'],
        pricing: referencePricing(
          'https://elevenlabs.io/docs/api-reference/speech-to-text/convert',
          'ElevenLabs STT costs should be reviewed against current plan pricing.',
          { units: { audio: 'usd_per_audio_minute_or_credit' } },
        ),
      },
    ],
  }),
  provider({
    id: 'deepgram',
    name: 'Deepgram',
    aliases: ['deepgram'],
    family: 'speech_audio',
    provider_type: 'speech',
    homepage_url: 'https://deepgram.com',
    docs_url: 'https://developers.deepgram.com',
    pricing_url: 'https://deepgram.com/pricing',
    logo_id: 'deepgram',
    base_url: 'https://api.deepgram.com',
    auth_type: 'bearer',
    endpoints: { audio: '/v1/listen', audio_speech: '/v1/speak' },
    model_prefixes: ['nova', 'aura'],
    capabilities: ['transcription', 'speech', 'streaming_audio'],
    pricing: referencePricing(
      'https://deepgram.com/pricing',
      'Deepgram pricing varies by speech-to-text/text-to-speech model and audio duration.',
      { units: { audio: 'usd_per_audio_minute_or_character' } },
    ),
    models: [
      {
        id: 'nova-3',
        modalities: ['audio'],
        endpoints: { audio: '/v1/listen' },
        capabilities: ['transcription', 'streaming_audio'],
        pricing: referencePricing(
          'https://developers.deepgram.com/docs/model',
          'Deepgram STT prices should be reviewed against current pricing.',
          { units: { audio: 'usd_per_audio_minute' } },
        ),
      },
      {
        id: 'aura-2',
        modalities: ['audio'],
        endpoints: { audio_speech: '/v1/speak' },
        capabilities: ['speech'],
        pricing: referencePricing(
          'https://developers.deepgram.com/docs/tts-models',
          'Deepgram TTS pricing is model and character dependent.',
          { units: { audio: 'usd_per_character_or_minute' } },
        ),
      },
    ],
  }),
  provider({
    id: 'assemblyai',
    name: 'AssemblyAI',
    aliases: ['assemblyai', 'assembly ai'],
    family: 'speech_audio',
    provider_type: 'speech',
    homepage_url: 'https://www.assemblyai.com',
    docs_url: 'https://www.assemblyai.com/docs',
    pricing_url: 'https://www.assemblyai.com/pricing',
    logo_id: 'assemblyai',
    base_url: 'https://api.assemblyai.com',
    auth_type: 'x-api-key',
    endpoints: { audio: '/v2/transcript' },
    model_prefixes: ['best', 'nano'],
    capabilities: ['transcription', 'audio_intelligence', 'async_jobs'],
    pricing: referencePricing(
      'https://www.assemblyai.com/pricing',
      'AssemblyAI prices are audio duration and feature dependent.',
      { units: { audio: 'usd_per_audio_hour_or_minute' } },
    ),
    models: [
      {
        id: 'best',
        modalities: ['audio'],
        endpoints: { audio: '/v2/transcript' },
        capabilities: ['transcription', 'async_jobs'],
        pricing: referencePricing(
          'https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio',
          'AssemblyAI transcription pricing should be reviewed by selected model and features.',
          { units: { audio: 'usd_per_audio_hour_or_minute' } },
        ),
      },
    ],
  }),
  provider({
    id: 'cartesia',
    name: 'Cartesia',
    aliases: ['cartesia', 'sonic'],
    family: 'speech_audio',
    provider_type: 'speech',
    homepage_url: 'https://cartesia.ai',
    docs_url: 'https://docs.cartesia.ai',
    pricing_url: 'https://cartesia.ai/pricing',
    logo_id: 'cartesia',
    base_url: 'https://api.cartesia.ai',
    auth_type: 'bearer',
    endpoints: { audio_speech: '/tts/bytes' },
    model_prefixes: ['sonic'],
    capabilities: ['speech', 'low_latency_audio'],
    pricing: referencePricing(
      'https://cartesia.ai/pricing',
      'Cartesia pricing is voice/model and character/audio-duration dependent.',
      { units: { audio: 'usd_per_character_or_minute' } },
    ),
    models: [
      {
        id: 'sonic-2',
        modalities: ['audio'],
        endpoints: { audio_speech: '/tts/bytes' },
        capabilities: ['speech', 'low_latency_audio'],
        pricing: referencePricing(
          'https://docs.cartesia.ai/api-reference/tts/bytes',
          'Cartesia TTS pricing should be reviewed before cost routing.',
          { units: { audio: 'usd_per_character_or_minute' } },
        ),
      },
    ],
  }),
  provider({
    id: 'speechmatics',
    name: 'Speechmatics',
    aliases: ['speechmatics'],
    family: 'speech_audio',
    provider_type: 'speech',
    homepage_url: 'https://www.speechmatics.com',
    docs_url: 'https://docs.speechmatics.com',
    pricing_url: 'https://www.speechmatics.com/pricing',
    logo_id: 'speechmatics',
    base_url: 'https://asr.api.speechmatics.com',
    auth_type: 'bearer',
    endpoints: { audio: '/v2/jobs' },
    model_prefixes: ['speechmatics'],
    capabilities: ['transcription', 'async_jobs'],
    pricing: referencePricing(
      'https://www.speechmatics.com/pricing',
      'Speechmatics pricing depends on transcription mode, language features, and audio duration.',
      { units: { audio: 'usd_per_audio_hour_or_minute' } },
    ),
    models: [
      {
        id: 'speechmatics-asr',
        modalities: ['audio'],
        endpoints: { audio: '/v2/jobs' },
        capabilities: ['transcription', 'async_jobs'],
        pricing: referencePricing(
          'https://docs.speechmatics.com/api-ref/asr-transcription/submit-a-job',
          'Speechmatics transcription costs are duration and feature dependent.',
          { units: { audio: 'usd_per_audio_hour_or_minute' } },
        ),
      },
    ],
  }),
  provider({
    id: 'lm-studio',
    name: 'LM Studio',
    aliases: ['lm studio', 'lmstudio'],
    family: 'self_hosted',
    provider_type: 'local',
    homepage_url: 'https://lmstudio.ai',
    docs_url: 'https://lmstudio.ai/docs',
    pricing_url: 'https://lmstudio.ai/docs',
    logo_id: 'lm-studio',
    base_url: 'http://localhost:1234',
    auth_type: 'none',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['local', 'llama', 'qwen', 'mistral', 'gemma'],
    capabilities: ['local', 'openai_compatible', 'self_hosted'],
    pricing: pricing(0, 0, 'Local LM Studio costs depend on operator hardware and are not provider-billed.'),
    models: [
      {
        id: 'local-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['local', 'streaming'],
        pricing: pricing(0, 0, 'Local model; hardware cost is not included.'),
      },
    ],
  }),
  provider({
    id: 'llama-cpp',
    name: 'llama.cpp server',
    aliases: ['llama.cpp', 'llama cpp', 'llamacpp'],
    family: 'self_hosted',
    provider_type: 'local',
    homepage_url: 'https://github.com/ggml-org/llama.cpp',
    docs_url: 'https://github.com/ggml-org/llama.cpp/tree/master/examples/server',
    pricing_url: 'https://github.com/ggml-org/llama.cpp/tree/master/examples/server',
    logo_id: 'llama-cpp',
    base_url: 'http://localhost:8080',
    auth_type: 'none',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['local', 'llama', 'gguf'],
    capabilities: ['local', 'openai_compatible', 'self_hosted'],
    pricing: pricing(0, 0, 'Local llama.cpp costs depend on operator hardware and are not provider-billed.'),
    models: [
      {
        id: 'local-gguf-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['local', 'streaming'],
        pricing: pricing(0, 0, 'Local GGUF model; hardware cost is not included.'),
      },
    ],
  }),
  provider({
    id: 'huggingface-tgi',
    name: 'Text Generation Inference / TGI',
    aliases: ['tgi', 'text generation inference', 'hf tgi'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://huggingface.co/docs/text-generation-inference',
    docs_url: 'https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/using_guidance',
    pricing_url: 'https://huggingface.co/docs/text-generation-inference',
    logo_id: 'huggingface',
    base_url: 'http://localhost:8080',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/embed' },
    model_prefixes: ['local', 'meta-llama', 'mistral', 'qwen'],
    capabilities: ['self_hosted', 'openai_compatible', 'streaming'],
    pricing: pricing(0, 0, 'Self-hosted TGI cost depends on operator hardware and deployment.'),
    models: [
      {
        id: 'tgi-local-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['self_hosted', 'streaming'],
        pricing: pricing(0, 0, 'Self-hosted TGI model; hardware cost is not included.'),
      },
    ],
  }),
  provider({
    id: 'sglang',
    name: 'SGLang',
    aliases: ['sglang', 'sgl'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://github.com/sgl-project/sglang',
    docs_url: 'https://docs.sglang.ai',
    pricing_url: 'https://docs.sglang.ai',
    logo_id: 'sglang',
    base_url: 'http://localhost:30000',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings' },
    model_prefixes: ['local', 'llama', 'qwen', 'deepseek'],
    capabilities: ['self_hosted', 'openai_compatible', 'low_latency'],
    pricing: pricing(0, 0, 'Self-hosted SGLang cost depends on operator hardware and deployment.'),
    models: [
      {
        id: 'sglang-local-model',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['self_hosted', 'streaming'],
        pricing: pricing(0, 0, 'Self-hosted SGLang model; hardware cost is not included.'),
      },
    ],
  }),
  provider({
    id: 'xinference',
    name: 'Xinference',
    aliases: ['xinference', 'xorbits inference'],
    family: 'self_hosted',
    provider_type: 'self_hosted',
    homepage_url: 'https://inference.readthedocs.io',
    docs_url: 'https://inference.readthedocs.io/en/latest/user_guide/client_api.html',
    pricing_url: 'https://inference.readthedocs.io',
    logo_id: 'xinference',
    base_url: 'http://localhost:9997',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', embeddings: '/v1/embeddings', rerank: '/v1/rerank' },
    model_prefixes: ['local', 'llama', 'qwen', 'bge', 'rerank'],
    capabilities: ['self_hosted', 'openai_compatible', 'embedding', 'rerank'],
    pricing: pricing(0, 0, 'Self-hosted Xinference cost depends on operator hardware and deployment.'),
    models: [
      {
        id: 'xinference-local-chat',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['self_hosted', 'streaming'],
        pricing: pricing(0, 0, 'Self-hosted Xinference chat model; hardware cost is not included.'),
      },
      {
        id: 'bge-reranker-v2-m3',
        modalities: ['rerank'],
        endpoints: { rerank: '/v1/rerank' },
        capabilities: ['rerank', 'self_hosted'],
        pricing: rerankPricing(0, 'Self-hosted rerank model; hardware cost is not included.'),
      },
    ],
  }),
  provider({
    id: 'openai-compatible',
    name: 'OpenAI-compatible custom',
    base_url: 'https://your-provider.example',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions', responses: '/v1/responses', embeddings: '/v1/embeddings' },
    model_prefixes: [],
    capabilities: ['openai_compatible', 'custom'],
    models: [
      {
        id: 'custom-model',
        provider: 'openai-compatible',
        modalities: ['text'],
        endpoints: { chat_completions: '/v1/chat/completions' },
        capabilities: ['custom'],
        pricing: pricing(0, 0, 'Replace with provider-specific pricing.'),
        source: 'builtin',
        overridden: false,
      },
    ],
  }),
];
