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
  | 'cache_creation_input';

export type CatalogPricingConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface CatalogPricing {
  input?: number;
  output?: number;
  image?: number;
  audio?: number;
  video?: number;
  rerank?: number;
  embedding?: number;
  cache_read_input?: number;
  cache_creation_input?: number;
  /** Legacy default unit retained for existing overrides. Prefer units.* for modality-specific pricing. */
  unit?: string;
  units?: Partial<Record<CatalogPricingDimension, string>>;
  currency?: string;
  source: string;
  source_url?: string;
  last_updated: string;
  /** Last time SiftGate synced this pricing from an automatic adapter. */
  last_sync?: string;
  retrieved_at?: string;
  manual_review_required: boolean;
  stale_after_days?: number;
  pricing_confidence?: CatalogPricingConfidence;
  notes?: string;
}

export interface CatalogPricingHygiene {
  status: 'fresh' | 'stale' | 'placeholder' | 'missing' | 'invalid';
  currency: string | null;
  source: string | null;
  manual_review_required: boolean;
  pricing_confidence: CatalogPricingConfidence | null;
  last_updated: string | null;
  age_days: number | null;
  stale_after_days: number | null;
  stale: boolean;
  placeholder: boolean;
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
  compatibility_profiles?: string[];
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
  compatibility_profiles?: string[];
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
