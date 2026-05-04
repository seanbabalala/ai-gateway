import type { AuthType, NodeProtocol } from '../config/gateway.config';

export type CatalogModality =
  | 'text'
  | 'vision'
  | 'image'
  | 'audio'
  | 'video'
  | 'embedding'
  | 'rerank'
  | 'realtime';

export type CatalogEndpoint =
  | 'chat_completions'
  | 'responses'
  | 'messages'
  | 'embeddings'
  | 'image_generations'
  | 'image_edits'
  | 'audio_transcriptions'
  | 'audio_speech'
  | 'video_generations'
  | 'video_status'
  | 'rerank'
  | 'realtime';

export type CatalogAuthType =
  | AuthType
  | 'api-key-header'
  | 'query-key'
  | 'none'
  | 'custom';

export type CatalogPricingSource =
  | 'provider_docs'
  | 'manual_placeholder'
  | 'community'
  | 'operator_required';

export interface CatalogPricing {
  input?: number | null;
  output?: number | null;
  unit:
    | '1m_tokens'
    | '1k_tokens'
    | '1k_requests'
    | 'request'
    | 'image'
    | 'minute'
    | 'second'
    | 'unknown';
  currency: 'USD' | 'unknown';
  source: CatalogPricingSource;
  source_url?: string;
  last_updated: string;
  manual_review_required: boolean;
  stale_after_days?: number;
  pricing_confidence?: 'high' | 'medium' | 'low' | 'unknown';
  notes?: string;
}

export interface CatalogLimits {
  max_context_tokens?: number;
  max_output_tokens?: number;
  max_file_size?: number;
  dimensions?: number[];
}

export interface CatalogModel {
  id: string;
  name?: string;
  provider_id: string;
  modalities: CatalogModality[];
  endpoints: CatalogEndpoint[];
  input_types: string[];
  output_types: string[];
  capabilities: string[];
  limits?: CatalogLimits;
  pricing: CatalogPricing;
  structured_output?: boolean;
  supports_streaming?: boolean;
  supports_realtime?: boolean;
  supports_rerank?: boolean;
  manual_review_required?: boolean;
  notes?: string;
}

export interface CatalogProvider {
  id: string;
  name: string;
  description?: string;
  base_url: string;
  base_url_matchers: string[];
  protocols: NodeProtocol[];
  default_protocol: NodeProtocol;
  endpoints: Partial<Record<CatalogEndpoint, string>>;
  auth_type: CatalogAuthType;
  key_placeholder?: string;
  modalities: CatalogModality[];
  capabilities: string[];
  limits?: CatalogLimits;
  pricing: {
    source: CatalogPricingSource;
    last_updated: string;
    manual_review_required: boolean;
  };
  model_prefixes?: string[];
  tags?: string[];
  allows_unknown_models?: boolean;
  manual_review_required?: boolean;
  models: CatalogModel[];
}

export interface CatalogModelFilters {
  provider?: string;
  modality?: CatalogModality | string;
  endpoint?: CatalogEndpoint | string;
}

export interface CatalogValidationIssue {
  severity: 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
}

export interface CatalogDiagnosticsContext {
  modelsPricing?: Record<string, unknown>;
}
