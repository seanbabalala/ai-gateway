import type {
  CapabilityEndpoint,
  CapabilityIOType,
  Modality,
} from './modality';
import type { ModelCapabilityConfig, ModelPricing, NodeConfig } from './gateway.config';

export type ModelCatalogSource = 'builtin' | 'remote';
export type ModelCatalogPurpose =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'audio'
  | 'realtime';

export interface ModelCatalogEntry {
  provider: string;
  model: string;
  aliases?: string[];
  modalities: Modality[];
  endpoints: CapabilityEndpoint[];
  input_types?: CapabilityIOType[];
  output_types?: CapabilityIOType[];
  max_context_tokens?: number;
  max_file_size?: number;
  structured_output?: boolean;
  supports_streaming?: boolean;
  supports_realtime?: boolean;
  supports_rerank?: boolean;
  dimensions?: number | number[];
  pricing?: ModelPricing;
  quality_hint?: number;
  last_updated_at: string;
  source?: ModelCatalogSource;
}

export interface ModelCatalogDocument {
  version?: string;
  updated_at?: string;
  models: ModelCatalogEntry[];
}

export interface ModelCatalogLookupOptions {
  provider?: string | null;
}

const BUILTIN_UPDATED_AT = '2026-05-03';

export const BUILT_IN_MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    provider: 'openai',
    model: 'gpt-4o',
    modalities: ['text', 'vision'],
    endpoints: ['chat_completions', 'responses'],
    input_types: ['text', 'image'],
    output_types: ['text', 'json'],
    max_context_tokens: 128000,
    structured_output: true,
    supports_streaming: true,
    pricing: { input: 2.5, output: 10 },
    quality_hint: 0.86,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    modalities: ['text', 'vision'],
    endpoints: ['chat_completions', 'responses'],
    input_types: ['text', 'image'],
    output_types: ['text', 'json'],
    max_context_tokens: 128000,
    structured_output: true,
    supports_streaming: true,
    pricing: { input: 0.15, output: 0.6 },
    quality_hint: 0.68,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'gpt-image-1',
    modalities: ['image'],
    endpoints: ['image'],
    input_types: ['text', 'image'],
    output_types: ['image'],
    structured_output: false,
    supports_streaming: false,
    pricing: { input: 5, output: 0 },
    quality_hint: 0.74,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    modalities: ['text', 'embedding'],
    endpoints: ['embeddings'],
    input_types: ['text'],
    output_types: ['embedding'],
    dimensions: [512, 1536],
    pricing: { input: 0.02, output: 0 },
    quality_hint: 0.55,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'text-embedding-3-large',
    modalities: ['text', 'embedding'],
    endpoints: ['embeddings'],
    input_types: ['text'],
    output_types: ['embedding'],
    dimensions: [256, 1024, 3072],
    pricing: { input: 0.13, output: 0 },
    quality_hint: 0.78,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini-transcribe',
    modalities: ['audio', 'text'],
    endpoints: ['audio'],
    input_types: ['audio', 'file'],
    output_types: ['text'],
    structured_output: false,
    pricing: { input: 0.6, output: 0 },
    quality_hint: 0.62,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'tts-1',
    modalities: ['audio'],
    endpoints: ['audio'],
    input_types: ['text'],
    output_types: ['audio'],
    structured_output: false,
    pricing: { input: 15, output: 0 },
    quality_hint: 0.56,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'openai',
    model: 'gpt-4o-realtime-preview',
    modalities: ['text', 'audio', 'realtime'],
    endpoints: ['realtime'],
    input_types: ['text', 'audio', 'events'],
    output_types: ['text', 'audio', 'events'],
    max_context_tokens: 128000,
    supports_realtime: true,
    structured_output: false,
    pricing: { input: 5, output: 20 },
    quality_hint: 0.76,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    modalities: ['text', 'vision'],
    endpoints: ['messages'],
    input_types: ['text', 'image'],
    output_types: ['text', 'json'],
    max_context_tokens: 200000,
    structured_output: true,
    supports_streaming: true,
    pricing: { input: 3, output: 15 },
    quality_hint: 0.9,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4-6-v1',
    aliases: ['claude-opus-4'],
    modalities: ['text', 'vision'],
    endpoints: ['messages'],
    input_types: ['text', 'image'],
    output_types: ['text', 'json'],
    max_context_tokens: 200000,
    structured_output: true,
    supports_streaming: true,
    pricing: { input: 15, output: 75 },
    quality_hint: 0.95,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'google',
    model: 'gemini-2.5-pro',
    modalities: ['text', 'vision'],
    endpoints: ['chat_completions'],
    input_types: ['text', 'image'],
    output_types: ['text', 'json'],
    max_context_tokens: 1000000,
    structured_output: true,
    supports_streaming: true,
    pricing: { input: 1.25, output: 10 },
    quality_hint: 0.88,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
  {
    provider: 'cohere',
    model: 'rerank-english-v3',
    modalities: ['rerank'],
    endpoints: ['rerank'],
    input_types: ['text', 'documents'],
    output_types: ['ranked_documents'],
    supports_rerank: true,
    pricing: { input: 0.8, output: 0 },
    quality_hint: 0.7,
    last_updated_at: BUILTIN_UPDATED_AT,
    source: 'builtin',
  },
];

export function normalizeCatalogEntry(
  entry: ModelCatalogEntry,
  source: ModelCatalogSource,
): ModelCatalogEntry {
  return {
    ...entry,
    provider: entry.provider.trim().toLowerCase(),
    model: entry.model.trim(),
    modalities: Array.from(new Set(entry.modalities || ['text'])),
    endpoints: Array.from(new Set(entry.endpoints || [])),
    source,
  };
}

export function catalogKey(provider: string, model: string): string {
  return `${provider.toLowerCase()}:${model}`;
}

export function inferProviderFromNode(node?: Partial<NodeConfig> | null): string | null {
  if (!node) return null;
  const haystack = [
    node.id,
    node.name,
    node.base_url,
    node.protocol,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic';
  if (haystack.includes('openai') || haystack.includes('azure')) return 'openai';
  if (haystack.includes('gemini') || haystack.includes('google')) return 'google';
  if (haystack.includes('cohere')) return 'cohere';
  if (haystack.includes('mistral')) return 'mistral';
  if (haystack.includes('deepseek')) return 'deepseek';
  if (haystack.includes('x.ai') || haystack.includes('grok')) return 'xai';
  return null;
}

export function lookupBuiltInCatalogEntry(
  model: string,
  options: ModelCatalogLookupOptions = {},
): ModelCatalogEntry | undefined {
  const provider = options.provider?.toLowerCase() || null;
  const matches = BUILT_IN_MODEL_CATALOG.filter((entry) =>
    entry.model === model || entry.aliases?.includes(model),
  );
  if (provider) {
    return matches.find((entry) => entry.provider === provider) || matches[0];
  }
  return matches[0];
}

export function configuredModelIds(node: Partial<NodeConfig>): string[] {
  return Array.from(new Set([
    ...(Array.isArray(node.models) ? node.models : []),
    ...(Array.isArray(node.embedding_models) ? node.embedding_models : []),
    ...(Array.isArray(node.rerank_models) ? node.rerank_models : []),
    ...(Array.isArray(node.image_models) ? node.image_models : []),
    ...(Array.isArray(node.audio_models) ? node.audio_models : []),
    ...(Array.isArray(node.realtime_models) ? node.realtime_models : []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

export function configuredModelPurposes(
  node: Partial<NodeConfig>,
  model: string,
): ModelCatalogPurpose[] {
  const purposes = new Set<ModelCatalogPurpose>();
  if (node.models?.includes(model)) purposes.add('chat');
  if (node.embedding_models?.includes(model)) purposes.add('embedding');
  if (node.rerank_models?.includes(model)) purposes.add('rerank');
  if (node.image_models?.includes(model)) purposes.add('image');
  if (node.audio_models?.includes(model)) purposes.add('audio');
  if (node.realtime_models?.includes(model)) purposes.add('realtime');
  return Array.from(purposes);
}

export function catalogEntrySupportsPurpose(
  entry: ModelCatalogEntry,
  purpose: ModelCatalogPurpose,
): boolean {
  switch (purpose) {
    case 'chat':
      return entry.endpoints.some((endpoint) =>
        ['chat_completions', 'responses', 'messages'].includes(endpoint),
      );
    case 'embedding':
      return entry.endpoints.includes('embeddings') || entry.modalities.includes('embedding');
    case 'rerank':
      return entry.endpoints.includes('rerank') || entry.modalities.includes('rerank') || entry.supports_rerank === true;
    case 'image':
      return entry.endpoints.includes('image') || entry.modalities.includes('image');
    case 'audio':
      return entry.endpoints.includes('audio') || entry.modalities.includes('audio');
    case 'realtime':
      return entry.endpoints.includes('realtime') || entry.modalities.includes('realtime') || entry.supports_realtime === true;
  }
}

export function hasUserModelCapability(
  node: Partial<NodeConfig>,
  model: string,
): boolean {
  return Boolean(node.model_capabilities?.[model]);
}

export function userModelCapability(
  node: Partial<NodeConfig>,
  model: string,
): ModelCapabilityConfig | undefined {
  return node.model_capabilities?.[model];
}

export function isPricingStale(
  lastUpdatedAt: string | undefined,
  maxAgeDays: number,
  now = new Date(),
): boolean {
  if (!lastUpdatedAt || maxAgeDays <= 0) return false;
  const timestamp = Date.parse(lastUpdatedAt);
  if (Number.isNaN(timestamp)) return true;
  const ageMs = now.getTime() - timestamp;
  return ageMs > maxAgeDays * 86_400_000;
}
