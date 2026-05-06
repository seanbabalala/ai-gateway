import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConfigService } from '../config/config.service';
import type { ModelPricing } from '../config/gateway.config';
import {
  VALID_CAPABILITY_ENDPOINTS,
  VALID_MODALITIES,
} from '../config/modality';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';
import {
  LEGACY_PRICING_DIMENSIONS,
  PRICING_SOURCE_TYPES,
  UNIFIED_PRICING_DIMENSIONS,
  catalogModelToGovernedModelPricing,
  catalogPricingIsStale,
  getCatalogPricingValue,
  normalizeCatalogPricing,
} from './pricing-governance';
import {
  findCatalogProviderForNode as findCompatibilityCatalogProviderForNode,
  inferCatalogCompatibilityProfiles,
  isCompatibilityProfileId,
} from './compatibility-profiles';
import {
  augmentProviderAliases,
  buildCanonicalProjectionProviders,
  findCatalogProviderByIdOrAlias,
  providerReplacementId,
  providerStatusReason,
  resolveProviderStatus,
} from './provider-projection';
import type {
  CatalogCanonicalArchitecture,
  CatalogCanonicalModel,
  CatalogCanonicalRegistry,
  CatalogCanonicalSourceMetadata,
  CatalogCanonicalTopProvider,
  CatalogIssue,
  CatalogInternalMaterialization,
  CatalogLoadOptions,
  CatalogLoadResult,
  CatalogModel,
  CatalogOverrideFile,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
  CatalogPricingDimension,
  CatalogPricingHygiene,
  CatalogProvider,
  CatalogProviderStatus,
  CatalogSource,
  ProviderCatalog,
} from './catalog.types';

export const DEFAULT_CATALOG_OVERRIDE_FILE = 'catalog.override.yaml';
export const DEFAULT_CATALOG_SYNC_CACHE_FILE = '.siftgate/catalog-sync-cache.yaml';

const VALID_AUTH_TYPES = new Set(['bearer', 'x-api-key', 'none']);
const VALID_MODALITY_SET = new Set<string>(VALID_MODALITIES);
const VALID_ENDPOINT_SET = new Set<string>([
  ...VALID_CAPABILITY_ENDPOINTS,
  'images_generations',
  'images_edits',
  'images_variations',
  'audio_transcriptions',
  'audio_translations',
  'audio_speech',
  'video_status',
  'video_content',
  'video_cancel',
]);
const SECRET_KEY_PATTERN = /(^|[_-])((api|provider)?[_-]?key|secret|password|authorization|bearer|access[_-]?token|refresh[_-]?token|auth[_-]?token|token)([_-]|$)/i;
const SECRET_VALUE_PATTERN = /\b(sk-[A-Za-z0-9._~+/-]{12,}|sk_[A-Za-z0-9._~+/-]{12,}|xox[A-Za-z0-9._~+/-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/i;
const PRICING_DIMENSIONS: CatalogPricingDimension[] = [
  ...LEGACY_PRICING_DIMENSIONS,
  ...UNIFIED_PRICING_DIMENSIONS,
];
const PRICING_CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown']);
const PROVIDER_STATUSES = new Set<CatalogProviderStatus>([
  'active',
  'transport_only',
  'deprecated',
  'legacy_alias',
  'custom',
]);
const PLACEHOLDER_SOURCE_PATTERN = /(placeholder|operator_required|manual[_-]?placeholder|unknown|replace)/i;
const DEFAULT_STALE_AFTER_DAYS = 90;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function cloneEnrichmentMetadata(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneNumberRecord(
  value: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === 'number' && Number.isFinite(entry)),
  ) as Record<string, number>;
}

function normalizeDateLikeValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return undefined;
}

function normalizeDateOnlyLikeValue(value: unknown): string | undefined {
  const normalized = normalizeDateLikeValue(value);
  if (!normalized) return undefined;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return normalized;
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeNonEmptyStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = [...new Set(value.filter(isNonEmptyString).map((entry) => entry.trim()))];
  return entries.length > 0 ? entries : undefined;
}

function normalizeModelEnrichment(
  enrichment: CatalogModel['enrichment'] | CatalogOverrideModel['enrichment'] | undefined,
): CatalogModel['enrichment'] | undefined {
  if (!enrichment || !isNonEmptyString(enrichment.source)) return undefined;
  const metadata = cloneEnrichmentMetadata(enrichment.metadata);
  const metadataBenchmarks = isRecord(metadata?.benchmarks)
    ? Object.fromEntries(
        Object.entries(metadata?.benchmarks || {}).filter(
          ([, value]) => typeof value === 'number' && Number.isFinite(value),
        ),
      ) as Record<string, number>
    : undefined;
  const lifecycle = {
    release_date:
      normalizeDateOnlyLikeValue(enrichment.lifecycle?.release_date) ||
      normalizeDateOnlyLikeValue(enrichment.release_date),
    announcement_date:
      normalizeDateOnlyLikeValue(enrichment.lifecycle?.announcement_date) ||
      normalizeDateOnlyLikeValue(enrichment.announcement_date),
    knowledge_cutoff:
      normalizeDateOnlyLikeValue(enrichment.lifecycle?.knowledge_cutoff) ||
      normalizeDateOnlyLikeValue(metadata?.knowledge_cutoff),
  };
  const specs = {
    params:
      isFiniteNonNegativeNumber(enrichment.specs?.params)
        ? enrichment.specs?.params
        : isFiniteNonNegativeNumber(metadata?.params)
          ? (metadata?.params as number)
          : undefined,
    training_tokens:
      isFiniteNonNegativeNumber(enrichment.specs?.training_tokens)
        ? enrichment.specs?.training_tokens
        : isFiniteNonNegativeNumber(metadata?.training_tokens)
          ? (metadata?.training_tokens as number)
          : undefined,
    throughput:
      isFiniteNonNegativeNumber(enrichment.specs?.throughput)
        ? enrichment.specs?.throughput
        : isFiniteNonNegativeNumber(enrichment.throughput)
          ? enrichment.throughput
          : undefined,
    multimodal:
      typeof enrichment.specs?.multimodal === 'boolean'
        ? enrichment.specs.multimodal
        : typeof enrichment.multimodal === 'boolean'
          ? enrichment.multimodal
          : undefined,
    license:
      typeof enrichment.specs?.license === 'string' && enrichment.specs.license.trim()
        ? enrichment.specs.license
        : typeof metadata?.license === 'string' && metadata.license.trim()
          ? (metadata.license as string)
          : undefined,
    is_moe:
      typeof enrichment.specs?.is_moe === 'boolean'
        ? enrichment.specs.is_moe
        : typeof metadata?.is_moe === 'boolean'
          ? (metadata.is_moe as boolean)
          : undefined,
  };
  const benchmarks = cloneNumberRecord(enrichment.benchmarks) || metadataBenchmarks;
  const canonicalModelId =
    (isNonEmptyString(enrichment.canonical_model_id) && enrichment.canonical_model_id) ||
    (isNonEmptyString(metadata?.canonical_model_id) ? (metadata?.canonical_model_id as string) : undefined);
  const matchedFrom =
    normalizeNonEmptyStringArray(enrichment.matched_from) ||
    normalizeNonEmptyStringArray(metadata?.matched_from);
  const matchNotes =
    normalizeNonEmptyStringArray(enrichment.match_notes) ||
    normalizeNonEmptyStringArray(metadata?.match_notes);
  return {
    ...enrichment,
    synced_at: normalizeDateLikeValue(enrichment.synced_at),
    enriched_from: enrichment.enriched_from || enrichment.source,
    enriched_at:
      normalizeDateLikeValue(enrichment.enriched_at) ||
      normalizeDateLikeValue(enrichment.synced_at),
    match_strategy:
      enrichment.match_strategy === 'exact_source_model_id' ||
      enrichment.match_strategy === 'exact_canonical_slug' ||
      enrichment.match_strategy === 'explicit_alias' ||
      enrichment.match_strategy === 'strict_signature' ||
      enrichment.match_strategy === 'strict_signature_release_date' ||
      enrichment.match_strategy === 'ambiguous_candidate' ||
      enrichment.match_strategy === 'unmatched'
        ? enrichment.match_strategy
        : undefined,
    match_confidence:
      enrichment.match_confidence === 'high' ||
      enrichment.match_confidence === 'medium' ||
      enrichment.match_confidence === 'low'
        ? enrichment.match_confidence
        : undefined,
    matched_from: matchedFrom,
    match_notes: matchNotes,
    canonical_model_id: canonicalModelId,
    release_date: normalizeDateOnlyLikeValue(enrichment.release_date),
    announcement_date: normalizeDateOnlyLikeValue(enrichment.announcement_date),
    lifecycle: Object.values(lifecycle).some(Boolean) ? lifecycle : undefined,
    specs: Object.values(specs).some((value) => value !== undefined) ? specs : undefined,
    benchmarks,
    secondary_pricing_reference: isRecord(enrichment.secondary_pricing_reference)
      ? normalizeCatalogPricing({
          ...enrichment.secondary_pricing_reference,
        } as unknown as CatalogPricing)
      : undefined,
    metadata: cloneEnrichmentMetadata(enrichment.metadata),
  };
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeCanonicalArchitectureValue(
  value: unknown,
): CatalogCanonicalArchitecture | undefined {
  if (!isRecord(value)) return undefined;
  const architecture: CatalogCanonicalArchitecture = {
    modality: isNonEmptyString(value.modality) ? value.modality : undefined,
    tokenizer: isNonEmptyString(value.tokenizer) ? value.tokenizer : undefined,
    instruct_type:
      value.instruct_type === null
        ? null
        : isNonEmptyString(value.instruct_type)
          ? value.instruct_type
          : undefined,
    input_modalities: Array.isArray(value.input_modalities)
      ? value.input_modalities.filter(isNonEmptyString)
      : undefined,
    output_modalities: Array.isArray(value.output_modalities)
      ? value.output_modalities.filter(isNonEmptyString)
      : undefined,
  };
  return Object.values(architecture).some((entry) => entry !== undefined)
    ? architecture
    : undefined;
}

function normalizeCanonicalTopProviderValue(
  value: unknown,
): CatalogCanonicalTopProvider | undefined {
  if (!isRecord(value)) return undefined;
  const topProvider: CatalogCanonicalTopProvider = {
    context_length: isFiniteNonNegativeNumber(value.context_length)
      ? value.context_length
      : undefined,
    max_completion_tokens: isFiniteNonNegativeNumber(value.max_completion_tokens)
      ? value.max_completion_tokens
      : undefined,
    is_moderated:
      typeof value.is_moderated === 'boolean' ? value.is_moderated : undefined,
  };
  return Object.values(topProvider).some((entry) => entry !== undefined)
    ? topProvider
    : undefined;
}

function normalizeCanonicalSourceMetadataValue(
  value: unknown,
): CatalogCanonicalSourceMetadata | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.source)) return undefined;
  return {
    source: value.source,
    source_url: isNonEmptyString(value.source_url) ? value.source_url : undefined,
    synced_at: normalizeDateLikeValue(value.synced_at),
    dataset_role:
      value.dataset_role === 'canonical_primary' ||
      value.dataset_role === 'enrichment_overlay' ||
      value.dataset_role === 'provider_projection'
        ? value.dataset_role
        : undefined,
  };
}

function normalizeCanonicalModelValue(
  value: unknown,
): CatalogCanonicalModel | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNonEmptyString(value.canonical_id) ||
    !isNonEmptyString(value.source_model_id) ||
    !isNonEmptyString(value.source_provider_slug)
  ) {
    return undefined;
  }
  const sourceMetadata = normalizeCanonicalSourceMetadataValue(value.source_metadata);
  if (!sourceMetadata) return undefined;

  const aliases = Array.isArray(value.aliases)
    ? [...new Set(value.aliases.filter(isNonEmptyString))]
    : undefined;
  const supportedParameters = Array.isArray(value.supported_parameters)
    ? [...new Set(value.supported_parameters.filter(isNonEmptyString))]
    : undefined;

  return {
    canonical_id: value.canonical_id,
    source_model_id: value.source_model_id,
    source_provider_slug: value.source_provider_slug,
    display_name:
      isNonEmptyString(value.display_name) ? value.display_name : value.source_model_id,
    aliases: aliases && aliases.length > 0 ? aliases : undefined,
    canonical_slug: isNonEmptyString(value.canonical_slug) ? value.canonical_slug : undefined,
    description: isNonEmptyString(value.description) ? value.description : undefined,
    context_length: isFiniteNonNegativeNumber(value.context_length)
      ? value.context_length
      : undefined,
    architecture: normalizeCanonicalArchitectureValue(value.architecture),
    input_modalities: Array.isArray(value.input_modalities)
      ? [...new Set(value.input_modalities.filter(isNonEmptyString))]
      : undefined,
    output_modalities: Array.isArray(value.output_modalities)
      ? [...new Set(value.output_modalities.filter(isNonEmptyString))]
      : undefined,
    supported_parameters:
      supportedParameters && supportedParameters.length > 0
        ? supportedParameters
        : undefined,
    default_parameters: isRecord(value.default_parameters)
      ? cloneJsonValue(value.default_parameters)
      : undefined,
    pricing_reference: isRecord(value.pricing_reference)
      ? normalizeCatalogPricing({ ...value.pricing_reference } as unknown as CatalogPricing)
      : undefined,
    enrichment: normalizeModelEnrichment(
      isRecord(value.enrichment)
        ? (value.enrichment as unknown as CatalogModel['enrichment'])
        : undefined,
    ),
    top_provider: normalizeCanonicalTopProviderValue(value.top_provider),
    expiration_date: normalizeDateLikeValue(value.expiration_date),
    created: normalizeDateLikeValue(value.created),
    source_metadata: sourceMetadata,
    metadata: isRecord(value.metadata) ? cloneJsonValue(value.metadata) : undefined,
  };
}

function normalizeCanonicalOverlayDiagnosticValue(
  value: unknown,
): NonNullable<
  NonNullable<
    NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay']
  >['unmatched_models']
>[number] | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.model_id) || !isNonEmptyString(value.reason)) {
    return undefined;
  }
  return {
    organization_id: isNonEmptyString(value.organization_id) ? value.organization_id : undefined,
    model_id: value.model_id,
    canonical_id: isNonEmptyString(value.canonical_id) ? value.canonical_id : undefined,
    match_strategy:
      value.match_strategy === 'exact_source_model_id' ||
      value.match_strategy === 'exact_canonical_slug' ||
      value.match_strategy === 'explicit_alias' ||
      value.match_strategy === 'strict_signature' ||
      value.match_strategy === 'strict_signature_release_date' ||
      value.match_strategy === 'ambiguous_candidate' ||
      value.match_strategy === 'unmatched'
        ? value.match_strategy
        : undefined,
    match_confidence:
      value.match_confidence === 'high' ||
      value.match_confidence === 'medium' ||
      value.match_confidence === 'low'
        ? value.match_confidence
        : undefined,
    reason: value.reason,
    matched_from: normalizeNonEmptyStringArray(value.matched_from),
    match_notes: normalizeNonEmptyStringArray(value.match_notes),
  };
}

function normalizeZeroEvalOverlayDiagnosticsValue(
  value: unknown,
): NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay'] | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.source) ||
    !isNonEmptyString(value.source_url) ||
    !normalizeDateLikeValue(value.synced_at)
  ) {
    return undefined;
  }
  const unmatchedModels = Array.isArray(value.unmatched_models)
    ? value.unmatched_models
        .map((entry) => normalizeCanonicalOverlayDiagnosticValue(entry))
        .filter(
          (entry): entry is NonNullable<
            NonNullable<
              NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay']
            >['unmatched_models']
          >[number] => entry !== undefined,
        )
    : undefined;
  const lowConfidenceMatches = Array.isArray(value.low_confidence_matches)
    ? value.low_confidence_matches
        .map((entry) => normalizeCanonicalOverlayDiagnosticValue(entry))
        .filter(
          (entry): entry is NonNullable<
            NonNullable<
              NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay']
            >['low_confidence_matches']
          >[number] => entry !== undefined,
        )
    : undefined;
  const ambiguousMatches = Array.isArray(value.ambiguous_matches)
    ? value.ambiguous_matches
        .map((entry) => normalizeCanonicalOverlayDiagnosticValue(entry))
        .filter(
          (entry): entry is NonNullable<
            NonNullable<
              NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay']
            >['ambiguous_matches']
          >[number] => entry !== undefined,
        )
    : undefined;

  return {
    source: value.source,
    source_url: value.source_url,
    synced_at: normalizeDateLikeValue(value.synced_at)!,
    canonical_model_count: isFiniteNonNegativeNumber(value.canonical_model_count)
      ? value.canonical_model_count
      : 0,
    zeroeval_model_count: isFiniteNonNegativeNumber(value.zeroeval_model_count)
      ? value.zeroeval_model_count
      : 0,
    matched_model_count: isFiniteNonNegativeNumber(value.matched_model_count)
      ? value.matched_model_count
      : 0,
    projected_model_count: isFiniteNonNegativeNumber(value.projected_model_count)
      ? value.projected_model_count
      : 0,
    high_confidence_match_count: isFiniteNonNegativeNumber(value.high_confidence_match_count)
      ? value.high_confidence_match_count
      : 0,
    medium_confidence_match_count: isFiniteNonNegativeNumber(value.medium_confidence_match_count)
      ? value.medium_confidence_match_count
      : 0,
    low_confidence_match_count: isFiniteNonNegativeNumber(value.low_confidence_match_count)
      ? value.low_confidence_match_count
      : 0,
    unmatched_model_count: isFiniteNonNegativeNumber(value.unmatched_model_count)
      ? value.unmatched_model_count
      : 0,
    ambiguous_match_count: isFiniteNonNegativeNumber(value.ambiguous_match_count)
      ? value.ambiguous_match_count
      : 0,
    unmatched_models: unmatchedModels && unmatchedModels.length > 0 ? unmatchedModels : undefined,
    low_confidence_matches:
      lowConfidenceMatches && lowConfidenceMatches.length > 0
        ? lowConfidenceMatches
        : undefined,
    ambiguous_matches: ambiguousMatches && ambiguousMatches.length > 0 ? ambiguousMatches : undefined,
  };
}

function normalizeCanonicalRegistryValue(
  value: unknown,
): CatalogCanonicalRegistry | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNonEmptyString(value.primary_source) ||
    !isNonEmptyString(value.source_url) ||
    !normalizeDateLikeValue(value.generated_at)
  ) {
    return undefined;
  }

  const models = Array.isArray(value.models)
    ? value.models
        .map((model) => normalizeCanonicalModelValue(model))
        .filter((model): model is CatalogCanonicalModel => model !== undefined)
        .sort((a, b) => a.canonical_id.localeCompare(b.canonical_id))
    : [];

  return {
    version: 1,
    primary_source: value.primary_source,
    source_url: value.source_url,
    generated_at: normalizeDateLikeValue(value.generated_at)!,
    model_count: models.length,
    models,
  };
}

function normalizeCatalogInternalMaterializationValue(
  value: unknown,
): CatalogInternalMaterialization {
  if (!isRecord(value)) return {};
  const canonicalRegistry = normalizeCanonicalRegistryValue(value.canonical_registry);
  const zeroEvalOverlay = normalizeZeroEvalOverlayDiagnosticsValue(
    isRecord(value.diagnostics) ? value.diagnostics.zeroeval_overlay : undefined,
  );
  return {
    canonical_registry: canonicalRegistry,
    diagnostics: zeroEvalOverlay ? { zeroeval_overlay: zeroEvalOverlay } : undefined,
  };
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function isValidDateLikeValue(value: unknown): boolean {
  const normalized = normalizeDateLikeValue(value);
  return normalized !== undefined && !Number.isNaN(Date.parse(normalized));
}

function cloneProvider(provider: CatalogProvider): CatalogProvider {
  return {
    ...provider,
    aliases: provider.aliases ? [...provider.aliases] : undefined,
    status: provider.status,
    replacement_provider_id: provider.replacement_provider_id,
    status_reason: provider.status_reason,
    input_types: provider.input_types ? [...provider.input_types] : undefined,
    output_types: provider.output_types ? [...provider.output_types] : undefined,
    model_buckets: provider.model_buckets
      ? Object.fromEntries(
          Object.entries(provider.model_buckets).map(([key, values]) => [
            key,
            Array.isArray(values) ? [...values] : values,
          ]),
        ) as CatalogProvider['model_buckets']
      : undefined,
    modalities: provider.modalities ? [...provider.modalities] : undefined,
    endpoints: { ...provider.endpoints },
    compatibility_profiles: provider.compatibility_profiles
      ? [...provider.compatibility_profiles]
      : inferCatalogCompatibilityProfiles(provider),
    model_prefixes: provider.model_prefixes ? [...provider.model_prefixes] : undefined,
    capabilities: provider.capabilities ? [...provider.capabilities] : undefined,
    pricing: provider.pricing ? normalizeCatalogPricing({ ...provider.pricing }) : undefined,
    synced: provider.synced,
    models: provider.models.map((model) => ({
      ...model,
      modalities: [...model.modalities],
      endpoints: { ...model.endpoints },
      capabilities: [...model.capabilities],
      limits: model.limits
        ? {
            ...model.limits,
            dimensions: Array.isArray(model.limits.dimensions)
              ? [...model.limits.dimensions]
              : model.limits.dimensions,
          }
        : undefined,
      pricing: model.pricing ? normalizeCatalogPricing({ ...model.pricing }) : undefined,
      enrichment: normalizeModelEnrichment(model.enrichment),
      synced: model.synced,
    })),
  };
}

function issue(
  severity: CatalogIssue['severity'],
  code: string,
  message: string,
  issuePath?: string,
): CatalogIssue {
  return { severity, code, message, path: issuePath };
}

export function resolveCatalogOverridePath(
  options: CatalogLoadOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configOverride = readConfigOverridePath(options.config);
  const requested =
    options.overridePath ||
    env.SIFTGATE_CATALOG_OVERRIDE ||
    configOverride ||
    DEFAULT_CATALOG_OVERRIDE_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(cwd, requested);
}

export function resolveCatalogSyncCachePath(
  options: CatalogLoadOptions = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = readConfigSyncCachePath(options.config);
  const requested =
    options.syncCachePath ||
    env.SIFTGATE_CATALOG_SYNC_CACHE ||
    configPath ||
    DEFAULT_CATALOG_SYNC_CACHE_FILE;
  return path.isAbsolute(requested) ? requested : path.resolve(cwd, requested);
}

function readConfigOverridePath(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const catalog = config.catalog;
  if (!isRecord(catalog)) return undefined;
  return isNonEmptyString(catalog.override_file) ? catalog.override_file : undefined;
}

function readConfigSyncCachePath(config: unknown): string | undefined {
  if (!isRecord(config)) return undefined;
  const catalog = config.catalog;
  if (!isRecord(catalog)) return undefined;
  const sync = catalog.sync;
  if (!isRecord(sync)) return undefined;
  return isNonEmptyString(sync.cache_file) ? sync.cache_file : undefined;
}

export function loadMergedCatalog(
  options: CatalogLoadOptions = {},
): CatalogLoadResult {
  const overridePath = resolveCatalogOverridePath(options);
  const syncCachePath = resolveCatalogSyncCachePath(options);
  const issues: CatalogIssue[] = [];
  let override: CatalogOverrideFile | null = null;
  let overrideFound = false;
  let syncCache: CatalogOverrideFile | null = null;
  let syncCacheFound = false;

  if (fs.existsSync(syncCachePath)) {
    syncCacheFound = true;
    try {
      const raw = fs.readFileSync(syncCachePath, 'utf8');
      const parsed = yaml.load(raw);
      const validation = validateCatalogOverrideObject(parsed, syncCachePath);
      issues.push(...validation.issues);
      if (validation.override && !hasCatalogErrors(validation.issues)) {
        syncCache = validation.override;
      }
    } catch (error) {
      issues.push(
        issue(
          'warning',
          'catalog_sync_cache_read_failed',
          error instanceof Error
            ? `Could not read catalog sync cache: ${error.message}`
            : 'Could not read catalog sync cache.',
          syncCachePath,
        ),
      );
    }
  }

  if (fs.existsSync(overridePath)) {
    overrideFound = true;
    try {
      const raw = fs.readFileSync(overridePath, 'utf8');
      const parsed = yaml.load(raw);
      const validation = validateCatalogOverrideObject(parsed, overridePath);
      issues.push(...validation.issues);
      if (validation.override && !hasCatalogErrors(validation.issues)) {
        override = validation.override;
      }
    } catch (error) {
      issues.push(
        issue(
          'error',
          'catalog_override_read_failed',
          error instanceof Error
            ? `Could not read catalog override: ${error.message}`
            : 'Could not read catalog override.',
          overridePath,
        ),
      );
    }
  }

  const internal = mergeCatalogInternalMaterializations([
    { override: syncCache },
    { override },
  ]);
  const catalog = mergeCatalog(
    [
      { override: syncCache, source: 'sync_cache' },
      { override, source: 'override' },
    ],
    overridePath,
    internal,
  );
  return {
    catalog,
    overridePath,
    overrideFound,
    syncCachePath,
    syncCacheFound,
    issues,
    internal,
  };
}

function hasCatalogErrors(issues: CatalogIssue[]): boolean {
  return issues.some((entry) => entry.severity === 'error');
}

export function validateCatalogOverrideFile(
  filePath: string,
): { override: CatalogOverrideFile | null; issues: CatalogIssue[] } {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      override: null,
      issues: [
        issue(
          'error',
          'catalog_override_not_found',
          `Catalog override file not found: ${resolved}`,
          resolved,
        ),
      ],
    };
  }

  try {
    const parsed = yaml.load(fs.readFileSync(resolved, 'utf8'));
    return validateCatalogOverrideObject(parsed, resolved);
  } catch (error) {
    return {
      override: null,
      issues: [
        issue(
          'error',
          'catalog_override_parse_failed',
          error instanceof Error
            ? error.message
            : 'Catalog override YAML could not be parsed.',
          resolved,
        ),
      ],
    };
  }
}

export function validateCatalogOverrideObject(
  value: unknown,
  sourcePath = DEFAULT_CATALOG_OVERRIDE_FILE,
): { override: CatalogOverrideFile | null; issues: CatalogIssue[] } {
  const issues: CatalogIssue[] = [];
  scanForSecrets(value, issues, '');

  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'catalog_override_root_invalid',
        'Catalog override root must be a YAML object.',
        sourcePath,
      ),
    );
    return { override: null, issues };
  }

  if (value.version !== undefined && value.version !== 1) {
    issues.push(
      issue(
        'error',
        'catalog_override_version_invalid',
        'catalog.override.yaml version must be 1 when set.',
        'version',
      ),
    );
  }

  if (value.providers === undefined) {
    issues.push(
      issue(
        'error',
        'catalog_override_missing_providers',
        'catalog.override.yaml must include providers as an object or array.',
        'providers',
      ),
    );
    return { override: null, issues };
  }

  const providers = normalizeOverrideProviders(value.providers, issues);
  providers.forEach((provider, index) =>
    validateOverrideProvider(provider, `providers[${index}]`, issues),
  );
  const internal = validateCatalogInternalMaterialization(
    value._siftgate_internal,
    '_siftgate_internal',
    issues,
  );

  return {
    override: {
      version: 1,
      providers,
      _siftgate_internal: internal,
    },
    issues,
  };
}

function normalizeOverrideProviders(
  value: unknown,
  issues: CatalogIssue[],
): CatalogOverrideProvider[] {
  if (Array.isArray(value)) {
    return value.filter((entry, index): entry is CatalogOverrideProvider => {
      if (!isRecord(entry)) {
        issues.push(
          issue(
            'error',
            'catalog_provider_invalid',
            'Provider override entries must be objects.',
            `providers[${index}]`,
          ),
        );
        return false;
      }
      return true;
    });
  }

  if (!isRecord(value)) {
    issues.push(
      issue(
        'error',
        'catalog_providers_invalid',
        'providers must be an object keyed by provider id or an array.',
        'providers',
      ),
    );
    return [];
  }

  return Object.entries(value).flatMap(([providerId, providerValue]) => {
    if (!isRecord(providerValue)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_invalid',
          'Provider override entries must be objects.',
          `providers.${providerId}`,
        ),
      );
      return [];
    }
    return [{ id: providerId, ...providerValue } as CatalogOverrideProvider];
  });
}

function validateOverrideProvider(
  provider: CatalogOverrideProvider,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isNonEmptyString(provider.id)) {
    issues.push(
      issue(
        'error',
        'catalog_provider_id_invalid',
        'Provider override id must be a non-empty string.',
        `${basePath}.id`,
      ),
    );
  }

  if (
    provider.status !== undefined &&
    (!isNonEmptyString(provider.status) || !PROVIDER_STATUSES.has(provider.status))
  ) {
    issues.push(
      issue(
        'error',
        'catalog_provider_status_invalid',
        'Provider status must be active, transport_only, deprecated, legacy_alias, or custom.',
        `${basePath}.status`,
      ),
    );
  }

  if (
    provider.replacement_provider_id !== undefined &&
    !isNonEmptyString(provider.replacement_provider_id)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_provider_replacement_invalid',
        'replacement_provider_id must be a non-empty string when set.',
        `${basePath}.replacement_provider_id`,
      ),
    );
  }

  if (
    provider.status_reason !== undefined &&
    !isNonEmptyString(provider.status_reason)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_provider_status_reason_invalid',
        'status_reason must be a non-empty string when set.',
        `${basePath}.status_reason`,
      ),
    );
  }

  if (provider.base_url !== undefined) {
    if (!isNonEmptyString(provider.base_url)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_base_url_invalid',
          'Provider base_url must be a non-empty string.',
          `${basePath}.base_url`,
        ),
      );
    } else {
      validateCatalogUrl(provider.base_url, `${basePath}.base_url`, issues, 'Catalog provider base_url');
    }
  }

  if (
    provider.auth_type !== undefined &&
    !VALID_AUTH_TYPES.has(provider.auth_type)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_provider_auth_type_invalid',
        'Provider auth_type must be bearer, x-api-key, or none.',
        `${basePath}.auth_type`,
      ),
    );
  }

  validateEndpointMap(provider.endpoints, `${basePath}.endpoints`, issues);
  validateCompatibilityProfiles(
    provider.compatibility_profiles,
    `${basePath}.compatibility_profiles`,
    issues,
  );
  validateStringArray(provider.model_prefixes, `${basePath}.model_prefixes`, issues);
  validateStringArray(provider.capabilities, `${basePath}.capabilities`, issues);
  validateCacheFlags(provider, basePath, issues);
  validatePricing(provider.pricing, `${basePath}.pricing`, issues);

  if (provider.models !== undefined) {
    if (!Array.isArray(provider.models)) {
      issues.push(
        issue(
          'error',
          'catalog_provider_models_invalid',
          'Provider models must be an array.',
          `${basePath}.models`,
        ),
      );
    } else {
      provider.models.forEach((model, index) =>
        validateOverrideModel(model, `${basePath}.models[${index}]`, issues),
      );
    }
  }
}

function validateOverrideModel(
  model: CatalogOverrideModel,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isRecord(model)) {
    issues.push(
      issue(
        'error',
        'catalog_model_invalid',
        'Model override entries must be objects.',
        basePath,
      ),
    );
    return;
  }
  if (!isNonEmptyString(model.id)) {
    issues.push(
      issue(
        'error',
        'catalog_model_id_invalid',
        'Model override id must be a non-empty string.',
        `${basePath}.id`,
      ),
    );
  }
  validateModalities(model.modalities, `${basePath}.modalities`, issues);
  validateEndpointMap(model.endpoints, `${basePath}.endpoints`, issues);
  validateStringArray(model.capabilities, `${basePath}.capabilities`, issues);
  validateCacheFlags(model, basePath, issues);
  validatePricing(model.pricing, `${basePath}.pricing`, issues);
  if (model.limits !== undefined && !isRecord(model.limits)) {
    issues.push(
      issue(
        'error',
        'catalog_model_limits_invalid',
        'Model limits must be an object.',
        `${basePath}.limits`,
      ),
    );
  }
  if (model.enrichment !== undefined) {
    if (!isRecord(model.enrichment)) {
      issues.push(
        issue(
          'error',
          'catalog_model_enrichment_invalid',
          'Model enrichment must be an object.',
          `${basePath}.enrichment`,
        ),
      );
    } else {
      if (!isNonEmptyString(model.enrichment.source)) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_source_missing',
            'Model enrichment source should be a non-empty string.',
            `${basePath}.enrichment.source`,
          ),
        );
      }
      if (
        model.enrichment.source_url !== undefined &&
        !isNonEmptyString(model.enrichment.source_url)
      ) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_source_url_invalid',
            'Model enrichment source_url should be a valid http(s) URL when set.',
            `${basePath}.enrichment.source_url`,
          ),
        );
      } else if (isNonEmptyString(model.enrichment.source_url)) {
        validateCatalogUrl(
          model.enrichment.source_url,
          `${basePath}.enrichment.source_url`,
          issues,
          'Model enrichment source_url',
        );
      }
      if (
        model.enrichment.synced_at !== undefined &&
        normalizeDateLikeValue(model.enrichment.synced_at) === undefined
      ) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_synced_at_invalid',
            'Model enrichment synced_at should be an ISO date/time when set.',
            `${basePath}.enrichment.synced_at`,
          ),
        );
      }
      if (
        model.enrichment.enriched_at !== undefined &&
        normalizeDateLikeValue(model.enrichment.enriched_at) === undefined
      ) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_enriched_at_invalid',
            'Model enrichment enriched_at should be an ISO date/time when set.',
            `${basePath}.enrichment.enriched_at`,
          ),
        );
      }
      if (
        model.enrichment.match_strategy !== undefined &&
        ![
          'exact_source_model_id',
          'exact_canonical_slug',
          'explicit_alias',
          'strict_signature',
          'strict_signature_release_date',
          'ambiguous_candidate',
          'unmatched',
        ].includes(model.enrichment.match_strategy)
      ) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_match_strategy_invalid',
            'Model enrichment match_strategy is not a recognized catalog matching strategy.',
            `${basePath}.enrichment.match_strategy`,
          ),
        );
      }
      if (
        model.enrichment.match_confidence !== undefined &&
        !['high', 'medium', 'low'].includes(model.enrichment.match_confidence)
      ) {
        issues.push(
          issue(
            'warning',
            'catalog_model_enrichment_match_confidence_invalid',
            'Model enrichment match_confidence must be high, medium, or low when set.',
            `${basePath}.enrichment.match_confidence`,
          ),
        );
      }
      if (
        model.enrichment.matched_from !== undefined &&
        !Array.isArray(model.enrichment.matched_from)
      ) {
        issues.push(
          issue(
            'error',
            'catalog_model_enrichment_matched_from_invalid',
            'Model enrichment matched_from must be an array of strings when set.',
            `${basePath}.enrichment.matched_from`,
          ),
        );
      } else {
        validateStringArray(
          model.enrichment.matched_from,
          `${basePath}.enrichment.matched_from`,
          issues,
        );
      }
      if (
        model.enrichment.match_notes !== undefined &&
        !Array.isArray(model.enrichment.match_notes)
      ) {
        issues.push(
          issue(
            'error',
            'catalog_model_enrichment_match_notes_invalid',
            'Model enrichment match_notes must be an array of strings when set.',
            `${basePath}.enrichment.match_notes`,
          ),
        );
      } else {
        validateStringArray(
          model.enrichment.match_notes,
          `${basePath}.enrichment.match_notes`,
          issues,
        );
      }
      if (
        model.enrichment.metadata !== undefined &&
        !isRecord(model.enrichment.metadata)
      ) {
        issues.push(
          issue(
            'error',
            'catalog_model_enrichment_metadata_invalid',
            'Model enrichment metadata must be an object when set.',
            `${basePath}.enrichment.metadata`,
          ),
        );
      }
      if (model.enrichment.lifecycle !== undefined) {
        if (!isRecord(model.enrichment.lifecycle)) {
          issues.push(
            issue(
              'error',
              'catalog_model_enrichment_lifecycle_invalid',
              'Model enrichment lifecycle must be an object when set.',
              `${basePath}.enrichment.lifecycle`,
            ),
          );
        } else {
          for (const key of ['release_date', 'announcement_date', 'knowledge_cutoff'] as const) {
            const value = model.enrichment.lifecycle[key];
            if (value !== undefined && !isValidDateLikeValue(value)) {
              issues.push(
                issue(
                  'warning',
                  'catalog_model_enrichment_lifecycle_date_invalid',
                  `Model enrichment lifecycle.${key} should be an ISO date when set.`,
                  `${basePath}.enrichment.lifecycle.${key}`,
                ),
              );
            }
          }
        }
      }
      if (model.enrichment.specs !== undefined && !isRecord(model.enrichment.specs)) {
        issues.push(
          issue(
            'error',
            'catalog_model_enrichment_specs_invalid',
            'Model enrichment specs must be an object when set.',
            `${basePath}.enrichment.specs`,
          ),
        );
      }
      if (model.enrichment.benchmarks !== undefined) {
        if (!isRecord(model.enrichment.benchmarks)) {
          issues.push(
            issue(
              'error',
              'catalog_model_enrichment_benchmarks_invalid',
              'Model enrichment benchmarks must be an object when set.',
              `${basePath}.enrichment.benchmarks`,
            ),
          );
        } else {
          for (const [key, value] of Object.entries(model.enrichment.benchmarks)) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              issues.push(
                issue(
                  'error',
                  'catalog_model_enrichment_benchmark_invalid',
                  'Model enrichment benchmark values must be finite numbers.',
                  `${basePath}.enrichment.benchmarks.${key}`,
                ),
              );
            }
          }
        }
      }
      if (model.enrichment.secondary_pricing_reference !== undefined) {
        validatePricing(
          model.enrichment.secondary_pricing_reference,
          `${basePath}.enrichment.secondary_pricing_reference`,
          issues,
        );
      }
    }
  }
}

function validateCatalogInternalMaterialization(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): CatalogInternalMaterialization | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(
      issue(
        'warning',
        'catalog_internal_materialization_invalid',
        'Catalog internal materialization should be an object when present.',
        basePath,
      ),
    );
    return undefined;
  }

  let canonicalRegistry: CatalogInternalMaterialization['canonical_registry'];
  if (value.canonical_registry !== undefined) {
    if (!isRecord(value.canonical_registry)) {
      issues.push(
        issue(
          'warning',
          'catalog_canonical_registry_invalid',
          'Catalog internal canonical_registry should be an object when present.',
          `${basePath}.canonical_registry`,
        ),
      );
    } else {
      canonicalRegistry = normalizeCanonicalRegistryValue(value.canonical_registry);
      if (!canonicalRegistry) {
        issues.push(
          issue(
            'warning',
            'catalog_canonical_registry_invalid',
            'Catalog internal canonical_registry is malformed and will be ignored.',
            `${basePath}.canonical_registry`,
          ),
        );
      } else {
        validateCatalogUrl(
          canonicalRegistry.source_url,
          `${basePath}.canonical_registry.source_url`,
          issues,
          'Catalog canonical_registry.source_url',
        );
        if (Array.isArray(value.canonical_registry.models)) {
          const rawCount = value.canonical_registry.models.length;
          if (rawCount !== canonicalRegistry.models.length) {
            issues.push(
              issue(
                'warning',
                'catalog_canonical_registry_model_skipped',
                `Skipped ${rawCount - canonicalRegistry.models.length} malformed canonical model entr${rawCount - canonicalRegistry.models.length === 1 ? 'y' : 'ies'} while loading internal canonical_registry.`,
                `${basePath}.canonical_registry.models`,
              ),
            );
          }
        }
      }
    }
  }

  let zeroEvalOverlay: NonNullable<CatalogInternalMaterialization['diagnostics']>['zeroeval_overlay'];
  if (isRecord(value.diagnostics) && value.diagnostics.zeroeval_overlay !== undefined) {
    zeroEvalOverlay = normalizeZeroEvalOverlayDiagnosticsValue(
      value.diagnostics.zeroeval_overlay,
    );
    if (!zeroEvalOverlay) {
      issues.push(
        issue(
          'warning',
          'catalog_zeroeval_overlay_diagnostics_invalid',
          'Catalog internal zeroeval_overlay diagnostics are malformed and will be ignored.',
          `${basePath}.diagnostics.zeroeval_overlay`,
        ),
      );
    }
  } else if (value.diagnostics !== undefined && !isRecord(value.diagnostics)) {
    issues.push(
      issue(
        'warning',
        'catalog_internal_diagnostics_invalid',
        'Catalog internal diagnostics should be an object when present.',
        `${basePath}.diagnostics`,
      ),
    );
  }

  if (!canonicalRegistry && !zeroEvalOverlay) return undefined;
  return {
    canonical_registry: canonicalRegistry,
    diagnostics: zeroEvalOverlay ? { zeroeval_overlay: zeroEvalOverlay } : undefined,
  };
}

function validateCacheFlags(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (!isRecord(value)) return;
  for (const key of ['prompt_cache', 'read_cache', 'write_cache']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      issues.push(
        issue(
          'error',
          'catalog_cache_flag_invalid',
          `${key} must be a boolean when set.`,
          `${basePath}.${key}`,
        ),
      );
    }
  }
}

function validateCatalogUrl(
  value: string,
  issuePath: string,
  issues: CatalogIssue[],
  label = 'Catalog URL',
): void {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('invalid protocol');
    }
  } catch {
    issues.push(
      issue(
        'error',
        'catalog_url_invalid',
        `${label} must be an http(s) URL.`,
        issuePath,
      ),
    );
  }
}

function validateEndpointMap(
  endpoints: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (endpoints === undefined) return;
  if (!isRecord(endpoints)) {
    issues.push(
      issue(
        'error',
        'catalog_endpoints_invalid',
        'endpoints must be an object.',
        basePath,
      ),
    );
    return;
  }
  for (const [key, value] of Object.entries(endpoints)) {
    if (!VALID_ENDPOINT_SET.has(key)) {
      issues.push(
        issue(
          'warning',
          'catalog_endpoint_unknown',
          `Endpoint key "${key}" is not a known SiftGate capability endpoint.`,
          `${basePath}.${key}`,
        ),
      );
    }
    if (!isNonEmptyString(value)) {
      issues.push(
        issue(
          'error',
          'catalog_endpoint_invalid',
          'Endpoint values must be non-empty strings.',
          `${basePath}.${key}`,
        ),
      );
    } else if (
      !value.startsWith('/') &&
      !/^https?:\/\//i.test(value) &&
      !/^wss?:\/\//i.test(value)
    ) {
      issues.push(
        issue(
          'error',
          'catalog_endpoint_invalid',
          'Endpoint values must be paths or http(s)/ws(s) URLs.',
          `${basePath}.${key}`,
        ),
      );
    }
  }
}

function validateModalities(
  modalities: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (modalities === undefined) return;
  if (!Array.isArray(modalities)) {
    issues.push(
      issue(
        'error',
        'catalog_modalities_invalid',
        'modalities must be an array.',
        basePath,
      ),
    );
    return;
  }
  modalities.forEach((modality, index) => {
    if (!isNonEmptyString(modality) || !VALID_MODALITY_SET.has(modality)) {
      issues.push(
        issue(
          'error',
          'catalog_modality_invalid',
          `Unsupported modality "${String(modality)}".`,
          `${basePath}[${index}]`,
        ),
      );
    }
  });
}

function validateStringArray(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(
      issue(
        'error',
        'catalog_string_array_invalid',
        'Value must be an array of strings.',
        basePath,
      ),
    );
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(
        issue(
          'error',
          'catalog_string_array_invalid',
          'Array entries must be non-empty strings.',
          `${basePath}[${index}]`,
        ),
      );
    }
  });
}

function validateCompatibilityProfiles(
  value: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(
      issue(
        'error',
        'catalog_compatibility_profiles_invalid',
        'compatibility_profiles must be an array of profile ids.',
        basePath,
      ),
    );
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(
        issue(
          'error',
          'catalog_compatibility_profile_invalid',
          'compatibility profile entries must be non-empty strings.',
          `${basePath}[${index}]`,
        ),
      );
      return;
    }
    if (!isCompatibilityProfileId(item)) {
      issues.push(
        issue(
          'warning',
          'catalog_compatibility_profile_unknown',
          `Compatibility profile "${item}" is not built in. It will be treated as operator-managed metadata.`,
          `${basePath}[${index}]`,
        ),
      );
    }
  });
}

function validatePricing(
  pricing: unknown,
  basePath: string,
  issues: CatalogIssue[],
): void {
  if (pricing === undefined) return;
  if (!isRecord(pricing)) {
    issues.push(
      issue('error', 'catalog_pricing_invalid', 'pricing must be an object.', basePath),
    );
    return;
  }
  for (const key of PRICING_DIMENSIONS) {
    if (
      pricing[key] !== undefined &&
      !isFiniteNonNegativeNumber(pricing[key])
    ) {
      issues.push(
        issue(
          'error',
          'catalog_pricing_invalid',
          `pricing.${key} must be a non-negative number when set.`,
          `${basePath}.${key}`,
        ),
      );
    }
  }
  if (pricing.unit !== undefined && !isNonEmptyString(pricing.unit)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_unit_missing',
        'pricing.unit should be a non-empty string when set.',
        `${basePath}.unit`,
      ),
    );
  }
  if (pricing.billing_unit !== undefined && !isNonEmptyString(pricing.billing_unit)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_billing_unit_missing',
        'pricing.billing_unit should be a non-empty string when set.',
        `${basePath}.billing_unit`,
      ),
    );
  }
  if (pricing.units !== undefined) {
    if (!isRecord(pricing.units)) {
      issues.push(
        issue(
          'error',
          'catalog_pricing_units_invalid',
          'pricing.units must be an object keyed by supported pricing dimensions.',
          `${basePath}.units`,
        ),
      );
    } else {
      for (const [key, value] of Object.entries(pricing.units)) {
        if (!PRICING_DIMENSIONS.includes(key as CatalogPricingDimension)) {
          issues.push(
            issue(
              'warning',
              'catalog_pricing_unit_unknown',
              `pricing.units.${key} is not a known pricing dimension.`,
              `${basePath}.units.${key}`,
            ),
          );
        }
        if (!isNonEmptyString(value)) {
          issues.push(
            issue(
              'error',
              'catalog_pricing_units_invalid',
              'pricing.units values must be non-empty strings.',
              `${basePath}.units.${key}`,
            ),
          );
        }
      }
    }
  }
  if (pricing.currency !== undefined && !isNonEmptyString(pricing.currency)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_currency_missing',
        'pricing.currency should be a non-empty currency code.',
        `${basePath}.currency`,
      ),
    );
  }
  if (
    pricing.source_type !== undefined &&
    (!isNonEmptyString(pricing.source_type) ||
      !PRICING_SOURCE_TYPES.includes(pricing.source_type as (typeof PRICING_SOURCE_TYPES)[number]))
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_source_type_invalid',
        'pricing.source_type must be official_docs, provider_api, aggregator_api, operator_override, docs_review, or unknown.',
        `${basePath}.source_type`,
      ),
    );
  }
  if (!isNonEmptyString(pricing.source)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_source_missing',
        'pricing.source should describe where this value came from.',
        `${basePath}.source`,
      ),
    );
  }
  if (pricing.source_url === undefined) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_source_url_missing',
        'pricing.source_url should point to the docs, API, or local review source for this price.',
        `${basePath}.source_url`,
      ),
    );
  } else {
    if (!isNonEmptyString(pricing.source_url)) {
      issues.push(
        issue(
          'warning',
          'catalog_pricing_source_url_missing',
          'pricing.source_url should be a non-empty URL when set.',
          `${basePath}.source_url`,
        ),
      );
    } else {
      validateCatalogUrl(pricing.source_url, `${basePath}.source_url`, issues, 'pricing.source_url');
    }
  }
  if (!isNonEmptyString(pricing.last_updated)) {
    if (pricing.last_updated === undefined) {
      issues.push(
        issue(
          'warning',
          'catalog_pricing_last_updated_missing',
          'pricing.last_updated should be an ISO date.',
          `${basePath}.last_updated`,
        ),
      );
    } else if (!isValidDateLikeValue(pricing.last_updated)) {
      issues.push(
        issue(
          'warning',
          'catalog_pricing_last_updated_invalid',
          'pricing.last_updated should be an ISO date.',
          `${basePath}.last_updated`,
        ),
      );
    }
  } else if (Number.isNaN(Date.parse(pricing.last_updated))) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_updated_invalid',
        'pricing.last_updated should be an ISO date.',
        `${basePath}.last_updated`,
      ),
    );
  }
  if (
    pricing.retrieved_at !== undefined &&
    !isValidDateLikeValue(pricing.retrieved_at)
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_retrieved_at_invalid',
        'pricing.retrieved_at should be an ISO date/time when set.',
        `${basePath}.retrieved_at`,
      ),
    );
  }
  if (
    pricing.last_verified_at !== undefined &&
    !isValidDateLikeValue(pricing.last_verified_at)
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_verified_at_invalid',
        'pricing.last_verified_at should be an ISO date/time when set.',
        `${basePath}.last_verified_at`,
      ),
    );
  }
  if (
    pricing.last_sync !== undefined &&
    !isValidDateLikeValue(pricing.last_sync)
  ) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_last_sync_invalid',
        'pricing.last_sync should be an ISO date/time when set.',
        `${basePath}.last_sync`,
      ),
    );
  }
  if (pricing.manual_review_required === undefined) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_manual_review_missing',
        'pricing.manual_review_required should be set explicitly.',
        `${basePath}.manual_review_required`,
      ),
    );
  } else if (typeof pricing.manual_review_required !== 'boolean') {
    issues.push(
      issue(
        'error',
        'catalog_pricing_invalid',
        'pricing.manual_review_required must be a boolean when set.',
        `${basePath}.manual_review_required`,
      ),
    );
  }
  if (pricing.review_reason !== undefined && !isNonEmptyString(pricing.review_reason)) {
    issues.push(
      issue(
        'warning',
        'catalog_pricing_review_reason_missing',
        'pricing.review_reason should be a non-empty string when set.',
        `${basePath}.review_reason`,
      ),
    );
  }
  if (
    pricing.stale_after_days !== undefined &&
    (!isFiniteNonNegativeNumber(pricing.stale_after_days) || pricing.stale_after_days === 0)
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_stale_after_invalid',
        'pricing.stale_after_days must be a positive number when set.',
        `${basePath}.stale_after_days`,
      ),
    );
  }
  if (
    pricing.pricing_confidence !== undefined &&
    (!isNonEmptyString(pricing.pricing_confidence) ||
      !PRICING_CONFIDENCES.has(pricing.pricing_confidence))
  ) {
    issues.push(
      issue(
        'error',
        'catalog_pricing_confidence_invalid',
        'pricing.pricing_confidence must be high, medium, low, or unknown.',
        `${basePath}.pricing_confidence`,
      ),
    );
  }
}

function scanForSecrets(
  value: unknown,
  issues: CatalogIssue[],
  currentPath: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForSecrets(item, issues, `${currentPath}[${index}]`),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      if (SECRET_KEY_PATTERN.test(key)) {
        issues.push(
          issue(
            'error',
            'catalog_override_secret_field',
            `Catalog override field "${childPath}" looks like a secret. Provider API keys must stay in gateway.config.yaml env refs, not catalog.override.yaml.`,
            childPath,
          ),
        );
      }
      scanForSecrets(child, issues, childPath);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value)) {
    issues.push(
      issue(
        'warning',
        'catalog_override_secret_value',
        'Catalog override contains a value that looks like a secret. Remove provider keys from catalog.override.yaml.',
        currentPath,
      ),
    );
  }
}

export function mergeCatalog(
  overrides:
    | CatalogOverrideFile
    | null
    | Array<{ override: CatalogOverrideFile | null; source: CatalogSource }> = null,
  overrideFile?: string,
  internal: CatalogInternalMaterialization = {},
): ProviderCatalog {
  const canonicalRegistryPresent = Boolean(internal.canonical_registry?.models.length);
  const providers = BUILTIN_PROVIDER_CATALOG.map((provider) =>
    prepareBuiltinProviderForMerge(provider, canonicalRegistryPresent),
  );
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  if (internal.canonical_registry?.models.length) {
    const projectedProviders = buildCanonicalProjectionProviders({
      canonicalRegistry: internal.canonical_registry,
      providers: BUILTIN_PROVIDER_CATALOG.map(cloneProvider),
    });
    for (const projectedProvider of Object.values(projectedProviders)) {
      const existing = byId.get(projectedProvider.id || '');
      if (!existing || !projectedProvider.id) continue;
      mergeProvider(existing, projectedProvider, 'sync_cache');
    }
  }

  const layers = Array.isArray(overrides)
    ? overrides
    : [{ override: overrides, source: 'override' as CatalogSource }];

  for (const layer of layers) {
    for (const overrideProvider of normalizeOverrideProvidersForMerge(layer.override)) {
      if (!overrideProvider.id) continue;
      const existing = byId.get(overrideProvider.id);
      if (existing) {
        mergeProvider(existing, overrideProvider, layer.source);
      } else {
        const provider = providerFromOverride(overrideProvider, layer.source);
        providers.push(provider);
        byId.set(provider.id, provider);
      }
    }
  }

  for (const provider of providers) {
    finalizeMergedProvider(provider, canonicalRegistryPresent);
  }

  providers.sort((a, b) => a.id.localeCompare(b.id));
  for (const provider of providers) {
    provider.models.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    providers,
    override_file: overrideFile || null,
  };
}

function prepareBuiltinProviderForMerge(
  provider: CatalogProvider,
  canonicalRegistryPresent: boolean,
): CatalogProvider {
  const next = cloneProvider(provider);
  next.aliases = augmentProviderAliases(next);
  next.replacement_provider_id = providerReplacementId(next.id);
  next.status = resolveProviderStatus({
    provider: next,
    canonicalRegistryPresent,
  });
  next.status_reason = providerStatusReason(next.id, next.status);
  if (canonicalRegistryPresent) {
    next.models = [];
    next.model_buckets = undefined;
  }
  return next;
}

function finalizeMergedProvider(
  provider: CatalogProvider,
  canonicalRegistryPresent: boolean,
): void {
  provider.aliases = augmentProviderAliases(provider);
  provider.status = resolveProviderStatus({
    provider,
    canonicalRegistryPresent,
    preferExistingStatus: false,
  });
  provider.replacement_provider_id =
    provider.replacement_provider_id || providerReplacementId(provider.id);
  provider.status_reason =
    provider.status_reason || providerStatusReason(provider.id, provider.status);

  const hasProjectedOrOperatorModels =
    provider.models.length > 0 &&
    provider.models.some(
      (model) => model.source !== 'builtin' || model.overridden || model.synced,
    );
  const providerPricingSource = provider.pricing?.source || '';
  if (
    canonicalRegistryPresent &&
    provider.status === 'active' &&
    hasProjectedOrOperatorModels &&
    (providerPricingSource === 'builtin-reference' ||
      providerPricingSource === 'provider-reference' ||
      providerPricingSource === 'builtin-static-placeholder')
  ) {
    provider.pricing = undefined;
  }
}

function normalizeOverrideProvidersForMerge(
  override: CatalogOverrideFile | null,
): CatalogOverrideProvider[] {
  if (!override?.providers) return [];
  if (Array.isArray(override.providers)) return override.providers;
  return Object.entries(override.providers).map(([id, provider]) => ({
    id,
    ...provider,
  }));
}

function mergeCatalogInternalMaterializations(
  layers: Array<{ override: CatalogOverrideFile | null }>,
): CatalogInternalMaterialization {
  const merged: CatalogInternalMaterialization = {};
  for (const layer of layers) {
    if (layer.override?._siftgate_internal?.canonical_registry) {
      merged.canonical_registry = cloneJsonValue(
        layer.override._siftgate_internal.canonical_registry,
      );
    }
    if (layer.override?._siftgate_internal?.diagnostics?.zeroeval_overlay) {
      merged.diagnostics ??= {};
      merged.diagnostics.zeroeval_overlay = cloneJsonValue(
        layer.override._siftgate_internal.diagnostics.zeroeval_overlay,
      );
    }
  }
  return merged;
}

function mergeProvider(
  target: CatalogProvider,
  override: CatalogOverrideProvider,
  source: CatalogSource,
): void {
  if (source === 'override') {
    target.overridden = true;
  } else if (source === 'sync_cache') {
    target.synced = true;
  }
  if (override.name !== undefined) target.name = override.name;
  if (override.aliases) target.aliases = [...override.aliases];
  if (override.status !== undefined) target.status = override.status;
  if (override.replacement_provider_id !== undefined) {
    target.replacement_provider_id = override.replacement_provider_id;
  }
  if (override.status_reason !== undefined) target.status_reason = override.status_reason;
  if (override.family !== undefined) target.family = override.family;
  if (override.category !== undefined) target.category = override.category;
  if (override.provider_type !== undefined) target.provider_type = override.provider_type;
  if (override.homepage_url !== undefined) target.homepage_url = override.homepage_url;
  if (override.docs_url !== undefined) target.docs_url = override.docs_url;
  if (override.pricing_url !== undefined) target.pricing_url = override.pricing_url;
  if (override.logo_id !== undefined) target.logo_id = override.logo_id;
  if (override.input_types) target.input_types = [...override.input_types];
  if (override.output_types) target.output_types = [...override.output_types];
  if (override.model_buckets) {
    target.model_buckets = Object.fromEntries(
      Object.entries(override.model_buckets).map(([key, values]) => [
        key,
        Array.isArray(values) ? [...values] : values,
      ]),
    ) as CatalogProvider['model_buckets'];
  }
  if (override.compatibility_profile !== undefined) {
    target.compatibility_profile = Array.isArray(override.compatibility_profile)
      ? [...override.compatibility_profile]
      : override.compatibility_profile;
  }
  if (override.modalities) target.modalities = [...override.modalities];
  if (override.base_url !== undefined) target.base_url = override.base_url;
  if (override.auth_type !== undefined) target.auth_type = override.auth_type;
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.compatibility_profiles) {
    target.compatibility_profiles = [...override.compatibility_profiles];
  }
  if (override.model_prefixes) target.model_prefixes = [...override.model_prefixes];
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.pricing) target.pricing = normalizeCatalogPricing({ ...override.pricing });
  if (override.prompt_cache !== undefined) target.prompt_cache = override.prompt_cache;
  if (override.read_cache !== undefined) target.read_cache = override.read_cache;
  if (override.write_cache !== undefined) target.write_cache = override.write_cache;

  const modelsById = new Map(target.models.map((model) => [model.id, model]));
  for (const overrideModel of override.models || []) {
    const existing = modelsById.get(overrideModel.id);
    if (existing) {
      mergeModel(existing, target.id, overrideModel, source);
    } else {
      const model = modelFromOverride(target.id, overrideModel, source);
      target.models.push(model);
      modelsById.set(model.id, model);
    }
  }

  if (
    source === 'override' &&
    override.status === undefined &&
    target.status === 'transport_only' &&
    (override.models?.length || 0) > 0
  ) {
    target.status = 'active';
    target.status_reason =
      target.status_reason ||
      'Local catalog overrides supplied explicit models for this preset, so SiftGate now treats it as an active operator-facing provider row.';
  }
}

function providerFromOverride(
  override: CatalogOverrideProvider,
  source: CatalogSource,
): CatalogProvider {
  const id = override.id || 'custom';
  return {
    id,
    name: override.name || id,
    aliases: override.aliases ? [...override.aliases] : undefined,
    status:
      override.status ||
      (id === 'openai-compatible' ? 'custom' : undefined),
    replacement_provider_id: override.replacement_provider_id,
    status_reason: override.status_reason,
    family: override.family,
    category: override.category,
    provider_type: override.provider_type,
    homepage_url: override.homepage_url,
    docs_url: override.docs_url,
    pricing_url: override.pricing_url,
    logo_id: override.logo_id,
    input_types: override.input_types ? [...override.input_types] : undefined,
    output_types: override.output_types ? [...override.output_types] : undefined,
    model_buckets: override.model_buckets
      ? Object.fromEntries(
          Object.entries(override.model_buckets).map(([key, values]) => [
            key,
            Array.isArray(values) ? [...values] : values,
          ]),
        ) as CatalogProvider['model_buckets']
      : undefined,
    compatibility_profile: Array.isArray(override.compatibility_profile)
      ? [...override.compatibility_profile]
      : override.compatibility_profile,
    modalities: override.modalities ? [...override.modalities] : undefined,
    base_url: override.base_url || 'https://provider.example',
    auth_type: override.auth_type || 'bearer',
    endpoints: { ...(override.endpoints || {}) },
    compatibility_profiles: override.compatibility_profiles
      ? [...override.compatibility_profiles]
      : ['openai_compatible'],
    model_prefixes: override.model_prefixes ? [...override.model_prefixes] : [],
    capabilities: override.capabilities ? [...override.capabilities] : [],
    pricing: override.pricing ? normalizeCatalogPricing({ ...override.pricing }) : undefined,
    prompt_cache: override.prompt_cache,
    read_cache: override.read_cache,
    write_cache: override.write_cache,
    models: (override.models || []).map((model) => modelFromOverride(id, model, source)),
    source,
    overridden: source === 'override',
    synced: source === 'sync_cache',
  };
}

function mergeModel(
  target: CatalogModel,
  providerId: string,
  override: CatalogOverrideModel,
  source: CatalogSource,
): void {
  target.provider = providerId;
  if (source === 'override') {
    target.overridden = true;
  } else if (source === 'sync_cache') {
    target.synced = true;
  }
  target.source = source;
  if (override.display_name !== undefined) target.display_name = override.display_name;
  if (override.modalities) target.modalities = [...override.modalities];
  if (override.endpoints) target.endpoints = { ...target.endpoints, ...override.endpoints };
  if (override.capabilities) target.capabilities = [...override.capabilities];
  if (override.limits) target.limits = { ...override.limits };
  if (override.pricing) target.pricing = normalizeCatalogPricing({ ...override.pricing });
  if (override.enrichment) {
    const normalizedEnrichment = normalizeModelEnrichment(override.enrichment);
    if (normalizedEnrichment) {
      target.enrichment = {
        ...(target.enrichment || {}),
        ...normalizedEnrichment,
        metadata: {
          ...cloneEnrichmentMetadata(target.enrichment?.metadata),
          ...cloneEnrichmentMetadata(normalizedEnrichment.metadata),
        },
      };
    }
  }
  if (override.prompt_cache !== undefined) target.prompt_cache = override.prompt_cache;
  if (override.read_cache !== undefined) target.read_cache = override.read_cache;
  if (override.write_cache !== undefined) target.write_cache = override.write_cache;
}

function modelFromOverride(
  providerId: string,
  override: CatalogOverrideModel,
  source: CatalogSource,
): CatalogModel {
  return {
    id: override.id,
    provider: providerId,
    display_name: override.display_name,
    modalities: override.modalities ? [...override.modalities] : ['text'],
    endpoints: { ...(override.endpoints || {}) },
    capabilities: override.capabilities ? [...override.capabilities] : [],
    limits: override.limits ? { ...override.limits } : undefined,
    pricing: override.pricing ? normalizeCatalogPricing({ ...override.pricing }) : undefined,
    enrichment: normalizeModelEnrichment(override.enrichment),
    prompt_cache: override.prompt_cache,
    read_cache: override.read_cache,
    write_cache: override.write_cache,
    source,
    overridden: source === 'override',
    synced: source === 'sync_cache',
  };
}

export function flattenCatalogModels(catalog: ProviderCatalog): CatalogModel[] {
  return catalog.providers.flatMap((provider) => provider.models);
}

export function findCatalogModel(
  catalog: ProviderCatalog,
  modelId: string,
): CatalogModel | undefined {
  return flattenCatalogModels(catalog).find((model) => model.id === modelId);
}

export function findCatalogModelForNode(
  catalog: ProviderCatalog,
  modelId: string,
  node?: { id?: string; base_url?: string },
): CatalogModel | undefined {
  const matches = flattenCatalogModels(catalog).filter((model) => model.id === modelId);
  if (matches.length === 0) return undefined;
  if (!node) return matches[0];

  const nodeId = typeof node.id === 'string' ? node.id : '';
  const baseUrl = typeof node.base_url === 'string'
    ? normalizeComparableUrl(node.base_url)
    : '';
  const providerById = nodeId
    ? findCatalogProviderByIdOrAlias(catalog.providers, nodeId)
    : undefined;
  const providerByUrl = baseUrl
    ? catalog.providers.find(
        (provider) => normalizeComparableUrl(provider.base_url) === baseUrl,
      )
    : undefined;
  const providerIds = new Set(
    [providerById?.id, providerByUrl?.id, nodeId].filter(isNonEmptyString),
  );
  return matches.find((model) => providerIds.has(model.provider)) || matches[0];
}

export function findCatalogProviderForNode(
  catalog: ProviderCatalog | undefined,
  node?: { id?: string; base_url?: string },
): CatalogProvider | undefined {
  return findCompatibilityCatalogProviderForNode(catalog, node);
}

export function catalogModelToModelPricing(
  model: CatalogModel | undefined,
): (ModelPricing & {
  source?: string;
  currency?: string;
  catalog_source?: string;
  manual_review_required?: boolean;
  pricing_confidence?: string;
}) | undefined {
  return catalogModelToGovernedModelPricing(model);
}

export function assessCatalogPricing(
  pricing: CatalogPricing | undefined,
  modalities: readonly string[] = [],
  now: Date = new Date(),
): CatalogPricingHygiene {
  const normalizedPricing = normalizeCatalogPricing(pricing);
  if (!normalizedPricing) {
    return {
      status: 'missing',
      currency: null,
      source_type: null,
      source: null,
      source_url: null,
      manual_review_required: false,
      review_reason: null,
      pricing_confidence: null,
      last_updated: null,
      last_verified_at: null,
      retrieved_at: null,
      age_days: null,
      stale_after_days: null,
      stale: false,
      placeholder: false,
      review_required: false,
      source_missing: true,
      source_url_missing: true,
      missing_price_dimensions: requiredPricingDimensions(modalities),
      unit_mismatches: [],
      warnings: ['catalog_pricing_missing', 'catalog_pricing_source_missing', 'catalog_pricing_source_url_missing'],
    };
  }
  pricing = normalizedPricing;

  const required = requiredPricingDimensions(modalities);
  const missing = required.filter((dimension) => !hasPricingDimension(pricing, dimension));
  const unitMismatches = required.filter((dimension) => !hasCompatibleUnit(pricing, dimension));
  const lastUpdated = isNonEmptyString(pricing.last_updated) ? pricing.last_updated : null;
  const lastVerifiedAt = isNonEmptyString(pricing.last_verified_at) ? pricing.last_verified_at : null;
  const retrievedAt = isNonEmptyString(pricing.retrieved_at) ? pricing.retrieved_at : null;
  const freshnessBasis = lastVerifiedAt || retrievedAt || lastUpdated;
  const parsedFreshnessBasis = freshnessBasis ? Date.parse(freshnessBasis) : Number.NaN;
  const ageDays = Number.isNaN(parsedFreshnessBasis)
    ? null
    : Math.max(0, Math.floor((now.getTime() - parsedFreshnessBasis) / 86_400_000));
  const staleAfterDays = pricing.stale_after_days ?? DEFAULT_STALE_AFTER_DAYS;
  const stale = catalogPricingIsStale(pricing, now, DEFAULT_STALE_AFTER_DAYS);
  const sourceMissing = !isNonEmptyString(pricing.source);
  const sourceUrlMissing = !isNonEmptyString(pricing.source_url);
  const reviewRequired =
    pricing.manual_review_required === true ||
    pricing.pricing_confidence === 'low' ||
    pricing.pricing_confidence === 'unknown' ||
    PLACEHOLDER_SOURCE_PATTERN.test(pricing.source || '');
  const placeholder = reviewRequired;
  const warnings = [
    ...missing.map((dimension) => `catalog_pricing_missing:${dimension}`),
    ...unitMismatches.map((dimension) => `catalog_pricing_unit_mismatch:${dimension}`),
    ...(stale ? ['catalog_pricing_stale'] : []),
    ...(reviewRequired ? ['catalog_pricing_review_required'] : []),
    ...(sourceMissing ? ['catalog_pricing_source_missing'] : []),
    ...(sourceUrlMissing ? ['catalog_pricing_source_url_missing'] : []),
  ];

  return {
    status: missing.length > 0
      ? 'missing'
      : stale
        ? 'stale'
        : reviewRequired
          ? 'placeholder'
          : 'fresh',
    currency: pricing.currency || null,
    source_type: pricing.source_type || null,
    source: pricing.source || null,
    source_url: pricing.source_url || null,
    manual_review_required: pricing.manual_review_required === true,
    review_reason: pricing.review_reason || null,
    pricing_confidence: pricing.pricing_confidence || null,
    last_updated: lastUpdated,
    last_verified_at: lastVerifiedAt,
    retrieved_at: retrievedAt,
    age_days: ageDays,
    stale_after_days: staleAfterDays,
    stale,
    placeholder,
    review_required: reviewRequired,
    source_missing: sourceMissing,
    source_url_missing: sourceUrlMissing,
    missing_price_dimensions: missing,
    unit_mismatches: unitMismatches,
    warnings,
  };
}

export function collectCatalogPricingHygieneIssues(
  catalog: ProviderCatalog,
  now: Date = new Date(),
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      const hygiene = assessCatalogPricing(model.pricing, model.modalities, now);
      const modelPath = `providers.${provider.id}.models.${model.id}.pricing`;
      for (const dimension of hygiene.missing_price_dimensions) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_missing',
            `Catalog model "${model.id}" is missing ${dimension} pricing metadata.`,
            modelPath,
          ),
        );
      }
      for (const dimension of hygiene.unit_mismatches) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_unit_mismatch',
            `Catalog model "${model.id}" has pricing units that do not describe ${dimension} workloads.`,
            modelPath,
          ),
        );
      }
      if (hygiene.stale) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_stale',
            `Catalog pricing for "${model.id}" is ${hygiene.age_days} day(s) old; review provider pricing before cost routing.`,
            modelPath,
          ),
        );
      }
      if (hygiene.review_required || hygiene.placeholder) {
        issues.push(
          issue(
            'info',
            'catalog_pricing_review_required',
            `Catalog pricing for "${model.id}" needs operator review before production cost routing.`,
            modelPath,
          ),
        );
      }
      if (hygiene.source_missing) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_source_missing',
            `Catalog pricing for "${model.id}" is missing a price source label.`,
            modelPath,
          ),
        );
      }
      if (hygiene.source_url_missing) {
        issues.push(
          issue(
            'warning',
            'catalog_pricing_source_url_missing',
            `Catalog pricing for "${model.id}" is missing a reviewable source URL.`,
            modelPath,
          ),
        );
      }
    }
  }
  return issues;
}

function requiredPricingDimensions(modalities: readonly string[]): CatalogPricingDimension[] {
  const normalized = new Set(modalities.map((modality) => modality.toLowerCase()));
  const required = new Set<CatalogPricingDimension>();
  if (
    normalized.size === 0 ||
    normalized.has('text') ||
    normalized.has('vision') ||
    normalized.has('realtime')
  ) {
    required.add('input');
    required.add('output');
  }
  if (normalized.has('image')) required.add('image');
  if (normalized.has('audio')) required.add('audio');
  if (normalized.has('video')) required.add('video');
  if (normalized.has('rerank')) required.add('rerank');
  if (normalized.has('embedding')) required.add('embedding');
  return [...required];
}

function hasPricingDimension(
  pricing: CatalogPricing,
  dimension: CatalogPricingDimension,
): boolean {
  if (isFiniteNonNegativeNumber(getCatalogPricingValue(pricing, dimension))) return true;
  if (dimension === 'embedding' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'rerank' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'audio' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'image' && isFiniteNonNegativeNumber(pricing.input)) return true;
  if (dimension === 'video' && isFiniteNonNegativeNumber(pricing.input)) return true;
  return false;
}

function hasCompatibleUnit(
  pricing: CatalogPricing,
  dimension: CatalogPricingDimension,
): boolean {
  const unit = (pricing.units?.[dimension] || pricing.billing_unit || pricing.unit || '').toLowerCase();
  if (!unit) return false;
  if (
    dimension === 'input' ||
    dimension === 'output' ||
    dimension === 'embedding' ||
    dimension === 'input_per_1m_tokens' ||
    dimension === 'output_per_1m_tokens' ||
    dimension === 'embedding_per_1m_tokens'
  ) {
    return unit.includes('token') || unit.includes('embedding');
  }
  if (dimension === 'image' || dimension === 'image_per_generation' || dimension === 'image_per_edit') return unit.includes('image');
  if (dimension === 'audio' || dimension === 'audio_per_minute' || dimension === 'audio_per_1m_chars') return unit.includes('audio') || unit.includes('minute') || unit.includes('char') || unit.includes('second');
  if (dimension === 'video' || dimension === 'video_per_second' || dimension === 'video_per_generation') return unit.includes('video') || unit.includes('minute') || unit.includes('second') || unit.includes('generation');
  if (dimension === 'rerank' || dimension === 'rerank_per_1k_requests' || dimension === 'rerank_per_1k_docs') return unit.includes('rerank') || unit.includes('request') || unit.includes('doc');
  if (
    dimension === 'cache_read_input' ||
    dimension === 'cache_creation_input' ||
    dimension === 'cache_read_per_1m_tokens' ||
    dimension === 'cache_write_per_1m_tokens'
  ) {
    return unit.includes('token') || unit.includes('cache');
  }
  if (dimension === 'realtime_per_minute') return unit.includes('realtime') || unit.includes('minute');
  if (dimension === 'batch_discount') return unit.includes('discount') || unit.includes('percent') || unit.includes('batch');
  return true;
}

export function formatCatalogAsYaml(catalog: ProviderCatalog): string {
  return yaml.dump(catalog, {
    noRefs: true,
    lineWidth: 100,
    sortKeys: false,
  });
}

@Injectable()
export class CatalogService {
  constructor(private readonly config: ConfigService) {}

  load(): CatalogLoadResult {
    return loadMergedCatalog({
      cwd: process.cwd(),
      env: process.env,
      config: this.config.getFullConfig(),
    });
  }

  providers(): CatalogProvider[] {
    return this.load().catalog.providers;
  }

  canonicalRegistry(): CatalogCanonicalRegistry | undefined {
    return this.load().internal.canonical_registry;
  }

  models(filters: { provider?: string; modality?: string } = {}): CatalogModel[] {
    let models = flattenCatalogModels(this.load().catalog);
    if (filters.provider) {
      models = models.filter((model) => model.provider === filters.provider);
    }
    if (filters.modality) {
      models = models.filter((model) =>
        (model.modalities as string[]).includes(filters.modality as string),
      );
    }
    return models;
  }
}
