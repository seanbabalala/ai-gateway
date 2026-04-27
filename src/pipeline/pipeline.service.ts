import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Response as ExpressResponse } from 'express';
import { ConfigService } from '../config/config.service';
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

    // ── Route Resolution ──
    // Priority: direct model match > scoring-based tier routing
    const { route, tier, score } = this.resolveSmartRoute(canonical);

    let canonicalResponse: CanonicalResponse;
    let usedNodeId = route.primary.node;
    let usedModel = route.primary.model;
    let isFallback = false;
    let lastError: Error | null = null;

    // Try primary
    try {
      canonicalResponse = await this.providerClient.forward(
        canonical, route.primary.node, route.primary.model,
        { tier, score, is_fallback: false },
      );
      this.circuitBreaker.recordSuccess(route.primary.node);
    } catch (err) {
      lastError = err as Error;
      this.logger.warn(`Primary node ${route.primary.node} failed: ${lastError.message}`);
      this.circuitBreaker.recordFailure(route.primary.node);
      canonicalResponse = null as unknown as CanonicalResponse;
    }

    // Try fallbacks
    if (!canonicalResponse && route.fallbacks.length > 0) {
      for (const fb of route.fallbacks) {
        try {
          this.logger.log(`Trying fallback: ${fb.node} (${fb.model})`);
          canonicalResponse = await this.providerClient.forward(
            canonical, fb.node, fb.model,
            { tier, score, is_fallback: true },
          );
          this.circuitBreaker.recordSuccess(fb.node);
          usedNodeId = fb.node;
          usedModel = fb.model;
          isFallback = true;
          break;
        } catch (err) {
          lastError = err as Error;
          this.logger.warn(`Fallback node ${fb.node} failed: ${lastError.message}`);
          this.circuitBreaker.recordFailure(fb.node);
        }
      }
    }

    if (!canonicalResponse) {
      const errorMsg = lastError?.message || 'All nodes failed';
      await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
        statusCode: lastError instanceof ProviderError ? lastError.statusCode : 502,
        isFallback, latencyMs: 0, usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg });
      return { body: this.formatError(canonical.metadata.source_format, 502, errorMsg), statusCode: 502 };
    }

    const responseBody = this.denormalizeForClient(canonicalResponse, canonical.metadata.source_format);

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
      usage: canonicalResponse.usage, error: null });

    return { body: responseBody, statusCode: 200 };
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
        // Send 429 as JSON before switching to SSE
        res.status(429).json(
          this.formatError(canonical.metadata.source_format, 429, err.message),
        );
        return;
      }
      throw err;
    }

    const { route, tier, score } = this.resolveSmartRoute(canonical);

    const startTime = Date.now();

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Create serializer for client's source format
    const serializer = this.createSerializer(canonical.metadata.source_format);

    // Try primary + fallbacks (connection-phase fallback only)
    const targets = [route.primary, ...route.fallbacks];
    let streamConnected = false;
    let usedNodeId = route.primary.node;
    let usedModel = route.primary.model;
    let isFallback = false;
    let lastError: Error | null = null;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const isFirstTarget = i === 0;

      try {
        const stream = this.providerClient.forwardStream(
          canonical, target.node, target.model,
        );

        // Stream events to client
        const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

        for await (const event of stream) {
          streamConnected = true;
          usedNodeId = target.node;
          usedModel = target.model;
          isFallback = !isFirstTarget;

          // Collect usage from stop event
          if (event.type === 'stop') {
            usage.input_tokens = event.usage.input_tokens;
            usage.output_tokens = event.usage.output_tokens;
          }

          // Serialize and send
          const sseText = serializer.serialize(event);
          if (sseText) {
            res.write(sseText);
          }
        }

        // Stream completed successfully — log and return
        const latencyMs = Date.now() - startTime;
        this.circuitBreaker.recordSuccess(target.node);

        // ── Budget Record ──
        const pricing = this.config.getModelPricing(usedModel);
        const costUsd = pricing
          ? (usage.input_tokens / 1_000_000) * pricing.input +
            (usage.output_tokens / 1_000_000) * pricing.output
          : 0;
        const totalTokens = usage.input_tokens + usage.output_tokens;
        await this.budgetService.record(totalTokens, costUsd);

        await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
          statusCode: 200, isFallback, latencyMs, usage, error: null });

        res.end();
        return;
      } catch (err) {
        lastError = err as Error;

        if (streamConnected) {
          // Transmission phase — don't fallback, send error event
          this.logger.warn(`Stream interrupted from ${target.node}: ${lastError.message}`);
          this.circuitBreaker.recordFailure(target.node);
          const errorEvent: CanonicalStreamEvent = {
            type: 'error',
            error: { message: lastError.message, code: 'stream_error' },
          };
          res.write(serializer.serialize(errorEvent));
          res.end();

          await this.logCall({ requestId, canonical, tier, score, nodeId: target.node, model: target.model,
            statusCode: 502, isFallback: !isFirstTarget, latencyMs: Date.now() - startTime,
            usage: { input_tokens: 0, output_tokens: 0 }, error: lastError.message });
          return;
        }

        // Connection phase — try next fallback
        this.logger.warn(
          `${isFirstTarget ? 'Primary' : 'Fallback'} node ${target.node} stream failed: ${lastError.message}`,
        );
        this.circuitBreaker.recordFailure(target.node);
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
      usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg });
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
      });
      const saved = await this.callLogRepo.save(log);

      // Push to SSE stream for real-time dashboard
      this.logEventBus.emit(saved);
    } catch (err) {
      this.logger.error(`Failed to log call: ${(err as Error).message}`);
    }
  }
}
