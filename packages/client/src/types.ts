export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type RoutingHintValue = string | number | boolean | null;

export interface RoutingHint {
  tier?: string;
  node?: string;
  model?: string;
  optimization?: "cost" | "latency" | "balanced" | "quality";
  [key: string]: RoutingHintValue | undefined;
}

export type SiftGateRoutingHint = string | RoutingHint;

export interface SiftGateClientOptions {
  baseUrl?: string;
  gatewayApiKey?: string;
  headers?: Record<string, string>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface SiftGateRequestOptions {
  headers?: Record<string, string>;
  routingHint?: SiftGateRoutingHint;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SiftGateErrorDetails {
  status: number;
  statusText: string;
  body: unknown;
  requestId?: string;
}

export type ChatContentPart =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "image_url"; image_url: unknown; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

export interface ChatMessage {
  role:
    | "system"
    | "developer"
    | "user"
    | "assistant"
    | "tool"
    | "function"
    | string;
  content?: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface ResponseFormatJsonSchema {
  type: "json_schema";
  json_schema?: {
    name?: string;
    schema?: unknown;
    strict?: boolean;
    description?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ResponseFormat =
  | { type: "text"; [key: string]: unknown }
  | { type: "json_object"; [key: string]: unknown }
  | ResponseFormatJsonSchema
  | { type: string; [key: string]: unknown };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  response_format?: ResponseFormat;
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: unknown[];
  usage?: unknown;
  [key: string]: unknown;
}

export type ResponsesInput =
  | string
  | Array<{
      role?: string;
      content?: unknown;
      [key: string]: unknown;
    }>;

export interface ResponsesTextFormat {
  type?: "text" | "json_object" | "json_schema" | string;
  name?: string;
  schema?: unknown;
  strict?: boolean;
  [key: string]: unknown;
}

export interface ResponsesRequest {
  model: string;
  input: ResponsesInput;
  instructions?: string;
  stream?: boolean;
  text?: {
    format?: ResponsesTextFormat;
    [key: string]: unknown;
  };
  max_output_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface ResponsesResponse {
  id?: string;
  object?: string;
  model?: string;
  output?: unknown[];
  output_text?: string;
  usage?: unknown;
  [key: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant" | string;
  content: string | unknown[];
  [key: string]: unknown;
}

export interface MessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  system?: string | unknown[];
  stream?: boolean;
  temperature?: number;
  [key: string]: unknown;
}

export interface MessagesResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: unknown[];
  stop_reason?: string | null;
  usage?: unknown;
  [key: string]: unknown;
}

export type EmbeddingInput =
  | string
  | string[]
  | number[]
  | number[][]
  | Array<string | number[]>;

export interface EmbeddingsRequest {
  model: string;
  input: EmbeddingInput;
  dimensions?: number;
  encoding_format?: "float" | "base64" | string;
  user?: string;
  [key: string]: unknown;
}

export interface EmbeddingData {
  object?: "embedding" | string;
  embedding: number[] | string;
  index: number;
  [key: string]: unknown;
}

export interface EmbeddingsResponse {
  object?: "list" | string;
  data: EmbeddingData[];
  model?: string;
  usage?: unknown;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  object?: "model" | string;
  owned_by?: string;
  created?: number;
  [key: string]: unknown;
}

export interface ModelsResponse {
  object?: "list" | string;
  data: ModelInfo[];
  [key: string]: unknown;
}
