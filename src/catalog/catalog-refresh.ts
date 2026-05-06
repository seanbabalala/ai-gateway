import type {
  CatalogIssue,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
} from './catalog.types';
import type { Modality } from '../config/modality';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';
export const ZEROEVAL_MODELS_URL =
  'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false';
const ONE_MILLION = 1_000_000;

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
  override: CatalogOverrideFile;
  issues: CatalogIssue[];
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModel[];
}

interface OpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
    image?: string | number | null;
    audio?: string | number | null;
    [key: string]: string | number | null | undefined;
  };
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
  };
  supported_parameters?: string[];
}

interface ZeroEvalModel {
  model_id?: string;
  name?: string;
  organization?: string;
  organization_id?: string;
  context?: number | null;
  release_date?: string | null;
  announcement_date?: string | null;
  multimodal?: boolean | null;
  input_price?: number | null;
  output_price?: number | null;
  throughput?: number | null;
  canonical_model_id?: string | null;
  params?: number | null;
  training_tokens?: number | null;
  license?: string | null;
  knowledge_cutoff?: string | null;
  is_moe?: boolean | null;
  [key: string]: unknown;
}

const ZEROEVAL_PROVIDER_ID_MAP: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  mistral: 'mistral',
  cohere: 'cohere',
  deepseek: 'deepseek',
  qwen: 'alibaba-qwen',
  moonshot: 'moonshot',
  minimax: 'minimax',
  zhipu: 'zhipu',
  baidu: 'baidu-qianfan',
  qianfan: 'baidu-qianfan',
  volcengine: 'volcengine-ark',
  doubao: 'volcengine-ark',
  xai: 'xai',
  perplexity: 'perplexity',
  cerebras: 'cerebras',
  sambanova: 'sambanova',
  groq: 'groq',
  ai21: 'ai21',
};

const BUILTIN_PROVIDER_MODELS = new Map(
  BUILTIN_PROVIDER_CATALOG.map((provider) => [
    provider.id,
    new Set(provider.models.map((model) => model.id)),
  ]),
);

export const CATALOG_REFRESH_SOURCES: CatalogRefreshSource[] = [
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    mode: 'public_api',
    source_url: OPENROUTER_MODELS_URL,
    automatic: true,
    pricing: 'live',
    notes: 'OpenRouter exposes a public model catalog with per-token prompt/completion pricing.',
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
  const models = (payload.data || [])
    .map((model) => openRouterModelToCatalogModel(model, lastUpdated, generatedAt))
    .filter((model): model is CatalogOverrideModel => model !== null)
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
      notes: 'Provider-level metadata generated from the OpenRouter public models API.',
    },
    models,
  };

  return {
    provider: 'openrouter',
    generated_at: generatedAt,
    source,
    model_count: models.length,
    priced_model_count: pricedModelCount,
    override: {
      version: 1,
      providers: {
        openrouter: provider,
      },
    },
    issues,
  };
}

async function refreshZeroEvalCatalog(input: {
  now: Date;
  fetchImpl: typeof fetch;
}): Promise<CatalogRefreshResult> {
  const source = CATALOG_REFRESH_SOURCES.find((entry) => entry.provider === 'zeroeval')!;
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
    throw new Error(`ZeroEval catalog request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ZeroEvalModel[];
  const providers = new Map<string, CatalogOverrideProvider>();
  let modelCount = 0;
  let pricedModelCount = 0;
  const unmappedOrganizations = new Set<string>();
  const unknownModelsByProvider = new Map<string, number>();

  for (const entry of Array.isArray(payload) ? payload : []) {
    const mappedProviderId = mapZeroEvalOrganization(entry.organization_id);
    if (!mappedProviderId) {
      if (typeof entry.organization_id === 'string' && entry.organization_id.trim()) {
        unmappedOrganizations.add(entry.organization_id.trim());
      }
      continue;
    }

    if (!isKnownBuiltInModel(mappedProviderId, entry.model_id)) {
      unknownModelsByProvider.set(
        mappedProviderId,
        (unknownModelsByProvider.get(mappedProviderId) || 0) + 1,
      );
      continue;
    }

    const model = zeroEvalModelToCatalogModel(entry, lastUpdated, generatedAt);
    if (!model) continue;

    let provider = providers.get(mappedProviderId);
    if (!provider) {
      provider = { id: mappedProviderId, models: [] };
      providers.set(mappedProviderId, provider);
    }
    provider.models ??= [];
    provider.models.push(model);
    modelCount += 1;
    if (hasAnyPrice(model.pricing)) pricedModelCount += 1;
  }

  if (providers.size === 0) {
    issues.push({
      severity: 'warning',
      code: 'catalog_refresh_empty',
      message:
        'ZeroEval returned no entries that matched the built-in Provider Catalog. The sync payload was generated but contains no model enrichments.',
      path: 'zeroeval',
    });
  }

  if (unmappedOrganizations.size > 0) {
    issues.push({
      severity: 'info',
      code: 'catalog_refresh_zeroeval_unmapped_organizations',
      message: `Skipped ZeroEval organizations without a built-in provider mapping: ${[
        ...unmappedOrganizations,
      ]
        .sort()
        .join(', ')}.`,
      path: 'zeroeval',
    });
  }

  for (const [providerId, count] of [...unknownModelsByProvider.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    issues.push({
      severity: 'info',
      code: 'catalog_refresh_zeroeval_unknown_models',
      message: `Skipped ${count} ZeroEval model entr${count === 1 ? 'y' : 'ies'} for "${providerId}" because the model id is not present in the built-in catalog.`,
      path: `zeroeval.${providerId}`,
    });
  }

  for (const provider of providers.values()) {
    provider.models?.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    provider: 'zeroeval',
    generated_at: generatedAt,
    source,
    model_count: modelCount,
    priced_model_count: pricedModelCount,
    override: {
      version: 1,
      providers: Object.fromEntries(
        [...providers.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    issues,
  };
}

function openRouterModelToCatalogModel(
  model: OpenRouterModel,
  lastUpdated: string,
  retrievedAt: string,
): CatalogOverrideModel | null {
  if (!model.id || typeof model.id !== 'string') return null;
  const inputModalities = normalizeModalities(model.architecture?.input_modalities || ['text'], 'input');
  const outputModalities = normalizeModalities(model.architecture?.output_modalities || ['text'], 'output');
  const modalities = Array.from(new Set([...inputModalities, ...outputModalities]));
  const pricing = openRouterPricingToCatalogPricing(model, modalities, lastUpdated, retrievedAt);

  return {
    id: model.id,
    display_name: model.name || model.id,
    modalities,
    endpoints: { chat_completions: '/v1/chat/completions' },
    capabilities: inferOpenRouterCapabilities(model, modalities),
    limits: {
      max_context_tokens:
        model.context_length ||
        model.top_provider?.context_length ||
        undefined,
    },
    pricing,
  };
}

function zeroEvalModelToCatalogModel(
  model: ZeroEvalModel,
  lastUpdated: string,
  retrievedAt: string,
): CatalogOverrideModel | null {
  if (!isNonEmptyString(model.model_id)) return null;

  const benchmarkEntries = Object.entries(model).filter(
    ([key, value]) =>
      key.endsWith('_score') &&
      typeof value === 'number' &&
      Number.isFinite(value),
  );
  const benchmarks =
    benchmarkEntries.length > 0
      ? (Object.fromEntries(benchmarkEntries) as Record<string, number>)
      : undefined;

  return {
    id: model.model_id,
    display_name: isNonEmptyString(model.name) ? model.name : model.model_id,
    limits:
      typeof model.context === 'number' && Number.isFinite(model.context) && model.context > 0
        ? { max_context_tokens: model.context }
        : undefined,
    pricing: zeroEvalPricingToCatalogPricing(model, lastUpdated, retrievedAt),
    enrichment: {
      source: 'zeroeval',
      enriched_from: 'zeroeval',
      source_url: ZEROEVAL_MODELS_URL,
      synced_at: retrievedAt,
      enriched_at: retrievedAt,
      organization: isNonEmptyString(model.organization) ? model.organization : undefined,
      organization_id: isNonEmptyString(model.organization_id)
        ? model.organization_id
        : undefined,
      canonical_model_id:
        isNonEmptyString(model.canonical_model_id) ? model.canonical_model_id : undefined,
      release_date: normalizeDateLike(model.release_date),
      announcement_date: normalizeDateLike(model.announcement_date),
      multimodal: typeof model.multimodal === 'boolean' ? model.multimodal : undefined,
      throughput:
        typeof model.throughput === 'number' && Number.isFinite(model.throughput)
          ? model.throughput
          : undefined,
      lifecycle: {
        release_date: normalizeDateLike(model.release_date),
        announcement_date: normalizeDateLike(model.announcement_date),
        knowledge_cutoff: normalizeDateLike(model.knowledge_cutoff),
      },
      specs: {
        params:
          typeof model.params === 'number' && Number.isFinite(model.params)
            ? model.params
            : undefined,
        training_tokens:
          typeof model.training_tokens === 'number' && Number.isFinite(model.training_tokens)
            ? model.training_tokens
            : undefined,
        throughput:
          typeof model.throughput === 'number' && Number.isFinite(model.throughput)
            ? model.throughput
            : undefined,
        multimodal:
          typeof model.multimodal === 'boolean' ? model.multimodal : undefined,
        license: isNonEmptyString(model.license) ? model.license : undefined,
        is_moe: typeof model.is_moe === 'boolean' ? model.is_moe : undefined,
      },
      benchmarks,
    },
  };
}

function normalizeModalities(values: string[], direction: 'input' | 'output'): Modality[] {
  const mapped = values.flatMap((value): Modality[] => {
    const normalized = value.toLowerCase();
    if (normalized === 'image') return direction === 'input' ? ['vision'] : ['image'];
    if (normalized === 'audio') return ['audio'];
    if (normalized === 'video') return ['video'];
    if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
    if (normalized === 'transcription') return ['text'];
    if (normalized === 'text') return ['text'];
    return [];
  });
  return mapped.length > 0 ? mapped : ['text'];
}

function openRouterPricingToCatalogPricing(
  model: OpenRouterModel,
  modalities: Modality[],
  lastUpdated: string,
  retrievedAt: string,
): CatalogPricing {
  const input = parseUsdPerToken(model.pricing?.prompt);
  const output = parseUsdPerToken(model.pricing?.completion);
  const image = parseUsdPerToken(model.pricing?.image);
  const audio = parseUsdPerToken(model.pricing?.audio);
  const tokenPriced =
    modalities.includes('text') ||
    modalities.includes('vision') ||
    (model.architecture?.input_modalities || []).some((item) => item.toLowerCase() === 'text') ||
    (model.architecture?.output_modalities || []).some((item) => item.toLowerCase() === 'text');
  const tokenComplete = tokenPriced && input !== null && output !== null;
  const modalityPriced =
    ((modalities.includes('image') || modalities.includes('vision')) && image !== null) ||
    (modalities.includes('audio') && audio !== null) ||
    (modalities.includes('embedding') && input !== null);
  const complete = tokenComplete || modalityPriced;
  const pricing: CatalogPricing = {
    currency: 'USD',
    billing_unit: 'usd_per_1m_tokens',
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      image: 'usd_per_1m_image_tokens',
      audio: 'usd_per_1m_audio_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      image_per_generation: 'usd_per_1m_image_tokens',
      audio_per_minute: 'usd_per_1m_audio_tokens',
      embedding_per_1m_tokens: 'usd_per_1m_embedding_tokens',
    },
    source_type: 'aggregator_api',
    source: 'openrouter-public-api',
    source_url: OPENROUTER_MODELS_URL,
    last_updated: lastUpdated,
    last_sync: retrievedAt,
    retrieved_at: retrievedAt,
    last_verified_at: retrievedAt,
    manual_review_required: !complete,
    review_reason: complete ? undefined : 'OpenRouter did not expose all modality price units for this model.',
    stale_after_days: 7,
    pricing_confidence: complete ? 'high' : 'unknown',
    notes: tokenPriced
      ? 'OpenRouter prompt/completion pricing converted from USD/token to USD/1M tokens. Non-token modality prices are included only when OpenRouter exposes explicit image/audio price fields.'
      : 'OpenRouter returned non-text modality metadata. SiftGate only marks prices high-confidence when explicit modality pricing is available.',
  };
  if (tokenPriced && input !== null) {
    pricing.input = roundPrice(input * ONE_MILLION);
    pricing.input_per_1m_tokens = pricing.input;
  }
  if (tokenPriced && output !== null) {
    pricing.output = roundPrice(output * ONE_MILLION);
    pricing.output_per_1m_tokens = pricing.output;
  }
  if (image !== null) {
    pricing.image = roundPrice(image * ONE_MILLION);
    pricing.image_per_generation = pricing.image;
  }
  if (audio !== null) {
    pricing.audio = roundPrice(audio * ONE_MILLION);
    pricing.audio_per_minute = pricing.audio;
  }
  if (modalities.includes('embedding') && input !== null) {
    pricing.embedding = roundPrice(input * ONE_MILLION);
    pricing.embedding_per_1m_tokens = pricing.embedding;
  }
  return pricing;
}

function zeroEvalPricingToCatalogPricing(
  model: ZeroEvalModel,
  lastUpdated: string,
  retrievedAt: string,
): CatalogPricing | undefined {
  const input =
    typeof model.input_price === 'number' && Number.isFinite(model.input_price) && model.input_price >= 0
      ? roundPrice(model.input_price)
      : null;
  const output =
    typeof model.output_price === 'number' && Number.isFinite(model.output_price) && model.output_price >= 0
      ? roundPrice(model.output_price)
      : null;
  if (input === null && output === null) return undefined;

  const pricing: CatalogPricing = {
    currency: 'USD',
    billing_unit: 'usd_per_1m_tokens',
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
    },
    source_type: 'aggregator_api',
    source: 'zeroeval',
    source_url: ZEROEVAL_MODELS_URL,
    last_updated: lastUpdated,
    last_sync: retrievedAt,
    retrieved_at: retrievedAt,
    last_verified_at: retrievedAt,
    manual_review_required: true,
    review_reason:
      'ZeroEval pricing is third-party enrichment metadata and should be reviewed before production billing decisions.',
    stale_after_days: 7,
    pricing_confidence: 'medium',
    notes:
      'ZeroEval input/output pricing is treated as a reference value in USD per 1M tokens and never overrides explicit local pricing.',
  };
  if (input !== null) {
    pricing.input = input;
    pricing.input_per_1m_tokens = input;
  }
  if (output !== null) {
    pricing.output = output;
    pricing.output_per_1m_tokens = output;
  }
  return pricing;
}

function parseUsdPerToken(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(8));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeDateLike(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function mapZeroEvalOrganization(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return ZEROEVAL_PROVIDER_ID_MAP[value.trim().toLowerCase()];
}

function isKnownBuiltInModel(providerId: string, modelId: unknown): boolean {
  if (!isNonEmptyString(modelId)) return false;
  return BUILTIN_PROVIDER_MODELS.get(providerId)?.has(modelId) === true;
}

function inferOpenRouterCapabilities(
  model: OpenRouterModel,
  modalities: Modality[],
): string[] {
  const parameters = new Set((model.supported_parameters || []).map((item) => item.toLowerCase()));
  const capabilities = new Set<string>(['openai_compatible']);
  if (parameters.has('tools') || parameters.has('tool_choice')) capabilities.add('tools');
  if (parameters.has('response_format') || parameters.has('structured_outputs')) {
    capabilities.add('structured_output');
  }
  if (parameters.has('reasoning') || parameters.has('include_reasoning')) capabilities.add('reasoning');
  if (modalities.includes('vision')) capabilities.add('vision');
  if (modalities.includes('audio')) capabilities.add('audio');
  if (modalities.includes('video')) capabilities.add('video');
  return [...capabilities].sort();
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
