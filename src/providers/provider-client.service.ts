import { Injectable, Logger, Optional } from '@nestjs/common';
import { SpanKind } from '@opentelemetry/api';
import { ConfigService } from '../config/config.service';
import { NodeConfig, NodeProtocol } from '../config/gateway.config';
import { resolveNodeUsageSchema } from '../catalog/compatibility-profiles';
import {
  CanonicalRequest,
  CanonicalEmbeddingRequest,
  CanonicalEmbeddingResponse,
  CanonicalRerankRequest,
  CanonicalRerankResponse,
  CanonicalMediaRequest,
  CanonicalMediaResponse,
  CanonicalMediaSourceFormat,
  CanonicalResponse,
  CanonicalContentBlock,
  CanonicalStreamEvent,
  StopReason,
  Tier,
  TokenUsage,
} from '../canonical/canonical.types';
import { ChatCompletionsDenormalizer } from '../canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../canonical/denormalizers/messages.denormalizer';
import { toAnthropicMessagesOutputFormat } from '../canonical/structured-output';
import { ChatCompletionsStreamParser } from './stream/chat-completions.stream';
import { ResponsesStreamParser } from './stream/responses.stream';
import { MessagesStreamParser } from './stream/messages.stream';
import { TelemetryService } from '../telemetry/telemetry.service';
import { UpstreamConnectionPoolService } from './upstream-connection-pool.service';
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service';
import {
  extractUsageBySchema,
  UsageSchema,
} from './usage-schema-resolver';
import type { Dispatcher } from 'undici';

type FetchOptionsWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

function isUndiciTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const typed = error as { name?: string; code?: string };
  return (
    typed.name === 'HeadersTimeoutError' ||
    typed.name === 'BodyTimeoutError' ||
    typed.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    typed.code === 'UND_ERR_BODY_TIMEOUT'
  );
}

interface ProviderRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

@Injectable()
export class ProviderClientService {
  private readonly logger = new Logger(ProviderClientService.name);
  private readonly allowedAnthropicBetas = new Set([
    'claude-code-20250219',
    'interleaved-thinking-2025-05-14',
    'context-management-2025-06-27',
    'context-1m-2025-08-07',
  ]);

  private readonly chatDenorm = new ChatCompletionsDenormalizer();
  private readonly respDenorm = new ResponsesDenormalizer();
  private readonly msgDenorm = new MessagesDenormalizer();

  constructor(
    private readonly config: ConfigService,
    private readonly telemetry: TelemetryService,
    @Optional()
    private readonly connectionPool?: UpstreamConnectionPoolService,
    @Optional()
    private readonly secretResolver?: SecretReferenceResolverService,
  ) {}

  // ══════════════════════════════════════════════════════
  // Non-Streaming Forward
  // ══════════════════════════════════════════════════════

  async forward(
    canonical: CanonicalRequest,
    nodeId: string,
    targetModel: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: ProviderRequestOptions = {},
  ): Promise<CanonicalResponse> {
    return this.telemetry.withSpan(
      'gateway.upstream',
      {
        'gateway.upstream.node': nodeId,
        'gateway.upstream.model': targetModel,
        'gateway.upstream.is_fallback': routingMeta.is_fallback,
        'gen_ai.system': canonical.metadata.source_format,
        'gen_ai.request.model': targetModel,
      },
      async (span) => {
        const node = this.config.getNode(nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);

        const startTime = Date.now();
        const upstreamModel = this.resolveUpstreamModel(node, targetModel);
        const requestBody = this.denormalizeRequest(canonical, node.protocol, upstreamModel);
        (requestBody as Record<string, unknown>).stream = false;

        const response = await this.sendRequest(
          node,
          requestBody,
          canonical,
          options.timeoutMs,
          options.signal,
        );
        const latencyMs = Date.now() - startTime;

        this.telemetry.upstreamDuration.record(latencyMs, { node: nodeId, model: targetModel });

        const responseBody = await this.readJsonResponse(response, node);
        const usageSchema = this.resolveUsageSchemaForNode(node);
        const canonical_resp = this.normalizeResponse(
          responseBody,
          node.protocol,
          routingMeta,
          nodeId,
          targetModel,
          latencyMs,
          usageSchema,
        );

        // GenAI semantic attributes
        span.setAttributes({
          'gen_ai.usage.input_tokens': canonical_resp.usage.input_tokens,
          'gen_ai.usage.output_tokens': canonical_resp.usage.output_tokens,
          'gateway.upstream.latency_ms': latencyMs,
        });

        return canonical_resp;
      },
      SpanKind.CLIENT,
    );
  }

  async forwardEmbeddings(
    canonical: CanonicalEmbeddingRequest,
    nodeId: string,
    targetModel: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: ProviderRequestOptions = {},
  ): Promise<CanonicalEmbeddingResponse> {
    return this.telemetry.withSpan(
      'gateway.upstream.embeddings',
      {
        'gateway.upstream.node': nodeId,
        'gateway.upstream.model': targetModel,
        'gateway.upstream.is_fallback': routingMeta.is_fallback,
        'gen_ai.system': 'embeddings',
        'gen_ai.request.model': targetModel,
      },
      async (span) => {
        const node = this.config.getNode(nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);

        const startTime = Date.now();
        const requestBody = this.buildEmbeddingsRequest(canonical, targetModel);
        const response = await this.sendRequest(
          node,
          requestBody,
          undefined,
          options.timeoutMs,
          options.signal,
          node.embeddings_endpoint || '/v1/embeddings',
        );
        const latencyMs = Date.now() - startTime;

        this.telemetry.upstreamDuration.record(latencyMs, { node: nodeId, model: targetModel });

        const responseBody = await this.readJsonResponse(response, node);
        const canonicalResp = this.normalizeEmbeddingsResponse(
          responseBody as Record<string, unknown>,
          routingMeta,
          nodeId,
          targetModel,
          latencyMs,
        );
        span.setAttributes({
          'gen_ai.usage.input_tokens': canonicalResp.usage.input_tokens,
          'gen_ai.usage.output_tokens': canonicalResp.usage.output_tokens,
          'gateway.upstream.latency_ms': latencyMs,
        });
        return canonicalResp;
      },
      SpanKind.CLIENT,
    );
  }

  async forwardRerank(
    canonical: CanonicalRerankRequest,
    nodeId: string,
    targetModel: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: ProviderRequestOptions = {},
  ): Promise<CanonicalRerankResponse> {
    return this.telemetry.withSpan(
      'gateway.upstream.rerank',
      {
        'gateway.upstream.node': nodeId,
        'gateway.upstream.model': targetModel,
        'gateway.upstream.is_fallback': routingMeta.is_fallback,
        'gen_ai.system': 'rerank',
        'gen_ai.request.model': targetModel,
      },
      async (span) => {
        const node = this.config.getNode(nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);

        const startTime = Date.now();
        const requestBody = this.buildRerankRequest(canonical, targetModel);
        const response = await this.sendRequest(
          node,
          requestBody,
          undefined,
          options.timeoutMs,
          options.signal,
          node.rerank_endpoint || '/v1/rerank',
        );
        const latencyMs = Date.now() - startTime;

        this.telemetry.upstreamDuration.record(latencyMs, { node: nodeId, model: targetModel });

        const responseBody = await this.readJsonResponse(response, node);
        const canonicalResp = this.normalizeRerankResponse(
          responseBody as Record<string, unknown>,
          canonical,
          routingMeta,
          nodeId,
          targetModel,
          latencyMs,
        );
        span.setAttributes({
          'gen_ai.usage.input_tokens': canonicalResp.usage.input_tokens,
          'gen_ai.usage.output_tokens': canonicalResp.usage.output_tokens,
          'gateway.upstream.latency_ms': latencyMs,
        });
        return canonicalResp;
      },
      SpanKind.CLIENT,
    );
  }

  async forwardMedia(
    canonical: CanonicalMediaRequest,
    nodeId: string,
    targetModel: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: ProviderRequestOptions = {},
  ): Promise<CanonicalMediaResponse> {
    return this.telemetry.withSpan(
      `gateway.upstream.${canonical.source_format}`,
      {
        'gateway.upstream.node': nodeId,
        'gateway.upstream.model': targetModel,
        'gateway.upstream.is_fallback': routingMeta.is_fallback,
        'gen_ai.system': canonical.source_format,
        'gen_ai.request.model': targetModel,
        'gateway.media.type': canonical.media.media_type,
        'gateway.media.operation': canonical.media.operation,
        'gateway.media.multipart': canonical.media.multipart,
        'gateway.media.byte_size': canonical.media.byte_size,
      },
      async (span) => {
        const node = this.config.getNode(nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);

        const startTime = Date.now();
        const endpoint = this.mediaEndpointFor(node, canonical.source_format);
        const request = this.buildMediaRequest(canonical, targetModel);
        const response = await this.sendMediaRequest(
          node,
          request,
          endpoint,
          options.timeoutMs,
          options.signal,
        );
        const latencyMs = Date.now() - startTime;

        this.telemetry.upstreamDuration.record(latencyMs, { node: nodeId, model: targetModel });
        const canonicalResp = await this.normalizeMediaResponse(
          response,
          canonical,
          routingMeta,
          nodeId,
          targetModel,
          latencyMs,
        );
        span.setAttributes({
          'gen_ai.usage.input_tokens': canonicalResp.usage.input_tokens,
          'gen_ai.usage.output_tokens': canonicalResp.usage.output_tokens,
          'gateway.upstream.latency_ms': latencyMs,
        });
        return canonicalResp;
      },
      SpanKind.CLIENT,
    );
  }

  // ══════════════════════════════════════════════════════
  // Streaming Forward
  // ══════════════════════════════════════════════════════

  /**
   * Forward a canonical request as a stream.
   * Returns an async generator of CanonicalStreamEvent.
   *
   * Throws ProviderError during connection phase (before first chunk).
   * After first chunk is yielded, errors are emitted as StreamErrorEvent.
   */
  async *forwardStream(
    canonical: CanonicalRequest,
    nodeId: string,
    targetModel: string,
    options: ProviderRequestOptions = {},
  ): AsyncGenerator<CanonicalStreamEvent> {
    const node = this.config.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const upstreamModel = this.resolveUpstreamModel(node, targetModel);
    const requestBody = this.denormalizeRequest(canonical, node.protocol, upstreamModel);
    (requestBody as Record<string, unknown>).stream = true;

    const response = await this.sendRequest(
      node,
      requestBody,
      canonical,
      options.timeoutMs,
      options.signal,
    );

    if (!response.body) {
      throw new ProviderError(`No response body from ${node.id}`, 502, nodeId);
    }

    // Parse the SSE stream
    const parser = this.createStreamParser(
      node.protocol,
      this.resolveUsageSchemaForNode(node),
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const cancelReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    if (options.signal?.aborted) {
      cancelReader();
    } else {
      options.signal?.addEventListener('abort', cancelReader, { once: true });
    }

    try {
      while (true) {
        if (options.signal?.aborted) {
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const event of parser.parse(chunk)) {
          yield event;
        }
      }
    } catch (err) {
      // Transmission phase error — emit as error event (don't throw)
      yield {
        type: 'error',
        error: {
          message: `Stream interrupted from ${node.id}: ${(err as Error).message}`,
          code: 'stream_error',
        },
      };
    } finally {
      options.signal?.removeEventListener('abort', cancelReader);
      reader.releaseLock();
    }
  }

  // ══════════════════════════════════════════════════════
  // Shared HTTP Request Logic
  // ══════════════════════════════════════════════════════

  private async resolveNodeApiKey(node: NodeConfig): Promise<string> {
    return this.secretResolver
      ? this.secretResolver.resolveString(node.api_key, {
          location: `nodes.${node.id}.api_key`,
        })
      : node.api_key;
  }

  private async resolveNodeHeaders(node: NodeConfig): Promise<Record<string, string>> {
    return this.secretResolver
      ? this.secretResolver.resolveRecord(node.headers, {
          optional: true,
          location: `nodes.${node.id}.headers`,
        })
      : { ...(node.headers || {}) };
  }

  private async sendRequest(
    node: NodeConfig,
    requestBody: Record<string, unknown>,
    canonical?: CanonicalRequest,
    timeoutMs?: number,
    signal?: AbortSignal,
    endpointOverride?: string,
  ): Promise<Response> {
    const url = `${node.base_url}${endpointOverride || node.endpoint}`;
    const nodeHeaders = await this.resolveNodeHeaders(node);
    const apiKey = await this.resolveNodeApiKey(node);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Auth
    const authType =
      node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'custom-header') {
      const headerName = node.auth_header_name?.trim();
      if (!headerName) {
        throw new Error(`Node "${node.id}" auth_type=custom-header requires auth_header_name`);
      }
      headers[headerName] = node.auth_header_prefix
        ? `${node.auth_header_prefix} ${apiKey}`
        : apiKey;
    } else if (authType === 'x-api-key') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = nodeHeaders['anthropic-version'] || '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Custom headers
    Object.assign(headers, nodeHeaders);

    // Preserve Anthropic-native request headers for messages → messages passthrough.
    if (canonical && this.shouldPassthroughNativeMessages(canonical, node.protocol)) {
      Object.assign(headers, this.extractNativeMessageHeaders(canonical));
    }

    this.logger.debug(
      `Forwarding to ${node.id} (${node.protocol}) → ${url} model=${requestBody.model} stream=${requestBody.stream}`,
    );

    const controller = new AbortController();
    const effectiveTimeoutMs = timeoutMs ?? node.timeout_ms ?? 60000;
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const abortFromExternal = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', abortFromExternal, { once: true });
    }

    let response: Response;
    try {
      const fetchOptions: FetchOptionsWithDispatcher = {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      };
      const dispatcher = this.connectionPool?.getDispatcher(node);
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }

      response = await fetch(url, fetchOptions);
    } catch (err: unknown) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : 'Unknown fetch error';
      const errorName = err instanceof Error ? err.name : '';
      if (errorName === 'AbortError' || isUndiciTimeoutError(err)) {
        throw new ProviderError(
          `Provider ${node.id} timed out after ${effectiveTimeoutMs}ms`,
          504,
          node.id,
          'timeout',
        );
      }
      throw new ProviderError(
        `Failed to connect to ${node.id}: ${message}`,
        0,
        node.id,
        'network_error',
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromExternal);
    }

    if (!response.ok) {
      let errorBody: string;
      try { errorBody = await response.text(); } catch { errorBody = 'Unable to read error body'; }
      if (process.env.GATEWAY_DEBUG_MESSAGES_BODY === '1' && node.protocol === 'messages') {
        this.logger.debug(
          `Failed messages request body preview: ${JSON.stringify(requestBody).substring(0, 2000)}`,
        );
      }
      this.logger.warn(`Provider ${node.id} returned ${response.status}: ${errorBody.substring(0, 200)}`);
      const retryAfter = response.headers?.get?.('retry-after');
      throw new ProviderError(
        `Provider ${node.id} returned ${response.status}: ${errorBody.substring(0, 500)}` +
          (retryAfter ? ` retry-after: ${retryAfter}` : ''),
        response.status,
        node.id,
        response.status === 429 ? 'rate_limited' : 'http_error',
      );
    }

    return response;
  }

  private async sendMediaRequest(
    node: NodeConfig,
    request: { body: Record<string, unknown> | Buffer; contentType: string },
    endpoint: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = `${node.base_url}${endpoint}`;
    const nodeHeaders = await this.resolveNodeHeaders(node);
    const apiKey = await this.resolveNodeApiKey(node);
    const headers: Record<string, string> = {
      'Content-Type': request.contentType,
    };

    const authType =
      node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'custom-header') {
      const headerName = node.auth_header_name?.trim();
      if (!headerName) {
        throw new Error(`Node "${node.id}" auth_type=custom-header requires auth_header_name`);
      }
      headers[headerName] = node.auth_header_prefix
        ? `${node.auth_header_prefix} ${apiKey}`
        : apiKey;
    } else if (authType === 'x-api-key') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = nodeHeaders['anthropic-version'] || '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    Object.assign(headers, nodeHeaders);

    const controller = new AbortController();
    const effectiveTimeoutMs = timeoutMs ?? node.timeout_ms ?? 60000;
    const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
    const abortFromExternal = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', abortFromExternal, { once: true });
    }

    try {
      const body = Buffer.isBuffer(request.body)
        ? (request.body as unknown as BodyInit)
        : JSON.stringify(request.body);
      const fetchOptions: FetchOptionsWithDispatcher = {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      };
      const dispatcher = this.connectionPool?.getDispatcher(node);
      if (dispatcher) {
        fetchOptions.dispatcher = dispatcher;
      }
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        let errorBody: string;
        try { errorBody = await response.text(); } catch { errorBody = 'Unable to read error body'; }
        this.logger.warn(`Provider ${node.id} returned ${response.status}: ${errorBody.substring(0, 200)}`);
        const retryAfter = response.headers?.get?.('retry-after');
        throw new ProviderError(
          `Provider ${node.id} returned ${response.status}: ${errorBody.substring(0, 500)}` +
            (retryAfter ? ` retry-after: ${retryAfter}` : ''),
          response.status,
          node.id,
          response.status === 429 ? 'rate_limited' : 'http_error',
        );
      }
      return response;
    } catch (err: unknown) {
      if (err instanceof ProviderError) throw err;
      const message = err instanceof Error ? err.message : 'Unknown fetch error';
      const errorName = err instanceof Error ? err.name : '';
      if (errorName === 'AbortError' || isUndiciTimeoutError(err)) {
        throw new ProviderError(
          `Provider ${node.id} timed out after ${effectiveTimeoutMs}ms`,
          504,
          node.id,
          'timeout',
        );
      }
      throw new ProviderError(
        `Failed to connect to ${node.id}: ${message}`,
        0,
        node.id,
        'network_error',
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromExternal);
    }
  }

  private async readJsonResponse(
    response: Response,
    node: NodeConfig,
  ): Promise<Record<string, unknown>> {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch (err: unknown) {
      if (isUndiciTimeoutError(err)) {
        throw new ProviderError(
          `Provider ${node.id} timed out while reading upstream response body`,
          504,
          node.id,
          'timeout',
        );
      }
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════
  // Stream Parser Factory
  // ══════════════════════════════════════════════════════

  private createStreamParser(
    protocol: NodeProtocol,
    usageSchema?: UsageSchema,
  ) {
    switch (protocol) {
      case 'chat_completions':
        return new ChatCompletionsStreamParser(usageSchema);
      case 'responses':
        return new ResponsesStreamParser(usageSchema);
      case 'messages':
        return new MessagesStreamParser(usageSchema);
      default:
        throw new Error(`Unsupported stream protocol: ${protocol}`);
    }
  }

  // ══════════════════════════════════════════════════════
  // Request Denormalization
  // ══════════════════════════════════════════════════════

  private denormalizeRequest(
    canonical: CanonicalRequest,
    protocol: NodeProtocol,
    targetModel: string,
  ): Record<string, unknown> {
    if (this.shouldPassthroughNativeMessages(canonical, protocol)) {
      return this.buildNativeMessagesRequest(canonical, targetModel);
    }

    switch (protocol) {
      case 'chat_completions':
        return this.chatDenorm.denormalize(canonical, targetModel);
      case 'responses':
        return this.respDenorm.denormalize(canonical, targetModel);
      case 'messages':
        return this.msgDenorm.denormalize(canonical, targetModel);
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  private resolveUpstreamModel(node: NodeConfig, targetModel: string): string {
    return node.upstream_model_aliases?.[targetModel] || targetModel;
  }

  private buildEmbeddingsRequest(
    canonical: CanonicalEmbeddingRequest,
    targetModel: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: targetModel,
      input: canonical.input,
    };
    if (canonical.dimensions !== undefined) {
      body.dimensions = canonical.dimensions;
    }
    if (canonical.encoding_format) {
      body.encoding_format = canonical.encoding_format;
    }
    if (canonical.user) {
      body.user = canonical.user;
    }
    return body;
  }

  private buildRerankRequest(
    canonical: CanonicalRerankRequest,
    targetModel: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: targetModel,
      query: canonical.query,
      documents: canonical.documents,
    };
    if (canonical.top_n !== undefined) {
      body.top_n = canonical.top_n;
    }
    if (canonical.return_documents !== undefined) {
      body.return_documents = canonical.return_documents;
    }
    return body;
  }

  private mediaEndpointFor(
    node: NodeConfig,
    sourceFormat: CanonicalMediaSourceFormat,
  ): string {
    switch (sourceFormat) {
      case 'image_generation':
        return node.images_generations_endpoint || '/v1/images/generations';
      case 'image_edit':
        return node.images_edits_endpoint || '/v1/images/edits';
      case 'image_variation':
        return node.images_variations_endpoint || '/v1/images/variations';
      case 'audio_transcription':
        return node.audio_transcriptions_endpoint || '/v1/audio/transcriptions';
      case 'audio_translation':
        return node.audio_translations_endpoint || '/v1/audio/translations';
      case 'audio_speech':
        return node.audio_speech_endpoint || '/v1/audio/speech';
      case 'video_generation':
        return node.video_endpoint || node.video_generations_endpoint || '/v1/videos/generations';
      default:
        return node.endpoint;
    }
  }

  private buildMediaRequest(
    canonical: CanonicalMediaRequest,
    targetModel: string,
  ): { body: Record<string, unknown> | Buffer; contentType: string } {
    if (Buffer.isBuffer(canonical.payload)) {
      return {
        body: this.withMultipartModel(canonical.payload, canonical.content_type, targetModel),
        contentType: canonical.content_type,
      };
    }

    return {
      body: {
        ...canonical.payload,
        model: targetModel,
      },
      contentType: 'application/json',
    };
  }

  private withMultipartModel(
    body: Buffer,
    contentType: string,
    targetModel: string,
  ): Buffer {
    const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
    if (!boundaryMatch) return body;

    const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
    const raw = body.toString('latin1');
    const parts = raw.split(`--${boundary}`);
    let replaced = false;
    const rewritten = parts.map((part) => {
      if (replaced || !part.includes('name="model"')) return part;
      const valueStart = part.indexOf('\r\n\r\n');
      if (valueStart < 0) return part;
      const valueEnd = part.indexOf('\r\n', valueStart + 4);
      replaced = true;
      return `${part.slice(0, valueStart + 4)}${targetModel}${part.slice(valueEnd >= 0 ? valueEnd : part.length)}`;
    }).join(`--${boundary}`);

    if (replaced) {
      return Buffer.from(rewritten, 'latin1');
    }

    const closing = `--${boundary}--`;
    const insertAt = raw.lastIndexOf(closing);
    if (insertAt < 0) return body;
    const field =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      `${targetModel}\r\n`;
    return Buffer.from(`${raw.slice(0, insertAt)}${field}${raw.slice(insertAt)}`, 'latin1');
  }

  private shouldPassthroughNativeMessages(
    canonical: CanonicalRequest,
    protocol: NodeProtocol,
  ): boolean {
    return protocol === 'messages' && canonical.metadata.source_format === 'messages';
  }

  private buildNativeMessagesRequest(
    canonical: CanonicalRequest,
    targetModel: string,
  ): Record<string, unknown> {
    const rawBody =
      canonical.metadata.raw_body &&
      typeof canonical.metadata.raw_body === 'object' &&
      !Array.isArray(canonical.metadata.raw_body)
        ? (canonical.metadata.raw_body as Record<string, unknown>)
        : {};

    const cloned = JSON.parse(JSON.stringify(rawBody)) as Record<string, unknown>;
    cloned.model = targetModel;
    cloned.stream = canonical.stream;
    const outputFormat = toAnthropicMessagesOutputFormat(
      canonical.response_format,
    );
    if (outputFormat) {
      const outputConfig =
        cloned.output_config &&
        typeof cloned.output_config === 'object' &&
        !Array.isArray(cloned.output_config)
          ? (cloned.output_config as Record<string, unknown>)
          : {};
      cloned.output_config = {
        ...outputConfig,
        format: outputFormat,
      };
      delete cloned.output_format;
      delete cloned.response_format;
      delete cloned.text;
    }
    return this.sanitizeNativeMessagesRequest(cloned);
  }

  private sanitizeNativeMessagesRequest(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitizeBlocks = (value: unknown): unknown => {
      if (!Array.isArray(value)) {
        return value;
      }

      const sanitized: unknown[] = [];
      for (const block of value) {
        if (!block || typeof block !== 'object') {
          sanitized.push(block);
          continue;
        }

        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type === 'text') {
          if (typeof typedBlock.text !== 'string' || typedBlock.text.length > 0) {
            sanitized.push(block);
          }
          continue;
        }

        if (
          typedBlock.type === 'thinking' ||
          typedBlock.type === 'redacted_thinking'
        ) {
          continue;
        }

        sanitized.push(block);
      }

      return sanitized;
    };

    if (Array.isArray(body.messages)) {
      body.messages = (body.messages as unknown[]).map((message) => {
        if (!message || typeof message !== 'object') {
          return message;
        }

        const typedMessage = { ...(message as Record<string, unknown>) };
        typedMessage.content = sanitizeBlocks(typedMessage.content);
        return typedMessage;
      });
    }

    if (Array.isArray(body.system)) {
      body.system = sanitizeBlocks(body.system);
    }

    return body;
  }

  private extractNativeMessageHeaders(
    canonical: CanonicalRequest,
  ): Record<string, string> {
    const rawHeaders = canonical.metadata.raw_headers || {};
    const forwarded: Record<string, string> = {};

    const anthropicVersion = rawHeaders['anthropic-version'];
    if (anthropicVersion) {
      forwarded['anthropic-version'] = anthropicVersion;
    }

    const anthropicBeta = rawHeaders['anthropic-beta'];
    if (anthropicBeta) {
      const filteredBetas = anthropicBeta
        .split(',')
        .map((beta) => beta.trim())
        .filter((beta) => beta && this.allowedAnthropicBetas.has(beta));

      if (filteredBetas.length > 0) {
        forwarded['anthropic-beta'] = filteredBetas.join(',');
      }
    }

    return forwarded;
  }

  // ══════════════════════════════════════════════════════
  // Response Normalization (non-stream)
  // ══════════════════════════════════════════════════════

  normalizeResponse(
    body: Record<string, unknown>,
    protocol: NodeProtocol,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
    usageSchema?: UsageSchema,
  ): CanonicalResponse {
    switch (protocol) {
      case 'chat_completions':
        return this.normalizeChatCompletionsResponse(
          body,
          routingMeta,
          nodeId,
          model,
          latencyMs,
          usageSchema,
        );
      case 'responses':
        return this.normalizeResponsesResponse(
          body,
          routingMeta,
          nodeId,
          model,
          latencyMs,
          usageSchema,
        );
      case 'messages':
        return this.normalizeMessagesResponse(
          body,
          routingMeta,
          nodeId,
          model,
          latencyMs,
          usageSchema,
        );
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  normalizeEmbeddingsResponse(
    body: Record<string, unknown>,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
  ): CanonicalEmbeddingResponse {
    const usage = (body.usage || {}) as Record<string, unknown>;
    const data = Array.isArray(body.data) ? body.data : [];
    return {
      id: (body.id as string) || `emb_${Date.now()}`,
      object: 'list',
      data: data.map((item, index) => {
        const entry =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        return {
          index:
            typeof entry.index === 'number' && Number.isFinite(entry.index)
              ? entry.index
              : index,
          embedding: Array.isArray(entry.embedding) || typeof entry.embedding === 'string'
            ? (entry.embedding as number[] | string)
            : [],
        };
      }),
      usage: {
        input_tokens:
          (usage.prompt_tokens as number) ||
          (usage.input_tokens as number) ||
          (usage.total_tokens as number) ||
          0,
        output_tokens: 0,
      },
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  normalizeRerankResponse(
    body: Record<string, unknown>,
    canonical: CanonicalRerankRequest,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
  ): CanonicalRerankResponse {
    const usage = (body.usage || body.meta || {}) as Record<string, unknown>;
    const billedUnits = (usage.billed_units || {}) as Record<string, unknown>;
    const results = Array.isArray(body.results)
      ? body.results
      : Array.isArray(body.data)
        ? body.data
        : [];

    return {
      id: (body.id as string) || `rerank_${Date.now()}`,
      object: 'rerank',
      results: results.map((item, index) => {
        const entry =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        const resultIndex =
          typeof entry.index === 'number' && Number.isFinite(entry.index)
            ? entry.index
            : index;
        return {
          index: resultIndex,
          relevance_score:
            typeof entry.relevance_score === 'number' && Number.isFinite(entry.relevance_score)
              ? entry.relevance_score
              : typeof entry.score === 'number' && Number.isFinite(entry.score)
                ? entry.score
                : 0,
          document:
            entry.document !== undefined
              ? (entry.document as CanonicalRerankResponse['results'][number]['document'])
              : canonical.return_documents
                ? canonical.documents[resultIndex]
                : undefined,
        };
      }),
      usage: {
        input_tokens:
          (usage.prompt_tokens as number) ||
          (usage.input_tokens as number) ||
          (usage.total_tokens as number) ||
          (billedUnits.input_tokens as number) ||
          (billedUnits.search_units as number) ||
          0,
        output_tokens: (usage.output_tokens as number) || 0,
      },
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private async normalizeMediaResponse(
    response: Response,
    canonical: CanonicalMediaRequest,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
  ): Promise<CanonicalMediaResponse> {
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const providerResponseType = contentType.split(';')[0].trim().toLowerCase() || contentType;
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as Record<string, unknown>;
      const usage = (body.usage || {}) as Record<string, unknown>;
      return {
        id: (body.id as string) || `${canonical.source_format}_${Date.now()}`,
        body,
        content_type: contentType,
        provider_response_type: providerResponseType,
        usage: {
          input_tokens:
            (usage.prompt_tokens as number) ||
            (usage.input_tokens as number) ||
            (usage.total_tokens as number) ||
            0,
          output_tokens:
            (usage.completion_tokens as number) ||
            (usage.output_tokens as number) ||
            0,
        },
        model: (body.model as string) || model,
        routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      id: `${canonical.source_format}_${Date.now()}`,
      body: Buffer.from(arrayBuffer),
      content_type: contentType,
      provider_response_type: providerResponseType,
      usage: { input_tokens: 0, output_tokens: 0 },
      model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private normalizeChatCompletionsResponse(
    body: Record<string, unknown>,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
    usageSchema?: UsageSchema,
  ): CanonicalResponse {
    const choices = body.choices as Record<string, unknown>[];
    const choice = choices?.[0] || {};
    const message = (choice.message || {}) as Record<string, unknown>;
    const content: CanonicalContentBlock[] = [];

    if (message.content && typeof message.content === 'string') {
      content.push({ type: 'text', text: message.content });
    }
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls as Record<string, unknown>[]) {
        const fn = tc.function as Record<string, unknown>;
        content.push({
          type: 'tool_use', id: (tc.id as string) || '', name: (fn.name as string) || '',
          input: this.safeParseJson((fn.arguments as string) || '{}'),
        });
      }
    }

    const fallbackUsage: TokenUsage = {
      input_tokens: ((body.usage as Record<string, unknown>)?.prompt_tokens as number) || 0,
      output_tokens:
        ((body.usage as Record<string, unknown>)?.completion_tokens as number) || 0,
      cache_read_input_tokens:
        ((((body.usage as Record<string, unknown>)?.prompt_tokens_details as Record<
          string,
          unknown
        >)?.cached_tokens as number) || 0),
    };

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: this.mapChatFinishReason(choice.finish_reason as string),
      usage: this.resolveNormalizedUsage(body, usageSchema, fallbackUsage),
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private normalizeResponsesResponse(
    body: Record<string, unknown>,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
    usageSchema?: UsageSchema,
  ): CanonicalResponse {
    const output = (body.output || []) as Record<string, unknown>[];
    const content: CanonicalContentBlock[] = [];

    for (const item of output) {
      if (item.type === 'message') {
        const msgContent = item.content as Record<string, unknown>[];
        if (Array.isArray(msgContent)) {
          for (const part of msgContent) {
            if (part.type === 'output_text') content.push({ type: 'text', text: (part.text as string) || '' });
          }
        }
      } else if (item.type === 'function_call') {
        content.push({
          type: 'tool_use', id: (item.call_id as string) || (item.id as string) || '',
          name: (item.name as string) || '', input: this.safeParseJson((item.arguments as string) || '{}'),
        });
      }
    }

    const fallbackUsage: TokenUsage = {
      input_tokens: ((body.usage as Record<string, unknown>)?.input_tokens as number) || 0,
      output_tokens:
        ((body.usage as Record<string, unknown>)?.output_tokens as number) || 0,
      cache_read_input_tokens:
        ((((body.usage as Record<string, unknown>)?.input_tokens_details as Record<
          string,
          unknown
        >)?.cached_tokens as number) ||
          (((body.usage as Record<string, unknown>)?.prompt_tokens_details as Record<
            string,
            unknown
          >)?.cached_tokens as number) ||
          ((((body.usage as Record<string, unknown>)?.input_token_details as Record<
            string,
            unknown
          >)?.cached_tokens as number) || 0)),
    };

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: this.mapResponsesStatus(body.status as string),
      usage: this.resolveNormalizedUsage(body, usageSchema, fallbackUsage),
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private normalizeMessagesResponse(
    body: Record<string, unknown>,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    nodeId: string,
    model: string,
    latencyMs: number,
    usageSchema?: UsageSchema,
  ): CanonicalResponse {
    const rawContent = (body.content || []) as Record<string, unknown>[];
    const content: CanonicalContentBlock[] = [];

    for (const block of rawContent) {
      if (block.type === 'text') content.push({ type: 'text', text: (block.text as string) || '' });
      else if (block.type === 'tool_use') {
        content.push({
          type: 'tool_use', id: (block.id as string) || '', name: (block.name as string) || '',
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }

    const fallbackUsage: TokenUsage = {
      input_tokens: ((body.usage as Record<string, unknown>)?.input_tokens as number) || 0,
      output_tokens:
        ((body.usage as Record<string, unknown>)?.output_tokens as number) || 0,
      cache_creation_input_tokens:
        (((body.usage as Record<string, unknown>)?.cache_creation_input_tokens as number) ||
          0),
      cache_read_input_tokens:
        (((body.usage as Record<string, unknown>)?.cache_read_input_tokens as number) || 0),
    };

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: (body.stop_reason as StopReason) || 'end_turn',
      usage: this.resolveNormalizedUsage(body, usageSchema, fallbackUsage),
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  // ══════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════

  private mapChatFinishReason(reason: string): StopReason {
    switch (reason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      default: return 'end_turn';
    }
  }

  private mapResponsesStatus(status: string): StopReason {
    if (status === 'completed') return 'end_turn';
    if (status === 'incomplete') return 'max_tokens';
    return 'end_turn';
  }

  private safeParseJson(str: string): Record<string, unknown> {
    try { return JSON.parse(str); } catch { return { _raw: str }; }
  }

  private resolveUsageSchemaForNode(node: NodeConfig): UsageSchema | undefined {
    return resolveNodeUsageSchema(
      node,
      node.protocol,
      this.getMergedCatalogSafely(),
    );
  }

  private getMergedCatalogSafely() {
    return typeof this.config.getMergedCatalog === 'function'
      ? this.config.getMergedCatalog()
      : undefined;
  }

  private resolveNormalizedUsage(
    body: Record<string, unknown>,
    usageSchema: UsageSchema | undefined,
    fallbackUsage: TokenUsage,
  ): TokenUsage {
    if (!usageSchema) {
      return fallbackUsage;
    }

    const schemaUsage = extractUsageBySchema(body, usageSchema);
    return {
      input_tokens: schemaUsage.input_tokens || fallbackUsage.input_tokens || 0,
      output_tokens: schemaUsage.output_tokens || fallbackUsage.output_tokens || 0,
      cache_creation_input_tokens:
        schemaUsage.cache_creation_input_tokens ||
        fallbackUsage.cache_creation_input_tokens ||
        0,
      cache_read_input_tokens:
        schemaUsage.cache_read_input_tokens ||
        fallbackUsage.cache_read_input_tokens ||
        0,
    };
  }
}

// ══════════════════════════════════════════════════════
// Custom Error
// ══════════════════════════════════════════════════════

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly nodeId: string,
    public readonly failureType:
      | 'timeout'
      | 'rate_limited'
      | 'http_error'
      | 'network_error' = 'http_error',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
