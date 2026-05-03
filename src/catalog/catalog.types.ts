import type { AuthType } from '../config/gateway.config';
import type { CapabilityEndpoint, Modality } from '../config/modality';

export type CatalogSource = 'builtin' | 'override';

export interface CatalogPricing {
  input?: number;
  output?: number;
  unit?: string;
  source: string;
  last_updated: string;
  manual_review_required: boolean;
  notes?: string;
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
