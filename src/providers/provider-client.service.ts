import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { NodeConfig, NodeProtocol } from '../config/gateway.config';
import {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalContentBlock,
  CanonicalStreamEvent,
  StopReason,
  Tier,
} from '../canonical/canonical.types';
import { ChatCompletionsDenormalizer } from '../canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../canonical/denormalizers/messages.denormalizer';
import { ChatCompletionsStreamParser } from './stream/chat-completions.stream';
import { ResponsesStreamParser } from './stream/responses.stream';
import { MessagesStreamParser } from './stream/messages.stream';

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

  constructor(private readonly config: ConfigService) {}

  // ══════════════════════════════════════════════════════
  // Non-Streaming Forward
  // ══════════════════════════════════════════════════════

  async forward(
    canonical: CanonicalRequest,
    nodeId: string,
    targetModel: string,
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
  ): Promise<CanonicalResponse> {
    const node = this.config.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const startTime = Date.now();
    const requestBody = this.denormalizeRequest(canonical, node.protocol, targetModel);
    (requestBody as Record<string, unknown>).stream = false;

    const response = await this.sendRequest(node, requestBody, canonical);
    const latencyMs = Date.now() - startTime;

    const responseBody = await response.json();
    return this.normalizeResponse(responseBody, node.protocol, routingMeta, nodeId, targetModel, latencyMs);
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
  ): AsyncGenerator<CanonicalStreamEvent> {
    const node = this.config.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const requestBody = this.denormalizeRequest(canonical, node.protocol, targetModel);
    (requestBody as Record<string, unknown>).stream = true;

    const response = await this.sendRequest(node, requestBody, canonical);

    if (!response.body) {
      throw new ProviderError(`No response body from ${node.id}`, 502, nodeId);
    }

    // Parse the SSE stream
    const parser = this.createStreamParser(node.protocol);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
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
      reader.releaseLock();
    }
  }

  // ══════════════════════════════════════════════════════
  // Shared HTTP Request Logic
  // ══════════════════════════════════════════════════════

  private async sendRequest(
    node: NodeConfig,
    requestBody: Record<string, unknown>,
    canonical?: CanonicalRequest,
  ): Promise<Response> {
    const url = `${node.base_url}${node.endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Auth
    const authType =
      node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'x-api-key') {
      headers['x-api-key'] = node.api_key;
      headers['anthropic-version'] = node.headers?.['anthropic-version'] || '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${node.api_key}`;
    }

    // Custom headers
    if (node.headers) Object.assign(headers, node.headers);

    // Preserve Anthropic-native request headers for messages → messages passthrough.
    if (canonical && this.shouldPassthroughNativeMessages(canonical, node.protocol)) {
      Object.assign(headers, this.extractNativeMessageHeaders(canonical));
    }

    this.logger.debug(
      `Forwarding to ${node.id} (${node.protocol}) → ${url} model=${requestBody.model} stream=${requestBody.stream}`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), node.timeout_ms || 60000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : 'Unknown fetch error';
      throw new ProviderError(`Failed to connect to ${node.id}: ${message}`, 0, node.id);
    } finally {
      clearTimeout(timeout);
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
      throw new ProviderError(
        `Provider ${node.id} returned ${response.status}: ${errorBody.substring(0, 500)}`,
        response.status,
        node.id,
      );
    }

    return response;
  }

  // ══════════════════════════════════════════════════════
  // Stream Parser Factory
  // ══════════════════════════════════════════════════════

  private createStreamParser(protocol: NodeProtocol) {
    switch (protocol) {
      case 'chat_completions':
        return new ChatCompletionsStreamParser();
      case 'responses':
        return new ResponsesStreamParser();
      case 'messages':
        return new MessagesStreamParser();
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
    return this.sanitizeNativeMessagesRequest(cloned);
  }

  private sanitizeNativeMessagesRequest(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitizeBlocks = (value: unknown): unknown => {
      if (!Array.isArray(value)) {
        return value;
      }

      return value.filter((block) => {
        if (!block || typeof block !== 'object') {
          return true;
        }

        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type !== 'text') {
          return true;
        }

        return typeof typedBlock.text !== 'string' || typedBlock.text.length > 0;
      });
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
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
    nodeId: string,
    model: string,
    latencyMs: number,
  ): CanonicalResponse {
    switch (protocol) {
      case 'chat_completions':
        return this.normalizeChatCompletionsResponse(body, routingMeta, nodeId, model, latencyMs);
      case 'responses':
        return this.normalizeResponsesResponse(body, routingMeta, nodeId, model, latencyMs);
      case 'messages':
        return this.normalizeMessagesResponse(body, routingMeta, nodeId, model, latencyMs);
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  private normalizeChatCompletionsResponse(
    body: Record<string, unknown>,
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
    nodeId: string, model: string, latencyMs: number,
  ): CanonicalResponse {
    const choices = body.choices as Record<string, unknown>[];
    const choice = choices?.[0] || {};
    const message = (choice.message || {}) as Record<string, unknown>;
    const usage = (body.usage || {}) as Record<string, unknown>;
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

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: this.mapChatFinishReason(choice.finish_reason as string),
      usage: { input_tokens: (usage.prompt_tokens as number) || 0, output_tokens: (usage.completion_tokens as number) || 0 },
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private normalizeResponsesResponse(
    body: Record<string, unknown>,
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
    nodeId: string, model: string, latencyMs: number,
  ): CanonicalResponse {
    const output = (body.output || []) as Record<string, unknown>[];
    const usage = (body.usage || {}) as Record<string, unknown>;
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

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: this.mapResponsesStatus(body.status as string),
      usage: { input_tokens: (usage.input_tokens as number) || 0, output_tokens: (usage.output_tokens as number) || 0 },
      model: (body.model as string) || model,
      routing: { ...routingMeta, node: nodeId, latency_ms: latencyMs },
    };
  }

  private normalizeMessagesResponse(
    body: Record<string, unknown>,
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
    nodeId: string, model: string, latencyMs: number,
  ): CanonicalResponse {
    const rawContent = (body.content || []) as Record<string, unknown>[];
    const usage = (body.usage || {}) as Record<string, unknown>;
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

    return {
      id: (body.id as string) || `gen_${Date.now()}`, content,
      stop_reason: (body.stop_reason as StopReason) || 'end_turn',
      usage: { input_tokens: (usage.input_tokens as number) || 0, output_tokens: (usage.output_tokens as number) || 0 },
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
}

// ══════════════════════════════════════════════════════
// Custom Error
// ══════════════════════════════════════════════════════

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly nodeId: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
