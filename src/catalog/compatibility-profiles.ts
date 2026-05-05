import type { SourceFormat } from '../canonical/canonical.types';
import type { NodeConfig } from '../config/gateway.config';
import type { Modality } from '../config/modality';
import { expandModalityAliases } from '../config/modality';
import type { CatalogProvider, ProviderCatalog } from './catalog.types';
import type {
  UsageSchema,
  UsageSchemaPath,
} from '../providers/usage-schema-resolver';

export type CompatibilityProfileId =
  | 'openai_compatible'
  | 'openai_responses_compatible'
  | 'anthropic_messages_compatible'
  | 'google_gemini_openai_compatible'
  | 'google_gemini_compatible'
  | 'google_vertex_compatible'
  | 'aws_bedrock_converse'
  | 'azure_openai_compatible'
  | 'huggingface_inference'
  | 'openrouter_aggregator'
  | 'cohere_compatible'
  | 'deepseek_compatible'
  | 'mistral_compatible'
  | 'local_ollama'
  | 'local_vllm'
  | 'local_tgi'
  | 'local_lmstudio'
  | 'local_sglang'
  | 'media_generation_sync'
  | 'media_generation_async'
  | 'speech_transcription'
  | 'speech_tts'
  | 'rerank_compatible'
  | 'embedding_compatible';

export type CompatibilityProtocolFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'aws_bedrock'
  | 'azure_openai'
  | 'huggingface'
  | 'aggregator'
  | 'cohere'
  | 'mistral'
  | 'local'
  | 'media'
  | 'speech'
  | 'rerank'
  | 'embedding';

export type CompatibilityRequestStyle =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini_generate_content'
  | 'vertex_predict'
  | 'bedrock_converse'
  | 'provider_native'
  | 'openai_compatible'
  | 'local_openai_compatible';

export type CompatibilityResponseStyle =
  | 'openai_chat'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'gemini'
  | 'operation'
  | 'provider_native'
  | 'openai_compatible';

export type CompatibilityStrategy =
  | 'native'
  | 'openai_compatible'
  | 'provider_specific'
  | 'passthrough'
  | 'translated'
  | 'unsupported';

export interface ProviderCompatibilityProfile {
  profile_id: CompatibilityProfileId;
  display_name: string;
  protocol_family: CompatibilityProtocolFamily;
  request_style: CompatibilityRequestStyle;
  response_style: CompatibilityResponseStyle;
  auth_strategy: string;
  endpoint_strategy: CompatibilityStrategy;
  streaming_strategy: CompatibilityStrategy;
  multipart_strategy: CompatibilityStrategy;
  async_job_strategy: CompatibilityStrategy;
  supported_source_formats: Array<SourceFormat | 'realtime'>;
  supported_modalities: Array<Modality | 'batch'>;
  passthrough_fields: string[];
  downgraded_fields: string[];
  unsupported_fields: string[];
  known_limitations: string[];
  usage_schema?: Partial<Record<SourceFormat | 'gemini_generate_content', UsageSchema>>;
}

export interface CompatibilityEvidenceInput {
  node?: Partial<NodeConfig> | null;
  provider?: CatalogProvider | null;
  catalog?: ProviderCatalog | null;
  sourceFormat?: string | null;
  requestedModality?: string | null;
  stream?: boolean | null;
  multipart?: boolean | null;
  selected?: boolean;
  eligible?: boolean;
}

export interface CompatibilityProfileEvidence {
  provider_id: string | null;
  compatibility_profile: string[];
  endpoint_strategy: string | null;
  protocol_strategy: string | null;
  passthrough_fields: string[];
  downgraded_fields: string[];
  unsupported_fields: string[];
  selected_reason: string;
  filtered_by_profile_reason: string | null;
}

const TEXT_SOURCES: Array<SourceFormat | 'realtime'> = [
  'chat_completions',
  'responses',
  'messages',
];

const OPENAI_FIELDS = [
  'metadata',
  'tools',
  'tool_choice',
  'response_format',
  'stream',
  'routing_hints',
  'reasoning_effort',
];

function profile(
  value: ProviderCompatibilityProfile,
): ProviderCompatibilityProfile {
  return value;
}

function path(pathValue: UsageSchemaPath): UsageSchemaPath {
  return Array.isArray(pathValue) ? [...pathValue] : pathValue;
}

function usageSchema(value: UsageSchema): UsageSchema {
  return {
    ...value,
    ...(value.input_tokens ? { input_tokens: path(value.input_tokens) } : {}),
    ...(value.input_tokens_parts
      ? { input_tokens_parts: [...value.input_tokens_parts] }
      : {}),
    ...(value.output_tokens ? { output_tokens: path(value.output_tokens) } : {}),
    ...(value.output_tokens_parts
      ? { output_tokens_parts: [...value.output_tokens_parts] }
      : {}),
    ...(value.total_tokens ? { total_tokens: path(value.total_tokens) } : {}),
    ...(value.cache_read_input_tokens
      ? { cache_read_input_tokens: path(value.cache_read_input_tokens) }
      : {}),
    ...(value.cache_creation_input_tokens
      ? { cache_creation_input_tokens: path(value.cache_creation_input_tokens) }
      : {}),
  };
}

function usageSchemaMap(
  value:
    | Partial<Record<SourceFormat | 'gemini_generate_content', UsageSchema>>
    | undefined,
): Partial<Record<SourceFormat | 'gemini_generate_content', UsageSchema>> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, schema]) => [key, usageSchema(schema)]),
  );
}

export const BUILTIN_COMPATIBILITY_PROFILES: ProviderCompatibilityProfile[] = [
  profile({
    profile_id: 'openai_compatible',
    display_name: 'OpenAI-compatible Chat Completions',
    protocol_family: 'openai',
    request_style: 'openai_chat',
    response_style: 'openai_chat',
    auth_strategy: 'bearer_or_provider_header',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'realtime', 'batch'],
    supported_modalities: ['text', 'vision', 'realtime', 'batch'],
    passthrough_fields: OPENAI_FIELDS,
    downgraded_fields: ['reasoning', 'thinking_config'],
    unsupported_fields: ['anthropic_thinking'],
    known_limitations: [
      'Provider-specific OpenAI-compatible gateways may ignore unsupported beta fields.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        // OpenAI Chat objects expose cache hits on
        // usage.prompt_tokens_details.cached_tokens. MiniMax's OpenAI-compatible
        // chat docs show the same usage.prompt_tokens / completion_tokens /
        // prompt_tokens_details.cached_tokens shape.
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'openai_responses_compatible',
    display_name: 'OpenAI-compatible Responses',
    protocol_family: 'openai',
    request_style: 'openai_responses',
    response_style: 'openai_responses',
    auth_strategy: 'bearer_or_provider_header',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['responses'],
    supported_modalities: ['text', 'vision'],
    passthrough_fields: [
      'metadata',
      'tools',
      'text',
      'reasoning',
      'stream',
      'routing_hints',
    ],
    downgraded_fields: ['reasoning_effort'],
    unsupported_fields: ['anthropic_thinking'],
    known_limitations: [
      'Responses-compatible providers often vary on tools, reasoning, and structured output details.',
    ],
    usage_schema: usageSchemaMap({
      responses: {
        // OpenAI prompt caching docs now document Response-object cache hits at
        // usage.prompt_tokens_details.cached_tokens. Keep the older
        // usage.input_token_details.cached_tokens as a compatibility fallback.
        input_tokens: 'usage.input_tokens',
        output_tokens: 'usage.output_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: [
          'usage.prompt_tokens_details.cached_tokens',
          'usage.input_token_details.cached_tokens',
        ],
      },
    }),
  }),
  profile({
    profile_id: 'anthropic_messages_compatible',
    display_name: 'Anthropic Messages-compatible',
    protocol_family: 'anthropic',
    request_style: 'anthropic_messages',
    response_style: 'anthropic_messages',
    auth_strategy: 'x-api-key_anthropic_version',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'translated',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'responses', 'messages'],
    supported_modalities: ['text', 'vision'],
    passthrough_fields: ['metadata', 'tools', 'tool_choice', 'thinking', 'stream'],
    downgraded_fields: ['response_format', 'reasoning_effort'],
    unsupported_fields: ['openai_responses_text_config'],
    known_limitations: [
      'OpenAI structured-output requests must be translated or handled by fallback policy.',
    ],
    usage_schema: usageSchemaMap({
      messages: {
        // Anthropic prompt caching docs expose usage.input_tokens,
        // usage.output_tokens, usage.cache_creation_input_tokens, and
        // usage.cache_read_input_tokens. MiniMax's Anthropic-compatible cache
        // docs show the same message usage object. For internal cost accounting
        // we normalize input_tokens to the total input volume by summing all
        // three input-side counters.
        input_tokens_parts: [
          'usage.input_tokens',
          'usage.cache_creation_input_tokens',
          'usage.cache_read_input_tokens',
        ],
        output_tokens: 'usage.output_tokens',
        cache_creation_input_tokens: 'usage.cache_creation_input_tokens',
        cache_read_input_tokens: 'usage.cache_read_input_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'google_gemini_openai_compatible',
    display_name: 'Google Gemini OpenAI-compatible',
    protocol_family: 'google',
    request_style: 'openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'bearer_or_query_key',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'vision', 'embedding'],
    passthrough_fields: OPENAI_FIELDS,
    downgraded_fields: ['reasoning', 'thinking_config'],
    unsupported_fields: ['anthropic_version'],
    known_limitations: [
      'The Gemini OpenAI compatibility surface follows OpenAI-style usage objects, while native Gemini keeps usageMetadata.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        // Google Gemini OpenAI compatibility uses the OpenAI Chat Completions
        // response shape, so cache hits follow usage.prompt_tokens_details.cached_tokens.
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'google_gemini_compatible',
    display_name: 'Google Gemini-compatible',
    protocol_family: 'google',
    request_style: 'gemini_generate_content',
    response_style: 'gemini',
    auth_strategy: 'bearer_or_query_key',
    endpoint_strategy: 'translated',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'translated',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['chat_completions', 'responses', 'embeddings', 'video_generation'],
    supported_modalities: ['text', 'vision', 'embedding', 'video'],
    passthrough_fields: ['metadata', 'thinking_config', 'stream'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['anthropic_version'],
    known_limitations: [
      'Gemini request/response shapes are translated; unsupported OpenAI fields stay in trace evidence.',
    ],
    usage_schema: usageSchemaMap({
      gemini_generate_content: {
        // Google GenerateContentResponse uses usageMetadata.promptTokenCount,
        // usageMetadata.cachedContentTokenCount, usageMetadata.candidatesTokenCount,
        // and usageMetadata.totalTokenCount.
        input_tokens: 'usageMetadata.promptTokenCount',
        output_tokens: 'usageMetadata.candidatesTokenCount',
        total_tokens: 'usageMetadata.totalTokenCount',
        cache_read_input_tokens: 'usageMetadata.cachedContentTokenCount',
      },
    }),
  }),
  profile({
    profile_id: 'google_vertex_compatible',
    display_name: 'Google Vertex-compatible',
    protocol_family: 'google',
    request_style: 'vertex_predict',
    response_style: 'operation',
    auth_strategy: 'bearer_google_cloud',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'translated',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['chat_completions', 'responses', 'embeddings', 'video_generation'],
    supported_modalities: ['text', 'vision', 'embedding', 'video'],
    passthrough_fields: ['metadata', 'thinking_config'],
    downgraded_fields: ['tools', 'response_format', 'stream'],
    unsupported_fields: ['anthropic_version'],
    known_limitations: [
      'Long-running operations require async job polling for video and some media endpoints.',
    ],
  }),
  profile({
    profile_id: 'aws_bedrock_converse',
    display_name: 'AWS Bedrock Converse',
    protocol_family: 'aws_bedrock',
    request_style: 'bedrock_converse',
    response_style: 'provider_native',
    auth_strategy: 'aws_sigv4_or_gateway_header',
    endpoint_strategy: 'translated',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'translated',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['chat_completions', 'messages', 'embeddings'],
    supported_modalities: ['text', 'vision', 'embedding'],
    passthrough_fields: ['metadata', 'tool_config'],
    downgraded_fields: ['reasoning_effort', 'response_format', 'stream'],
    unsupported_fields: ['openai_realtime'],
    known_limitations: [
      'Bedrock auth and model routing are provider-specific; SiftGate keeps HTTP adapters SDK-less.',
    ],
  }),
  profile({
    profile_id: 'azure_openai_compatible',
    display_name: 'Azure OpenAI-compatible',
    protocol_family: 'azure_openai',
    request_style: 'openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'api-key_header_or_bearer',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'responses', 'embeddings', 'image_generation'],
    supported_modalities: ['text', 'vision', 'embedding', 'image'],
    passthrough_fields: OPENAI_FIELDS,
    downgraded_fields: ['deployment_model_alias'],
    unsupported_fields: ['anthropic_thinking'],
    known_limitations: [
      'Azure deployment paths can differ from public OpenAI paths; endpoint validation warns rather than blocks.',
    ],
  }),
  profile({
    profile_id: 'huggingface_inference',
    display_name: 'Hugging Face Inference',
    protocol_family: 'huggingface',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'bearer',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'provider_specific',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['chat_completions', 'embeddings', 'image_generation', 'audio_transcription'],
    supported_modalities: ['text', 'vision', 'embedding', 'image', 'audio'],
    passthrough_fields: ['metadata', 'parameters'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['anthropic_messages_beta'],
    known_limitations: [
      'Inference provider support varies by selected backend and model task.',
    ],
  }),
  profile({
    profile_id: 'openrouter_aggregator',
    display_name: 'OpenRouter Aggregator',
    protocol_family: 'aggregator',
    request_style: 'openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'bearer_with_optional_app_headers',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'passthrough',
    async_job_strategy: 'passthrough',
    supported_source_formats: ['chat_completions', 'responses'],
    supported_modalities: ['text', 'vision'],
    passthrough_fields: [
      ...OPENAI_FIELDS,
      'provider',
      'models',
      'transforms',
    ],
    downgraded_fields: ['reasoning', 'thinking_config'],
    unsupported_fields: [],
    known_limitations: [
      'Downstream provider behavior can differ by routed model; safe probes only validate aggregator auth/endpoint.',
    ],
  }),
  profile({
    profile_id: 'cohere_compatible',
    display_name: 'Cohere-compatible',
    protocol_family: 'cohere',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'bearer',
    endpoint_strategy: 'translated',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'rerank', 'embeddings'],
    supported_modalities: ['text', 'rerank', 'embedding'],
    passthrough_fields: ['metadata', 'documents'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['image_input'],
    known_limitations: [
      'Cohere rerank and embedding endpoints use provider-specific request shapes.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        // Cohere v2 chat responses nest token counters under usage. The
        // official docs show usage.billed_units.input_tokens /
        // usage.billed_units.output_tokens, usage.tokens.input_tokens /
        // usage.tokens.output_tokens, and usage.cached_tokens.
        input_tokens: [
          'usage.billed_units.input_tokens',
          'usage.tokens.input_tokens',
        ],
        output_tokens: [
          'usage.billed_units.output_tokens',
          'usage.tokens.output_tokens',
        ],
        cache_read_input_tokens: 'usage.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'deepseek_compatible',
    display_name: 'DeepSeek OpenAI-compatible',
    protocol_family: 'openai',
    request_style: 'openai_chat',
    response_style: 'openai_chat',
    auth_strategy: 'bearer_or_provider_header',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions'],
    supported_modalities: ['text'],
    passthrough_fields: OPENAI_FIELDS,
    downgraded_fields: ['reasoning', 'thinking_config'],
    unsupported_fields: ['anthropic_thinking'],
    known_limitations: [
      'DeepSeek exposes dedicated cache hit/miss counters under usage instead of OpenAI prompt_tokens_details.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        // DeepSeek context caching docs add usage.prompt_cache_hit_tokens and
        // usage.prompt_cache_miss_tokens. Use prompt_tokens when present, and
        // fall back to the hit+miss split when only the dedicated counters exist.
        input_tokens: ['usage.prompt_tokens', 'usage.input_tokens'],
        input_tokens_parts: [
          'usage.prompt_cache_hit_tokens',
          'usage.prompt_cache_miss_tokens',
        ],
        output_tokens: ['usage.completion_tokens', 'usage.output_tokens'],
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_cache_hit_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'mistral_compatible',
    display_name: 'Mistral-compatible',
    protocol_family: 'mistral',
    request_style: 'openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'bearer',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'translated',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'vision', 'embedding'],
    passthrough_fields: ['metadata', 'tools', 'tool_choice', 'stream'],
    downgraded_fields: ['reasoning_effort', 'response_format'],
    unsupported_fields: ['anthropic_thinking'],
    known_limitations: [
      'Mistral-compatible providers may expose vision and OCR fields outside OpenAI shape.',
    ],
  }),
  profile({
    profile_id: 'local_ollama',
    display_name: 'Local Ollama',
    protocol_family: 'local',
    request_style: 'local_openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'none_or_bearer',
    endpoint_strategy: 'translated',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'translated',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'vision', 'embedding'],
    passthrough_fields: ['metadata', 'options', 'stream'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['managed_batch', 'realtime'],
    known_limitations: [
      'Local model capabilities depend on the pulled model and server version.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'local_vllm',
    display_name: 'Local vLLM OpenAI-compatible',
    protocol_family: 'local',
    request_style: 'local_openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'none_or_bearer',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'embedding'],
    passthrough_fields: ['metadata', 'guided_json', 'extra_body', 'stream'],
    downgraded_fields: ['tools', 'reasoning_effort'],
    unsupported_fields: ['provider_media_generation'],
    known_limitations: [
      'Structured output and tool-call behavior depend on the vLLM engine configuration.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'local_tgi',
    display_name: 'Local Text Generation Inference',
    protocol_family: 'local',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'none_or_bearer',
    endpoint_strategy: 'translated',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions'],
    supported_modalities: ['text'],
    passthrough_fields: ['parameters', 'stream'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['vision', 'managed_batch'],
    known_limitations: [
      'TGI exposes generation parameters through provider-native fields.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'local_lmstudio',
    display_name: 'Local LM Studio OpenAI-compatible',
    protocol_family: 'local',
    request_style: 'local_openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'none_or_bearer',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'embedding'],
    passthrough_fields: ['metadata', 'stream'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['managed_batch', 'realtime'],
    known_limitations: [
      'LM Studio compatibility depends on the loaded model and local server mode.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'local_sglang',
    display_name: 'Local SGLang OpenAI-compatible',
    protocol_family: 'local',
    request_style: 'local_openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'none_or_bearer',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'openai_compatible',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['chat_completions', 'embeddings'],
    supported_modalities: ['text', 'embedding'],
    passthrough_fields: ['metadata', 'stream'],
    downgraded_fields: ['tools', 'response_format', 'reasoning_effort'],
    unsupported_fields: ['managed_batch', 'realtime'],
    known_limitations: [
      'SGLang usage fields follow its OpenAI-compatible gateway surface when enabled.',
    ],
    usage_schema: usageSchemaMap({
      chat_completions: {
        input_tokens: 'usage.prompt_tokens',
        output_tokens: 'usage.completion_tokens',
        total_tokens: 'usage.total_tokens',
        cache_read_input_tokens: 'usage.prompt_tokens_details.cached_tokens',
      },
    }),
  }),
  profile({
    profile_id: 'media_generation_sync',
    display_name: 'Synchronous media generation',
    protocol_family: 'media',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'unsupported',
    multipart_strategy: 'provider_specific',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['image_generation', 'image_edit', 'image_variation'],
    supported_modalities: ['image'],
    passthrough_fields: ['metadata', 'size', 'quality', 'response_format'],
    downgraded_fields: ['stream'],
    unsupported_fields: ['video_polling'],
    known_limitations: [
      'Variations and edits may be passthrough-only for providers without native support.',
    ],
  }),
  profile({
    profile_id: 'media_generation_async',
    display_name: 'Async media/video generation',
    protocol_family: 'media',
    request_style: 'provider_native',
    response_style: 'operation',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'unsupported',
    multipart_strategy: 'provider_specific',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['image_generation', 'video_generation'],
    supported_modalities: ['image', 'video'],
    passthrough_fields: ['metadata', 'duration', 'size', 'aspect_ratio', 'quality'],
    downgraded_fields: ['stream', 'response_format'],
    unsupported_fields: ['synchronous_video_bytes'],
    known_limitations: [
      'Video generation is always modeled as an async job in SiftGate.',
    ],
  }),
  profile({
    profile_id: 'speech_transcription',
    display_name: 'Speech transcription/translation',
    protocol_family: 'speech',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'provider_specific',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['audio_transcription', 'audio_translation'],
    supported_modalities: ['audio'],
    passthrough_fields: ['metadata', 'language', 'timestamp_granularities', 'response_format'],
    downgraded_fields: ['stream'],
    unsupported_fields: ['image_input'],
    known_limitations: [
      'Long audio providers may require async job adapters or endpoint probes only.',
    ],
  }),
  profile({
    profile_id: 'speech_tts',
    display_name: 'Speech text-to-speech',
    protocol_family: 'speech',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'provider_specific',
    streaming_strategy: 'provider_specific',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'provider_specific',
    supported_source_formats: ['audio_speech'],
    supported_modalities: ['audio'],
    passthrough_fields: ['metadata', 'voice', 'format', 'speed', 'response_format'],
    downgraded_fields: ['stream'],
    unsupported_fields: ['audio_file_input'],
    known_limitations: [
      'Output audio formats and voices are provider-specific.',
    ],
  }),
  profile({
    profile_id: 'rerank_compatible',
    display_name: 'Rerank-compatible',
    protocol_family: 'rerank',
    request_style: 'provider_native',
    response_style: 'provider_native',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'translated',
    streaming_strategy: 'unsupported',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['rerank'],
    supported_modalities: ['rerank'],
    passthrough_fields: ['metadata', 'documents', 'top_n'],
    downgraded_fields: ['return_documents'],
    unsupported_fields: ['stream'],
    known_limitations: [
      'Rerank scoring fields differ by provider and are normalized conservatively.',
    ],
  }),
  profile({
    profile_id: 'embedding_compatible',
    display_name: 'Embedding-compatible',
    protocol_family: 'embedding',
    request_style: 'openai_compatible',
    response_style: 'openai_compatible',
    auth_strategy: 'provider_header',
    endpoint_strategy: 'openai_compatible',
    streaming_strategy: 'unsupported',
    multipart_strategy: 'unsupported',
    async_job_strategy: 'unsupported',
    supported_source_formats: ['embeddings'],
    supported_modalities: ['embedding'],
    passthrough_fields: ['metadata', 'dimensions', 'encoding_format'],
    downgraded_fields: ['batch_size_hint'],
    unsupported_fields: ['stream'],
    known_limitations: [
      'Embedding dimensions are validated when a model explicitly advertises supported dimensions.',
    ],
  }),
];

const PROFILE_BY_ID = new Map(
  BUILTIN_COMPATIBILITY_PROFILES.map((profile) => [profile.profile_id, profile]),
);

const PROVIDER_PROFILE_OVERRIDES: Record<string, CompatibilityProfileId[]> = {
  openai: [
    'openai_compatible',
    'openai_responses_compatible',
    'embedding_compatible',
    'media_generation_sync',
    'speech_transcription',
    'speech_tts',
  ],
  anthropic: ['anthropic_messages_compatible'],
  google: [
    'google_gemini_openai_compatible',
    'google_gemini_compatible',
    'google_vertex_compatible',
    'embedding_compatible',
    'media_generation_async',
  ],
  'azure-openai': ['azure_openai_compatible', 'embedding_compatible', 'media_generation_sync'],
  openrouter: ['openrouter_aggregator'],
  cohere: ['cohere_compatible', 'rerank_compatible', 'embedding_compatible'],
  deepseek: ['deepseek_compatible'],
  mistral: ['mistral_compatible', 'embedding_compatible'],
  ollama: ['local_ollama', 'embedding_compatible'],
  vllm: ['local_vllm', 'embedding_compatible'],
  'huggingface-tgi': ['local_tgi'],
  'lm-studio': ['local_lmstudio', 'embedding_compatible'],
  sglang: ['local_sglang', 'embedding_compatible'],
  'aws-bedrock': ['aws_bedrock_converse', 'embedding_compatible'],
  voyage: ['embedding_compatible'],
  jina: ['embedding_compatible', 'rerank_compatible'],
  replicate: ['media_generation_async'],
};

const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
  'alibaba-qwen',
  'baidu-qianfan',
  'volcengine-ark',
  'zhipu',
  'moonshot',
  'minimax',
  'tencent-hunyuan',
  '01ai',
  'perplexity',
  'nvidia-nim',
  'cerebras',
  'sambanova',
  'deepseek',
  'xai',
  'groq',
  'together',
  'fireworks',
  'openai-compatible',
]);

export function listCompatibilityProfiles(): ProviderCompatibilityProfile[] {
  return BUILTIN_COMPATIBILITY_PROFILES.map((profile) => ({
    ...profile,
    supported_source_formats: [...profile.supported_source_formats],
    supported_modalities: [...profile.supported_modalities],
    passthrough_fields: [...profile.passthrough_fields],
    downgraded_fields: [...profile.downgraded_fields],
    unsupported_fields: [...profile.unsupported_fields],
    known_limitations: [...profile.known_limitations],
    usage_schema: usageSchemaMap(profile.usage_schema),
  }));
}

export function getCompatibilityProfile(
  id: string | undefined,
): ProviderCompatibilityProfile | undefined {
  return id ? PROFILE_BY_ID.get(id as CompatibilityProfileId) : undefined;
}

export function isCompatibilityProfileId(value: string): value is CompatibilityProfileId {
  return PROFILE_BY_ID.has(value as CompatibilityProfileId);
}

export function normalizeCompatibilityProfileIds(
  value: string | string[] | undefined,
): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  return typeof value === 'string' && value.trim()
    ? [value.trim()]
    : [];
}

export function inferCatalogCompatibilityProfiles(
  provider: Pick<CatalogProvider, 'id' | 'endpoints' | 'capabilities' | 'models' | 'base_url'>,
): CompatibilityProfileId[] {
  const ids = new Set<CompatibilityProfileId>();
  const override = PROVIDER_PROFILE_OVERRIDES[provider.id];
  if (override) {
    override.forEach((id) => ids.add(id));
  }
  if (OPENAI_COMPATIBLE_PROVIDER_IDS.has(provider.id)) {
    ids.add('openai_compatible');
  }

  const endpointKeys = new Set(Object.keys(provider.endpoints || {}));
  const capabilities = new Set((provider.capabilities || []).map((capability) => capability.toLowerCase()));
  const allModalities = new Set(
    (provider.models || []).flatMap((model) => (model.modalities || []).map(String)),
  );

  if (endpointKeys.has('chat_completions')) ids.add('openai_compatible');
  if (endpointKeys.has('responses')) ids.add('openai_responses_compatible');
  if (endpointKeys.has('messages')) ids.add('anthropic_messages_compatible');
  if (endpointKeys.has('embeddings') || allModalities.has('embedding')) ids.add('embedding_compatible');
  if (endpointKeys.has('rerank') || allModalities.has('rerank')) ids.add('rerank_compatible');
  if (endpointKeys.has('image') || endpointKeys.has('image_edit') || allModalities.has('image')) {
    ids.add('media_generation_sync');
  }
  if (endpointKeys.has('video') || allModalities.has('video')) {
    ids.add('media_generation_async');
  }
  if (
    endpointKeys.has('audio') ||
    endpointKeys.has('audio_translation') ||
    endpointKeys.has('audio_transcriptions') ||
    endpointKeys.has('audio_translations')
  ) {
    ids.add('speech_transcription');
  }
  if (endpointKeys.has('audio_speech') || capabilities.has('tts')) {
    ids.add('speech_tts');
  }

  if (ids.size === 0) {
    ids.add('openai_compatible');
  }
  return Array.from(ids);
}

export function findCatalogProviderForNode(
  catalog: ProviderCatalog | undefined | null,
  node: Pick<NodeConfig, 'id' | 'base_url'> | Partial<NodeConfig> | undefined | null,
): CatalogProvider | undefined {
  if (!catalog || !node) return undefined;
  const nodeId = typeof node.id === 'string' ? node.id : '';
  const baseUrl = typeof node.base_url === 'string'
    ? normalizeComparableUrl(node.base_url)
    : '';
  return catalog.providers.find((provider) => {
    if (provider.id === nodeId) return true;
    return baseUrl.length > 0 && normalizeComparableUrl(provider.base_url) === baseUrl;
  });
}

export function resolveNodeCompatibilityProfiles(
  node: Partial<NodeConfig> | undefined | null,
  catalog?: ProviderCatalog | null,
): ProviderCompatibilityProfile[] {
  const provider = findCatalogProviderForNode(catalog, node);
  const explicit = normalizeCompatibilityProfileIds(node?.compatibility_profile);
  const providerIds = normalizeCompatibilityProfileIds(
    provider?.compatibility_profiles,
  );
  const inferred = node
    ? inferNodeCompatibilityProfileIds(node, provider)
    : [];
  const ids = uniqueStrings([
    ...(explicit.length > 0 ? explicit : providerIds.length > 0 ? providerIds : inferred),
  ]);
  return ids
    .map((id) => getCompatibilityProfile(id))
    .filter((profile): profile is ProviderCompatibilityProfile => Boolean(profile));
}

export function resolveNodeCompatibilityProfileIds(
  node: Partial<NodeConfig> | undefined | null,
  catalog?: ProviderCatalog | null,
): string[] {
  return resolveNodeCompatibilityProfiles(node, catalog).map(
    (profile) => profile.profile_id,
  );
}

export function resolveNodeUsageSchema(
  node: Partial<NodeConfig> | undefined | null,
  protocol: NodeConfig['protocol'],
  catalog?: ProviderCatalog | null,
): UsageSchema | undefined {
  const key = protocolToUsageSchemaKey(protocol);
  if (!key) return undefined;

  for (const profile of resolveNodeCompatibilityProfiles(node, catalog)) {
    const schema = profile.usage_schema?.[key];
    if (schema) {
      return usageSchema(schema);
    }
  }

  return undefined;
}

export function compatibilityProfileSupportsSourceFormat(
  profile: ProviderCompatibilityProfile,
  sourceFormat: string | null | undefined,
): boolean {
  if (!sourceFormat) return true;
  const normalized = sourceFormat === 'chat' ? 'chat_completions' : sourceFormat;
  if (normalized === 'images') {
    return ['image_generation', 'image_edit', 'image_variation'].some((format) =>
      profile.supported_source_formats.includes(format as SourceFormat),
    );
  }
  if (normalized === 'audio') {
    return ['audio_transcription', 'audio_translation', 'audio_speech'].some((format) =>
      profile.supported_source_formats.includes(format as SourceFormat),
    );
  }
  if (normalized === 'video') {
    return profile.supported_source_formats.includes('video_generation');
  }
  return profile.supported_source_formats.includes(normalized as SourceFormat);
}

export function compatibilityProfileSupportsModality(
  profile: ProviderCompatibilityProfile,
  modality: string | null | undefined,
): boolean {
  if (!modality) return true;
  if (modality === 'batch') {
    return profile.supported_modalities.includes('batch');
  }
  const supported = expandModalityAliases(
    profile.supported_modalities.filter((item): item is Modality => item !== 'batch'),
  );
  return supported.has(modality as Modality);
}

export function compatibilityEvidence(
  input: CompatibilityEvidenceInput,
): CompatibilityProfileEvidence {
  const provider = input.provider || findCatalogProviderForNode(input.catalog, input.node);
  const profiles = resolveNodeCompatibilityProfiles(input.node, input.catalog);
  const filteredByProfileReason = compatibilityFilteredReason({
    profiles,
    sourceFormat: input.sourceFormat,
    requestedModality: input.requestedModality,
    stream: input.stream,
    multipart: input.multipart,
  });
  const profileIds = profiles.map((profile) => profile.profile_id);
  const selectedReason = filteredByProfileReason
    ? 'profile_filtered'
    : input.selected
      ? 'profile_supported_selected'
      : input.eligible === false
        ? 'profile_not_selected'
        : 'profile_supported_candidate';

  return {
    provider_id: provider?.id || input.node?.id || null,
    compatibility_profile: profileIds,
    endpoint_strategy: joinStrategies(profiles.map((profile) => profile.endpoint_strategy)),
    protocol_strategy: joinStrategies(
      profiles.map((profile) => `${profile.protocol_family}:${profile.request_style}`),
    ),
    passthrough_fields: uniqueStrings(profiles.flatMap((profile) => profile.passthrough_fields)),
    downgraded_fields: uniqueStrings(profiles.flatMap((profile) => profile.downgraded_fields)),
    unsupported_fields: uniqueStrings(profiles.flatMap((profile) => profile.unsupported_fields)),
    selected_reason: selectedReason,
    filtered_by_profile_reason: filteredByProfileReason,
  };
}

export function compatibilityFilteredReason(input: {
  profiles: ProviderCompatibilityProfile[];
  sourceFormat?: string | null;
  requestedModality?: string | null;
  stream?: boolean | null;
  multipart?: boolean | null;
}): string | null {
  if (input.profiles.length === 0) return 'compatibility_profile_missing';
  if (
    input.sourceFormat &&
    !input.profiles.some((profile) =>
      compatibilityProfileSupportsSourceFormat(profile, input.sourceFormat),
    )
  ) {
    return `compatibility_profile_unsupported_source_format:${input.sourceFormat}`;
  }
  if (
    input.requestedModality &&
    !input.profiles.some((profile) =>
      compatibilityProfileSupportsModality(profile, input.requestedModality),
    )
  ) {
    return `compatibility_profile_unsupported_modality:${input.requestedModality}`;
  }
  if (
    input.stream &&
    !input.profiles.some((profile) => profile.streaming_strategy !== 'unsupported')
  ) {
    return 'compatibility_profile_streaming_unsupported';
  }
  if (
    input.multipart &&
    !input.profiles.some((profile) => profile.multipart_strategy !== 'unsupported')
  ) {
    return 'compatibility_profile_multipart_unsupported';
  }
  return null;
}

export function compatibilityCapabilityConfigured(
  profiles: ProviderCompatibilityProfile[],
  capability: string,
): boolean {
  const sourceFormat = capabilityToSourceFormat(capability);
  const modality = capabilityToModality(capability);
  if (sourceFormat) {
    return profiles.some((profile) =>
      compatibilityProfileSupportsSourceFormat(profile, sourceFormat),
    );
  }
  return profiles.some((profile) =>
    compatibilityProfileSupportsModality(profile, modality),
  );
}

export function capabilityToSourceFormat(capability: string): string | null {
  switch (capability) {
    case 'chat':
      return 'chat_completions';
    case 'responses':
      return 'responses';
    case 'messages':
      return 'messages';
    case 'embeddings':
      return 'embeddings';
    case 'rerank':
      return 'rerank';
    case 'images':
      return 'image_generation';
    case 'audio':
      return 'audio_transcription';
    case 'video':
      return 'video_generation';
    case 'realtime':
      return 'realtime';
    case 'batch':
      return 'batch';
    default:
      return null;
  }
}

export function capabilityToModality(capability: string): string | null {
  switch (capability) {
    case 'embeddings':
      return 'embedding';
    case 'rerank':
      return 'rerank';
    case 'images':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'realtime':
      return 'realtime';
    case 'batch':
      return 'batch';
    default:
      return 'text';
  }
}

function inferNodeCompatibilityProfileIds(
  node: Partial<NodeConfig>,
  provider?: CatalogProvider,
): CompatibilityProfileId[] {
  if (provider) return inferCatalogCompatibilityProfiles(provider);
  const ids = new Set<CompatibilityProfileId>();
  const nodeId = String(node.id || '').toLowerCase();
  const baseUrl = String(node.base_url || '').toLowerCase();

  if (nodeId.includes('ollama') || baseUrl.includes('11434')) ids.add('local_ollama');
  if (nodeId.includes('vllm') || baseUrl.includes('vllm')) ids.add('local_vllm');
  if (nodeId.includes('tgi') || baseUrl.includes('text-generation-inference')) ids.add('local_tgi');
  if (nodeId.includes('lmstudio') || baseUrl.includes('1234')) ids.add('local_lmstudio');
  if (node.protocol === 'messages') ids.add('anthropic_messages_compatible');
  if (node.protocol === 'responses') ids.add('openai_responses_compatible');
  if (node.protocol === 'chat_completions') ids.add('openai_compatible');
  if (node.embedding_models?.length || node.embeddings_endpoint) ids.add('embedding_compatible');
  if (node.rerank_models?.length || node.rerank_endpoint) ids.add('rerank_compatible');
  if (node.image_models?.length || node.images_generations_endpoint || node.images_edits_endpoint) {
    ids.add('media_generation_sync');
  }
  if (node.video_models?.length || node.video_endpoint || node.video_generations_endpoint) {
    ids.add('media_generation_async');
  }
  if (node.audio_models?.length || node.audio_transcriptions_endpoint || node.audio_translations_endpoint) {
    ids.add('speech_transcription');
  }
  if (node.audio_speech_endpoint) ids.add('speech_tts');
  if (ids.size === 0) ids.add('openai_compatible');
  return Array.from(ids);
}

function protocolToUsageSchemaKey(
  protocol: NodeConfig['protocol'],
): SourceFormat | 'gemini_generate_content' | null {
  switch (protocol) {
    case 'chat_completions':
      return 'chat_completions';
    case 'responses':
      return 'responses';
    case 'messages':
      return 'messages';
    default:
      return null;
  }
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function uniqueStrings(values: readonly unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  );
}

function joinStrategies(values: readonly string[]): string | null {
  const unique = uniqueStrings(values);
  return unique.length > 0 ? unique.join(', ') : null;
}
