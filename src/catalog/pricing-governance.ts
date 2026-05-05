import type { ModelPricing } from '../config/gateway.config';
import type {
  CatalogModel,
  CatalogPricing,
  CatalogPricingConfidence,
  CatalogPricingDimension,
  CatalogPricingSourceType,
  CatalogPricingUsedFrom,
} from './catalog.types';

export const PRICING_SOURCE_TYPES: CatalogPricingSourceType[] = [
  'official_docs',
  'provider_api',
  'aggregator_api',
  'operator_override',
  'docs_review',
  'unknown',
];

export const UNIFIED_PRICING_DIMENSIONS: CatalogPricingDimension[] = [
  'input_per_1m_tokens',
  'output_per_1m_tokens',
  'cache_read_per_1m_tokens',
  'cache_write_per_1m_tokens',
  'embedding_per_1m_tokens',
  'rerank_per_1k_requests',
  'rerank_per_1k_docs',
  'image_per_generation',
  'image_per_edit',
  'audio_per_minute',
  'audio_per_1m_chars',
  'video_per_second',
  'video_per_generation',
  'realtime_per_minute',
  'batch_discount',
];

export const LEGACY_PRICING_DIMENSIONS: CatalogPricingDimension[] = [
  'input',
  'output',
  'image',
  'audio',
  'video',
  'rerank',
  'embedding',
  'cache_read_input',
  'cache_creation_input',
];

const DEFAULT_REVIEW_REASON = 'Verify provider pricing before production cost routing.';

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find(isFiniteNonNegativeNumber);
}

export function inferPricingSourceType(pricing: CatalogPricing | undefined): CatalogPricingSourceType {
  if (!pricing) return 'unknown';
  if (pricing.source_type && PRICING_SOURCE_TYPES.includes(pricing.source_type)) {
    return pricing.source_type;
  }
  const source = (pricing.source || '').toLowerCase();
  if (source.includes('openrouter') || source.includes('aggregator')) return 'aggregator_api';
  if (source.includes('public-api') || source.includes('provider-api')) return 'provider_api';
  if (source.includes('override') || source.includes('operator')) return 'operator_override';
  if (source.includes('official')) return 'official_docs';
  if (source.includes('builtin') || source.includes('provider-reference') || source.includes('docs')) {
    return 'docs_review';
  }
  return 'unknown';
}

export function pricingUsedFrom(model: CatalogModel | undefined): CatalogPricingUsedFrom {
  if (!model) return 'missing';
  if (model.overridden || model.source === 'override') return 'catalog_override';
  if (model.synced || model.source === 'sync_cache') return 'catalog_sync_cache';
  if (model.source === 'builtin') return 'builtin_catalog';
  return 'missing';
}

export function normalizeCatalogPricing(pricing: CatalogPricing | undefined): CatalogPricing | undefined {
  if (!pricing) return undefined;
  const normalized: CatalogPricing = { ...pricing };
  normalized.currency = normalized.currency || 'USD';
  normalized.billing_unit = normalized.billing_unit || normalized.unit || 'usd_per_1m_tokens';
  normalized.source_type = inferPricingSourceType(normalized);
  normalized.last_verified_at =
    normalized.last_verified_at ||
    normalized.retrieved_at ||
    normalized.last_sync ||
    normalized.last_updated;
  if (normalized.manual_review_required && !normalized.review_reason) {
    normalized.review_reason = DEFAULT_REVIEW_REASON;
  }

  normalized.input_per_1m_tokens = firstNumber(
    normalized.input_per_1m_tokens,
    normalized.input,
  );
  normalized.output_per_1m_tokens = firstNumber(
    normalized.output_per_1m_tokens,
    normalized.output,
  );
  normalized.cache_read_per_1m_tokens = firstNumber(
    normalized.cache_read_per_1m_tokens,
    normalized.cache_read_input,
  );
  normalized.cache_write_per_1m_tokens = firstNumber(
    normalized.cache_write_per_1m_tokens,
    normalized.cache_creation_input,
  );
  normalized.embedding_per_1m_tokens = firstNumber(
    normalized.embedding_per_1m_tokens,
    normalized.embedding,
  );
  normalized.image_per_generation = firstNumber(
    normalized.image_per_generation,
    normalized.image,
  );
  normalized.audio_per_minute = firstNumber(
    normalized.audio_per_minute,
    normalized.audio,
  );
  normalized.video_per_generation = firstNumber(
    normalized.video_per_generation,
    normalized.video,
  );
  normalized.rerank_per_1k_requests = firstNumber(
    normalized.rerank_per_1k_requests,
    normalized.rerank,
  );

  normalized.input = firstNumber(normalized.input, normalized.input_per_1m_tokens);
  normalized.output = firstNumber(normalized.output, normalized.output_per_1m_tokens);
  normalized.cache_read_input = firstNumber(
    normalized.cache_read_input,
    normalized.cache_read_per_1m_tokens,
  );
  normalized.cache_creation_input = firstNumber(
    normalized.cache_creation_input,
    normalized.cache_write_per_1m_tokens,
  );
  normalized.embedding = firstNumber(normalized.embedding, normalized.embedding_per_1m_tokens);
  normalized.image = firstNumber(normalized.image, normalized.image_per_generation);
  normalized.audio = firstNumber(normalized.audio, normalized.audio_per_minute);
  normalized.video = firstNumber(normalized.video, normalized.video_per_generation);
  normalized.rerank = firstNumber(normalized.rerank, normalized.rerank_per_1k_requests);
  return normalized;
}

export function getCatalogPricingValue(
  pricing: CatalogPricing | undefined,
  dimension: CatalogPricingDimension,
): number | undefined {
  const normalized = normalizeCatalogPricing(pricing);
  if (!normalized) return undefined;
  const value = normalized[dimension];
  if (isFiniteNonNegativeNumber(value)) return value;
  switch (dimension) {
    case 'input':
      return normalized.input_per_1m_tokens;
    case 'output':
      return normalized.output_per_1m_tokens;
    case 'cache_read_input':
      return normalized.cache_read_per_1m_tokens;
    case 'cache_creation_input':
      return normalized.cache_write_per_1m_tokens;
    case 'embedding':
      return firstNumber(normalized.embedding_per_1m_tokens, normalized.input_per_1m_tokens);
    case 'rerank':
      return firstNumber(normalized.rerank_per_1k_requests, normalized.rerank_per_1k_docs, normalized.input_per_1m_tokens);
    case 'image':
      return firstNumber(normalized.image_per_generation, normalized.image_per_edit, normalized.input_per_1m_tokens);
    case 'audio':
      return firstNumber(normalized.audio_per_minute, normalized.audio_per_1m_chars, normalized.input_per_1m_tokens);
    case 'video':
      return firstNumber(normalized.video_per_generation, normalized.video_per_second, normalized.input_per_1m_tokens);
    default:
      return undefined;
  }
}

export function catalogPricingIsStale(
  pricing: CatalogPricing | undefined,
  now: Date = new Date(),
  defaultStaleAfterDays = 90,
): boolean {
  const normalized = normalizeCatalogPricing(pricing);
  const basis = normalized?.last_verified_at || normalized?.retrieved_at || normalized?.last_updated;
  if (!basis) return false;
  const parsed = Date.parse(basis);
  if (Number.isNaN(parsed)) return false;
  const staleAfterDays = normalized?.stale_after_days ?? defaultStaleAfterDays;
  const ageDays = Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000));
  return ageDays > staleAfterDays;
}

export function catalogModelToGovernedModelPricing(
  model: CatalogModel | undefined,
): (ModelPricing & {
  source?: string;
  currency?: string;
  catalog_source?: string;
  manual_review_required?: boolean;
  pricing_confidence?: CatalogPricingConfidence;
}) | undefined {
  const pricing = normalizeCatalogPricing(model?.pricing);
  const input = getCatalogPricingValue(pricing, 'input');
  const output = getCatalogPricingValue(pricing, 'output');
  if (!pricing || !isFiniteNonNegativeNumber(input) || !isFiniteNonNegativeNumber(output)) {
    return undefined;
  }
  const missingUnits = missingPriceUnitsForModel(model, pricing);
  return {
    input,
    output,
    cache_creation_input: getCatalogPricingValue(pricing, 'cache_creation_input'),
    cache_read_input: getCatalogPricingValue(pricing, 'cache_read_input'),
    billing_unit: pricing.billing_unit,
    input_per_1m_tokens: input,
    output_per_1m_tokens: output,
    cache_read_per_1m_tokens: getCatalogPricingValue(pricing, 'cache_read_per_1m_tokens'),
    cache_write_per_1m_tokens: getCatalogPricingValue(pricing, 'cache_write_per_1m_tokens'),
    embedding_per_1m_tokens: getCatalogPricingValue(pricing, 'embedding_per_1m_tokens'),
    rerank_per_1k_requests: getCatalogPricingValue(pricing, 'rerank_per_1k_requests'),
    rerank_per_1k_docs: getCatalogPricingValue(pricing, 'rerank_per_1k_docs'),
    image_per_generation: getCatalogPricingValue(pricing, 'image_per_generation'),
    image_per_edit: getCatalogPricingValue(pricing, 'image_per_edit'),
    audio_per_minute: getCatalogPricingValue(pricing, 'audio_per_minute'),
    audio_per_1m_chars: getCatalogPricingValue(pricing, 'audio_per_1m_chars'),
    video_per_second: getCatalogPricingValue(pricing, 'video_per_second'),
    video_per_generation: getCatalogPricingValue(pricing, 'video_per_generation'),
    realtime_per_minute: getCatalogPricingValue(pricing, 'realtime_per_minute'),
    batch_discount: getCatalogPricingValue(pricing, 'batch_discount'),
    source: `catalog:${model?.provider || 'unknown'}:${pricing.source}`,
    source_type: pricing.source_type,
    source_url: pricing.source_url,
    currency: pricing.currency || 'USD',
    catalog_source: model?.overridden ? 'override' : model?.source,
    pricing_used_from: pricingUsedFrom(model),
    manual_review_required: pricing.manual_review_required,
    review_reason: pricing.review_reason,
    pricing_confidence: pricing.pricing_confidence || 'unknown',
    pricing_stale: catalogPricingIsStale(pricing),
    last_updated: pricing.last_updated,
    last_verified_at: pricing.last_verified_at,
    retrieved_at: pricing.retrieved_at,
    stale_after_days: pricing.stale_after_days,
    missing_price_units: missingUnits,
  };
}

export function missingPriceUnitsForModel(
  model: CatalogModel | undefined,
  pricing: CatalogPricing | undefined = model?.pricing,
): CatalogPricingDimension[] {
  const normalized = normalizeCatalogPricing(pricing);
  if (!model || !normalized) return [];
  const missing = new Set<CatalogPricingDimension>();
  const modalities = new Set((model.modalities || []).map((item) => String(item).toLowerCase()));
  if (modalities.size === 0 || modalities.has('text') || modalities.has('vision') || modalities.has('realtime')) {
    if (!isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'input'))) missing.add('input_per_1m_tokens');
    if (!isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'output'))) missing.add('output_per_1m_tokens');
  }
  if ((model.read_cache || model.prompt_cache) && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'cache_read_per_1m_tokens'))) {
    missing.add('cache_read_per_1m_tokens');
  }
  if ((model.write_cache || model.prompt_cache) && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'cache_write_per_1m_tokens'))) {
    missing.add('cache_write_per_1m_tokens');
  }
  if (modalities.has('embedding') && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'embedding_per_1m_tokens'))) {
    missing.add('embedding_per_1m_tokens');
  }
  if (modalities.has('rerank') && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'rerank_per_1k_requests'))) {
    missing.add('rerank_per_1k_requests');
  }
  if (modalities.has('image') && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'image_per_generation'))) {
    missing.add('image_per_generation');
  }
  if (modalities.has('audio') && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'audio_per_minute'))) {
    missing.add('audio_per_minute');
  }
  if (modalities.has('video') && !isFiniteNonNegativeNumber(getCatalogPricingValue(normalized, 'video_per_generation'))) {
    missing.add('video_per_generation');
  }
  return [...missing];
}

export function pricingEvidenceFromModelPricing(
  pricing: ModelPricing | undefined,
): {
  pricing_source: string | null;
  pricing_confidence: string | null;
  pricing_stale: boolean | null;
  pricing_used_from: string;
  missing_price_units: string[];
  estimated_cost_basis: string | null;
} {
  if (!pricing) {
    return {
      pricing_source: 'missing',
      pricing_confidence: null,
      pricing_stale: null,
      pricing_used_from: 'missing',
      missing_price_units: ['input_per_1m_tokens', 'output_per_1m_tokens'],
      estimated_cost_basis: null,
    };
  }
  const missing: string[] = Array.isArray(pricing.missing_price_units)
    ? pricing.missing_price_units
    : [];
  if (!isFiniteNonNegativeNumber(pricing.input)) missing.push('input_per_1m_tokens');
  if (!isFiniteNonNegativeNumber(pricing.output)) missing.push('output_per_1m_tokens');
  return {
    pricing_source: pricing.source || 'config',
    pricing_confidence: pricing.pricing_confidence || null,
    pricing_stale: typeof pricing.pricing_stale === 'boolean' ? pricing.pricing_stale : null,
    pricing_used_from: pricing.pricing_used_from || pricing.catalog_source || 'gateway_config',
    missing_price_units: Array.from(new Set(missing)),
    estimated_cost_basis:
      isFiniteNonNegativeNumber(pricing.input) && isFiniteNonNegativeNumber(pricing.output)
        ? 'input_output_per_1m_tokens'
        : null,
  };
}
