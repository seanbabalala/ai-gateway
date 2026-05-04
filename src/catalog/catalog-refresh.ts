import type {
  CatalogIssue,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
} from './catalog.types';
import type { Modality } from '../config/modality';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';
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
  if (provider !== 'openrouter') {
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
            'Automatic catalog refresh currently supports OpenRouter public model metadata. Other providers require docs review, API-key discovery, or local operator overrides.',
          path: provider,
        },
      ],
    };
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
      source: 'openrouter-public-api',
      source_url: source.source_url,
      last_updated: lastUpdated,
      retrieved_at: generatedAt,
      manual_review_required: false,
      stale_after_days: 7,
      pricing_confidence: 'high',
      currency: 'USD',
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
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      image: 'usd_per_1m_image_tokens',
      audio: 'usd_per_1m_audio_tokens',
    },
    source: 'openrouter-public-api',
    source_url: OPENROUTER_MODELS_URL,
    last_updated: lastUpdated,
    retrieved_at: retrievedAt,
    manual_review_required: !complete,
    stale_after_days: 7,
    pricing_confidence: complete ? 'high' : 'unknown',
    notes: tokenPriced
      ? 'OpenRouter prompt/completion pricing converted from USD/token to USD/1M tokens. Non-token modality prices are included only when OpenRouter exposes explicit image/audio price fields.'
      : 'OpenRouter returned non-text modality metadata. SiftGate only marks prices high-confidence when explicit modality pricing is available.',
  };
  if (tokenPriced && input !== null) pricing.input = roundPrice(input * ONE_MILLION);
  if (tokenPriced && output !== null) pricing.output = roundPrice(output * ONE_MILLION);
  if (image !== null) pricing.image = roundPrice(image * ONE_MILLION);
  if (audio !== null) pricing.audio = roundPrice(audio * ONE_MILLION);
  if (modalities.includes('embedding') && input !== null) pricing.embedding = roundPrice(input * ONE_MILLION);
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
