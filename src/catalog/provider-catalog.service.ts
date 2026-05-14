import { Injectable } from '@nestjs/common';
import type { NodeConfig, NodeProtocol } from '../config/gateway.config';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';
import type {
  CatalogModel as MergedCatalogModel,
  CatalogPricing as MergedCatalogPricing,
  CatalogProvider as MergedCatalogProvider,
} from './catalog.types';
import type {
  CatalogDiagnosticsContext,
  CatalogEndpoint,
  CatalogModel,
  CatalogModelFilters,
  CatalogModality,
  CatalogProvider,
  CatalogValidationIssue,
} from './provider-catalog.types';

type NodeLike = Partial<NodeConfig> & Record<string, unknown>;

const PROVIDER_CATALOG_VERSION = '2026-05-05.static.v3';
const PROVIDER_CATALOG_LAST_UPDATED = '2026-05-05';

const MODEL_FIELDS: Array<{
  key: keyof NodeConfig;
  modality: CatalogModality;
  endpoint: CatalogEndpoint;
  label: string;
}> = [
  { key: 'models', modality: 'text', endpoint: 'chat_completions', label: 'chat/text' },
  { key: 'embedding_models', modality: 'embedding', endpoint: 'embeddings', label: 'embedding' },
  { key: 'rerank_models', modality: 'rerank', endpoint: 'rerank', label: 'rerank' },
  { key: 'image_models', modality: 'image', endpoint: 'image_generations', label: 'image' },
  { key: 'audio_models', modality: 'audio', endpoint: 'audio_transcriptions', label: 'audio' },
  { key: 'video_models', modality: 'video', endpoint: 'video_generations', label: 'video' },
  { key: 'realtime_models', modality: 'realtime', endpoint: 'realtime', label: 'realtime' },
];

const PROVIDER_CATALOG: CatalogProvider[] = BUILTIN_PROVIDER_CATALOG.map(projectProvider);

@Injectable()
export class ProviderCatalogService {
  listProviders(): CatalogProvider[] {
    return clone(PROVIDER_CATALOG);
  }

  listModels(filters: CatalogModelFilters = {}): CatalogModel[] {
    return clone(listCatalogModels(filters));
  }

  getProvider(id: string): CatalogProvider | undefined {
    const provider = PROVIDER_CATALOG.find((entry) => entry.id === id);
    return provider ? clone(provider) : undefined;
  }

  getMetadata() {
    return {
      version: PROVIDER_CATALOG_VERSION,
      source: 'builtin_static',
      last_updated: PROVIDER_CATALOG_LAST_UPDATED,
      auto_update: false,
    };
  }

  detectProviderForNode(node: NodeLike): CatalogProvider | undefined {
    return detectCatalogProviderForNode(node);
  }

  diagnoseNode(
    node: NodeLike,
    basePath: string,
    context: CatalogDiagnosticsContext = {},
  ): CatalogValidationIssue[] {
    return diagnoseNodeAgainstCatalog(node, basePath, context);
  }
}

export function listCatalogModels(filters: CatalogModelFilters = {}): CatalogModel[] {
  const providerFilter = normalizeFilter(filters.provider);
  const modalityFilter = normalizeFilter(filters.modality);
  const endpointFilter = normalizeFilter(filters.endpoint);

  return PROVIDER_CATALOG.flatMap((provider) => provider.models).filter((model) => {
    if (providerFilter && model.provider_id !== providerFilter) return false;
    if (
      modalityFilter &&
      !model.modalities.some((modality) => modality === modalityFilter)
    ) {
      return false;
    }
    if (
      endpointFilter &&
      !model.endpoints.some((endpoint) => endpoint === endpointFilter)
    ) {
      return false;
    }
    return true;
  });
}

export function detectCatalogProviderForNode(
  node: NodeLike,
): CatalogProvider | undefined {
  const nodeId = typeof node.id === 'string' ? node.id.toLowerCase() : '';
  const nodeName = typeof node.name === 'string' ? node.name.toLowerCase() : '';
  const host = getHostWithPort(node.base_url);

  const hostMatch = PROVIDER_CATALOG.find((provider) =>
    provider.base_url_matchers.some((matcher) => hostMatches(host, matcher)),
  );
  if (hostMatch) return hostMatch;

  return PROVIDER_CATALOG.find((provider) => {
    if (provider.id === 'openai-compatible') return false;
    return nodeId === provider.id || nodeName.includes(provider.id);
  });
}

export function diagnoseNodeAgainstCatalog(
  node: NodeLike,
  basePath: string,
  context: CatalogDiagnosticsContext = {},
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const provider = detectCatalogProviderForNode(node);
  if (!provider) {
    issues.push({
      severity: 'info',
      code: 'catalog_provider_unrecognized',
      message:
        'Provider catalog could not match this node. SiftGate will treat it as custom/OpenAI-compatible and skip known-model warnings.',
      path: `${basePath}.base_url`,
    });
    return issues;
  }

  const modelIndex = new Map(provider.models.map((model) => [model.id, model]));
  const hasLocalPricing = (model: string): boolean =>
    hasModelPricingOverride(node, model) || Boolean(context.modelsPricing?.[model]);

  for (const field of MODEL_FIELDS) {
    const expectedEndpoint = field.key === 'models'
      ? protocolToCatalogEndpoint(node.protocol)
      : field.endpoint;
    const configuredModels = Array.isArray(node[field.key])
      ? (node[field.key] as unknown[]).filter(isNonEmptyString)
      : [];
    if (configuredModels.length === 0) continue;

    if (
      !provider.modalities.includes(field.modality) ||
      !provider.endpoints[expectedEndpoint]
    ) {
      issues.push({
        severity: 'warning',
        code: 'catalog_endpoint_modality_mismatch',
        message: `Provider catalog does not list ${provider.name} support for ${field.label} models on endpoint ${expectedEndpoint}. Verify this node before production traffic.`,
        path: `${basePath}.${field.key}`,
      });
    }

    for (const [index, modelId] of configuredModels.entries()) {
      const modelPath = `${basePath}.${field.key}[${index}]`;
      const model = modelIndex.get(modelId);
      if (!model) {
        if (!provider.allows_unknown_models) {
          issues.push({
            severity: 'warning',
            code: 'catalog_unknown_model',
            message: `Model "${modelId}" is not in the built-in ${provider.name} catalog. It may still work, but pricing and capability metadata should be reviewed.`,
            path: modelPath,
          });
        }
        continue;
      }

      if (
        !model.modalities.includes(field.modality) &&
        !(field.modality === 'image' && model.modalities.includes('vision'))
      ) {
        issues.push({
          severity: 'warning',
          code: 'catalog_model_modality_mismatch',
          message: `Model "${modelId}" is cataloged for ${model.modalities.join(', ')}, but it is listed under ${String(field.key)}.`,
          path: modelPath,
        });
      }

      if (!model.endpoints.includes(expectedEndpoint)) {
        issues.push({
          severity: 'warning',
          code: 'catalog_endpoint_modality_mismatch',
          message: `Model "${modelId}" is not cataloged for endpoint ${expectedEndpoint}. Verify the endpoint/model pairing.`,
          path: modelPath,
        });
      }

      if (model.pricing.manual_review_required && !hasLocalPricing(modelId)) {
        issues.push({
          severity: 'warning',
          code: 'catalog_pricing_manual_review',
          message: `Catalog pricing for "${modelId}" is marked manual_review_required. Add models_pricing or model_capabilities pricing for accurate cost routing.`,
          path: modelPath,
        });
      }
    }
  }

  return issues;
}

function hasModelPricingOverride(node: NodeLike, model: string): boolean {
  const capabilities = node.model_capabilities;
  if (!isRecord(capabilities)) return false;
  const entry = capabilities[model];
  return isRecord(entry) && isRecord(entry.pricing);
}

function protocolToCatalogEndpoint(protocol: unknown): CatalogEndpoint {
  if (
    protocol === 'responses' ||
    protocol === 'messages' ||
    protocol === 'chat_completions'
  ) {
    return protocol;
  }
  return 'chat_completions';
}

function projectProvider(provider: MergedCatalogProvider): CatalogProvider {
  const endpoints = projectEndpointMap(provider.endpoints);
  const protocols = protocolListFromEndpoints(endpoints);
  const models = provider.models.map((model) => projectModel(model, provider));
  const modalities = Array.from(
    new Set(
      (provider.modalities && provider.modalities.length > 0
        ? provider.modalities
        : models.flatMap((model) => model.modalities)) as CatalogModality[],
    ),
  );
  const pricing = projectPricing(provider.pricing || provider.models.find((model) => model.pricing)?.pricing);

  return {
    id: provider.id,
    name: provider.name,
    description: `${provider.name} catalog provider`,
    aliases: provider.aliases,
    family: provider.family,
    category: provider.category,
    provider_type: provider.provider_type,
    homepage_url: provider.homepage_url,
    docs_url: provider.docs_url,
    pricing_url: provider.pricing_url,
    logo_id: provider.logo_id,
    input_types: provider.input_types,
    output_types: provider.output_types,
    model_buckets: provider.model_buckets,
    compatibility_profile: provider.compatibility_profile,
    base_url: provider.base_url,
    base_url_matchers: baseUrlMatchers(provider.base_url),
    protocols,
    default_protocol: protocols[0] || 'chat_completions',
    endpoints,
    auth_type: projectAuthType(provider.auth_type),
    modalities,
    capabilities: provider.capabilities || [],
    limits: projectLimits(provider.models.find((model) => model.limits)?.limits),
    pricing,
    model_prefixes: provider.model_prefixes,
    tags: [
      provider.source,
      provider.provider_type || '',
      provider.family || '',
      ...(provider.overridden ? ['override'] : []),
    ].filter(Boolean),
    allows_unknown_models:
      provider.id === 'openai-compatible' ||
      provider.provider_type === 'local' ||
      provider.provider_type === 'self_hosted' ||
      provider.capabilities?.some((capability) =>
        ['local', 'self_hosted', 'model_marketplace', 'multi_provider'].includes(capability),
      ),
    manual_review_required: pricing.manual_review_required,
    models,
  };
}

function projectModel(
  model: MergedCatalogModel,
  provider: MergedCatalogProvider,
): CatalogModel {
  const endpoints = projectEndpointList(model.endpoints);
  const pricing = projectPricing(model.pricing || provider.pricing);
  return {
    id: model.id,
    name: model.display_name || model.id,
    provider_id: provider.id,
    modalities: model.modalities as CatalogModality[],
    endpoints,
    input_types: provider.input_types || inferInputTypes(model.modalities),
    output_types: provider.output_types || inferOutputTypes(model.modalities),
    capabilities: model.capabilities || [],
    limits: projectLimits(model.limits),
    pricing,
    structured_output: model.capabilities.includes('structured_output'),
    supports_streaming: model.capabilities.includes('streaming'),
    supports_realtime: model.modalities.includes('realtime'),
    supports_rerank: model.modalities.includes('rerank'),
    manual_review_required: pricing.manual_review_required,
  };
}

function projectEndpointMap(
  endpoints: Partial<Record<string, string>>,
): Partial<Record<CatalogEndpoint, string>> {
  const output: Partial<Record<CatalogEndpoint, string>> = {};
  for (const [endpoint, path] of Object.entries(endpoints || {})) {
    for (const alias of endpointAliases(endpoint)) {
      output[alias] = path;
    }
  }
  return output;
}

function projectEndpointList(endpoints: Partial<Record<string, string>>): CatalogEndpoint[] {
  return Array.from(new Set(Object.keys(projectEndpointMap(endpoints)) as CatalogEndpoint[]));
}

function endpointAliases(endpoint: string): CatalogEndpoint[] {
  switch (endpoint) {
    case 'image':
      return ['image_generations'];
    case 'image_edit':
      return ['image_edits'];
    case 'audio':
      return ['audio_transcriptions'];
    case 'audio_translation':
      return [];
    case 'video':
      return ['video_generations'];
    default:
      return isLegacyEndpoint(endpoint) ? [endpoint] : [];
  }
}

function isLegacyEndpoint(endpoint: string): endpoint is CatalogEndpoint {
  return [
    'chat_completions',
    'responses',
    'messages',
    'gemini',
    'embeddings',
    'image_generations',
    'image_edits',
    'audio_transcriptions',
    'audio_speech',
    'video_generations',
    'video_status',
    'rerank',
    'realtime',
    'batch',
  ].includes(endpoint);
}

function protocolListFromEndpoints(
  endpoints: Partial<Record<CatalogEndpoint, string>>,
): NodeProtocol[] {
  return (['chat_completions', 'responses', 'messages', 'gemini'] as NodeProtocol[]).filter(
    (protocol) => Boolean(endpoints[protocol]),
  );
}

function projectAuthType(authType: MergedCatalogProvider['auth_type']): CatalogProvider['auth_type'] {
  if (authType === 'none') return 'none';
  if (authType === 'x-api-key') return 'x-api-key';
  if (authType === 'bearer') return 'bearer';
  return 'custom';
}

function projectPricing(pricing: MergedCatalogPricing | undefined): CatalogModel['pricing'] {
  return {
    input: pricing?.input ?? pricing?.embedding ?? pricing?.rerank ?? pricing?.image ?? pricing?.audio ?? null,
    output: pricing?.output ?? null,
    unit: legacyPricingUnit(pricing),
    currency: pricing?.currency === 'USD' ? 'USD' : 'unknown',
    source: legacyPricingSource(pricing?.source),
    source_url: pricing?.source_url,
    last_updated: pricing?.last_updated || PROVIDER_CATALOG_LAST_UPDATED,
    manual_review_required: pricing?.manual_review_required ?? true,
    stale_after_days: pricing?.stale_after_days,
    pricing_confidence: pricing?.pricing_confidence,
    notes: pricing?.notes,
  };
}

function projectLimits(limits: MergedCatalogModel['limits']): CatalogModel['limits'] {
  if (!limits) return undefined;
  return {
    max_context_tokens: limits.max_context_tokens,
    max_file_size: limits.max_file_size,
    dimensions: Array.isArray(limits.dimensions)
      ? [...limits.dimensions]
      : limits.dimensions === undefined
        ? undefined
        : [limits.dimensions],
  };
}

function legacyPricingSource(source: string | undefined): CatalogModel['pricing']['source'] {
  if (!source) return 'operator_required';
  if (source.includes('override') || source.includes('operator')) return 'operator_required';
  if (source.includes('provider') || source.includes('builtin') || source.includes('openrouter')) {
    return 'provider_docs';
  }
  return 'community';
}

function legacyPricingUnit(pricing: MergedCatalogPricing | undefined): CatalogModel['pricing']['unit'] {
  if (!pricing) return 'unknown';
  if (pricing.units?.image || pricing.image !== undefined) return 'image';
  if (pricing.units?.audio || pricing.audio !== undefined) return 'minute';
  if (pricing.units?.rerank || pricing.rerank !== undefined) return '1k_requests';
  if (pricing.unit?.includes('1k')) return '1k_tokens';
  if (pricing.unit?.includes('request')) return 'request';
  if (pricing.unit?.includes('review') || pricing.unit === 'unknown') return 'unknown';
  return '1m_tokens';
}

function baseUrlMatchers(baseUrl: string): string[] {
  try {
    const placeholderSafe = baseUrl.replace(/\{[^}]+\}/g, 'example');
    const hostname = new URL(placeholderSafe).hostname.toLowerCase();
    const broadHostname = hostname
      .replace(/(^|\.)example\./g, '$1')
      .replace(/-example/g, '')
      .replace(/^\.+/, '');
    return Array.from(new Set([hostname, broadHostname].filter(Boolean)));
  } catch {
    return [baseUrl.toLowerCase()];
  }
}

function inferInputTypes(modalities: readonly string[]): string[] {
  const values = new Set<string>();
  for (const modality of modalities) {
    if (['text', 'vision', 'embedding', 'rerank'].includes(modality)) values.add('text');
    if (modality === 'vision' || modality === 'image') values.add('image');
    if (modality === 'audio') values.add('audio');
    if (modality === 'video') values.add('video');
    if (modality === 'batch') values.add('file');
    if (modality === 'realtime') values.add('events');
  }
  return [...values];
}

function inferOutputTypes(modalities: readonly string[]): string[] {
  const values = new Set<string>();
  for (const modality of modalities) {
    if (['text', 'vision'].includes(modality)) values.add('text');
    if (modality === 'embedding') values.add('embedding');
    if (modality === 'rerank') values.add('ranked_documents');
    if (modality === 'image') values.add('image');
    if (modality === 'audio') values.add('audio');
    if (modality === 'video') values.add('video');
    if (modality === 'batch') values.add('file');
    if (modality === 'realtime') values.add('events');
  }
  return [...values];
}

function getHostWithPort(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) return '';
  try {
    const parsed = new URL(baseUrl);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return baseUrl.toLowerCase();
  }
}

function hostMatches(host: string, matcher: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedMatcher = matcher.toLowerCase();
  return (
    normalizedHost === normalizedMatcher ||
    normalizedHost.endsWith(`.${normalizedMatcher}`) ||
    normalizedHost.includes(normalizedMatcher)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
