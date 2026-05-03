import { Injectable } from '@nestjs/common';
import type { NodeConfig } from '../config/gateway.config';
import {
  PROVIDER_CATALOG,
  PROVIDER_CATALOG_LAST_UPDATED,
  PROVIDER_CATALOG_VERSION,
} from './provider-catalog.data';
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
  { key: 'realtime_models', modality: 'realtime', endpoint: 'realtime', label: 'realtime' },
];

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
