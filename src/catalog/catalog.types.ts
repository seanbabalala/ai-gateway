import type { AuthType } from '../config/gateway.config';
import type { CapabilityEndpoint, Modality } from '../config/modality';

export type CatalogSource = 'builtin' | 'override';

export type CatalogPricingDimension =
  | 'input'
  | 'output'
  | 'image'
  | 'audio'
  | 'video'
  | 'rerank'
  | 'embedding';

export type CatalogPricingConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface CatalogPricing {
  input?: number;
  output?: number;
  image?: number;
  audio?: number;
  video?: number;
  rerank?: number;
  embedding?: number;
  /** Legacy default unit retained for existing overrides. Prefer units.* for modality-specific pricing. */
  unit?: string;
  units?: Partial<Record<CatalogPricingDimension, string>>;
  currency?: string;
  source: string;
  source_url?: string;
  last_updated: string;
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
  source: CatalogSource;
  overridden: boolean;
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
  models: CatalogModel[];
  source: CatalogSource;
  overridden: boolean;
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
  issues: CatalogIssue[];
}

export interface CatalogLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  overridePath?: string;
  config?: unknown;
}
