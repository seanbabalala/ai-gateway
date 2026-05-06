import type { Modality } from '../config/modality';
import type {
  CatalogCanonicalArchitecture,
  CatalogCanonicalModel,
  CatalogCanonicalRegistry,
  CatalogCanonicalTopProvider,
  CatalogOverrideModel,
  CatalogPricing,
} from './catalog.types';

const ONE_MILLION = 1_000_000;
const OPENROUTER_PRICING_SOURCE = 'openrouter-public-api';

export interface OpenRouterModelPayload {
  id?: string;
  canonical_slug?: string | null;
  name?: string;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    modality?: string | null;
    tokenizer?: string | null;
    instruct_type?: string | null;
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  } | null;
  pricing?: {
    prompt?: string | number | null;
    completion?: string | number | null;
    image?: string | number | null;
    audio?: string | number | null;
    input_cache_read?: string | number | null;
    cache_read?: string | number | null;
    input_cache_write?: string | number | null;
    cache_creation?: string | number | null;
    [key: string]: string | number | null | undefined;
  } | null;
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    is_moderated?: boolean | null;
  } | null;
  supported_parameters?: string[] | null;
  default_parameters?: Record<string, unknown> | null;
  knowledge_cutoff?: string | null;
  expiration_date?: string | number | null;
  created?: string | number | null;
  per_request_limits?: Record<string, unknown> | null;
  supported_voices?: unknown;
  links?: Record<string, unknown> | null;
  hugging_face_id?: string | null;
}

export function buildOpenRouterCanonicalRegistry(input: {
  models: OpenRouterModelPayload[];
  generatedAt: string;
  sourceUrl: string;
}): CatalogCanonicalRegistry {
  const models = input.models
    .map((model) =>
      openRouterModelToCanonicalModel({
        model,
        generatedAt: input.generatedAt,
        sourceUrl: input.sourceUrl,
      }),
    )
    .filter((model): model is CatalogCanonicalModel => model !== null)
    .sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));

  return {
    version: 1,
    primary_source: 'openrouter',
    source_url: input.sourceUrl,
    generated_at: input.generatedAt,
    model_count: models.length,
    models,
  };
}

export function materializeOpenRouterProviderModel(input: {
  model: CatalogCanonicalModel;
  generatedAt: string;
  sourceUrl: string;
}): CatalogOverrideModel {
  const lastUpdated = input.generatedAt.slice(0, 10);
  const modalities = canonicalModelModalities(input.model);

  return {
    id: input.model.source_model_id,
    display_name: input.model.display_name || input.model.source_model_id,
    modalities,
    endpoints: { chat_completions: '/v1/chat/completions' },
    capabilities: inferOpenRouterCapabilities(input.model, modalities),
    limits:
      typeof input.model.context_length === 'number' && Number.isFinite(input.model.context_length)
        ? { max_context_tokens: input.model.context_length }
        : undefined,
    pricing: materializeOpenRouterProviderPricing({
      model: input.model,
      generatedAt: input.generatedAt,
      lastUpdated,
      sourceUrl: input.sourceUrl,
      modalities,
    }),
  };
}

export function canonicalPricingHasAnyValue(
  pricing: CatalogPricing | undefined,
): boolean {
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
        pricing.cache_read_input,
        pricing.cache_creation_input,
        pricing.input_per_1m_tokens,
        pricing.output_per_1m_tokens,
        pricing.cache_read_per_1m_tokens,
        pricing.cache_write_per_1m_tokens,
        pricing.embedding_per_1m_tokens,
      ].some((value) => value !== undefined),
  );
}

function openRouterModelToCanonicalModel(input: {
  model: OpenRouterModelPayload;
  generatedAt: string;
  sourceUrl: string;
}): CatalogCanonicalModel | null {
  if (!isNonEmptyString(input.model.id)) return null;

  const canonicalSlug = isNonEmptyString(input.model.canonical_slug)
    ? input.model.canonical_slug
    : undefined;
  const canonicalId = canonicalSlug || input.model.id;
  const sourceProviderSlug = sourceProviderSlugFromModelId(input.model.id);
  const architecture = normalizeArchitecture(input.model.architecture);
  const created = normalizeDateTimeValue(input.model.created);
  const expirationDate = normalizeDateTimeValue(input.model.expiration_date);
  const pricingReference = buildOpenRouterCanonicalPricingReference({
    model: input.model,
    generatedAt: input.generatedAt,
    sourceUrl: input.sourceUrl,
  });
  const aliases = [input.model.id].filter((alias) => alias !== canonicalId);
  const metadata = buildCanonicalMetadata(input.model);

  return {
    canonical_id: canonicalId,
    source_model_id: input.model.id,
    source_provider_slug: sourceProviderSlug,
    display_name: isNonEmptyString(input.model.name) ? input.model.name : input.model.id,
    aliases: aliases.length > 0 ? aliases : undefined,
    canonical_slug: canonicalSlug,
    description: isNonEmptyString(input.model.description) ? input.model.description : undefined,
    context_length:
      finitePositiveNumber(input.model.context_length) ||
      finitePositiveNumber(input.model.top_provider?.context_length),
    architecture,
    input_modalities: architecture?.input_modalities,
    output_modalities: architecture?.output_modalities,
    supported_parameters: normalizeStringArray(input.model.supported_parameters),
    default_parameters: cloneRecord(input.model.default_parameters),
    pricing_reference: pricingReference,
    top_provider: normalizeTopProvider(input.model.top_provider),
    expiration_date: expirationDate,
    created,
    source_metadata: {
      source: OPENROUTER_PRICING_SOURCE,
      source_url: input.sourceUrl,
      synced_at: input.generatedAt,
      dataset_role: 'canonical_primary',
    },
    metadata,
  };
}

function buildCanonicalMetadata(
  model: OpenRouterModelPayload,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (isNonEmptyString(model.knowledge_cutoff)) {
    metadata.knowledge_cutoff = normalizeDateTimeValue(model.knowledge_cutoff) || model.knowledge_cutoff;
  }
  if (isNonEmptyString(model.hugging_face_id)) {
    metadata.hugging_face_id = model.hugging_face_id;
  }
  const pricingExtras = cloneOpenRouterPricingExtras(model.pricing);
  if (pricingExtras) metadata.additional_pricing = pricingExtras;
  if (model.per_request_limits && isRecord(model.per_request_limits)) {
    metadata.per_request_limits = cloneRecord(model.per_request_limits);
  }
  if (model.links && isRecord(model.links)) {
    metadata.links = cloneRecord(model.links);
  }
  if (model.supported_voices !== undefined) {
    metadata.supported_voices = cloneUnknown(model.supported_voices);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildOpenRouterCanonicalPricingReference(input: {
  model: OpenRouterModelPayload;
  generatedAt: string;
  sourceUrl: string;
}): CatalogPricing | undefined {
  const lastUpdated = input.generatedAt.slice(0, 10);
  return buildOpenRouterPricing({
    model: input.model,
    generatedAt: input.generatedAt,
    lastUpdated,
    sourceUrl: input.sourceUrl,
    referenceOnly: true,
  });
}

function materializeOpenRouterProviderPricing(input: {
  model: CatalogCanonicalModel;
  generatedAt: string;
  lastUpdated: string;
  sourceUrl: string;
  modalities: Modality[];
}): CatalogPricing | undefined {
  const reference = input.model.pricing_reference;
  if (!reference) return undefined;

  const pricing: CatalogPricing = {
    ...reference,
    source_type: 'aggregator_api',
    source: OPENROUTER_PRICING_SOURCE,
    source_url: input.sourceUrl,
    last_updated: input.lastUpdated,
    last_sync: input.generatedAt,
    retrieved_at: input.generatedAt,
    last_verified_at: input.generatedAt,
    stale_after_days: 7,
    currency: reference.currency || 'USD',
  };

  const complete = openRouterPricingIsComplete({
    pricing,
    inputModalities: input.model.input_modalities,
    outputModalities: input.model.output_modalities,
    catalogModalities: input.modalities,
  });
  pricing.manual_review_required = !complete;
  pricing.review_reason = complete
    ? undefined
    : 'OpenRouter did not expose complete modality pricing for this model.';
  pricing.pricing_confidence = complete ? 'high' : 'unknown';
  pricing.notes = complete
    ? 'OpenRouter prompt/completion pricing converted from USD/token to USD/1M tokens. This row reflects OpenRouter route pricing, not direct-provider billing authority.'
    : 'OpenRouter returned partial modality pricing. Review non-token or missing price units before using this as a default.';

  return pricing;
}

function buildOpenRouterPricing(input: {
  model: OpenRouterModelPayload;
  generatedAt: string;
  lastUpdated: string;
  sourceUrl: string;
  referenceOnly: boolean;
}): CatalogPricing | undefined {
  const inputPrice = parseUsdPerToken(input.model.pricing?.prompt);
  const outputPrice = parseUsdPerToken(input.model.pricing?.completion);
  const imagePrice = parseUsdPerToken(input.model.pricing?.image);
  const audioPrice = parseUsdPerToken(input.model.pricing?.audio);
  const cacheReadPrice =
    parseUsdPerToken(input.model.pricing?.input_cache_read) ??
    parseUsdPerToken(input.model.pricing?.cache_read);
  const cacheWritePrice =
    parseUsdPerToken(input.model.pricing?.input_cache_write) ??
    parseUsdPerToken(input.model.pricing?.cache_creation);

  if (
    inputPrice === null &&
    outputPrice === null &&
    imagePrice === null &&
    audioPrice === null &&
    cacheReadPrice === null &&
    cacheWritePrice === null
  ) {
    return undefined;
  }

  const modalities = inputModalitiesToCatalogModalities(
    normalizeStringArray(input.model.architecture?.input_modalities),
    normalizeStringArray(input.model.architecture?.output_modalities),
  );

  const pricing: CatalogPricing = {
    currency: 'USD',
    billing_unit: 'usd_per_1m_tokens',
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      image: 'usd_per_1m_image_tokens',
      audio: 'usd_per_1m_audio_tokens',
      cache_read_input: 'usd_per_1m_cache_read_tokens',
      cache_creation_input: 'usd_per_1m_cache_write_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
      cache_read_per_1m_tokens: 'usd_per_1m_cache_read_tokens',
      cache_write_per_1m_tokens: 'usd_per_1m_cache_write_tokens',
      embedding_per_1m_tokens: 'usd_per_1m_embedding_tokens',
      image_per_generation: 'usd_per_1m_image_tokens',
      audio_per_minute: 'usd_per_1m_audio_tokens',
    },
    source_type: 'aggregator_api',
    source: OPENROUTER_PRICING_SOURCE,
    source_url: input.sourceUrl,
    last_updated: input.lastUpdated,
    last_sync: input.generatedAt,
    retrieved_at: input.generatedAt,
    last_verified_at: input.generatedAt,
    manual_review_required: input.referenceOnly,
    review_reason: input.referenceOnly
      ? 'OpenRouter pricing is canonical reference metadata and should not be treated as direct-provider billing authority.'
      : undefined,
    stale_after_days: 7,
    pricing_confidence: input.referenceOnly ? 'medium' : 'unknown',
    notes: input.referenceOnly
      ? 'OpenRouter public catalog pricing is stored as canonical reference metadata. Explicit local pricing and reviewed provider-specific pricing still take precedence.'
      : undefined,
  };

  if (inputPrice !== null) {
    pricing.input = roundPrice(inputPrice * ONE_MILLION);
    pricing.input_per_1m_tokens = pricing.input;
  }
  if (outputPrice !== null) {
    pricing.output = roundPrice(outputPrice * ONE_MILLION);
    pricing.output_per_1m_tokens = pricing.output;
  }
  if (imagePrice !== null) {
    pricing.image = roundPrice(imagePrice * ONE_MILLION);
    pricing.image_per_generation = pricing.image;
  }
  if (audioPrice !== null) {
    pricing.audio = roundPrice(audioPrice * ONE_MILLION);
    pricing.audio_per_minute = pricing.audio;
  }
  if (cacheReadPrice !== null) {
    pricing.cache_read_input = roundPrice(cacheReadPrice * ONE_MILLION);
    pricing.cache_read_per_1m_tokens = pricing.cache_read_input;
  }
  if (cacheWritePrice !== null) {
    pricing.cache_creation_input = roundPrice(cacheWritePrice * ONE_MILLION);
    pricing.cache_write_per_1m_tokens = pricing.cache_creation_input;
  }
  if (modalities.includes('embedding') && inputPrice !== null) {
    pricing.embedding = roundPrice(inputPrice * ONE_MILLION);
    pricing.embedding_per_1m_tokens = pricing.embedding;
  }

  if (!input.referenceOnly) {
    const complete = openRouterPricingIsComplete({
      pricing,
      inputModalities: normalizeStringArray(input.model.architecture?.input_modalities),
      outputModalities: normalizeStringArray(input.model.architecture?.output_modalities),
      catalogModalities: modalities,
    });
    pricing.manual_review_required = !complete;
    pricing.review_reason = complete
      ? undefined
      : 'OpenRouter did not expose all modality price units for this model.';
    pricing.pricing_confidence = complete ? 'high' : 'unknown';
    pricing.notes = complete
      ? 'OpenRouter prompt/completion pricing converted from USD/token to USD/1M tokens. Non-token modality prices are included only when OpenRouter exposes explicit price fields.'
      : 'OpenRouter returned partial modality pricing. Review any missing modality costs before using this as a default.';
  }

  return pricing;
}

function openRouterPricingIsComplete(input: {
  pricing: CatalogPricing;
  inputModalities?: string[];
  outputModalities?: string[];
  catalogModalities: Modality[];
}): boolean {
  const inputModalities = new Set((input.inputModalities || []).map((value) => value.toLowerCase()));
  const outputModalities = new Set((input.outputModalities || []).map((value) => value.toLowerCase()));
  const tokenPriced =
    input.catalogModalities.includes('text') ||
    input.catalogModalities.includes('vision') ||
    input.catalogModalities.includes('embedding') ||
    inputModalities.has('text') ||
    outputModalities.has('text') ||
    inputModalities.has('image') ||
    inputModalities.has('file');
  const tokenComplete =
    tokenPriced &&
    input.pricing.input !== undefined &&
    input.pricing.output !== undefined;

  const imageGeneration =
    input.catalogModalities.includes('image') || outputModalities.has('image');
  const audioGeneration = outputModalities.has('audio');
  const embeddingLike =
    input.catalogModalities.includes('embedding') || outputModalities.has('embedding');

  const modalityComplete =
    (imageGeneration && input.pricing.image !== undefined) ||
    (audioGeneration && input.pricing.audio !== undefined) ||
    (embeddingLike &&
      (input.pricing.embedding !== undefined || input.pricing.input !== undefined));

  return tokenComplete || modalityComplete;
}

function normalizeArchitecture(
  value: OpenRouterModelPayload['architecture'],
): CatalogCanonicalArchitecture | undefined {
  if (!value) return undefined;

  const architecture: CatalogCanonicalArchitecture = {
    modality: isNonEmptyString(value.modality) ? value.modality : undefined,
    tokenizer: isNonEmptyString(value.tokenizer) ? value.tokenizer : undefined,
    instruct_type:
      value.instruct_type === null
        ? null
        : isNonEmptyString(value.instruct_type)
          ? value.instruct_type
          : undefined,
    input_modalities: normalizeStringArray(value.input_modalities),
    output_modalities: normalizeStringArray(value.output_modalities),
  };

  return Object.values(architecture).some((item) => item !== undefined)
    ? architecture
    : undefined;
}

function normalizeTopProvider(
  value: OpenRouterModelPayload['top_provider'],
): CatalogCanonicalTopProvider | undefined {
  if (!value) return undefined;
  const provider: CatalogCanonicalTopProvider = {
    context_length: finitePositiveNumber(value.context_length),
    max_completion_tokens: finitePositiveNumber(value.max_completion_tokens),
    is_moderated:
      typeof value.is_moderated === 'boolean' ? value.is_moderated : undefined,
  };
  return Object.values(provider).some((item) => item !== undefined)
    ? provider
    : undefined;
}

function canonicalModelModalities(model: CatalogCanonicalModel): Modality[] {
  return inputModalitiesToCatalogModalities(model.input_modalities, model.output_modalities);
}

function inputModalitiesToCatalogModalities(
  inputModalities?: string[],
  outputModalities?: string[],
): Modality[] {
  const mapped = [
    ...(inputModalities || []).flatMap((value): Modality[] => {
      const normalized = value.toLowerCase();
      if (normalized === 'text' || normalized === 'file') return ['text'];
      if (normalized === 'image') return ['vision'];
      if (normalized === 'audio') return ['audio'];
      if (normalized === 'video') return ['video'];
      if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
      return [];
    }),
    ...(outputModalities || []).flatMap((value): Modality[] => {
      const normalized = value.toLowerCase();
      if (normalized === 'text' || normalized === 'file') return ['text'];
      if (normalized === 'image') return ['image'];
      if (normalized === 'audio') return ['audio'];
      if (normalized === 'video') return ['video'];
      if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
      return [];
    }),
  ];
  const unique = [...new Set(mapped)];
  return unique.length > 0 ? unique : ['text'];
}

function inferOpenRouterCapabilities(
  model: CatalogCanonicalModel,
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

function cloneOpenRouterPricingExtras(
  pricing: OpenRouterModelPayload['pricing'],
): Record<string, unknown> | undefined {
  if (!pricing || !isRecord(pricing)) return undefined;
  const ignoredKeys = new Set([
    'prompt',
    'completion',
    'image',
    'audio',
    'input_cache_read',
    'cache_read',
    'input_cache_write',
    'cache_creation',
  ]);
  const entries = Object.entries(pricing).filter(
    ([key, value]) => !ignoredKeys.has(key) && value !== null && value !== undefined,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sourceProviderSlugFromModelId(modelId: string): string {
  const [providerSlug] = modelId.split('/');
  return providerSlug?.trim() || 'openrouter';
}

function parseUsdPerToken(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(8));
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeDateTimeValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const asMilliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(asMilliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = [...new Set(value.filter(isNonEmptyString).map((item) => item.trim()))];
  return entries.length > 0 ? entries : undefined;
}

function cloneRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!value || !isRecord(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneUnknown(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
