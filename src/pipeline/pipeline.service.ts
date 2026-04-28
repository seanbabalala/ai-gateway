import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Response as ExpressResponse } from 'express';
import { ConfigService } from '../config/config.service';
import { RetryConfig } from '../config/gateway.config';
import {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  SourceFormat,
  Tier,
  TokenUsage,
} from '../canonical/canonical.types';
import {
  ProviderClientService,
  ProviderError,
} from '../providers/provider-client.service';
import { ScoringService } from '../scoring/scoring.service';
import { RoutingService } from '../routing/routing.service';
import { CircuitBreakerService } from '../routing/circuit-breaker.service';
import { BudgetService, BudgetExceededError } from '../budget/budget.service';
import { PromptCacheService } from '../cache/prompt-cache.service';
import { LogEventBus } from '../dashboard/log-event-bus';
import { ChatCompletionsDenormalizer } from '../canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../canonical/denormalizers/messages.denormalizer';
import {
  ChatCompletionsStreamSerializer,
  ResponsesStreamSerializer,
  MessagesStreamSerializer,
} from '../providers/stream/stream-serializers';
import { CallLog } from '../database/entities/call-log.entity';

export interface PipelineResult {
  body: Record<string, unknown>;
  statusCode: number;
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  private readonly chatDenorm = new ChatCompletionsDenormalizer();
  private readonly respDenorm = new ResponsesDenormalizer();
  private readonly msgDenorm = new MessagesDenormalizer();

  constructor(
    private readonly config: ConfigService,
    private readonly providerClient: ProviderClientService,
    private readonly scoringService: ScoringService,
    private readonly routingService: RoutingService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly budgetService: BudgetService,
    private readonly cacheService: PromptCacheService,
    private readonly logEventBus: LogEventBus,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  // ══════════════════════════════════════════════════════
  // Non-Streaming Process
  // ══════════════════════════════════════════════════════

  async process(canonical: CanonicalRequest): Promise<PipelineResult> {
    const requestId = uuidv4();

    // ── Budget Check ──
    try {
      await this.budgetService.check();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        this.logger.warn(`Budget exceeded: ${err.message}`);
        return {
          body: this.formatError(canonical.metadata.source_format, 429, err.message),
          statusCode: 429,
        };
      }
      throw err;
    }

    // ── Cache Lookup ──
    const cacheStart = Date.now();
    if (this.cacheService.shouldCache(canonical)) {
      const cached = this.cacheService.lookup(canonical);
      if (cached) {
        const cacheLatency = Date.now() - cacheStart;
        const responseBody = this.denormalizeForClient(cached, canonical.metadata.source_format);
        await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
          model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
          usage: cached.usage, error: null, retryCount: 0 });
        return { body: responseBody, statusCode: 200 };
      }
    }

    // ── Route Resolution ──
    const { route, tier, score } = this.resolveSmartRoute(canonical);
    const retryConfig = this.config.retry;

    let canonicalResponse: CanonicalResponse | null = null;
    let usedNodeId = route.primary.node;
    let usedModel = route.primary.model;
    let isFallback = false;
    let lastError: Error | null = null;
    let totalRetries = 0;

    // Try primary with retries
    const primaryResult = await this.tryNodeWithRetry(
      canonical, route.primary.node, route.primary.model,
      { tier, score, is_fallback: false }, retryConfig,
    );
    totalRetries += primaryResult.retries;

    if (primaryResult.response) {
      canonicalResponse = primaryResult.response;
    } else {
      lastError = primaryResult.lastError;
    }

    // Try fallbacks with retries
    if (!canonicalResponse && route.fallbacks.length > 0) {
      for (const fb of route.fallbacks) {
        this.logger.log(`Trying fallback: ${fb.node} (${fb.model})`);
        const fbResult = await this.tryNodeWithRetry(
          canonical, fb.node, fb.model,
          { tier, score, is_fallback: true }, retryConfig,
        );
        totalRetries += fbResult.retries;

        if (fbResult.response) {
          canonicalResponse = fbResult.response;
          usedNodeId = fb.node;
          usedModel = fb.model;
          isFallback = true;
          break;
        }
        lastError = fbResult.lastError;
      }
    }

    if (!canonicalResponse) {
      const errorMsg = lastError?.message || 'All nodes failed';
      await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
        statusCode: lastError instanceof ProviderError ? lastError.statusCode : 502,
        isFallback, latencyMs: 0, usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg,
        retryCount: totalRetries });
      return { body: this.formatError(canonical.metadata.source_format, 502, errorMsg), statusCode: 502 };
    }

    const responseBody = this.denormalizeForClient(canonicalResponse, canonical.metadata.source_format);

    // ── Cache Store ──
    this.cacheService.store(canonical, canonicalResponse);

    // ── Budget Record ──
    const pricing = this.config.getModelPricing(usedModel);
    const costUsd = pricing
      ? (canonicalResponse.usage.input_tokens / 1_000_000) * pricing.input +
        (canonicalResponse.usage.output_tokens / 1_000_000) * pricing.output
      : 0;
    const totalTokens = canonicalResponse.usage.input_tokens + canonicalResponse.usage.output_tokens;
    await this.budgetService.record(totalTokens, costUsd);

    await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
      statusCode: 200, isFallback, latencyMs: canonicalResponse.routing.latency_ms,
      usage: canonicalResponse.usage, error: null, retryCount: totalRetries });

    return { body: responseBody, statusCode: 200 };
  }

  // ══════════════════════════════════════════════════════
  // Retry Helper — try a single node with retries + backoff
  // ══════════════════════════════════════════════════════

  private async tryNodeWithRetry(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
    routingMeta: { tier: Tier; score: number; is_fallback: boolean },
    retryConfig: RetryConfig,
  ): Promise<{ response: CanonicalResponse | null; lastError: Error | null; retries: number }> {
    const maxAttempts = 1 + retryConfig.max_retries; // 1 initial + N retries
    let lastError: Error | null = null;
    let retries = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.providerClient.forward(
          canonical, nodeId, model, routingMeta,
        );
        this.circuitBreaker.recordSuccess(nodeId, model);
        return { response, lastError: null, retries };
      } catch (err) {
        lastError = err as Error;
        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        const isRetryable = retryConfig.retryable_status.includes(statusCode);
        const isLastAttempt = attempt >= maxAttempts - 1;

        if (!isRetryable || isLastAttempt) {
          // Not retryable or exhausted retries — record failure and give up
          this.logger.warn(
            `Node ${nodeId} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}` +
            (isLastAttempt && attempt > 0 ? ' — retries exhausted' : ''),
          );
          this.circuitBreaker.recordFailure(nodeId, model);
          return { response: null, lastError, retries };
        }

        // Retryable — backoff and retry
        retries++;
        const delay = this.calculateBackoff(attempt, retryConfig, statusCode === 429 ? lastError : undefined);
        this.logger.warn(
          `Node ${nodeId} returned ${statusCode} (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }

    return { response: null, lastError, retries };
  }

  /**
   * Calculate exponential backoff delay.
   * For 429: respects Retry-After header if present in the error message.
   * Otherwise: base * 2^attempt, capped at max, with ±25% jitter.
   */
  private calculateBackoff(attempt: number, retryConfig: RetryConfig, retryAfterError?: Error): number {
    // Try to extract Retry-After from error message for 429s
    if (retryAfterError) {
      const match = retryAfterError.message.match(/retry-after:\s*(\d+)/i);
      if (match) {
        const retryAfterSec = parseInt(match[1], 10);
        if (retryAfterSec > 0 && retryAfterSec <= 60) {
          return retryAfterSec * 1000;
        }
      }
    }

    // Exponential backoff: base * 2^attempt
    const exponential = retryConfig.backoff_base_ms * Math.pow(2, attempt);
    const capped = Math.min(exponential, retryConfig.backoff_max_ms);
    // ±25% jitter to avoid thundering herd
    const jitter = capped * (0.75 + Math.random() * 0.5);
    return Math.round(jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ══════════════════════════════════════════════════════
  // Streaming Process
  // ══════════════════════════════════════════════════════

  async processStream(
    canonical: CanonicalRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const requestId = uuidv4();

    // ── Budget Check ──
    try {
      await this.budgetService.check();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        this.logger.warn(`Budget exceeded (stream): ${err.message}`);
        res.status(429).json(
          this.formatError(canonical.metadata.source_format, 429, err.message),
        );
        return;
      }
      throw err;
    }

    // ── Cache Lookup (stream) ──
    if (this.cacheService.shouldCache(canonical)) {
      const cacheStart = Date.now();
      const cached = this.cacheService.lookup(canonical);
      if (cached) {
        const cacheLatency = Date.now() - cacheStart;

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        // Create serializer and replay cached response as synthetic stream
        const serializer = this.createSerializer(canonical.metadata.source_format);

        // start event
        const startEvt: CanonicalStreamEvent = { type: 'start', id: cached.id, model: cached.model };
        const startText = serializer.serialize(startEvt);
        if (startText) res.write(startText);

        // delta events for each text content block
        for (const block of cached.content) {
          if (block.type === 'text') {
            const deltaEvt: CanonicalStreamEvent = {
              type: 'delta',
              content: { type: 'text', text: block.text },
            };
            const deltaText = serializer.serialize(deltaEvt);
            if (deltaText) res.write(deltaText);
          }
        }

        // stop event
        const stopEvt: CanonicalStreamEvent = {
          type: 'stop',
          stop_reason: cached.stop_reason,
          usage: cached.usage,
        };
        const stopText = serializer.serialize(stopEvt);
        if (stopText) res.write(stopText);

        res.end();

        await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
          model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
          usage: cached.usage, error: null, retryCount: 0 });
        return;
      }
    }

    const { route, tier, score } = this.resolveSmartRoute(canonical);
    const retryConfig = this.config.retry;

    const startTime = Date.now();

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Create serializer for client's source format
    const serializer = this.createSerializer(canonical.metadata.source_format);

    // Try primary + fallbacks (connection-phase fallback + retry)
    const targets = [route.primary, ...route.fallbacks];
    let streamConnected = false;
    let usedNodeId = route.primary.node;
    let usedModel = route.primary.model;
    let isFallback = false;
    let lastError: Error | null = null;
    let totalRetries = 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const isFirstTarget = i === 0;

      // Connection-phase retry loop for this target
      const maxAttempts = 1 + retryConfig.max_retries;
      let connected = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const stream = this.providerClient.forwardStream(
            canonical, target.node, target.model,
          );

          // Stream events to client
          const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
          const accumulatedText: string[] = []; // For cache store
          let streamModel = '';
          let streamId = '';
          let streamStopReason = '';

          for await (const event of stream) {
            streamConnected = true;
            connected = true;
            usedNodeId = target.node;
            usedModel = target.model;
            isFallback = !isFirstTarget;

            // Accumulate for cache
            if (event.type === 'start') {
              streamModel = event.model;
              streamId = event.id;
            } else if (event.type === 'delta' && event.content.type === 'text') {
              accumulatedText.push(event.content.text);
            } else if (event.type === 'stop') {
              usage.input_tokens = event.usage.input_tokens;
              usage.output_tokens = event.usage.output_tokens;
              streamStopReason = event.stop_reason;
            }

            const sseText = serializer.serialize(event);
            if (sseText) {
              res.write(sseText);
            }
          }

          // Stream completed successfully
          const latencyMs = Date.now() - startTime;
          this.circuitBreaker.recordSuccess(target.node, target.model);

          // ── Cache Store (from stream accumulation) ──
          if (this.cacheService.shouldCache(canonical) && accumulatedText.length > 0) {
            const assembledResponse: CanonicalResponse = {
              id: streamId || `cache-${requestId}`,
              content: [{ type: 'text', text: accumulatedText.join('') }],
              stop_reason: (streamStopReason || 'end_turn') as CanonicalResponse['stop_reason'],
              usage: { ...usage },
              model: streamModel || usedModel,
              routing: { tier, node: usedNodeId, latency_ms: latencyMs, score, is_fallback: isFallback },
            };
            this.cacheService.store(canonical, assembledResponse);
          }

          const pricing = this.config.getModelPricing(usedModel);
          const costUsd = pricing
            ? (usage.input_tokens / 1_000_000) * pricing.input +
              (usage.output_tokens / 1_000_000) * pricing.output
            : 0;
          const totalTokens = usage.input_tokens + usage.output_tokens;
          await this.budgetService.record(totalTokens, costUsd);

          await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
            statusCode: 200, isFallback, latencyMs, usage, error: null, retryCount: totalRetries });

          res.end();
          return;
        } catch (err) {
          lastError = err as Error;

          if (connected || streamConnected) {
            // Transmission phase — don't retry, send error event
            this.logger.warn(`Stream interrupted from ${target.node}: ${lastError.message}`);
            this.circuitBreaker.recordFailure(target.node, target.model);
            const errorEvent: CanonicalStreamEvent = {
              type: 'error',
              error: { message: lastError.message, code: 'stream_error' },
            };
            res.write(serializer.serialize(errorEvent));
            res.end();

            await this.logCall({ requestId, canonical, tier, score, nodeId: target.node, model: target.model,
              statusCode: 502, isFallback: !isFirstTarget, latencyMs: Date.now() - startTime,
              usage: { input_tokens: 0, output_tokens: 0 }, error: lastError.message, retryCount: totalRetries });
            return;
          }

          // Connection phase failure — check if retryable
          const statusCode = lastError instanceof ProviderError ? lastError.statusCode : 0;
          const isRetryable = retryConfig.retryable_status.includes(statusCode);
          const isLastAttempt = attempt >= maxAttempts - 1;

          if (isRetryable && !isLastAttempt) {
            totalRetries++;
            const delay = this.calculateBackoff(attempt, retryConfig, statusCode === 429 ? lastError : undefined);
            this.logger.warn(
              `Stream ${target.node} returned ${statusCode} (attempt ${attempt + 1}/${maxAttempts}), ` +
              `retrying in ${delay}ms...`,
            );
            await this.sleep(delay);
            continue;
          }

          // Not retryable or exhausted — move to next fallback
          this.logger.warn(
            `${isFirstTarget ? 'Primary' : 'Fallback'} node ${target.node} stream failed: ${lastError.message}` +
            (attempt > 0 ? ` (after ${attempt + 1} attempts)` : ''),
          );
          this.circuitBreaker.recordFailure(target.node, target.model);
          break; // break retry loop, continue to next target
        }
      }
    }

    // All nodes failed
    const errorMsg = lastError?.message || 'All nodes failed';
    const errorEvent: CanonicalStreamEvent = {
      type: 'error',
      error: { message: errorMsg, code: 'all_nodes_failed' },
    };
    res.write(serializer.serialize(errorEvent));
    res.end();

    await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
      statusCode: 502, isFallback: false, latencyMs: Date.now() - startTime,
      usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg, retryCount: totalRetries });
  }

  // ══════════════════════════════════════════════════════
  // Smart Route Resolution
  // ══════════════════════════════════════════════════════

  /**
   * Resolve routing with priority:
   *   1. Direct model match — exact ID, alias, node ID shortcut, or "nodeId/model" prefix
   *   2. Unknown model → fall through to auto routing (let the gateway decide)
   *   3. "auto" / no model → scoring engine picks tier → routing
   *
   * Philosophy: the gateway never rejects a model name. If it can figure out
   * which node you mean, it routes directly. Otherwise it uses smart routing.
   * The upstream API is the final authority on whether a model name is valid.
   */
  private resolveSmartRoute(canonical: CanonicalRequest): {
    route: { primary: { node: string; model: string }; fallbacks: { node: string; model: string }[] };
    tier: Tier;
    score: number;
  } {
    const requestedModel = canonical.metadata.original_model;

    if (this.shouldPinMessagesRequestToClaude(canonical)) {
      const claudeNode = this.config.getNode('claude');
      if (claudeNode) {
        const pinnedModel =
          requestedModel && requestedModel !== 'auto'
            ? this.resolvePinnedClaudeModel(requestedModel)
            : claudeNode.models[0];

        this.logger.log(
          `Pinned messages route: "${requestedModel || 'auto'}" → node "claude" (model: ${pinnedModel})`,
        );

        return {
          route: {
            primary: { node: 'claude', model: pinnedModel },
            fallbacks: [],
          },
          tier: 'direct',
          score: 0,
        };
      }
    }

    // ── 1. Direct model specification ──
    if (requestedModel && requestedModel !== 'auto') {
      const resolved = this.config.resolveModel(requestedModel);

      if (resolved) {
        this.logger.log(
          `Direct route: "${requestedModel}" → node "${resolved.nodeId}" (model: ${resolved.model})`,
        );

        // Build fallbacks from other nodes
        const fallbacks = this.buildDirectFallbacks(canonical, resolved.nodeId);

        return {
          route: {
            primary: { node: resolved.nodeId, model: resolved.model },
            fallbacks,
          },
          tier: 'direct',
          score: 0,
        };
      }

      // Unknown model — fall through to auto routing (not an error)
      this.logger.log(
        `Model "${requestedModel}" not recognized, falling through to auto routing`,
      );
    }

    // ── 2. Score-based routing (model = "auto" or unspecified) ──
    const scoringResult = this.scoringService.score(canonical);
    const routeDecision = this.routingService.resolve(
      scoringResult.tier,
      scoringResult.score,
      canonical.metadata.session_key,
      scoringResult.domainHint,
    );

    this.logger.log(
      `Scored route: score=${scoringResult.score.toFixed(4)} → tier="${routeDecision.tier}"` +
      `${routeDecision.momentumAdjusted ? ' (momentum-adjusted)' : ''}` +
      `${routeDecision.domainHint ? ` [domain: ${routeDecision.domainHint}]` : ''}` +
      ` → primary="${routeDecision.primary.node}"` +
      `${scoringResult.fastPath ? ` [fast-path: ${scoringResult.fastPath}]` : ''}`,
    );

    return {
      route: {
        primary: routeDecision.primary,
        fallbacks: routeDecision.fallbacks,
      },
      tier: routeDecision.tier,
      score: scoringResult.score,
    };
  }

  private buildDirectFallbacks(
    canonical: CanonicalRequest,
    primaryNodeId: string,
  ): { node: string; model: string }[] {
    if (this.shouldStayOnPrimaryNode(canonical, primaryNodeId)) {
      return [];
    }

    return this.config.nodes
      .filter((n) => n.id !== primaryNodeId)
      .map((n) => ({ node: n.id, model: n.models[0] }));
  }

  private shouldStayOnPrimaryNode(
    canonical: CanonicalRequest,
    primaryNodeId: string,
  ): boolean {
    return primaryNodeId === 'claude' && this.shouldPinMessagesRequestToClaude(canonical);
  }

  private shouldPinMessagesRequestToClaude(canonical: CanonicalRequest): boolean {
    if (canonical.metadata.source_format !== 'messages') {
      return false;
    }

    const headers = canonical.metadata.raw_headers || {};
    const userAgent = (headers['user-agent'] || '').toLowerCase();
    const betas = (headers['anthropic-beta'] || '').toLowerCase();
    const model = (canonical.metadata.original_model || '').toLowerCase();

    if (userAgent.includes('claude')) {
      return true;
    }

    if (betas.includes('claude-code')) {
      return true;
    }

    return ['claude', 'opus', 'sonnet', 'haiku'].includes(model) || model.startsWith('claude-');
  }

  private resolvePinnedClaudeModel(requestedModel: string): string {
    const resolved = this.config.resolveModel(requestedModel);
    if (resolved?.nodeId === 'claude') {
      return resolved.model;
    }
    return requestedModel;
  }

  // ══════════════════════════════════════════════════════
  // Serializer Factory
  // ══════════════════════════════════════════════════════

  private createSerializer(sourceFormat: SourceFormat) {
    switch (sourceFormat) {
      case 'chat_completions': return new ChatCompletionsStreamSerializer();
      case 'responses': return new ResponsesStreamSerializer();
      case 'messages': return new MessagesStreamSerializer();
      default: return new ChatCompletionsStreamSerializer();
    }
  }

  // ══════════════════════════════════════════════════════
  // Response Denormalization for Client
  // ══════════════════════════════════════════════════════

  private denormalizeForClient(canonical: CanonicalResponse, sourceFormat: SourceFormat): Record<string, unknown> {
    switch (sourceFormat) {
      case 'chat_completions': return this.chatDenorm.denormalizeResponse(canonical);
      case 'responses': return this.respDenorm.denormalizeResponse(canonical);
      case 'messages': return this.msgDenorm.denormalizeResponse(canonical);
      default: return this.chatDenorm.denormalizeResponse(canonical);
    }
  }

  // ══════════════════════════════════════════════════════
  // Error Formatting
  // ══════════════════════════════════════════════════════

  private formatError(sourceFormat: SourceFormat, statusCode: number, message: string): Record<string, unknown> {
    switch (sourceFormat) {
      case 'chat_completions': return { error: { message, type: 'server_error', code: String(statusCode) } };
      case 'responses': return { error: { message, type: 'server_error', code: String(statusCode) } };
      case 'messages': return { type: 'error', error: { type: 'api_error', message } };
      default: return { error: { message } };
    }
  }

  // ══════════════════════════════════════════════════════
  // Call Logging
  // ══════════════════════════════════════════════════════

  async logCall(params: {
    requestId: string; canonical: CanonicalRequest; tier: Tier; score: number;
    nodeId: string; model: string; statusCode: number; isFallback: boolean;
    latencyMs: number; usage: TokenUsage; error: string | null;
    retryCount?: number;
  }): Promise<void> {
    try {
      const pricing = this.config.getModelPricing(params.model);
      const costUsd = pricing
        ? (params.usage.input_tokens / 1_000_000) * pricing.input +
          (params.usage.output_tokens / 1_000_000) * pricing.output
        : 0;

      const log = this.callLogRepo.create({
        request_id: params.requestId,
        source_format: params.canonical.metadata.source_format,
        tier: params.tier, score: params.score,
        node_id: params.nodeId, model: params.model,
        input_tokens: params.usage.input_tokens, output_tokens: params.usage.output_tokens,
        cost_usd: costUsd, latency_ms: params.latencyMs,
        status_code: params.statusCode, is_fallback: params.isFallback,
        session_key: params.canonical.metadata.session_key || null,
        error: params.error,
        api_key_name: params.canonical.metadata.api_key_name || null,
        retry_count: params.retryCount || 0,
      });
      const saved = await this.callLogRepo.save(log);

      // Push to SSE stream for real-time dashboard
      this.logEventBus.emit(saved);
    } catch (err) {
      this.logger.error(`Failed to log call: ${(err as Error).message}`);
    }
  }
}
