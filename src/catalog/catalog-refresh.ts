import type {
  CatalogCanonicalRegistry,
  CatalogIssue,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
} from './catalog.types';
import {
  buildOpenRouterCanonicalRegistry,
  materializeOpenRouterProviderModel,
  OpenRouterModelPayload,
} from './canonical-registry';
import {
  applyZeroEvalCanonicalOverlay,
  ZeroEvalModel,
} from './zeroeval-overlay';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';
export const ZEROEVAL_MODELS_URL =
  'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false';

export interface CatalogRefreshSource {
  provider: string;
  label: string;
  mode: 'public_api' | 'authenticated_api' | 'docs_review' | 'operator_local';
  source_url: string;
  automatic: boolean;
  pricing: 'live' | 'docs_only' | 'operator_required';
  notes: string;
}

export interface CatalogRefreshResult {
  provider: string;
  generated_at: string;
  source: CatalogRefreshSource;
  model_count: number;
  priced_model_count: number;
  canonical_model_count?: number;
  matched_model_count?: number;
  projected_model_count?: number;
  low_confidence_match_count?: number;
  unmatched_model_count?: number;
  ambiguous_match_count?: number;
  override: CatalogOverrideFile;
  issues: CatalogIssue[];
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelPayload[];
}

export const CATALOG_REFRESH_SOURCES: CatalogRefreshSource[] = [
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    mode: 'public_api',
    source_url: OPENROUTER_MODELS_URL,
    automatic: true,
    pricing: 'live',
    notes:
      'OpenRouter exposes the canonical primary model dataset for SiftGate v1.8, including model specs and reference pricing. It remains an aggregator source, not direct-provider billing authority.',
  },
  {
    provider: 'zeroeval',
    label: 'ZeroEval model enrichment',
    mode: 'public_api',
    source_url: ZEROEVAL_MODELS_URL,
    automatic: true,
    pricing: 'live',
    notes:
      'ZeroEval exposes a public multi-provider model leaderboard with reference pricing and technical metadata. SiftGate uses it as third-party enrichment, not billing authority.',
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    mode: 'docs_review',
    source_url: 'https://platform.openai.com/docs/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'OpenAI model listing needs an API key and public pricing is published on docs pages, so SiftGate treats built-in prices as review-required references.',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    mode: 'docs_review',
    source_url: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Anthropic publishes model and pricing references in docs. Operators should import reviewed overrides for production cost routing.',
  },
  {
    provider: 'google',
    label: 'Google Gemini / Vertex',
    mode: 'docs_review',
    source_url: 'https://ai.google.dev/gemini-api/docs/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Gemini and Vertex pricing depends on API surface, region, modality, and SKU. Built-in metadata is a review-required reference.',
  },
  {
    provider: 'azure-openai',
    label: 'Azure OpenAI',
    mode: 'operator_local',
    source_url: 'https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Azure pricing varies by region and deployment. Store verified rates in catalog.override.yaml or gateway config pricing.',
  },
  {
    provider: 'aws-bedrock',
    label: 'AWS Bedrock',
    mode: 'operator_local',
    source_url: 'https://aws.amazon.com/bedrock/pricing/',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Bedrock prices vary by AWS region, model provider, throughput mode, and inference profile. Add reviewed local pricing before cost routing.',
  },
  {
    provider: 'alibaba-qwen',
    label: 'Alibaba Qwen / Tongyi',
    mode: 'docs_review',
    source_url: 'https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio',
    automatic: false,
    pricing: 'docs_only',
    notes: 'DashScope pricing depends on region and model family. Keep exact rates in catalog.override.yaml for production routing.',
  },
  {
    provider: 'baidu-qianfan',
    label: 'Baidu Qianfan / Wenxin',
    mode: 'docs_review',
    source_url: 'https://cloud.baidu.com/doc/qianfan-docs/s/Jm8r1826a',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Qianfan pricing is documented by model and billing unit; operators should review current rates before using cost routing.',
  },
  {
    provider: 'volcengine-ark',
    label: 'Volcengine Ark / Doubao',
    mode: 'docs_review',
    source_url: 'https://www.volcengine.com/docs/82379/1949118',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Ark prices depend on model endpoint IDs and modality. Use local overrides for exact Doubao rates.',
  },
  {
    provider: 'zhipu',
    label: 'Zhipu AI / GLM',
    mode: 'docs_review',
    source_url: 'https://docs.bigmodel.cn/cn/guide/models/price',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Zhipu publishes GLM model and price references; verify current account pricing before production cost routing.',
  },
  {
    provider: 'moonshot',
    label: 'Moonshot AI / Kimi',
    mode: 'docs_review',
    source_url: 'https://platform.moonshot.cn/docs/pricing/chat',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Moonshot/Kimi pricing is docs-review metadata. Import reviewed overrides for exact model rates.',
  },
  {
    provider: 'minimax',
    label: 'MiniMax',
    mode: 'docs_review',
    source_url: 'https://platform.minimaxi.com/document/price',
    automatic: false,
    pricing: 'docs_only',
    notes: 'MiniMax prices vary across text, speech, image, and video APIs; keep unit-specific overrides locally.',
  },
  {
    provider: 'tencent-hunyuan',
    label: 'Tencent Hunyuan',
    mode: 'docs_review',
    source_url: 'https://cloud.tencent.com/document/product/1729/97731',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Tencent Hunyuan pricing varies by model, region, and API family. Review before cost routing.',
  },
  {
    provider: '01ai',
    label: '01.AI / Yi',
    mode: 'operator_local',
    source_url: 'https://platform.lingyiwanwu.com/docs',
    automatic: false,
    pricing: 'operator_required',
    notes: '01.AI/Yi public API availability and pricing should be verified by the operator before routing traffic.',
  },
  {
    provider: 'replicate',
    label: 'Replicate',
    mode: 'operator_local',
    source_url: 'https://replicate.com/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Replicate costs depend on model version and hardware runtime. Store exact model costs in local overrides.',
  },
  {
    provider: 'perplexity',
    label: 'Perplexity',
    mode: 'docs_review',
    source_url: 'https://docs.perplexity.ai/guides/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Perplexity pricing includes model and search request units. Review current docs before cost routing.',
  },
  {
    provider: 'nvidia-nim',
    label: 'NVIDIA NIM',
    mode: 'docs_review',
    source_url: 'https://build.nvidia.com/models',
    automatic: false,
    pricing: 'docs_only',
    notes: 'NIM hosted and self-hosted costs differ; verify model availability and rates before production routing.',
  },
  {
    provider: 'cerebras',
    label: 'Cerebras',
    mode: 'docs_review',
    source_url: 'https://inference-docs.cerebras.ai/support/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Cerebras model availability and prices should be reviewed against official inference docs.',
  },
  {
    provider: 'sambanova',
    label: 'SambaNova Cloud',
    mode: 'docs_review',
    source_url: 'https://docs.sambanova.ai/cloud/docs/get-started/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'SambaNova Cloud model support and pricing should be reviewed before using cost-aware routing.',
  },
  {
    provider: 'groq',
    label: 'Groq',
    mode: 'docs_review',
    source_url: 'https://groq.com/pricing/',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Groq model availability and rates are published outside the SiftGate catalog. Import reviewed overrides for production cost routing.',
  },
  {
    provider: 'mistral',
    label: 'Mistral AI',
    mode: 'docs_review',
    source_url: 'https://mistral.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Mistral pricing changes by model family and endpoint. Built-in metadata remains review-required.',
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    mode: 'docs_review',
    source_url: 'https://api-docs.deepseek.com/quick_start/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'DeepSeek publishes pricing in docs. Use catalog.override.yaml for reviewed local rates.',
  },
  {
    provider: 'xai',
    label: 'xAI',
    mode: 'docs_review',
    source_url: 'https://docs.x.ai/docs/models',
    automatic: false,
    pricing: 'docs_only',
    notes: 'xAI model and pricing metadata should be reviewed against official docs before cost routing.',
  },
  {
    provider: 'cohere',
    label: 'Cohere',
    mode: 'docs_review',
    source_url: 'https://cohere.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Cohere pricing depends on endpoint family such as chat, embed, and rerank. Import verified overrides for production.',
  },
  {
    provider: 'voyage',
    label: 'Voyage AI',
    mode: 'docs_review',
    source_url: 'https://www.voyageai.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Voyage AI embedding and rerank prices should be reviewed from official pricing before production cost routing.',
  },
  {
    provider: 'jina',
    label: 'Jina AI',
    mode: 'docs_review',
    source_url: 'https://jina.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Jina model buckets span embeddings, rerank, and readers. Keep reviewed model and pricing metadata in overrides.',
  },
  {
    provider: 'together',
    label: 'Together AI',
    mode: 'docs_review',
    source_url: 'https://www.together.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Together pricing and model availability can change by hosted model. Use local overrides for exact rates.',
  },
  {
    provider: 'fireworks',
    label: 'Fireworks AI',
    mode: 'docs_review',
    source_url: 'https://fireworks.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Fireworks rates vary by model and deployment style. Built-in catalog values are review-required references.',
  },
  {
    provider: 'ollama',
    label: 'Ollama',
    mode: 'operator_local',
    source_url: 'http://localhost:11434/api/tags',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Local model availability and cost depend on the operator machine or cluster.',
  },
  {
    provider: 'vllm',
    label: 'vLLM',
    mode: 'operator_local',
    source_url: 'http://localhost:8000/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Self-hosted OpenAI-compatible deployments need operator-supplied model and infrastructure cost metadata.',
  },
  {
    provider: 'huggingface',
    label: 'Hugging Face',
    mode: 'docs_review',
    source_url: 'https://huggingface.co/pricing#inference-providers',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Inference Providers route to multiple upstreams; review model/provider-specific pricing before cost routing.',
  },
  {
    provider: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    mode: 'docs_review',
    source_url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Workers AI pricing uses model-specific units and Cloudflare account plan settings.',
  },
  {
    provider: 'ibm-watsonx',
    label: 'IBM watsonx.ai',
    mode: 'docs_review',
    source_url: 'https://www.ibm.com/products/watsonx-ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'watsonx pricing depends on region, plan, and selected foundation model.',
  },
  {
    provider: 'baseten',
    label: 'Baseten',
    mode: 'operator_local',
    source_url: 'https://www.baseten.co/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Baseten model costs are deployment and hardware dependent.',
  },
  {
    provider: 'lepton',
    label: 'Lepton AI',
    mode: 'operator_local',
    source_url: 'https://www.lepton.ai/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Lepton endpoint pricing depends on deployment resources and hosted model selection.',
  },
  {
    provider: 'modal',
    label: 'Modal',
    mode: 'operator_local',
    source_url: 'https://modal.com/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Modal costs depend on custom app resources and runtime duration.',
  },
  {
    provider: 'runpod',
    label: 'RunPod',
    mode: 'operator_local',
    source_url: 'https://www.runpod.io/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'RunPod costs depend on GPU type, endpoint mode, duration, and deployment settings.',
  },
  {
    provider: 'predibase',
    label: 'Predibase',
    mode: 'operator_local',
    source_url: 'https://predibase.com/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Predibase serving prices depend on deployment, adapter, and compute tier.',
  },
  {
    provider: 'lamini',
    label: 'Lamini',
    mode: 'operator_local',
    source_url: 'https://www.lamini.ai/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Lamini pricing depends on hosted/private deployment and fine-tuning plan.',
  },
  {
    provider: 'ai21',
    label: 'AI21 Labs',
    mode: 'docs_review',
    source_url: 'https://www.ai21.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'AI21/Jamba pricing should be reviewed by model family and plan.',
  },
  {
    provider: 'fal',
    label: 'fal.ai',
    mode: 'operator_local',
    source_url: 'https://fal.ai/pricing',
    automatic: false,
    pricing: 'operator_required',
    notes: 'fal.ai image/video pricing depends on model, queue/runtime, and generation parameters.',
  },
  {
    provider: 'stability-ai',
    label: 'Stability AI',
    mode: 'docs_review',
    source_url: 'https://platform.stability.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Stability AI uses credits and endpoint-specific units.',
  },
  {
    provider: 'black-forest-labs',
    label: 'Black Forest Labs',
    mode: 'docs_review',
    source_url: 'https://docs.bfl.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'FLUX prices vary by model and generation parameters.',
  },
  {
    provider: 'ideogram',
    label: 'Ideogram',
    mode: 'docs_review',
    source_url: 'https://ideogram.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Ideogram costs depend on API plan, endpoint, and image parameters.',
  },
  {
    provider: 'luma',
    label: 'Luma AI',
    mode: 'docs_review',
    source_url: 'https://lumalabs.ai/api/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Luma costs vary by model, duration, and generation settings.',
  },
  {
    provider: 'runway',
    label: 'Runway',
    mode: 'docs_review',
    source_url: 'https://runwayml.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Runway API uses plan/credit and generation-specific units.',
  },
  {
    provider: 'pika',
    label: 'Pika',
    mode: 'docs_review',
    source_url: 'https://pika.art/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Pika pricing and API access depend on plan and model availability.',
  },
  {
    provider: 'elevenlabs',
    label: 'ElevenLabs',
    mode: 'docs_review',
    source_url: 'https://elevenlabs.io/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'ElevenLabs pricing uses character/minute and plan-specific units.',
  },
  {
    provider: 'deepgram',
    label: 'Deepgram',
    mode: 'docs_review',
    source_url: 'https://deepgram.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Deepgram prices vary by STT/TTS model and audio duration.',
  },
  {
    provider: 'assemblyai',
    label: 'AssemblyAI',
    mode: 'docs_review',
    source_url: 'https://www.assemblyai.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'AssemblyAI pricing depends on audio duration and enabled features.',
  },
  {
    provider: 'cartesia',
    label: 'Cartesia',
    mode: 'docs_review',
    source_url: 'https://cartesia.ai/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Cartesia pricing is voice/model and character/audio-duration dependent.',
  },
  {
    provider: 'speechmatics',
    label: 'Speechmatics',
    mode: 'docs_review',
    source_url: 'https://www.speechmatics.com/pricing',
    automatic: false,
    pricing: 'docs_only',
    notes: 'Speechmatics pricing depends on transcription mode, language features, and audio duration.',
  },
  {
    provider: 'lm-studio',
    label: 'LM Studio',
    mode: 'operator_local',
    source_url: 'http://localhost:1234/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Local LM Studio availability and cost depend on the operator machine.',
  },
  {
    provider: 'llama-cpp',
    label: 'llama.cpp server',
    mode: 'operator_local',
    source_url: 'http://localhost:8080/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Local llama.cpp availability and cost depend on the operator machine.',
  },
  {
    provider: 'huggingface-tgi',
    label: 'Text Generation Inference / TGI',
    mode: 'operator_local',
    source_url: 'http://localhost:8080/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Self-hosted TGI costs depend on the operator deployment.',
  },
  {
    provider: 'sglang',
    label: 'SGLang',
    mode: 'operator_local',
    source_url: 'http://localhost:30000/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Self-hosted SGLang costs depend on the operator deployment.',
  },
  {
    provider: 'xinference',
    label: 'Xinference',
    mode: 'operator_local',
    source_url: 'http://localhost:9997/v1/models',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Self-hosted Xinference costs depend on the operator deployment and selected local models.',
  },
  {
    provider: 'openai-compatible',
    label: 'OpenAI-compatible custom',
    mode: 'operator_local',
    source_url: '',
    automatic: false,
    pricing: 'operator_required',
    notes: 'Custom compatible providers and private proxies require operator-supplied model, endpoint, and cost metadata.',
  },
];

export function getCatalogRefreshSources(): CatalogRefreshSource[] {
  return CATALOG_REFRESH_SOURCES.map((source) => ({ ...source }));
}

export async function refreshCatalogProvider(input: {
  provider: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  canonicalRegistry?: CatalogCanonicalRegistry;
}): Promise<CatalogRefreshResult> {
  const provider = input.provider.trim().toLowerCase();
  if (provider !== 'openrouter' && provider !== 'zeroeval') {
    const source = CATALOG_REFRESH_SOURCES.find((entry) => entry.provider === provider);
    return {
      provider,
      generated_at: (input.now || new Date()).toISOString(),
      source: source || {
        provider,
        label: provider,
        mode: 'operator_local',
        source_url: '',
        automatic: false,
        pricing: 'operator_required',
        notes: 'No automatic catalog refresh adapter is available for this provider yet.',
      },
      model_count: 0,
      priced_model_count: 0,
      override: { version: 1, providers: {} },
      issues: [
        {
          severity: 'error',
          code: 'catalog_refresh_unsupported_provider',
          message:
            'Automatic catalog refresh currently supports OpenRouter public catalog sync and ZeroEval model enrichment. Other providers require docs review, API-key discovery, or local operator overrides.',
          path: provider,
        },
      ],
    };
  }

  if (provider === 'zeroeval') {
    return refreshZeroEvalCatalog({
      now: input.now || new Date(),
      fetchImpl: input.fetchImpl || globalThis.fetch,
      canonicalRegistry: input.canonicalRegistry,
    });
  }

  return refreshOpenRouterCatalog({
    now: input.now || new Date(),
    fetchImpl: input.fetchImpl || globalThis.fetch,
  });
}

async function refreshOpenRouterCatalog(input: {
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<CatalogRefreshResult> {
  const source = CATALOG_REFRESH_SOURCES.find((entry) => entry.provider === 'openrouter')!;
  const generatedAt = input.now.toISOString();
  const lastUpdated = generatedAt.slice(0, 10);
  const issues: CatalogIssue[] = [];

  if (typeof input.fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime.');
  }

  const response = await input.fetchImpl(source.source_url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter catalog request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const canonicalRegistry = buildOpenRouterCanonicalRegistry({
    models: payload.data || [],
    generatedAt,
    sourceUrl: source.source_url,
  });
  const models = canonicalRegistry.models
    .map((model) =>
      materializeOpenRouterProviderModel({
        model,
        generatedAt,
        sourceUrl: source.source_url,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  const pricedModelCount = models.filter((model) => hasAnyPrice(model.pricing)).length;
  if (models.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'catalog_refresh_empty',
      message: 'OpenRouter returned no models. The override file was generated but contains no model entries.',
      path: 'openrouter',
    });
  }

  const provider: CatalogOverrideProvider = {
    id: 'openrouter',
    name: 'OpenRouter',
    base_url: 'https://openrouter.ai/api',
    auth_type: 'bearer',
    endpoints: { chat_completions: '/v1/chat/completions' },
    model_prefixes: inferOpenRouterModelPrefixes(models),
    capabilities: ['openai_compatible', 'multi_provider', 'public_catalog'],
    pricing: {
      source_type: 'aggregator_api',
      source: 'openrouter-public-api',
      source_url: source.source_url,
      last_updated: lastUpdated,
      last_sync: generatedAt,
      retrieved_at: generatedAt,
      last_verified_at: generatedAt,
      manual_review_required: false,
      stale_after_days: 7,
      pricing_confidence: 'high',
      currency: 'USD',
      billing_unit: 'usd_per_1m_tokens',
      notes:
        'Provider-level metadata generated from the OpenRouter public models API and materialized from the internal canonical model registry.',
    },
    models,
  };

  return {
    provider: 'openrouter',
    generated_at: generatedAt,
    source,
    model_count: models.length,
    priced_model_count: pricedModelCount,
    canonical_model_count: canonicalRegistry.model_count,
    override: {
      version: 1,
      providers: {
        openrouter: provider,
      },
      _siftgate_internal: {
        canonical_registry: canonicalRegistry,
      },
    },
    issues,
  };
}

async function refreshZeroEvalCatalog(input: {
  now: Date;
  fetchImpl: typeof fetch;
  canonicalRegistry?: CatalogCanonicalRegistry;
}): Promise<CatalogRefreshResult> {
  const source = CATALOG_REFRESH_SOURCES.find((entry) => entry.provider === 'zeroeval')!;
  const generatedAt = input.now.toISOString();
  const issues: CatalogIssue[] = [];

  if (typeof input.fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime.');
  }

  if (!input.canonicalRegistry || input.canonicalRegistry.models.length === 0) {
    return {
      provider: 'zeroeval',
      generated_at: generatedAt,
      source,
      model_count: 0,
      priced_model_count: 0,
      canonical_model_count: input.canonicalRegistry?.model_count || 0,
      matched_model_count: 0,
      projected_model_count: 0,
      low_confidence_match_count: 0,
      unmatched_model_count: 0,
      ambiguous_match_count: 0,
      override: { version: 1, providers: {} },
      issues: [
        {
          severity: 'error',
          code: 'catalog_refresh_zeroeval_missing_canonical_registry',
          message:
            'ZeroEval enrichment requires an existing canonical registry from the OpenRouter sync cache. Run `siftgate catalog sync openrouter` first, then rerun ZeroEval.',
          path: 'zeroeval',
        },
      ],
    };
  }

  const response = await input.fetchImpl(source.source_url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`ZeroEval catalog request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ZeroEvalModel[];
  const overlay = applyZeroEvalCanonicalOverlay({
    canonicalRegistry: input.canonicalRegistry,
    zeroEvalModels: Array.isArray(payload) ? payload : [],
    generatedAt,
    sourceUrl: source.source_url,
  });

  if (overlay.projected_model_count === 0) {
    issues.push({
      severity: 'warning',
      code: 'catalog_refresh_empty',
      message:
        'ZeroEval returned no medium/high-confidence matches that could be materialized into provider projections. The overlay diagnostics were still recorded.',
      path: 'zeroeval',
    });
  }
  if (overlay.projection_skipped_providers.length > 0) {
    issues.push({
      severity: 'info',
      code: 'catalog_refresh_zeroeval_projection_skipped_providers',
      message: `Matched canonical models were retained in the internal overlay but not projected into provider presets for: ${overlay.projection_skipped_providers.join(', ')}.`,
      path: 'zeroeval',
    });
  }
  if (overlay.diagnostics.low_confidence_match_count > 0) {
    issues.push({
      severity: 'info',
      code: 'catalog_refresh_zeroeval_low_confidence_matches',
      message: `Skipped ${overlay.diagnostics.low_confidence_match_count} low-confidence ZeroEval match entr${overlay.diagnostics.low_confidence_match_count === 1 ? 'y' : 'ies'} from defaults and pricing materialization.`,
      path: 'zeroeval',
    });
  }
  if (overlay.diagnostics.unmatched_model_count > 0) {
    issues.push({
      severity: 'info',
      code: 'catalog_refresh_zeroeval_unmatched_models',
      message: `Left ${overlay.diagnostics.unmatched_model_count} ZeroEval model entr${overlay.diagnostics.unmatched_model_count === 1 ? 'y' : 'ies'} unmatched after canonical normalization.`,
      path: 'zeroeval',
    });
  }

  return {
    provider: 'zeroeval',
    generated_at: generatedAt,
    source,
    model_count: overlay.projected_model_count,
    priced_model_count: overlay.priced_model_count,
    canonical_model_count: overlay.canonical_registry.model_count,
    matched_model_count: overlay.diagnostics.matched_model_count,
    projected_model_count: overlay.projected_model_count,
    low_confidence_match_count: overlay.diagnostics.low_confidence_match_count,
    unmatched_model_count: overlay.diagnostics.unmatched_model_count,
    ambiguous_match_count: overlay.diagnostics.ambiguous_match_count,
    override: {
      version: 1,
      providers: overlay.providers,
      _siftgate_internal: {
        canonical_registry: overlay.canonical_registry,
        diagnostics: {
          zeroeval_overlay: overlay.diagnostics,
        },
      },
    },
    issues,
  };
}

function inferOpenRouterModelPrefixes(models: CatalogOverrideModel[]): string[] {
  const prefixes = new Set<string>();
  for (const model of models) {
    const [namespace] = model.id.split('/');
    if (namespace && namespace.length <= 32) prefixes.add(namespace);
    if (prefixes.size >= 24) break;
  }
  return [...prefixes].sort();
}

function hasAnyPrice(pricing: CatalogPricing | undefined): boolean {
  return Boolean(
    pricing &&
    [
      pricing.input,
      pricing.output,
      pricing.image,
      pricing.audio,
      pricing.video,
      pricing.rerank,
      pricing.embedding,
    ].some((value) => value !== undefined),
  );
}
