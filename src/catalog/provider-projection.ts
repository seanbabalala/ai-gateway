import type { CatalogCanonicalModel, CatalogCanonicalRegistry, CatalogModel, CatalogOverrideModel, CatalogOverrideProvider, CatalogProvider, CatalogProviderStatus } from './catalog.types';

const EXPLICIT_PROVIDER_STATUS: Partial<Record<string, CatalogProviderStatus>> = {
  openrouter: 'active',
  'openai-compatible': 'custom',
  'azure-openai': 'transport_only',
  'aws-bedrock': 'transport_only',
  together: 'transport_only',
  fireworks: 'transport_only',
  replicate: 'transport_only',
  huggingface: 'transport_only',
  'cloudflare-workers-ai': 'transport_only',
  'ibm-watsonx': 'transport_only',
  baseten: 'transport_only',
  lepton: 'transport_only',
  modal: 'transport_only',
  runpod: 'transport_only',
  predibase: 'transport_only',
  lamini: 'transport_only',
  'nvidia-nim': 'transport_only',
  ollama: 'transport_only',
  vllm: 'transport_only',
  'lm-studio': 'transport_only',
  'llama-cpp': 'transport_only',
  'huggingface-tgi': 'transport_only',
  sglang: 'transport_only',
  xinference: 'transport_only',
  fal: 'transport_only',
};

const PROVIDER_REPLACEMENTS: Partial<Record<string, string>> = {
  'azure-openai': 'openai',
};

const PROVIDER_STATUS_REASONS: Partial<Record<string, string>> = {
  openrouter:
    'Canonical OpenRouter sync drives the public model list for this preset.',
  'openai-compatible':
    'Generic custom/OpenAI-compatible presets depend on operator-supplied model truth and should not be presented as a canonical provider row by default.',
  'azure-openai':
    'Azure deployment names are operator-defined, so static model defaults are intentionally suppressed until local overrides or operator-specific catalogs are supplied.',
  'aws-bedrock':
    'Bedrock surfaces region- and deployment-specific provider models, so SiftGate keeps the transport preset but does not treat static model defaults as authoritative.',
  together:
    'Marketplace providers can expose multiple upstream model truths; keep the transport preset, but do not present a stale built-in model list as canonical.',
  fireworks:
    'Marketplace providers can expose multiple upstream model truths; keep the transport preset, but do not present a stale built-in model list as canonical.',
  replicate:
    'Replicate model ids and prices are version/runtime specific, so the preset remains transport-only until the operator pins local model truth.',
  huggingface:
    'Inference Providers route across multiple upstreams, so built-in model defaults are hidden until a stronger canonical/provider availability source exists.',
  'cloudflare-workers-ai':
    'Workers AI model availability is account- and platform-specific, so SiftGate preserves the transport preset without exposing static defaults as canonical truth.',
  'ibm-watsonx':
    'watsonx model availability depends on region, plan, and deployment context, so built-in model defaults are not treated as canonical.',
  baseten:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  lepton:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  modal:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  runpod:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  predibase:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  lamini:
    'Deployment platforms require operator-defined model truth and pricing, so the preset stays transport-only by default.',
  'nvidia-nim':
    'Hosted and self-hosted NIM surfaces vary by account and deployment, so built-in model defaults are hidden by default.',
  ollama:
    'Local model availability is operator-managed, so the preset remains transport-only until local overrides define the active model list.',
  vllm:
    'Self-hosted OpenAI-compatible stacks depend on operator deployments, so the preset remains transport-only until local overrides define the active model list.',
  'lm-studio':
    'Local model availability is operator-managed, so the preset remains transport-only until local overrides define the active model list.',
  'llama-cpp':
    'Local model availability is operator-managed, so the preset remains transport-only until local overrides define the active model list.',
  'huggingface-tgi':
    'Self-hosted TGI deployments depend on operator-defined model lists, so the preset remains transport-only by default.',
  sglang:
    'Self-hosted deployments depend on operator-defined model lists, so the preset remains transport-only by default.',
  xinference:
    'Self-hosted deployments depend on operator-defined model lists, so the preset remains transport-only by default.',
  fal:
    'fal.ai exposes provider-specific async routes and rapidly changing model variants, so the preset remains transport-only until a stronger canonical availability source exists.',
};

const PROVIDER_ALIAS_AUGMENTS: Partial<Record<string, string[]>> = {
  google: ['google-gemini', 'google-vertex'],
  fal: ['fal-ai'],
  luma: ['luma-ai'],
  lepton: ['lepton-ai'],
  'huggingface-tgi': ['text-generation-inference'],
};

const CANONICAL_TO_TRANSPORT_PROVIDER: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  gemini: 'google',
  mistral: 'mistral',
  groq: 'groq',
  deepseek: 'deepseek',
  xai: 'xai',
  cohere: 'cohere',
  voyage: 'voyage',
  jina: 'jina',
  qwen: 'alibaba-qwen',
  qwq: 'alibaba-qwen',
  qianfan: 'baidu-qianfan',
  baidu: 'baidu-qianfan',
  volcengine: 'volcengine-ark',
  doubao: 'volcengine-ark',
  zhipu: 'zhipu',
  glm: 'zhipu',
  moonshot: 'moonshot',
  kimi: 'moonshot',
  minimax: 'minimax',
  hunyuan: 'tencent-hunyuan',
  tencent: 'tencent-hunyuan',
  '01ai': '01ai',
  '01-ai': '01ai',
  yi: '01ai',
  perplexity: 'perplexity',
  cerebras: 'cerebras',
  sambanova: 'sambanova',
  ai21: 'ai21',
  stability: 'stability-ai',
  'stability-ai': 'stability-ai',
  'black-forest-labs': 'black-forest-labs',
  ideogram: 'ideogram',
  luma: 'luma',
  runway: 'runway',
  pika: 'pika',
  elevenlabs: 'elevenlabs',
  deepgram: 'deepgram',
  assemblyai: 'assemblyai',
  cartesia: 'cartesia',
  speechmatics: 'speechmatics',
};

type ProjectedModality = NonNullable<CatalogOverrideModel['modalities']>[number];
type ProjectedModalities = NonNullable<CatalogOverrideModel['modalities']>;
type ProjectedEndpoints = NonNullable<CatalogOverrideModel['endpoints']>;

export interface CatalogCanonicalProjectionBinding {
  provider_id: string;
  model_id: string;
  canonical_id: string;
  source_model_id: string;
  source_provider_slug: string;
  display_name: string;
  pricing_reference?: CatalogCanonicalModel['pricing_reference'];
  source_metadata: CatalogCanonicalModel['source_metadata'];
}

export function resolveCanonicalTransportProviderId(
  value: string | undefined | null,
): string | undefined {
  const normalized = normalizeProviderKey(value);
  if (!normalized) return undefined;
  return CANONICAL_TO_TRANSPORT_PROVIDER[normalized];
}

export function augmentProviderAliases(
  provider: Pick<CatalogProvider, 'id' | 'name' | 'aliases' | 'model_prefixes'>,
): string[] | undefined {
  const aliases = new Set<string>();
  for (const value of [
    provider.id,
    provider.name,
    ...(provider.aliases || []),
    ...(provider.model_prefixes || []),
    ...(PROVIDER_ALIAS_AUGMENTS[provider.id] || []),
  ]) {
    if (isNonEmptyString(value)) aliases.add(value.trim());
  }
  return aliases.size > 0 ? [...aliases] : undefined;
}

export function resolveProviderStatus(input: {
  provider: Pick<CatalogProvider, 'id' | 'status' | 'models' | 'overridden' | 'synced'>;
  canonicalRegistryPresent: boolean;
  preferExistingStatus?: boolean;
}): CatalogProviderStatus {
  if (
    input.provider.status &&
    (input.preferExistingStatus !== false || input.provider.overridden === true)
  ) {
    return input.provider.status;
  }
  const explicit = EXPLICIT_PROVIDER_STATUS[input.provider.id];
  if (explicit) return explicit;
  if (!input.canonicalRegistryPresent) return 'active';
  const hasProjectedOrOperatorModels =
    input.provider.overridden === true ||
    input.provider.synced === true ||
    input.provider.models.some((model) => model.source !== 'builtin' || model.overridden || model.synced);
  return hasProjectedOrOperatorModels ? 'active' : 'transport_only';
}

export function providerStatusReason(
  providerId: string,
  status: CatalogProviderStatus,
): string | undefined {
  if (PROVIDER_STATUS_REASONS[providerId]) return PROVIDER_STATUS_REASONS[providerId];
  if (status === 'transport_only') {
    return 'This preset keeps connection metadata, but SiftGate no longer treats its stale built-in model list as canonical operator-facing truth.';
  }
  if (status === 'custom') {
    return 'This row depends on operator-supplied model truth.';
  }
  return undefined;
}

export function providerReplacementId(providerId: string): string | undefined {
  return PROVIDER_REPLACEMENTS[providerId];
}

export function shouldExposeProviderByDefault(status: CatalogProviderStatus | undefined): boolean {
  return status === undefined || status === 'active';
}

export function shouldExposeProviderWithLegacyToggle(
  status: CatalogProviderStatus | undefined,
): boolean {
  return status === undefined || status !== 'legacy_alias';
}

export function findCatalogProviderByIdOrAlias<T extends Pick<CatalogProvider, 'id' | 'aliases'>>(
  providers: T[],
  id: string | undefined | null,
): T | undefined {
  if (!isNonEmptyString(id)) return undefined;
  const normalized = id.trim().toLowerCase();
  return providers.find((provider) => {
    if (provider.id.toLowerCase() === normalized) return true;
    return (provider.aliases || []).some((alias) => alias.toLowerCase() === normalized);
  });
}

export function buildCanonicalProjectionProviders(input: {
  canonicalRegistry: CatalogCanonicalRegistry;
  providers: CatalogProvider[];
}): Record<string, CatalogOverrideProvider> {
  const providersById = new Map(input.providers.map((provider) => [provider.id, provider]));
  const projected = new Map<string, CatalogOverrideProvider>();

  for (const canonical of input.canonicalRegistry.models) {
    const providerId = resolveCanonicalTransportProviderId(canonical.source_provider_slug);
    if (!providerId) continue;
    const provider = providersById.get(providerId);
    if (!provider) continue;
    const model = materializeCanonicalProjectedModel({
      canonical,
      provider,
    });
    if (!model) continue;

    let projection = projected.get(providerId);
    if (!projection) {
      projection = { id: providerId, models: [] };
      projected.set(providerId, projection);
    }
    projection.models ??= [];
    projection.models.push(model);
  }

  const entries = [...projected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([providerId, provider]) => [
      providerId,
      {
        ...provider,
        models: dedupeProjectedModels(provider.models || []),
      },
    ] as const);
  return Object.fromEntries(entries);
}

export function buildCanonicalProjectionBindings(input: {
  canonicalRegistry: CatalogCanonicalRegistry;
  providers: CatalogProvider[];
}): CatalogCanonicalProjectionBinding[] {
  const providersById = new Map(input.providers.map((provider) => [provider.id, provider]));
  const bindings = new Map<
    string,
    { binding: CatalogCanonicalProjectionBinding; score: number }
  >();

  for (const canonical of input.canonicalRegistry.models) {
    const providerId = resolveCanonicalTransportProviderId(canonical.source_provider_slug);
    if (!providerId) continue;
    const provider = providersById.get(providerId);
    if (!provider) continue;
    const model = materializeCanonicalProjectedModel({
      canonical,
      provider,
    });
    if (!model) continue;

    const binding: CatalogCanonicalProjectionBinding = {
      provider_id: providerId,
      model_id: model.id,
      canonical_id: canonical.canonical_id,
      source_model_id: canonical.source_model_id,
      source_provider_slug: canonical.source_provider_slug,
      display_name: canonical.display_name || model.id,
      pricing_reference: canonical.pricing_reference
        ? cloneJson(canonical.pricing_reference)
        : undefined,
      source_metadata: cloneJson(canonical.source_metadata),
    };
    const key = `${providerId}::${model.id}`;
    const score = projectionModelScore(model);
    const existing = bindings.get(key);
    if (
      !existing ||
      score > existing.score ||
      (score === existing.score &&
        binding.canonical_id.localeCompare(existing.binding.canonical_id) < 0)
    ) {
      bindings.set(key, { binding, score });
    }
  }

  return [...bindings.values()]
    .map((entry) => entry.binding)
    .sort((left, right) => {
      if (left.provider_id !== right.provider_id) {
        return left.provider_id.localeCompare(right.provider_id);
      }
      return left.model_id.localeCompare(right.model_id);
    });
}

function materializeCanonicalProjectedModel(input: {
  canonical: CatalogCanonicalModel;
  provider: CatalogProvider;
}): CatalogOverrideModel | null {
  const hint = findBuiltInModelHint(input.provider, input.canonical);
  const modelId = resolveProjectedModelId(input.canonical, hint);
  if (!modelId) return null;

  const modalities = inferProjectedModalities(input.canonical, hint);
  const endpoints = inferProjectedEndpoints(input.provider, input.canonical, modalities, hint);
  const capabilities = inferProjectedCapabilities(
    input.provider,
    input.canonical,
    modalities,
    hint,
    endpoints,
  );

  return {
    id: modelId,
    display_name: input.canonical.display_name || modelId,
    modalities,
    endpoints,
    capabilities,
    limits: projectedLimits(input.canonical, hint),
    pricing: input.canonical.pricing_reference
      ? cloneJson(input.canonical.pricing_reference)
      : undefined,
    enrichment: input.canonical.enrichment
      ? cloneJson(input.canonical.enrichment)
      : undefined,
    prompt_cache: hint?.prompt_cache ?? input.provider.prompt_cache,
    read_cache: hint?.read_cache ?? input.provider.read_cache,
    write_cache: hint?.write_cache ?? input.provider.write_cache,
    cache_metadata: hint?.cache_metadata || input.provider.cache_metadata,
  };
}

function findBuiltInModelHint(
  provider: CatalogProvider,
  canonical: CatalogCanonicalModel,
): CatalogModel | undefined {
  const keys = new Set<string>([
    ...projectionModelKeys(canonical),
    ...projectionAliasKeys(canonical),
  ]);
  if (keys.size === 0) return undefined;
  return provider.models.find((model) => keys.has(normalizeModelKey(model.id)));
}

function resolveProjectedModelId(
  canonical: CatalogCanonicalModel,
  hint?: CatalogModel,
): string | undefined {
  if (hint?.id) return hint.id;
  for (const candidate of [
    strippedProviderModelId(canonical.source_model_id),
    strippedProviderModelId(canonical.canonical_slug),
    strippedProviderModelId(canonical.canonical_id),
    ...(canonical.aliases || []).map((alias) => strippedProviderModelId(alias)),
  ]) {
    if (isProviderSafeModelId(candidate)) return candidate;
  }
  return undefined;
}

function inferProjectedModalities(
  canonical: CatalogCanonicalModel,
  hint?: CatalogModel,
): ProjectedModalities {
  const modalities = new Set<ProjectedModality>();
  for (const modality of hint?.modalities || []) {
    modalities.add(modality);
  }
  for (const modality of canonicalModalities(canonical)) {
    modalities.add(modality);
  }
  if (modalities.size === 0) modalities.add('text');
  return [...modalities];
}

function inferProjectedEndpoints(
  provider: CatalogProvider,
  canonical: CatalogCanonicalModel,
  modalities: ProjectedModalities,
  hint?: CatalogModel,
): ProjectedEndpoints {
  if (hint && Object.keys(hint.endpoints || {}).length > 0) {
    return { ...hint.endpoints };
  }

  const endpoints: ProjectedEndpoints = {};
  const inputModalities = new Set((canonical.input_modalities || []).map((value) => value.toLowerCase()));
  const outputModalities = new Set((canonical.output_modalities || []).map((value) => value.toLowerCase()));

  if (modalities.includes('embedding') && provider.endpoints.embeddings) {
    endpoints.embeddings = provider.endpoints.embeddings;
  }
  if (modalities.includes('rerank') && provider.endpoints.rerank) {
    endpoints.rerank = provider.endpoints.rerank;
  }
  if (modalities.includes('image')) {
    if (provider.endpoints.image) endpoints.image = provider.endpoints.image;
    if (provider.endpoints.image_edit) endpoints.image_edit = provider.endpoints.image_edit;
  }
  if (modalities.includes('video')) {
    if (provider.endpoints.video) endpoints.video = provider.endpoints.video;
    if (provider.endpoints.video_status) endpoints.video_status = provider.endpoints.video_status;
  }
  if (modalities.includes('audio')) {
    if (inputModalities.has('audio') && provider.endpoints.audio) {
      endpoints.audio = provider.endpoints.audio;
    } else if (outputModalities.has('audio') && provider.endpoints.audio_speech) {
      endpoints.audio_speech = provider.endpoints.audio_speech;
    } else if (provider.endpoints.audio && !provider.endpoints.audio_speech) {
      endpoints.audio = provider.endpoints.audio;
    } else if (provider.endpoints.audio_speech) {
      endpoints.audio_speech = provider.endpoints.audio_speech;
    }
  }
  if (modalities.includes('realtime') && provider.endpoints.realtime) {
    endpoints.realtime = provider.endpoints.realtime;
  }
  if (modalities.includes('text') || modalities.includes('vision')) {
    if (provider.endpoints.messages) endpoints.messages = provider.endpoints.messages;
    if (provider.endpoints.responses) endpoints.responses = provider.endpoints.responses;
    if (provider.endpoints.chat_completions) {
      endpoints.chat_completions = provider.endpoints.chat_completions;
    }
    if (provider.endpoints.batch && hint?.endpoints.batch) {
      endpoints.batch = provider.endpoints.batch;
    }
  }

  return endpoints;
}

function inferProjectedCapabilities(
  provider: CatalogProvider,
  canonical: CatalogCanonicalModel,
  modalities: ProjectedModalities,
  hint: CatalogModel | undefined,
  endpoints: ProjectedEndpoints,
): string[] {
  const capabilities = new Set<string>(hint?.capabilities || []);
  const parameters = new Set((canonical.supported_parameters || []).map((value) => value.toLowerCase()));

  if (provider.prompt_cache || hint?.prompt_cache) capabilities.add('prompt_cache');
  if (provider.read_cache || hint?.read_cache) capabilities.add('read_cache');
  if (provider.write_cache || hint?.write_cache) capabilities.add('write_cache');
  if (parameters.has('tools') || parameters.has('tool_choice')) capabilities.add('tools');
  if (
    parameters.has('response_format') ||
    parameters.has('structured_outputs') ||
    parameters.has('json_schema')
  ) {
    capabilities.add('structured_output');
  }
  if (parameters.has('reasoning') || parameters.has('include_reasoning')) {
    capabilities.add('reasoning');
  }
  if (modalities.includes('vision')) capabilities.add('vision');
  if (modalities.includes('embedding')) capabilities.add('embeddings');
  if (modalities.includes('rerank')) capabilities.add('rerank');
  if (modalities.includes('realtime')) capabilities.add('realtime');
  if (modalities.includes('image') && !modalities.includes('text') && !modalities.includes('vision')) {
    capabilities.add('image_generation');
  }
  if (modalities.includes('video') && !modalities.includes('text') && !modalities.includes('vision')) {
    capabilities.add('video_generation');
  }
  if (endpoints.audio_speech) capabilities.add('speech');
  if (endpoints.audio) capabilities.add('transcription');
  return [...capabilities].sort();
}

function projectedLimits(
  canonical: CatalogCanonicalModel,
  hint?: CatalogModel,
): CatalogOverrideModel['limits'] | undefined {
  const limits: NonNullable<CatalogOverrideModel['limits']> = {
    max_context_tokens:
      finitePositiveNumber(canonical.context_length) || hint?.limits?.max_context_tokens,
    dimensions: hint?.limits?.dimensions,
  };
  return Object.values(limits).some((value) => value !== undefined) ? limits : undefined;
}

function dedupeProjectedModels(models: CatalogOverrideModel[]): CatalogOverrideModel[] {
  const deduped = new Map<string, CatalogOverrideModel>();
  for (const model of models) {
    const current = deduped.get(model.id);
    if (!current) {
      deduped.set(model.id, model);
      continue;
    }
    deduped.set(model.id, mergeProjectedModels(current, model));
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeProjectedModels(
  current: CatalogOverrideModel,
  incoming: CatalogOverrideModel,
): CatalogOverrideModel {
  const preferred = projectionModelScore(incoming) >= projectionModelScore(current)
    ? incoming
    : current;
  const fallback = preferred === incoming ? current : incoming;
  const limits = {
    ...(fallback.limits || {}),
    ...(preferred.limits || {}),
  };
  if (
    typeof fallback.limits?.max_context_tokens === 'number' ||
    typeof preferred.limits?.max_context_tokens === 'number'
  ) {
    limits.max_context_tokens = Math.max(
      fallback.limits?.max_context_tokens || 0,
      preferred.limits?.max_context_tokens || 0,
    );
  }
  return {
    ...fallback,
    ...preferred,
    modalities: uniqueStrings([...(fallback.modalities || []), ...(preferred.modalities || [])]) as CatalogOverrideModel['modalities'],
    endpoints: { ...(fallback.endpoints || {}), ...(preferred.endpoints || {}) },
    capabilities: uniqueStrings([...(fallback.capabilities || []), ...(preferred.capabilities || [])]),
    limits: Object.values(limits).some((value) => value !== undefined) ? limits : undefined,
    pricing: preferred.pricing || fallback.pricing,
    enrichment: preferred.enrichment || fallback.enrichment,
    cache_metadata: preferred.cache_metadata || fallback.cache_metadata,
  };
}

function projectionModelScore(model: CatalogOverrideModel): number {
  const releaseDate = model.enrichment?.lifecycle?.release_date || model.enrichment?.release_date;
  const parsedRelease = releaseDate ? Date.parse(releaseDate) : Number.NaN;
  const priced = model.pricing ? 1_000_000 : 0;
  const context = typeof model.limits?.max_context_tokens === 'number'
    ? model.limits.max_context_tokens
    : 0;
  return (
    priced +
    (Number.isNaN(parsedRelease) ? 0 : parsedRelease / 1_000_000_000) +
    context +
    (model.capabilities?.length || 0) * 10 +
    (model.modalities?.length || 0)
  );
}

function projectionModelKeys(canonical: CatalogCanonicalModel): string[] {
  return uniqueStrings([
    normalizeModelKey(canonical.source_model_id),
    normalizeModelKey(strippedProviderModelId(canonical.source_model_id)),
    normalizeModelKey(canonical.canonical_slug),
    normalizeModelKey(strippedProviderModelId(canonical.canonical_slug)),
    normalizeModelKey(canonical.canonical_id),
    normalizeModelKey(strippedProviderModelId(canonical.canonical_id)),
  ]);
}

function projectionAliasKeys(canonical: CatalogCanonicalModel): string[] {
  return uniqueStrings(
    (canonical.aliases || []).flatMap((value) => [
      normalizeModelKey(value),
      normalizeModelKey(strippedProviderModelId(value)),
    ]),
  );
}

function canonicalModalities(canonical: CatalogCanonicalModel): ProjectedModalities {
  const mapped = [
    ...(canonical.input_modalities || []).flatMap((value): ProjectedModalities => {
      const normalized = value.toLowerCase();
      if (normalized === 'text' || normalized === 'file') return ['text'];
      if (normalized === 'image') return ['vision'];
      if (normalized === 'audio') return ['audio'];
      if (normalized === 'video') return ['video'];
      if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
      return [];
    }),
    ...(canonical.output_modalities || []).flatMap((value): ProjectedModalities => {
      const normalized = value.toLowerCase();
      if (normalized === 'text' || normalized === 'file') return ['text'];
      if (normalized === 'image') return ['image'];
      if (normalized === 'audio') return ['audio'];
      if (normalized === 'video') return ['video'];
      if (normalized === 'embedding' || normalized === 'embeddings') return ['embedding'];
      return [];
    }),
  ];
  return uniqueStrings(mapped) as ProjectedModalities;
}

function strippedProviderModelId(value: string | undefined | null): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed.includes('/')) return trimmed;
  return trimmed.split('/').slice(1).join('/');
}

function normalizeModelKey(value: string | undefined | null): string {
  if (!isNonEmptyString(value)) return '';
  return value.trim().toLowerCase();
}

function normalizeProviderKey(value: string | undefined | null): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value.trim().toLowerCase();
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProviderSafeModelId(value: string | undefined | null): value is string {
  return isNonEmptyString(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
