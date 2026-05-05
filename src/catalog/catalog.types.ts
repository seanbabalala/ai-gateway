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

export interface CatalogModel {
  id: string;
  provider: string;
  display_name?: string;
  modalities: Modality[];
  endpoints: Partial<Record<CapabilityEndpoint | string, string>>;
  capabilities: string[];
  limits?: CatalogLimits;
  pricing?: CatalogPricing;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  source: CatalogSource;
  overridden: boolean;
  synced?: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  base_url: string;
  auth_type: AuthType | 'none';
  endpoints: Partial<Record<CapabilityEndpoint | string, string>>;
  model_prefixes?: string[];
  capabilities?: string[];
  pricing?: CatalogPricing;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
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
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
}

export interface CatalogOverrideProvider {
  id?: string;
  name?: string;
  base_url?: string;
  auth_type?: AuthType | 'none';
  endpoints?: Partial<Record<CapabilityEndpoint | string, string>>;
  model_prefixes?: string[];
  capabilities?: string[];
  pricing?: CatalogPricing;
  prompt_cache?: boolean;
  read_cache?: boolean;
  write_cache?: boolean;
  models?: CatalogOverrideModel[];
}

export interface CatalogOverrideFile {
  version?: 1;
  providers?: Record<string, CatalogOverrideProvider> | CatalogOverrideProvider[];
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
}

export interface CatalogLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  overridePath?: string;
  syncCachePath?: string;
  config?: unknown;
}
