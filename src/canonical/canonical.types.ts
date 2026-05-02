// ===================================================================
// SiftGate — Canonical Internal Format
// ===================================================================
// All three API protocols (chat/completions, responses, messages)
// are normalized into this unified format for internal processing.
// ===================================================================

// ===== Roles =====
export type CanonicalRole = 'system' | 'user' | 'assistant' | 'tool';

// ===== Content Blocks =====
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data: string;
  };
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | CanonicalContentBlock[];
}

export type CanonicalContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock;

// ===== Messages =====
export interface CanonicalMessage {
  role: CanonicalRole;
  content: string | CanonicalContentBlock[];
}

// ===== Tool Definitions =====
export interface CanonicalTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// ===== Tool Choice =====
export type CanonicalToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { name: string };

// ===== Source Format =====
export type SourceFormat = 'chat_completions' | 'responses' | 'messages' | 'embeddings';

// ===== Structured Output =====
export type StructuredOutputFormatType =
  | 'text'
  | 'json_object'
  | 'json_schema'
  | 'unknown';

export type StructuredOutputSource =
  | 'chat_completions.response_format'
  | 'responses.text.format'
  | 'messages.output_config.format'
  | 'messages.output_format'
  | 'canonical';

export type StructuredOutputStrategy =
  | 'native'
  | 'passthrough'
  | 'downgraded'
  | 'none';

export interface CanonicalJsonSchemaFormat {
  name?: string;
  description?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface CanonicalResponseFormat {
  type: StructuredOutputFormatType;
  source: StructuredOutputSource;
  raw: unknown;
  json_schema?: CanonicalJsonSchemaFormat;
}

export interface CanonicalStructuredOutput {
  requested: boolean;
  type: StructuredOutputFormatType;
  source: StructuredOutputSource;
  name?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

// ===== Shared Request Metadata =====
export interface CanonicalRequestMetadata {
  source_format: SourceFormat;
  original_model?: string;
  session_key?: string;
  raw_headers: Record<string, string>;
  raw_body?: unknown;
  api_key_name?: string;
  api_key_id?: string;
  namespace_id?: string | null;
  namespace_name?: string | null;
  api_key_permissions?: {
    allow_auto: boolean;
    allow_direct: boolean;
    allowed_nodes: string[];
    allowed_models: string[];
  };
}

// ===== Request =====
export interface CanonicalRequest {
  messages: CanonicalMessage[];
  tools?: CanonicalTool[];
  tool_choice?: CanonicalToolChoice;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  response_format?: CanonicalResponseFormat;
  structured_output?: CanonicalStructuredOutput;
  stream: boolean;

  /** Original request metadata, preserved for response denormalization */
  metadata: CanonicalRequestMetadata;
}

// ===== Stop Reason =====
export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence';

// ===== Tier =====
export type Tier = 'simple' | 'standard' | 'complex' | 'reasoning' | 'direct' | 'cached';

// ===== Response =====
export interface CanonicalResponse {
  id: string;
  content: CanonicalContentBlock[];
  stop_reason: StopReason;
  usage: TokenUsage;
  model: string;

  /** Routing metadata for logging / observability */
  routing: {
    tier: Tier;
    node: string;
    latency_ms: number;
    score: number;
    is_fallback: boolean;
    fallback_reason?: string | null;
  };
}

// ===== Embeddings =====
export type CanonicalEmbeddingInput =
  | string
  | string[]
  | number[]
  | number[][];

export interface CanonicalEmbeddingRequest {
  model: string;
  input: CanonicalEmbeddingInput | unknown;
  dimensions?: number;
  encoding_format?: string;
  user?: string;
  metadata: CanonicalRequestMetadata;
}

export interface CanonicalEmbedding {
  index: number;
  embedding: number[] | string;
}

export interface CanonicalEmbeddingResponse {
  id: string;
  object: 'list';
  data: CanonicalEmbedding[];
  usage: TokenUsage;
  model: string;
  routing: {
    tier: Tier;
    node: string;
    latency_ms: number;
    score: number;
    is_fallback: boolean;
    fallback_reason?: string | null;
  };
}

// ===== Token Usage =====
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;  // Anthropic: tokens written to cache
  cache_read_input_tokens?: number;      // Anthropic: cache read; OpenAI: cached_tokens
}

// ===== Stream Events =====
export interface StreamStartEvent {
  type: 'start';
  id: string;
  model: string;
}

export interface StreamTextDelta {
  type: 'text';
  text: string;
}

export interface StreamToolUseDelta {
  type: 'tool_use';
  id: string;
  name?: string;
  input_delta?: string;
}

export interface StreamDeltaEvent {
  type: 'delta';
  content: StreamTextDelta | StreamToolUseDelta;
}

export interface StreamStopEvent {
  type: 'stop';
  stop_reason: string;
  usage: TokenUsage;
}

export interface StreamErrorEvent {
  type: 'error';
  error: {
    message: string;
    code?: string;
  };
}

export type CanonicalStreamEvent =
  | StreamStartEvent
  | StreamDeltaEvent
  | StreamStopEvent
  | StreamErrorEvent;

// ===== Normalizer / Denormalizer Interfaces =====

/** Converts protocol-specific input → CanonicalRequest */
export interface Normalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalRequest;
}

/** Converts CanonicalRequest → protocol-specific request body for a provider */
export interface RequestDenormalizer {
  denormalize(
    canonical: CanonicalRequest,
    targetModel: string,
  ): Record<string, unknown>;
}

/** Converts CanonicalResponse → protocol-specific response body for the client */
export interface ResponseDenormalizer {
  denormalize(
    canonical: CanonicalResponse,
    sourceFormat: SourceFormat,
  ): Record<string, unknown>;
}
