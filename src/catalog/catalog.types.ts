import type { AuthType } from '../config/gateway.config';
import type { CapabilityEndpoint, Modality } from '../config/modality';

export type CatalogSource = 'builtin' | 'sync_cache' | 'override';

export type CatalogPricingDimension =
  | 'input'
  | 'output'
  | 'image'
  | 'audio'
  | 'video'
  | 'rerank'
  | 'embedding'
  | 'cache_read_input'
  | 'cache_creation_input'
  | 'input_per_1m_tokens'
  | 'output_per_1m_tokens'
  | 'cache_read_per_1m_tokens'
  | 'cache_write_per_1m_tokens'
  | 'embedding_per_1m_tokens'
  | 'rerank_per_1k_requests'
  | 'rerank_per_1k_docs'
  | 'image_per_generation'
  | 'image_per_edit'
  | 'audio_per_minute'
  | 'audio_per_1m_chars'
  | 'video_per_second'
  | 'video_per_generation'
  | 'realtime_per_minute'
  | 'batch_discount';

export type CatalogPricingConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type CatalogPricingSourceType =
  | 'official_docs'
  | 'provider_api'
  | 'aggregator_api'
  | 'operator_override'
  | 'docs_review'
  | 'unknown';

export type CatalogPricingUsedFrom =
  | 'node_model_config'
  | 'gateway_config'
  | 'catalog_override'
  | 'catalog_sync_cache'
  | 'builtin_catalog'
  | 'missing';

export type ProviderCacheType = 'automatic' | 'explicit' | 'none';
export type CatalogProviderStatus =
  | 'active'
  | 'transport_only'
  | 'deprecated'
  | 'legacy_alias'
  | 'custom';

export interface CatalogProviderVisibilitySummary {
  active: number;
  transport_only: number;
  custom: number;
  deprecated_legacy: number;
  deprecated: number;
  legacy_alias: number;
  default_visible: number;
  hidden_by_default: number;
  total: number;
}

export interface CatalogCacheMetadata {
  supports_cache: boolean;
  cache_type: ProviderCacheType;
  cache_ttl_seconds: number;
  cache_min_tokens: number;
  cache_read_discount: number;
  notes?: string;
}

export interface CatalogPricing {
  /** Legacy token pricing retained for existing configs. Prefer input_per_1m_tokens/output_per_1m_tokens. */
  input?: number;
  output?: number;
  image?: number;
  audio?: number;
  video?: number;
  rerank?: number;
  embedding?: number;
  cache_read_input?: number;
  cache_creation_input?: number;
  billing_unit?: string;
  input_per_1m_tokens?: number;
  output_per_1m_tokens?: number;
  cache_read_per_1m_tokens?: number;
  cache_write_per_1m_tokens?: number;
  embedding_per_1m_tokens?: number;
  rerank_per_1k_requests?: number;
  rerank_per_1k_docs?: number;
  image_per_generation?: number;
  image_per_edit?: number;
  audio_per_minute?: number;
  audio_per_1m_chars?: number;
  video_per_second?: number;
  video_per_generation?: number;
  realtime_per_minute?: number;
  batch_discount?: number;
  /** Legacy default unit retained for existing overrides. Prefer units.* for modality-specific pricing. */
  unit?: string;
  units?: Partial<Record<CatalogPricingDimension, string>>;
  currency?: string;
  source_type?: CatalogPricingSourceType;
  source: string;
  source_url?: string;
  retrieved_at?: string;
  last_verified_at?: string;
  last_updated: string;
  /** Last time SiftGate synced this pricing from an automatic adapter. */
  last_sync?: string;
  manual_review_required: boolean;
  review_reason?: string;
  stale_after_days?: number;
  pricing_confidence?: CatalogPricingConfidence;
  notes?: string;
}

export interface CatalogPricingHygiene {
  status: 'fresh' | 'stale' | 'placeholder' | 'review_required' | 'missing' | 'invalid';
  currency: string | null;
  source_type?: CatalogPricingSourceType | null;
  source: string | null;
  source_url?: string | null;
  manual_review_required: boolean;
  review_reason?: string | null;
  pricing_confidence: CatalogPricingConfidence | null;
  last_updated: string | null;
  last_verified_at?: string | null;
  retrieved_at?: string | null;
  age_days: number | null;
  stale_after_days: number | null;
  stale: boolean;
  placeholder: boolean;
  review_required?: boolean;
  source_missing?: boolean;
  source_url_missing?: boolean;
  missing_price_dimensions: CatalogPricingDimension[];
  unit_mismatches: CatalogPricingDimension[];
  warnings: string[];
}

export interface CatalogLimits {
  max_context_tokens?: number;
  max_file_size?: number;
  dimensions?: number | number[];
}

export type CatalogModelMatchConfidence = 'high' | 'medium' | 'low';
export type CatalogModelMatchStrategy =
  | 'exact_source_model_id'
  | 'exact_canonical_slug'
  | 'explicit_alias'
  | 'strict_signature'
  | 'strict_signature_release_date'
  | 'ambiguous_candidate'
  | 'unmatched';

export interface CatalogModelLifecycle {
  release_date?: string;
  announcement_date?: string;
  knowledge_cutoff?: string;
}

export interface CatalogModelSpecs {
  params?: number;
  training_tokens?: number;
  throughput?: number;
  multimodal?: boolean;
  license?: string;
  is_moe?: boolean;
}

export interface CatalogModelEnrichment {
  source: string;
  source_url?: string;
  synced_at?: string;
  enriched_from?: string;
  enriched_at?: string;
  match_strategy?: CatalogModelMatchStrategy;
  match_confidence?: CatalogModelMatchConfidence;
  matched_from?: string[];
  match_notes?: string[];
  organization?: string;
  organization_id?: string;
  canonical_model_id?: string;
  release_date?: string;
  announcement_date?: string;
  multimodal?: boolean;
  throughput?: number;
  lifecycle?: CatalogModelLifecycle;
  specs?: CatalogModelSpecs;
  benchmarks?: Record<string, number>;
  secondary_pricing_reference?: CatalogPricing;
  metadata?: Record<string, unknown>;
}

export interface CatalogCanonicalArchitecture {
  modality?: string;
  tokenizer?: string;
  instruct_type?: string | null;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface CatalogCanonicalTopProvider {
  context_length?: number;
  max_completion_tokens?: number;
  is_moderated?: boolean;
}

export interface CatalogCanonicalSourceMetadata {
  source: string;
  source_url?: string;
  synced_at?: string;
  dataset_role?: 'canonical_primary' | 'enrichment_overlay' | 'provider_projection';
}

export interface CatalogCanonicalModel {
  canonical_id: string;
  source_model_id: string;
  source_provider_slug: string;
  display_name: string;
  aliases?: string[];
  canonical_slug?: string;
  description?: string;
  context_length?: number;
  architecture?: CatalogCanonicalArchitecture;
  input_modalities?: string[];
  output_modalities?: string[];
  supported_parameters?: string[];
  default_parameters?: Record<string, unknown>;
  pricing_reference?: CatalogPricing;
  enrichment?: CatalogModelEnrichment;
  top_provider?: CatalogCanonicalTopProvider;
  expiration_date?: string;
  created?: string;
  source_metadata: CatalogCanonicalSourceMetadata;
  metadata?: Record<string, unknown>;
}

export interface CatalogCanonicalOverlayDiagnostic {
  organization_id?: string;
  model_id: string;
  canonical_id?: string;
  match_strategy?: CatalogModelMatchStrategy;
  match_confidence?: CatalogModelMatchConfidence;
  reason: string;
  matched_from?: string[];
  match_notes?: string[];
}

export interface CatalogZeroEvalOverlayDiagnostics {
  source: string;
  source_url: string;
  synced_at: string;
  canonical_model_count: number;
  zeroeval_model_count: number;
  matched_model_count: number;
  projected_model_count: number;
  high_confidence_match_count: number;
  medium_confidence_match_count: number;
  low_confidence_match_count: number;
  unmatched_model_count: number;
  ambiguous_match_count: number;
  unmatched_models?: CatalogCanonicalOverlayDiagnostic[];
  low_confidence_matches?: CatalogCanonicalOverlayDiagnostic[];
  ambiguous_matches?: CatalogCanonicalOverlayDiagnostic[];
}

export interface CatalogCanonicalRegistry {
  version: 1;
  primary_source: string;
  source_url: string;
  generated_at: string;
  model_count: number;
  models: CatalogCanonicalModel[];
}

export interface CatalogInternalMaterialization {
  canonical_registry?: CatalogCanonicalRegistry;
  diagnostics?: {
    zeroeval_overlay?: CatalogZeroEvalOverlayDiagnostics;
  };
}

export interface CatalogModel {
  id: string;
  provider: string;
  display_name?: string;
  modalities: Modality[];
  endpoints: Partial<Record<CapabilityEndpoint | string, string>>;
  capabilities: string[];
  limits?: CatalogLimits;
  pricing?: CatalogPricing;
  enrichment?: CatalogModelEnrichment;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  cache_metadata?: CatalogCacheMetadata;
  source: CatalogSource;
  overridden: boolean;
  synced?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  aliases?: string[];
  status?: CatalogProviderStatus;
  replacement_provider_id?: string;
  status_reason?: string;
  family?: string;
  category?: string;
  provider_type?: 'direct' | 'aggregator' | 'cloud' | 'self_hosted' | 'media' | 'speech' | 'local';
  homepage_url?: string;
  docs_url?: string;
  pricing_url?: string;
  logo_id?: string;
  input_types?: string[];
  output_types?: string[];
  model_buckets?: {
    models?: string[];
    embedding_models?: string[];
    rerank_models?: string[];
    image_models?: string[];
    audio_models?: string[];
    video_models?: string[];
    realtime_models?: string[];
    batch_models?: string[];
  };
  compatibility_profile?: string | string[];
  base_url: string;
  auth_type: AuthType | 'none';
  endpoints: Partial<Record<CapabilityEndpoint | string, string>>;
  modalities?: Modality[];
  compatibility_profiles?: string[];
  model_prefixes?: string[];
  capabilities?: string[];
  pricing?: CatalogPricing;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  cache_metadata?: CatalogCacheMetadata;
  models: CatalogModel[];
  source: CatalogSource;
  overridden: boolean;
  synced?: boolean;
}

export interface ProviderCatalog {
  version: 1;
  generated_at: string;
  providers: CatalogProvider[];
  override_file?: string | null;
}

export interface CatalogOverrideModel {
  id: string;
  display_name?: string;
  modalities?: Modality[];
  endpoints?: Partial<Record<CapabilityEndpoint | string, string>>;
  capabilities?: string[];
  limits?: CatalogLimits;
  pricing?: CatalogPricing;
  enrichment?: CatalogModelEnrichment;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  cache_metadata?: CatalogCacheMetadata;
}

export interface CatalogOverrideProvider {
  id?: string;
  name?: string;
  aliases?: string[];
  status?: CatalogProviderStatus;
  replacement_provider_id?: string;
  status_reason?: string;
  family?: string;
  category?: string;
  provider_type?: CatalogProvider['provider_type'];
  homepage_url?: string;
  docs_url?: string;
  pricing_url?: string;
  logo_id?: string;
  input_types?: string[];
  output_types?: string[];
  model_buckets?: CatalogProvider['model_buckets'];
  compatibility_profile?: CatalogProvider['compatibility_profile'];
  modalities?: Modality[];
  base_url?: string;
  auth_type?: AuthType | 'none';
  endpoints?: Partial<Record<CapabilityEndpoint | string, string>>;
  compatibility_profiles?: string[];
  model_prefixes?: string[];
  capabilities?: string[];
  pricing?: CatalogPricing;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  cache_metadata?: CatalogCacheMetadata;
  models?: CatalogOverrideModel[];
}

export interface CatalogOverrideFile {
  version?: 1;
  providers?: Record<string, CatalogOverrideProvider> | CatalogOverrideProvider[];
  _siftgate_internal?: CatalogInternalMaterialization;
}

export interface CatalogIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface CatalogLoadResult {
  catalog: ProviderCatalog;
  overridePath: string;
  overrideFound: boolean;
  syncCachePath: string;
  syncCacheFound: boolean;
  issues: CatalogIssue[];
  internal: CatalogInternalMaterialization;
}

export interface CatalogLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  overridePath?: string;
  syncCachePath?: string;
  config?: unknown;
}
