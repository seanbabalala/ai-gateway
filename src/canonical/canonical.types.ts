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
export type SourceFormat = 'chat_completions' | 'responses' | 'messages';

// ===== Request =====
export interface CanonicalRequest {
  messages: CanonicalMessage[];
  tools?: CanonicalTool[];
  tool_choice?: CanonicalToolChoice;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;

  /** Original request metadata, preserved for response denormalization */
  metadata: {
    source_format: SourceFormat;
    original_model?: string;
    session_key?: string;
    raw_headers: Record<string, string>;
    raw_body?: unknown;
    api_key_name?: string;
    api_key_id?: string;
    api_key_permissions?: {
      allow_auto: boolean;
      allow_direct: boolean;
      allowed_nodes: string[];
      allowed_models: string[];
    };
  };
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
