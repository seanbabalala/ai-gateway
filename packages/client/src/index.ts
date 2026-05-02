export * from "./types";

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  FetchLike,
  MessagesRequest,
  MessagesResponse,
  ModelsResponse,
  ResponsesRequest,
  ResponsesResponse,
  SiftGateClientOptions,
  SiftGateErrorDetails,
  SiftGateRequestOptions,
} from "./types";

export class SiftGateError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly requestId?: string;

  constructor(message: string, details: SiftGateErrorDetails) {
    super(message);
    this.name = "SiftGateError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.body = details.body;
    this.requestId = details.requestId;
  }
}

export class SiftGateClient {
  private readonly baseUrl: string;
  private readonly gatewayApiKey?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs?: number;

  readonly models = {
    list: (options?: SiftGateRequestOptions) =>
      this.request<ModelsResponse>("GET", "/v1/models", undefined, options),
  };

  readonly chat = {
    completions: {
      create: (body: ChatCompletionRequest, options?: SiftGateRequestOptions) =>
        this.request<ChatCompletionResponse>(
          "POST",
          "/v1/chat/completions",
          body,
          options,
        ),
    },
  };

  readonly responses = {
    create: (body: ResponsesRequest, options?: SiftGateRequestOptions) =>
      this.request<ResponsesResponse>("POST", "/v1/responses", body, options),
  };

  readonly messages = {
    create: (body: MessagesRequest, options?: SiftGateRequestOptions) =>
      this.request<MessagesResponse>("POST", "/v1/messages", body, options),
  };

  readonly embeddings = {
    create: (body: EmbeddingsRequest, options?: SiftGateRequestOptions) =>
      this.request<EmbeddingsResponse>("POST", "/v1/embeddings", body, options),
  };

  constructor(options: SiftGateClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? "http://localhost:2099");
    this.gatewayApiKey = options.gatewayApiKey;
    this.defaultHeaders = options.headers ?? {};
    this.timeoutMs = options.timeoutMs;

    if (options.fetch) {
      this.fetchImpl = options.fetch;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as FetchLike;
    } else {
      throw new Error(
        "SiftGateClient requires a fetch implementation in this runtime.",
      );
    }
  }

  async request<TResponse = unknown, TBody = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: TBody,
    options?: SiftGateRequestOptions,
  ): Promise<TResponse> {
    const response = await this.requestRaw(method, path, body, options);
    return (await parseBody(response)) as TResponse;
  }

  async requestRaw<TBody = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: TBody,
    options?: SiftGateRequestOptions,
  ): Promise<Response> {
    const url = this.resolveUrl(path);
    const headers = this.buildHeaders(body, options);
    const { signal, cleanup } = createSignal(options, this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        throw await createSiftGateError(response);
      }

      return response;
    } finally {
      cleanup();
    }
  }

  private resolveUrl(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    if (this.baseUrl.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
      return `${this.baseUrl}${normalizedPath.slice("/v1".length)}`;
    }

    return `${this.baseUrl}${normalizedPath}`;
  }

  private buildHeaders<TBody>(
    body: TBody | undefined,
    options?: SiftGateRequestOptions,
  ): Headers {
    const headers = new Headers(this.defaultHeaders);

    if (this.gatewayApiKey && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${this.gatewayApiKey}`);
    }

    if (body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    headers.set("accept", headers.get("accept") ?? "application/json");

    for (const [key, value] of Object.entries(options?.headers ?? {})) {
      headers.set(key, value);
    }

    if (options?.routingHint !== undefined) {
      const hint =
        typeof options.routingHint === "string"
          ? options.routingHint
          : JSON.stringify(options.routingHint);
      headers.set("x-siftgate-routing-hint", hint);
    }

    return headers;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function createSignal(
  options: SiftGateRequestOptions | undefined,
  defaultTimeoutMs: number | undefined,
): { signal?: AbortSignal; cleanup: () => void } {
  const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;

  if (!timeoutMs) {
    return { signal: options?.signal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = options?.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function createSiftGateError(response: Response): Promise<SiftGateError> {
  const body = await parseBody(response);
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("x-correlation-id") ??
    undefined;

  return new SiftGateError(
    extractErrorMessage(body, response.status, response.statusText),
    {
      status: response.status,
      statusText: response.statusText,
      body,
      requestId,
    },
  );
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  if (!text) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("json") || looksLikeJson(text)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function extractErrorMessage(
  body: unknown,
  status: number,
  statusText: string,
): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error;

    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") {
        return message;
      }
    }

    if (typeof record.message === "string") {
      return record.message;
    }
  }

  if (typeof body === "string" && body.length > 0) {
    return body;
  }

  return `SiftGate request failed with ${status} ${statusText}`;
}
