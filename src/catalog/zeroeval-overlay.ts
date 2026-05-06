import type { Modality } from '../config/modality';
import { BUILTIN_PROVIDER_CATALOG } from './built-in-catalog';
import { canonicalPricingHasAnyValue } from './canonical-registry';
import type {
  CatalogCanonicalModel,
  CatalogCanonicalOverlayDiagnostic,
  CatalogCanonicalRegistry,
  CatalogModelEnrichment,
  CatalogModelMatchConfidence,
  CatalogModelMatchStrategy,
  CatalogOverrideModel,
  CatalogOverrideProvider,
  CatalogPricing,
  CatalogZeroEvalOverlayDiagnostics,
} from './catalog.types';

const ZEROEVAL_SOURCE = 'zeroeval';
const BUILTIN_PROVIDER_BY_ID = new Map(
  BUILTIN_PROVIDER_CATALOG.map((provider) => [provider.id, provider]),
);
const BUILTIN_MODEL_IDS_BY_PROVIDER = new Map(
  BUILTIN_PROVIDER_CATALOG.map((provider) => [
    provider.id,
    new Set(provider.models.map((model) => model.id)),
  ]),
);

const CANONICAL_PROVIDER_ALIASES: Record<string, string[]> = {
  openai: ['openai'],
  anthropic: ['anthropic'],
  google: ['google', 'gemini'],
  mistral: ['mistral'],
  cohere: ['cohere'],
  deepseek: ['deepseek'],
  qwen: ['qwen'],
  moonshot: ['moonshot', 'kimi'],
  minimax: ['minimax'],
  zhipu: ['zhipu', 'glm'],
  baidu: ['baidu', 'qianfan'],
  qianfan: ['baidu', 'qianfan'],
  volcengine: ['volcengine', 'doubao'],
  doubao: ['doubao', 'volcengine'],
  xai: ['xai'],
  perplexity: ['perplexity'],
  cerebras: ['cerebras'],
  sambanova: ['sambanova'],
  groq: ['groq'],
  ai21: ['ai21'],
  bytedance: ['bytedance', 'seed'],
};

const TRANSPORT_PROVIDER_ID_BY_CANONICAL: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  mistral: 'mistral',
  cohere: 'cohere',
  deepseek: 'deepseek',
  qwen: 'alibaba-qwen',
  moonshot: 'moonshot',
  kimi: 'moonshot',
  minimax: 'minimax',
  zhipu: 'zhipu',
  baidu: 'baidu-qianfan',
  qianfan: 'baidu-qianfan',
  volcengine: 'volcengine-ark',
  doubao: 'volcengine-ark',
  xai: 'xai',
  perplexity: 'perplexity',
  cerebras: 'cerebras',
  sambanova: 'sambanova',
  groq: 'groq',
  ai21: 'ai21',
};

interface ExplicitAliasRule {
  candidate_ids: string[];
  projection_model_id?: string;
  notes?: string[];
}

const EXPLICIT_ALIAS_RULES: Record<string, ExplicitAliasRule> = {
  'openai/chatgpt-4o-latest': {
    candidate_ids: ['gpt-4o', 'gpt-4o-2024-05-13'],
    projection_model_id: 'gpt-4o',
    notes: [
      'Applied OpenAI alias normalization from chatgpt-4o-latest to the GPT-4o family.',
    ],
  },
  'openai/gpt-5.3-chat-latest': {
    candidate_ids: ['gpt-chat-latest'],
    projection_model_id: 'gpt-5.3-chat-latest',
    notes: [
      'Mapped GPT chat latest family alias onto the OpenRouter canonical GPT chat route.',
    ],
  },
};

export interface ZeroEvalModel {
  model_id?: string;
  name?: string;
  organization?: string;
  organization_id?: string;
  context?: number | null;
  release_date?: string | null;
  announcement_date?: string | null;
  multimodal?: boolean | null;
  input_price?: number | null;
  output_price?: number | null;
  throughput?: number | null;
  canonical_model_id?: string | null;
  params?: number | null;
  training_tokens?: number | null;
  license?: string | null;
  knowledge_cutoff?: string | null;
  is_moe?: boolean | null;
  [key: string]: unknown;
}

export interface ZeroEvalOverlayResult {
  canonical_registry: CatalogCanonicalRegistry;
  providers: Record<string, CatalogOverrideProvider>;
  diagnostics: CatalogZeroEvalOverlayDiagnostics;
  priced_model_count: number;
  projected_model_count: number;
  projection_skipped_providers: string[];
}

interface ZeroEvalMatch {
  canonical: CatalogCanonicalModel;
  strategy: CatalogModelMatchStrategy;
  confidence: CatalogModelMatchConfidence;
  matched_from: string[];
  notes?: string[];
  projection_model_id?: string;
}

export function applyZeroEvalCanonicalOverlay(input: {
  canonicalRegistry: CatalogCanonicalRegistry;
  zeroEvalModels: ZeroEvalModel[];
  generatedAt: string;
  sourceUrl: string;
}): ZeroEvalOverlayResult {
  const registryModels = input.canonicalRegistry.models.map((model) => cloneCanonicalModel(model));
  const exactSourceIndex = new Map<string, CatalogCanonicalModel[]>();
  const exactCanonicalIndex = new Map<string, CatalogCanonicalModel[]>();
  const aliasIndex = new Map<string, CatalogCanonicalModel[]>();
  const signatureIndex = new Map<string, CatalogCanonicalModel[]>();

  for (const model of registryModels) {
    for (const providerKey of providerKeysForCanonicalModel(model)) {
      for (const key of exactSourceKeys(model)) {
        pushIndexedModel(exactSourceIndex, indexKey(providerKey, key), model);
      }
      for (const key of exactCanonicalKeys(model)) {
        pushIndexedModel(exactCanonicalIndex, indexKey(providerKey, key), model);
      }
      for (const key of aliasKeys(model)) {
        pushIndexedModel(aliasIndex, indexKey(providerKey, key), model);
      }
      for (const key of signatureKeys(model)) {
        pushIndexedModel(signatureIndex, indexKey(providerKey, key), model);
      }
    }
  }

  const providers = new Map<string, CatalogOverrideProvider>();
  const unmatchedModels: CatalogCanonicalOverlayDiagnostic[] = [];
  const lowConfidenceMatches: CatalogCanonicalOverlayDiagnostic[] = [];
  const ambiguousMatches: CatalogCanonicalOverlayDiagnostic[] = [];
  const projectionSkippedProviders = new Set<string>();
  let matchedModelCount = 0;
  let highConfidenceMatchCount = 0;
  let mediumConfidenceMatchCount = 0;
  let lowConfidenceMatchCount = 0;
  let ambiguousMatchCount = 0;
  let pricedModelCount = 0;
  let projectedModelCount = 0;

  for (const entry of Array.isArray(input.zeroEvalModels) ? input.zeroEvalModels : []) {
    if (!isNonEmptyString(entry.model_id)) continue;

    const match = matchZeroEvalCanonicalModel({
      entry,
      exactSourceIndex,
      exactCanonicalIndex,
      aliasIndex,
      signatureIndex,
    });

    if (!match) {
      unmatchedModels.push({
        organization_id: normalizeProviderKey(entry.organization_id),
        model_id: entry.model_id,
        reason:
          'No canonical OpenRouter model matched this ZeroEval row using exact ids, explicit aliases, or strict family/version/date rules.',
      });
      continue;
    }

    if (match.confidence === 'low') {
      const diagnostic: CatalogCanonicalOverlayDiagnostic = {
        organization_id: normalizeProviderKey(entry.organization_id),
        model_id: entry.model_id,
        canonical_id: match.canonical.canonical_id,
        match_strategy: match.strategy,
        match_confidence: match.confidence,
        reason:
          match.strategy === 'ambiguous_candidate'
            ? 'Multiple canonical candidates remained after strict matching, so this ZeroEval row was kept out of defaults and pricing materialization.'
            : 'The ZeroEval row only reached low-confidence matching and was kept out of defaults and pricing materialization.',
        matched_from: match.matched_from,
        match_notes: match.notes,
      };
      lowConfidenceMatches.push(diagnostic);
      if (match.strategy === 'ambiguous_candidate') {
        ambiguousMatches.push(diagnostic);
        ambiguousMatchCount += 1;
      }
      lowConfidenceMatchCount += 1;
      continue;
    }

    const overlay = buildCanonicalEnrichment({
      entry,
      match,
      generatedAt: input.generatedAt,
      sourceUrl: input.sourceUrl,
    });
    match.canonical.enrichment = overlay;
    matchedModelCount += 1;
    if (match.confidence === 'high') highConfidenceMatchCount += 1;
    if (match.confidence === 'medium') mediumConfidenceMatchCount += 1;

    const transportProviderId = mapCanonicalProviderToTransportProvider(
      match.canonical.source_provider_slug,
    );
    if (!transportProviderId) {
      projectionSkippedProviders.add(match.canonical.source_provider_slug);
      continue;
    }

    const projectedModel = materializeProjectedModel({
      providerId: transportProviderId,
      canonical: match.canonical,
      overlay,
      zeroEvalModel: entry,
      projectionModelId: match.projection_model_id,
    });
    if (!projectedModel) {
      projectionSkippedProviders.add(transportProviderId);
      continue;
    }

    let provider = providers.get(transportProviderId);
    if (!provider) {
      provider = { id: transportProviderId, models: [] };
      providers.set(transportProviderId, provider);
    }
    provider.models ??= [];
    provider.models.push(projectedModel);
    projectedModelCount += 1;
    if (canonicalPricingHasAnyValue(projectedModel.pricing)) pricedModelCount += 1;
  }

  for (const provider of providers.values()) {
    provider.models = dedupeProjectedModels(provider.models || []);
  }

  const canonicalRegistry: CatalogCanonicalRegistry = {
    ...input.canonicalRegistry,
    model_count: registryModels.length,
    models: registryModels.sort((left, right) => left.canonical_id.localeCompare(right.canonical_id)),
  };

  return {
    canonical_registry: canonicalRegistry,
    providers: Object.fromEntries(
      [...providers.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([providerId, provider]) => [
          providerId,
          {
            ...provider,
            models: (provider.models || []).sort((left, right) =>
              left.id.localeCompare(right.id),
            ),
          },
        ]),
    ),
    diagnostics: {
      source: ZEROEVAL_SOURCE,
      source_url: input.sourceUrl,
      synced_at: input.generatedAt,
      canonical_model_count: input.canonicalRegistry.model_count,
      zeroeval_model_count: Array.isArray(input.zeroEvalModels) ? input.zeroEvalModels.length : 0,
      matched_model_count: matchedModelCount,
      projected_model_count: projectedModelCount,
      high_confidence_match_count: highConfidenceMatchCount,
      medium_confidence_match_count: mediumConfidenceMatchCount,
      low_confidence_match_count: lowConfidenceMatchCount,
      unmatched_model_count: unmatchedModels.length,
      ambiguous_match_count: ambiguousMatchCount,
      unmatched_models: unmatchedModels.length > 0 ? unmatchedModels : undefined,
      low_confidence_matches:
        lowConfidenceMatches.length > 0 ? lowConfidenceMatches : undefined,
      ambiguous_matches: ambiguousMatches.length > 0 ? ambiguousMatches : undefined,
    },
    priced_model_count: pricedModelCount,
    projected_model_count: projectedModelCount,
    projection_skipped_providers: [...projectionSkippedProviders].sort(),
  };
}

function matchZeroEvalCanonicalModel(input: {
  entry: ZeroEvalModel;
  exactSourceIndex: Map<string, CatalogCanonicalModel[]>;
  exactCanonicalIndex: Map<string, CatalogCanonicalModel[]>;
  aliasIndex: Map<string, CatalogCanonicalModel[]>;
  signatureIndex: Map<string, CatalogCanonicalModel[]>;
}): ZeroEvalMatch | null {
  const modelId = normalizeModelKey(input.entry.model_id);
  if (!modelId) return null;

  const providerKeys = providerKeysForOrganization(input.entry.organization_id);
  const explicitRule = explicitAliasRule(input.entry);

  const exactSourceCandidates = lookupIndexedCandidates(
    input.exactSourceIndex,
    providerKeys,
    [modelId],
  );
  const exactSourceMatch = resolveMatchCandidates({
    candidates: exactSourceCandidates,
    entry: input.entry,
    strategy: 'exact_source_model_id',
    confidence: 'high',
    matched_from: [`zeroeval.model_id:${modelId}`],
    notes: undefined,
    projection_model_id: explicitRule?.projection_model_id,
  });
  if (exactSourceMatch) return exactSourceMatch;

  const exactCanonicalCandidates = lookupIndexedCandidates(
    input.exactCanonicalIndex,
    providerKeys,
    [modelId],
  );
  const exactCanonicalMatch = resolveMatchCandidates({
    candidates: exactCanonicalCandidates,
    entry: input.entry,
    strategy: 'exact_canonical_slug',
    confidence: 'high',
    matched_from: [`zeroeval.model_id:${modelId}`],
    notes: undefined,
    projection_model_id: explicitRule?.projection_model_id,
  });
  if (exactCanonicalMatch) return exactCanonicalMatch;

  const aliasQueries = explicitRule?.candidate_ids
    ?.map((value) => normalizeModelKey(value))
    .filter((value): value is string => Boolean(value)) || [];
  const aliasCandidates = dedupeCanonicalCandidates(
    [
      ...lookupIndexedCandidates(input.aliasIndex, providerKeys, [modelId, ...aliasQueries]),
      ...lookupIndexedCandidates(input.exactSourceIndex, providerKeys, aliasQueries),
      ...lookupIndexedCandidates(input.exactCanonicalIndex, providerKeys, aliasQueries),
    ],
    input.entry,
  );
  const aliasMatch = resolveMatchCandidates({
    candidates: aliasCandidates,
    entry: input.entry,
    strategy: 'explicit_alias',
    confidence: 'high',
    matched_from: [
      `zeroeval.model_id:${modelId}`,
      ...(aliasQueries.length > 0
        ? aliasQueries.map((value) => `explicit_alias:${value}`)
        : []),
    ],
    notes: explicitRule?.notes,
    projection_model_id: explicitRule?.projection_model_id,
  });
  if (aliasMatch) return aliasMatch;

  const signature = strictSignatureKey(input.entry.model_id);
  if (!signature) return null;

  const signatureCandidates = lookupIndexedCandidates(
    input.signatureIndex,
    providerKeys,
    [signature],
  );
  const releaseDate = normalizedReleaseDate(input.entry.release_date);
  const signatureMatches = dedupeCanonicalCandidates(signatureCandidates, input.entry);
  if (signatureMatches.length === 0) return null;
  if (signatureMatches.length === 1) {
    const candidate = signatureMatches[0];
    const releaseDateMatched = releaseDate
      ? canonicalDateCandidates(candidate).has(releaseDate)
      : false;
    return {
      canonical: candidate,
      strategy: releaseDateMatched
        ? 'strict_signature_release_date'
        : 'strict_signature',
      confidence: releaseDateMatched ? 'high' : 'medium',
      matched_from: [
        `zeroeval.model_id:${modelId}`,
        `strict_signature:${signature}`,
        ...(releaseDateMatched ? [`release_date:${releaseDate}`] : []),
      ],
      notes: releaseDateMatched
        ? ['Strict family/version/date signature matched a single canonical model.']
        : ['Strict family/version signature matched a single canonical model.'],
      projection_model_id: explicitRule?.projection_model_id,
    };
  }

  if (releaseDate) {
    const releaseMatched = signatureMatches.filter((candidate) =>
      canonicalDateCandidates(candidate).has(releaseDate),
    );
    if (releaseMatched.length === 1) {
      return {
        canonical: releaseMatched[0],
        strategy: 'strict_signature_release_date',
        confidence: 'high',
        matched_from: [
          `zeroeval.model_id:${modelId}`,
          `strict_signature:${signature}`,
          `release_date:${releaseDate}`,
        ],
        notes: ['Release date disambiguated multiple strict signature candidates.'],
        projection_model_id: explicitRule?.projection_model_id,
      };
    }
  }

  const ranked = rankCanonicalCandidates(signatureMatches, input.entry);
  if (ranked.length > 0 && ranked[0].score > (ranked[1]?.score ?? -Infinity)) {
    return {
      canonical: ranked[0].candidate,
      strategy: 'strict_signature',
      confidence: 'medium',
      matched_from: [`zeroeval.model_id:${modelId}`, `strict_signature:${signature}`],
      notes: ['Strict signature required tie-breaking across multiple canonical route variants.'],
      projection_model_id: explicitRule?.projection_model_id,
    };
  }

  return {
    canonical: ranked[0]?.candidate || signatureMatches[0],
    strategy: 'ambiguous_candidate',
    confidence: 'low',
    matched_from: [`zeroeval.model_id:${modelId}`, `strict_signature:${signature}`],
    notes: ['Multiple canonical candidates matched the same strict signature.'],
    projection_model_id: explicitRule?.projection_model_id,
  };
}

function resolveMatchCandidates(input: {
  candidates: CatalogCanonicalModel[];
  entry: ZeroEvalModel;
  strategy: CatalogModelMatchStrategy;
  confidence: CatalogModelMatchConfidence;
  matched_from: string[];
  notes?: string[];
  projection_model_id?: string;
}): ZeroEvalMatch | null {
  if (input.candidates.length === 0) return null;
  const deduped = dedupeCanonicalCandidates(input.candidates, input.entry);
  if (deduped.length === 1) {
    return {
      canonical: deduped[0],
      strategy: input.strategy,
      confidence: input.confidence,
      matched_from: input.matched_from,
      notes: input.notes,
      projection_model_id: input.projection_model_id,
    };
  }

  const ranked = rankCanonicalCandidates(deduped, input.entry);
  if (ranked.length > 0 && ranked[0].score > (ranked[1]?.score ?? -Infinity)) {
    return {
      canonical: ranked[0].candidate,
      strategy: input.strategy,
      confidence: input.confidence,
      matched_from: input.matched_from,
      notes: [...(input.notes || []), 'Resolved duplicate canonical route variants via deterministic candidate ranking.'],
      projection_model_id: input.projection_model_id,
    };
  }

  return {
    canonical: ranked[0]?.candidate || deduped[0],
    strategy: 'ambiguous_candidate',
    confidence: 'low',
    matched_from: input.matched_from,
    notes: [...(input.notes || []), 'Exact/alias matching still left multiple canonical candidates.'],
    projection_model_id: input.projection_model_id,
  };
}

function buildCanonicalEnrichment(input: {
  entry: ZeroEvalModel;
  match: ZeroEvalMatch;
  generatedAt: string;
  sourceUrl: string;
}): CatalogModelEnrichment {
  const benchmarks = zeroEvalBenchmarks(input.entry);
  const secondaryPricingReference = zeroEvalPricingToCatalogPricing(
    input.entry,
    input.generatedAt.slice(0, 10),
    input.generatedAt,
  );
  return {
    source: ZEROEVAL_SOURCE,
    source_url: input.sourceUrl,
    synced_at: input.generatedAt,
    enriched_from: ZEROEVAL_SOURCE,
    enriched_at: input.generatedAt,
    match_strategy: input.match.strategy,
    match_confidence: input.match.confidence,
    matched_from: input.match.matched_from,
    match_notes: input.match.notes,
    organization: isNonEmptyString(input.entry.organization)
      ? input.entry.organization.trim()
      : undefined,
    organization_id: normalizeProviderKey(input.entry.organization_id),
    canonical_model_id: input.match.canonical.canonical_id,
    release_date: normalizedReleaseDate(input.entry.release_date),
    announcement_date: normalizedReleaseDate(input.entry.announcement_date),
    multimodal:
      typeof input.entry.multimodal === 'boolean' ? input.entry.multimodal : undefined,
    throughput: finiteNonNegativeNumber(input.entry.throughput),
    lifecycle: {
      release_date: normalizedReleaseDate(input.entry.release_date),
      announcement_date: normalizedReleaseDate(input.entry.announcement_date),
      knowledge_cutoff: normalizedReleaseDate(input.entry.knowledge_cutoff),
    },
    specs: {
      params: finiteNonNegativeNumber(input.entry.params),
      training_tokens: finiteNonNegativeNumber(input.entry.training_tokens),
      throughput: finiteNonNegativeNumber(input.entry.throughput),
      multimodal:
        typeof input.entry.multimodal === 'boolean' ? input.entry.multimodal : undefined,
      license: isNonEmptyString(input.entry.license)
        ? input.entry.license.trim()
        : undefined,
      is_moe: typeof input.entry.is_moe === 'boolean' ? input.entry.is_moe : undefined,
    },
    benchmarks,
    secondary_pricing_reference: secondaryPricingReference,
    metadata: {
      matched_zeroeval_model_id: input.entry.model_id,
      zeroeval_name: isNonEmptyString(input.entry.name) ? input.entry.name.trim() : undefined,
      zeroeval_canonical_model_id: isNonEmptyString(input.entry.canonical_model_id)
        ? input.entry.canonical_model_id.trim()
        : undefined,
    },
  };
}

function materializeProjectedModel(input: {
  providerId: string;
  canonical: CatalogCanonicalModel;
  overlay: CatalogModelEnrichment;
  zeroEvalModel: ZeroEvalModel;
  projectionModelId?: string;
}): CatalogOverrideModel | null {
  const modelId = resolveProjectedModelId(input);
  if (!modelId) return null;
  const modalities = projectedModalities(input.canonical, input.zeroEvalModel);
  const pricing = projectedPricing(input.canonical, input.overlay);
  return {
    id: modelId,
    display_name:
      isNonEmptyString(input.zeroEvalModel.name)
        ? input.zeroEvalModel.name.trim()
        : input.canonical.display_name,
    modalities,
    endpoints: projectedEndpoints(input.providerId, modalities),
    capabilities: projectedCapabilities(input.canonical, modalities),
    limits:
      finitePositiveNumber(input.zeroEvalModel.context) ||
      finitePositiveNumber(input.canonical.context_length)
        ? {
            max_context_tokens:
              finitePositiveNumber(input.zeroEvalModel.context) ||
              finitePositiveNumber(input.canonical.context_length),
          }
        : undefined,
    pricing,
    enrichment: input.overlay,
  };
}

function resolveProjectedModelId(input: {
  providerId: string;
  canonical: CatalogCanonicalModel;
  zeroEvalModel: ZeroEvalModel;
  projectionModelId?: string;
}): string | undefined {
  if (isNonEmptyString(input.projectionModelId)) return input.projectionModelId.trim();

  const builtInHints = BUILTIN_MODEL_IDS_BY_PROVIDER.get(input.providerId) || new Set<string>();
  const sourceShort = strippedProviderModelId(input.canonical.source_model_id);
  const canonicalShort =
    strippedProviderModelId(input.canonical.canonical_slug) ||
    strippedProviderModelId(input.canonical.canonical_id);
  const zeroEvalId = isNonEmptyString(input.zeroEvalModel.model_id)
    ? input.zeroEvalModel.model_id.trim()
    : undefined;
  const aliasShorts = (input.canonical.aliases || [])
    .map((value) => strippedProviderModelId(value))
    .filter((value): value is string => Boolean(value));

  for (const candidate of [
    sourceShort,
    zeroEvalId,
    canonicalShort,
    ...aliasShorts,
  ]) {
    if (!candidate) continue;
    const match = [...builtInHints].find(
      (hint) => normalizeModelKey(hint) === normalizeModelKey(candidate),
    );
    if (match) return match;
  }

  if (isProviderSafeModelId(sourceShort)) {
    const normalized = normalizeProjectionModelId(sourceShort, zeroEvalId);
    if (normalized) return normalized;
  }
  if (isNonEmptyString(zeroEvalId)) return zeroEvalId.trim();
  if (isProviderSafeModelId(canonicalShort)) return canonicalShort;
  return undefined;
}

function projectedPricing(
  canonical: CatalogCanonicalModel,
  overlay: CatalogModelEnrichment,
): CatalogPricing | undefined {
  if (canonical.pricing_reference) {
    return clonePricing(canonical.pricing_reference);
  }
  if (overlay.secondary_pricing_reference) {
    return clonePricing(overlay.secondary_pricing_reference);
  }
  return undefined;
}

function dedupeProjectedModels(models: CatalogOverrideModel[]): CatalogOverrideModel[] {
  const deduped = new Map<string, CatalogOverrideModel>();
  for (const model of models) {
    deduped.set(model.id, deduped.has(model.id)
      ? mergeProjectedModels(deduped.get(model.id)!, model)
      : model);
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeProjectedModels(
  current: CatalogOverrideModel,
  incoming: CatalogOverrideModel,
): CatalogOverrideModel {
  return {
    ...current,
    ...incoming,
    modalities: incoming.modalities || current.modalities,
    endpoints: { ...(current.endpoints || {}), ...(incoming.endpoints || {}) },
    capabilities: [...new Set([...(current.capabilities || []), ...(incoming.capabilities || [])])],
    limits: incoming.limits || current.limits,
    pricing: incoming.pricing || current.pricing,
    enrichment: incoming.enrichment || current.enrichment,
  };
}

function providerKeysForCanonicalModel(model: CatalogCanonicalModel): string[] {
  return providerKeysForOrganization(model.source_provider_slug);
}

function providerKeysForOrganization(value: unknown): string[] {
  const normalized = normalizeProviderKey(value);
  if (!normalized) return [];
  return [...new Set([normalized, ...(CANONICAL_PROVIDER_ALIASES[normalized] || [])])];
}

function mapCanonicalProviderToTransportProvider(value: string): string | undefined {
  const normalized = normalizeProviderKey(value);
  if (!normalized) return undefined;
  if (TRANSPORT_PROVIDER_ID_BY_CANONICAL[normalized]) {
    return TRANSPORT_PROVIDER_ID_BY_CANONICAL[normalized];
  }
  return BUILTIN_PROVIDER_BY_ID.has(normalized) ? normalized : undefined;
}

function explicitAliasRule(entry: ZeroEvalModel): ExplicitAliasRule | undefined {
  const provider = normalizeProviderKey(entry.organization_id);
  const modelId = normalizeModelKey(entry.model_id);
  if (!provider || !modelId) return undefined;
  const direct = EXPLICIT_ALIAS_RULES[`${provider}/${modelId}`];
  if (direct) return direct;

  if (provider === 'openai' && modelId.startsWith('chatgpt-') && modelId.endsWith('-latest')) {
    const family = modelId.slice('chatgpt-'.length, -'-latest'.length);
    const gptFamily = family ? `gpt-${family}` : undefined;
    if (gptFamily) {
      return {
        candidate_ids: [gptFamily],
        projection_model_id: gptFamily,
        notes: ['Applied generic OpenAI ChatGPT latest alias normalization.'],
      };
    }
  }

  if (provider === 'openai') {
    const chatLatestMatch = modelId.match(/^gpt-[0-9]+(?:\.[0-9]+)?-chat-latest$/);
    if (chatLatestMatch) {
      return {
        candidate_ids: ['gpt-chat-latest'],
        projection_model_id: modelId,
        notes: ['Applied generic OpenAI GPT chat latest alias normalization.'],
      };
    }
  }

  return undefined;
}

function exactSourceKeys(model: CatalogCanonicalModel): string[] {
  return uniqueKeys([
    normalizeModelKey(model.source_model_id),
    normalizeModelKey(strippedProviderModelId(model.source_model_id)),
  ]);
}

function exactCanonicalKeys(model: CatalogCanonicalModel): string[] {
  return uniqueKeys([
    normalizeModelKey(model.canonical_slug),
    normalizeModelKey(strippedProviderModelId(model.canonical_slug)),
    normalizeModelKey(model.canonical_id),
    normalizeModelKey(strippedProviderModelId(model.canonical_id)),
  ]);
}

function aliasKeys(model: CatalogCanonicalModel): string[] {
  return uniqueKeys([
    ...(model.aliases || []).flatMap((value) => [
      normalizeModelKey(value),
      normalizeModelKey(strippedProviderModelId(value)),
    ]),
  ]);
}

function signatureKeys(model: CatalogCanonicalModel): string[] {
  return uniqueKeys([
    strictSignatureKey(model.source_model_id),
    strictSignatureKey(model.canonical_slug),
    strictSignatureKey(model.canonical_id),
    ...(model.aliases || []).map((value) => strictSignatureKey(value)),
  ]);
}

function strictSignatureKey(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const normalized = normalizeSignatureBase(strippedProviderModelId(value));
  if (!normalized) return undefined;
  const tokens = normalized
    .split('-')
    .filter(Boolean)
    .filter((token) => !isDateToken(token));
  if (tokens.length === 0) return undefined;
  return tokens.sort().join('|');
}

function normalizeSignatureBase(value: string | undefined): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/^~/, '')
    .replace(/[./:_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeModelKey(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value.trim().toLowerCase();
}

function strippedProviderModelId(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const normalized = value.trim().replace(/^~/, '');
  const slashIndex = normalized.indexOf('/');
  if (slashIndex >= 0) return normalized.slice(slashIndex + 1);
  return normalized;
}

function lookupIndexedCandidates(
  index: Map<string, CatalogCanonicalModel[]>,
  providerKeys: string[],
  modelKeys: string[],
): CatalogCanonicalModel[] {
  const matches: CatalogCanonicalModel[] = [];
  for (const providerKey of providerKeys) {
    for (const modelKey of modelKeys) {
      const indexed = index.get(indexKey(providerKey, modelKey));
      if (indexed) matches.push(...indexed);
    }
  }
  return matches;
}

function dedupeCanonicalCandidates(
  candidates: CatalogCanonicalModel[],
  entry: ZeroEvalModel,
): CatalogCanonicalModel[] {
  const deduped = new Map<string, CatalogCanonicalModel>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.canonical_id);
    if (!existing) {
      deduped.set(candidate.canonical_id, candidate);
      continue;
    }
    const ranked = rankCanonicalCandidates([existing, candidate], entry);
    deduped.set(candidate.canonical_id, ranked[0].candidate);
  }
  return [...deduped.values()];
}

function rankCanonicalCandidates(
  candidates: CatalogCanonicalModel[],
  entry: ZeroEvalModel,
): Array<{ candidate: CatalogCanonicalModel; score: number }> {
  const modelId = normalizeModelKey(entry.model_id);
  const releaseDate = normalizedReleaseDate(entry.release_date);
  const isPreview = modelLooksPreview(entry.model_id) || modelLooksPreview(entry.name);
  return candidates
    .map((candidate) => {
      const shortSource = normalizeModelKey(strippedProviderModelId(candidate.source_model_id));
      const shortCanonical = normalizeModelKey(
        strippedProviderModelId(candidate.canonical_slug || candidate.canonical_id),
      );
      const aliasShorts = new Set(
        (candidate.aliases || [])
          .map((value) => normalizeModelKey(strippedProviderModelId(value)))
          .filter((value): value is string => Boolean(value)),
      );
      let score = 0;
      if (modelId && shortSource === modelId) score += 120;
      if (modelId && shortCanonical === modelId) score += 110;
      if (modelId && aliasShorts.has(modelId)) score += 100;
      if (releaseDate && canonicalDateCandidates(candidate).has(releaseDate)) score += 25;
      if (!stringHasRouteModifiers(strippedProviderModelId(candidate.source_model_id))) score += 15;
      if (!modelLooksPreview(candidate.source_model_id) && !isPreview) score += 10;
      if (!modelLooksPreview(candidate.canonical_slug) && !isPreview) score += 5;
      if (!candidate.source_model_id.startsWith('~')) score += 4;
      if (!normalizeModelKey(candidate.source_model_id)?.includes(':free')) score += 3;
      return { candidate, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.candidate.canonical_id.localeCompare(right.candidate.canonical_id);
    });
}

function projectedModalities(
  canonical: CatalogCanonicalModel,
  zeroEvalModel: ZeroEvalModel,
): Modality[] {
  const mapped = [
    ...mapCanonicalModalities(canonical.input_modalities),
    ...mapCanonicalOutputModalities(canonical.output_modalities),
  ];
  const unique = [...new Set(mapped)];
  if (unique.length > 0) return unique;
  if (zeroEvalModel.multimodal === true) return ['text', 'vision'];
  return ['text'];
}

function mapCanonicalModalities(values: string[] | undefined): Modality[] {
  return (values || []).flatMap((value): Modality[] => {
    const normalized = value.toLowerCase();
    if (normalized === 'text' || normalized === 'file') return ['text'];
    if (normalized === 'image') return ['vision'];
    if (normalized === 'audio') return ['audio'];
    if (normalized === 'video') return ['video'];
    if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
    return [];
  });
}

function mapCanonicalOutputModalities(values: string[] | undefined): Modality[] {
  return (values || []).flatMap((value): Modality[] => {
    const normalized = value.toLowerCase();
    if (normalized === 'text' || normalized === 'file') return ['text'];
    if (normalized === 'image') return ['image'];
    if (normalized === 'audio') return ['audio'];
    if (normalized === 'video') return ['video'];
    if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
    return [];
  });
}

function projectedEndpoints(
  providerId: string,
  modalities: Modality[],
): CatalogOverrideModel['endpoints'] | undefined {
  const provider = BUILTIN_PROVIDER_BY_ID.get(providerId);
  if (!provider) return undefined;
  const endpoints: Record<string, string> = {};
  const textEndpoint =
    provider.endpoints.messages
      ? 'messages'
      : provider.endpoints.responses
        ? 'responses'
        : provider.endpoints.chat_completions
          ? 'chat_completions'
          : undefined;

  if (
    textEndpoint &&
    (modalities.includes('text') || modalities.includes('vision'))
  ) {
    endpoints[textEndpoint] = provider.endpoints[textEndpoint] as string;
  }
  if (provider.endpoints.embeddings && modalities.includes('embedding')) {
    endpoints.embeddings = provider.endpoints.embeddings;
  }
  if (provider.endpoints.rerank && modalities.includes('rerank')) {
    endpoints.rerank = provider.endpoints.rerank;
  }
  if (provider.endpoints.image && modalities.includes('image')) {
    endpoints.image = provider.endpoints.image;
  }
  if (provider.endpoints.audio_transcriptions && modalities.includes('audio')) {
    endpoints.audio_transcriptions = provider.endpoints.audio_transcriptions;
  }
  if (provider.endpoints.audio_speech && modalities.includes('audio')) {
    endpoints.audio_speech = provider.endpoints.audio_speech;
  }
  if (provider.endpoints.video && modalities.includes('video')) {
    endpoints.video = provider.endpoints.video;
  }
  if (provider.endpoints.realtime && modalities.includes('audio')) {
    endpoints.realtime = provider.endpoints.realtime;
  }
  return Object.keys(endpoints).length > 0 ? endpoints : undefined;
}

function projectedCapabilities(
  canonical: CatalogCanonicalModel,
  modalities: Modality[],
): string[] | undefined {
  const parameters = new Set(
    (canonical.supported_parameters || []).map((value) => value.toLowerCase()),
  );
  const capabilities = new Set<string>();
  if (parameters.has('tools') || parameters.has('tool_choice')) capabilities.add('tools');
  if (parameters.has('response_format') || parameters.has('structured_outputs')) {
    capabilities.add('structured_output');
  }
  if (parameters.has('reasoning') || parameters.has('include_reasoning')) {
    capabilities.add('reasoning');
  }
  if (modalities.includes('vision')) capabilities.add('vision');
  if (modalities.includes('embedding')) capabilities.add('embedding');
  if (modalities.includes('image')) capabilities.add('image');
  if (modalities.includes('audio')) capabilities.add('audio');
  if (modalities.includes('video')) capabilities.add('video');
  const values = [...capabilities].sort();
  return values.length > 0 ? values : undefined;
}

function zeroEvalBenchmarks(model: ZeroEvalModel): Record<string, number> | undefined {
  const entries = Object.entries(model).filter(
    ([key, value]) =>
      key.endsWith('_score') &&
      typeof value === 'number' &&
      Number.isFinite(value),
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as Record<string, number>)
    : undefined;
}

export function zeroEvalPricingToCatalogPricing(
  model: ZeroEvalModel,
  lastUpdated: string,
  retrievedAt: string,
): CatalogPricing | undefined {
  const input =
    typeof model.input_price === 'number' &&
    Number.isFinite(model.input_price) &&
    model.input_price >= 0
      ? roundPrice(model.input_price)
      : null;
  const output =
    typeof model.output_price === 'number' &&
    Number.isFinite(model.output_price) &&
    model.output_price >= 0
      ? roundPrice(model.output_price)
      : null;
  if (input === null && output === null) return undefined;

  const pricing: CatalogPricing = {
    currency: 'USD',
    billing_unit: 'usd_per_1m_tokens',
    unit: 'usd_per_1m_tokens',
    units: {
      input: 'usd_per_1m_input_tokens',
      output: 'usd_per_1m_output_tokens',
      input_per_1m_tokens: 'usd_per_1m_input_tokens',
      output_per_1m_tokens: 'usd_per_1m_output_tokens',
    },
    source_type: 'aggregator_api',
    source: ZEROEVAL_SOURCE,
    source_url: 'https://api.zeroeval.com/leaderboard/models/full?justCanonicals=false',
    last_updated: lastUpdated,
    last_sync: retrievedAt,
    retrieved_at: retrievedAt,
    last_verified_at: retrievedAt,
    manual_review_required: true,
    review_reason:
      'ZeroEval pricing is third-party enrichment metadata and should be reviewed before production billing decisions.',
    stale_after_days: 7,
    pricing_confidence: 'medium',
    notes:
      'ZeroEval input/output pricing is stored as a secondary reference in USD per 1M tokens and never overrides explicit local pricing.',
  };
  if (input !== null) {
    pricing.input = input;
    pricing.input_per_1m_tokens = input;
  }
  if (output !== null) {
    pricing.output = output;
    pricing.output_per_1m_tokens = output;
  }
  return pricing;
}

function canonicalDateCandidates(model: CatalogCanonicalModel): Set<string> {
  const values = new Set<string>();
  for (const candidate of [
    normalizedReleaseDate(model.created),
    ...extractDateCandidates(model.canonical_slug),
    ...extractDateCandidates(model.canonical_id),
    ...((model.aliases || []).flatMap((value) => extractDateCandidates(value))),
  ]) {
    if (candidate) values.add(candidate);
  }
  return values;
}

function extractDateCandidates(value: string | undefined): string[] {
  if (!isNonEmptyString(value)) return [];
  const matches = value.match(/(\d{4}-\d{2}-\d{2}|\d{8}|\d{4}-\d{2})/g) || [];
  return matches
    .map((match) => normalizeLooseDate(match))
    .filter((match): match is string => Boolean(match));
}

function normalizeLooseDate(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  return undefined;
}

function normalizedReleaseDate(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return normalizeLooseDate(value.trim()) || value.trim();
}

function cloneCanonicalModel(model: CatalogCanonicalModel): CatalogCanonicalModel {
  return JSON.parse(JSON.stringify(model)) as CatalogCanonicalModel;
}

function clonePricing(pricing: CatalogPricing): CatalogPricing {
  return JSON.parse(JSON.stringify(pricing)) as CatalogPricing;
}

function uniqueKeys(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function pushIndexedModel(
  index: Map<string, CatalogCanonicalModel[]>,
  key: string,
  model: CatalogCanonicalModel,
): void {
  const existing = index.get(key);
  if (existing) {
    existing.push(model);
    return;
  }
  index.set(key, [model]);
}

function indexKey(providerKey: string, modelKey: string): string {
  return `${providerKey}::${modelKey}`;
}

function normalizeProviderKey(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value.trim().toLowerCase();
}

function isProviderSafeModelId(value: string | undefined): value is string {
  return Boolean(
    value &&
      !value.startsWith('~') &&
      !value.includes(':') &&
      value.trim().length > 0,
  );
}

function normalizeProjectionModelId(
  sourceModelId: string,
  zeroEvalModelId: string | undefined,
): string {
  if (
    zeroEvalModelId &&
    normalizeSignatureBase(sourceModelId) === normalizeSignatureBase(zeroEvalModelId)
  ) {
    return zeroEvalModelId;
  }
  return sourceModelId;
}

function stringHasRouteModifiers(value: string | undefined): boolean {
  return Boolean(value && (value.includes(':') || value.startsWith('~')));
}

function modelLooksPreview(value: unknown): boolean {
  if (!isNonEmptyString(value)) return false;
  return /\bpreview\b|\bbeta\b|experimental|exp\b|alpha|test/i.test(value);
}

function isDateToken(value: string): boolean {
  return /^\d{8}$/.test(value) || /^\d{4}$/.test(value) || /^\d{2}$/.test(value);
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(8));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
