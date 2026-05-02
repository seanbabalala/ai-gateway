import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Response as ExpressResponse } from 'express';
import { SpanKind } from '@opentelemetry/api';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { RetryConfig, ModelPricing, NodeConfig } from '../config/gateway.config';
import {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  SourceFormat,
  Tier,
  TokenUsage,
} from '../canonical/canonical.types';
import { detectRequestModalities } from '../canonical/modality-detection';
import {
  ProviderClientService,
  ProviderError,
} from '../providers/provider-client.service';
import { ScoringService } from '../scoring/scoring.service';
import { RoutingService } from '../routing/routing.service';
import { CircuitBreakerService } from '../routing/circuit-breaker.service';
import {
  ConcurrencyLease,
  ConcurrencyLimitError,
  ConcurrencyLimiterService,
} from '../routing/concurrency-limiter.service';
import { BudgetService, BudgetExceededError } from '../budget/budget.service';
import { PromptCacheService } from '../cache/prompt-cache.service';
import { LogEventBus } from '../dashboard/log-event-bus';
import { HookExecutorService } from '../plugins/hook-executor.service';
import { TelemetryUploaderService } from '../control-plane/telemetry-uploader.service';
import { ChatCompletionsDenormalizer } from '../canonical/denormalizers/chat-completions.denormalizer';
import { ResponsesDenormalizer } from '../canonical/denormalizers/responses.denormalizer';
import { MessagesDenormalizer } from '../canonical/denormalizers/messages.denormalizer';
import {
  ChatCompletionsStreamSerializer,
  ResponsesStreamSerializer,
  MessagesStreamSerializer,
} from '../providers/stream/stream-serializers';
import { CallLog } from '../database/entities/call-log.entity';
import { TelemetryService } from '../telemetry/telemetry.service';

export interface PipelineResult {
  body: Record<string, unknown>;
  statusCode: number;
}

interface SmartRouteResolution {
  route: {
    primary: { node: string; model: string };
    fallbacks: { node: string; model: string }[];
  };
  tier: Tier;
  score: number;
  domainHint: string | null;
  modalityHints?: string[];
  experimentGroup: string | null;
  experimentGroupsByTarget: Record<string, string>;
}

class GatewayRequestRejectedError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GatewayRequestRejectedError';
  }
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  private readonly chatDenorm = new ChatCompletionsDenormalizer();
  private readonly respDenorm = new ResponsesDenormalizer();
  private readonly msgDenorm = new MessagesDenormalizer();

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly providerClient: ProviderClientService,
    private readonly scoringService: ScoringService,
    private readonly routingService: RoutingService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly concurrencyLimiter: ConcurrencyLimiterService,
    private readonly budgetService: BudgetService,
    private readonly cacheService: PromptCacheService,
    private readonly logEventBus: LogEventBus,
    private readonly hooks: HookExecutorService,
    private readonly telemetry: TelemetryService,
    private readonly telemetryUploader: TelemetryUploaderService,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  // ══════════════════════════════════════════════════════
  // Non-Streaming Process
  // ══════════════════════════════════════════════════════

  async process(canonical: CanonicalRequest): Promise<PipelineResult> {
    const requestId = uuidv4();
    const startTime = Date.now();

    return this.telemetry.withSpan(
      'gateway.request',
      {
        'gateway.request_id': requestId,
        'gateway.source_format': canonical.metadata.source_format,
        'gateway.model': canonical.metadata.original_model || 'auto',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.stream': false,
      },
      async (rootSpan) => {
        const store = new Map<string, unknown>();
        let currentPhase = 'preRequest';

        try {
          // ── preRequest Hook ──
          if (!this.hooks.isEmpty()) {
            const hookResult = await this.hooks.run(
              'preRequest',
              { request: canonical } as Record<string, unknown>,
              store,
              this.config.getFullConfig(),
            );
            if (hookResult.shortCircuit) {
              const scResponse = hookResult.shortCircuit as CanonicalResponse;
              currentPhase = 'budgetCheck';
              try {
                await this.checkBudget(canonical);
              } catch (err) {
                if (err instanceof BudgetExceededError) {
                  this.logger.warn(`Budget exceeded: ${err.message}`);
                  return {
                    body: this.formatBudgetError(canonical.metadata.source_format, err),
                    statusCode: 429,
                  };
                }
                throw err;
              }
              currentPhase = 'budgetRecord';
              await this.recordBudgetUsage(canonical, scResponse.usage, scResponse.model);
              await this.logCall({
                requestId,
                canonical,
                tier: 'direct',
                score: 0,
                nodeId: 'hook',
                model: scResponse.model,
                statusCode: 200,
                isFallback: false,
                latencyMs: Date.now() - startTime,
                usage: scResponse.usage,
                error: null,
                retryCount: 0,
              });
              return {
                body: this.denormalizeForClient(scResponse, canonical.metadata.source_format),
                statusCode: 200,
              };
            }
            canonical = (hookResult.data as { request: CanonicalRequest }).request;
          }

          // ── Budget Check ──
          currentPhase = 'budgetCheck';
          try {
            await this.checkBudget(canonical);
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              this.logger.warn(`Budget exceeded: ${err.message}`);
              return {
                body: this.formatBudgetError(canonical.metadata.source_format, err),
                statusCode: 429,
              };
            }
            throw err;
          }

          // ── Cache Lookup ──
          currentPhase = 'cacheLookup';
          const cacheStart = Date.now();
          if (this.cacheService.shouldCache(canonical)) {
            const cached = this.cacheService.lookup(canonical);
            if (cached) {
              const cacheLatency = Date.now() - cacheStart;
              this.telemetry.cacheOperations.add(1, { operation: 'hit' });
              rootSpan.setAttribute('gateway.cache', 'hit');
              const responseBody = this.denormalizeForClient(cached, canonical.metadata.source_format);
              await this.recordBudgetUsage(canonical, cached.usage, cached.model);
              await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
                model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
                usage: cached.usage, error: null, retryCount: 0 });
              return { body: responseBody, statusCode: 200 };
            }
            this.telemetry.cacheOperations.add(1, { operation: 'miss' });
          }

          // ── Route Resolution ──
          currentPhase = 'routeResolution';
          const { route, tier, score, domainHint, modalityHints, experimentGroup, experimentGroupsByTarget } =
            await this.resolveSmartRoute(canonical, store);
          rootSpan.setAttributes({ 'gateway.tier': tier, 'gateway.score': score });
          const retryConfig = this.config.retry;

          let canonicalResponse: CanonicalResponse | null = null;
          let usedNodeId = route.primary.node;
          let usedModel = route.primary.model;
          let isFallback = false;
          let lastError: Error | null = null;
          let totalRetries = 0;

          // Try primary with retries
          currentPhase = 'preUpstream';
          const primaryResult = await this.tryNodeWithRetry(
            canonical, route.primary.node, route.primary.model,
            { tier, score, is_fallback: false }, retryConfig, store,
          );
          totalRetries += primaryResult.retries;
          usedNodeId = route.primary.node;
          usedModel = route.primary.model;

          if (primaryResult.response) {
            canonicalResponse = primaryResult.response;
          } else {
            lastError = primaryResult.lastError;
          }

          // Try fallbacks with retries
          if (!canonicalResponse && route.fallbacks.length > 0) {
            for (const fb of route.fallbacks) {
              this.logger.log(`Trying fallback: ${fb.node} (${fb.model})`);
              usedNodeId = fb.node;
              usedModel = fb.model;
              currentPhase = 'preUpstream';
              const fbResult = await this.tryNodeWithRetry(
                canonical, fb.node, fb.model,
                { tier, score, is_fallback: true }, retryConfig, store,
              );
              totalRetries += fbResult.retries;

              if (fbResult.response) {
                canonicalResponse = fbResult.response;
                isFallback = true;
                break;
              }
              lastError = fbResult.lastError;
            }
          }

          if (!canonicalResponse) {
            const errorMsg = lastError?.message || 'All nodes failed';
            const failureStatus = this.resolveFailureStatus(lastError);
            const recovered = await this.runOnErrorHooks(
              canonical,
              lastError || new Error(errorMsg),
              'upstreamFailure',
              store,
            );
            const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
              experimentGroupsByTarget,
              usedNodeId,
              usedModel,
              experimentGroup,
            );
            if (recovered) {
              await this.recordSyntheticSuccess({
                requestId,
                canonical,
                response: recovered,
                tier,
                score,
                nodeId: 'hook',
                latencyMs: Date.now() - startTime,
                retryCount: totalRetries,
                experimentGroup: resolvedExperimentGroup,
              });
              return {
                body: this.denormalizeForClient(recovered, canonical.metadata.source_format),
                statusCode: 200,
              };
            }
            this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
            await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
              statusCode: failureStatus,
              isFallback, latencyMs: 0, usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg,
              retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
              domainHint, modalityHints });
            return {
              body: this.formatError(canonical.metadata.source_format, failureStatus, errorMsg),
              statusCode: failureStatus,
            };
          }

          // ── postUpstream Hook ──
          currentPhase = 'postUpstream';
          if (!this.hooks.isEmpty()) {
            const hookResult = await this.hooks.run(
              'postUpstream',
              { request: canonical, response: canonicalResponse } as Record<string, unknown>,
              store,
              this.config.getFullConfig(),
            );
            canonicalResponse = (hookResult.data as { response: CanonicalResponse }).response;
          }

          let responseBody = this.denormalizeForClient(canonicalResponse, canonical.metadata.source_format);

          // ── preResponse Hook ──
          currentPhase = 'preResponse';
          if (!this.hooks.isEmpty()) {
            const hookResult = await this.hooks.run(
              'preResponse',
              { request: canonical, body: responseBody } as Record<string, unknown>,
              store,
              this.config.getFullConfig(),
            );
            responseBody = (hookResult.data as { body: Record<string, unknown> }).body;
          }

          // ── Cache Store ──
          currentPhase = 'cacheStore';
          this.cacheService.store(canonical, canonicalResponse);
          this.telemetry.cacheOperations.add(1, { operation: 'store' });

          // ── Budget Record ──
          currentPhase = 'budgetRecord';
          const { costUsd, totalTokens } = await this.recordBudgetUsage(
            canonical,
            canonicalResponse.usage,
            usedModel,
          );

          // ── Telemetry Metrics ──
          const durationMs = Date.now() - startTime;
          rootSpan.setAttributes({
            'gateway.node': usedNodeId,
            'gateway.model': usedModel,
            'gateway.is_fallback': isFallback,
            'gen_ai.request.model': usedModel,
            'gen_ai.usage.input_tokens': canonicalResponse.usage.input_tokens,
            'gen_ai.usage.output_tokens': canonicalResponse.usage.output_tokens,
          });
          this.telemetry.requestTotal.add(1, { tier, node: usedNodeId, model: usedModel, status: 200 });
          this.telemetry.requestDuration.record(durationMs, { tier, node: usedNodeId });
          this.telemetry.tokensUsage.add(totalTokens, { node: usedNodeId, model: usedModel, direction: 'total' });
          if (costUsd > 0) {
            this.telemetry.costTotal.add(costUsd, { node: usedNodeId, model: usedModel });
          }

          const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
            experimentGroupsByTarget,
            usedNodeId,
            usedModel,
            experimentGroup,
          );
          await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
            statusCode: 200, isFallback, latencyMs: canonicalResponse.routing.latency_ms,
            usage: canonicalResponse.usage, error: null, retryCount: totalRetries,
            experimentGroup: resolvedExperimentGroup, domainHint, modalityHints });

          return { body: responseBody, statusCode: 200 };
        } catch (err) {
          const recovered = await this.runOnErrorHooks(
            canonical,
            err as Error,
            currentPhase,
            store,
          );
          if (recovered) {
            await this.recordSyntheticSuccess({
              requestId,
              canonical,
              response: recovered,
              tier: 'direct',
              score: 0,
              nodeId: 'hook',
              latencyMs: Date.now() - startTime,
            });
            return {
              body: this.denormalizeForClient(recovered, canonical.metadata.source_format),
              statusCode: 200,
            };
          }
          if (err instanceof GatewayRequestRejectedError) {
            return {
              body: this.formatError(
                canonical.metadata.source_format,
                err.statusCode,
                err.message,
              ),
              statusCode: err.statusCode,
            };
          }
          throw err;
        }
      }, // end of async (rootSpan)
      SpanKind.SERVER,
    ); // end of withSpan
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
    store?: Map<string, unknown>,
  ): Promise<{ response: CanonicalResponse | null; lastError: Error | null; retries: number }> {
    const maxAttempts = 1 + retryConfig.max_retries; // 1 initial + N retries
    let lastError: Error | null = null;
    let retries = 0;
    let requestForNode = canonical;

    if (store) {
      const preUpstreamResult = await this.runPreUpstreamHooks(
        canonical,
        nodeId,
        model,
        store,
      );
      if (preUpstreamResult.shortCircuit) {
        return {
          response: preUpstreamResult.shortCircuit,
          lastError: null,
          retries,
        };
      }
      requestForNode = preUpstreamResult.request;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.withConcurrencySlot(
          nodeId,
          model,
          () =>
            this.providerClient.forward(
              requestForNode,
              nodeId,
              model,
              routingMeta,
            ),
        );
        this.circuitBreaker.recordSuccess(nodeId, model);
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          response.routing.latency_ms,
          200,
        );
        return { response, lastError: null, retries };
      } catch (err) {
        lastError = err as Error;
        if (lastError instanceof ConcurrencyLimitError) {
          this.logger.warn(lastError.message);
          if (!lastError.fallbackAllowed) {
            throw new GatewayRequestRejectedError(
              lastError.message,
              lastError.statusCode,
            );
          }
          return { response: null, lastError, retries };
        }
        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          Date.now() - attemptStart,
          statusCode || 0,
        );
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

  private async withConcurrencySlot<T>(
    nodeId: string,
    model: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquireConcurrencySlot(nodeId, model);
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }

  private async acquireConcurrencySlot(
    nodeId: string,
    model: string,
  ): Promise<ConcurrencyLease> {
    const node = this.config.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    return this.concurrencyLimiter.acquire(node, model);
  }

  // ══════════════════════════════════════════════════════
  // Streaming Process
  // ══════════════════════════════════════════════════════

  async processStream(
    canonical: CanonicalRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const requestId = uuidv4();
    const streamStartTime = Date.now();
    const store = new Map<string, unknown>();
    let currentPhase = 'preRequest';
    let headersFlushed = false;

    // Manual span for streaming (can't use withSpan with generators)
    const rootSpan = this.telemetry.tracer.startSpan('gateway.request', {
      kind: SpanKind.SERVER,
      attributes: {
        'gateway.request_id': requestId,
        'gateway.source_format': canonical.metadata.source_format,
        'gateway.model': canonical.metadata.original_model || 'auto',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.stream': true,
      },
    });

    const ensureStreamHeaders = () => {
      if (headersFlushed) return;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      headersFlushed = true;
    };

    try {
      // ── preRequest Hook (stream) ──
      if (!this.hooks.isEmpty()) {
        const hookResult = await this.hooks.run(
          'preRequest',
          { request: canonical } as Record<string, unknown>,
          store,
          this.config.getFullConfig(),
        );
        if (hookResult.shortCircuit) {
          const scResponse = hookResult.shortCircuit as CanonicalResponse;
          currentPhase = 'budgetCheck';
          try {
            await this.checkBudget(canonical);
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              this.logger.warn(`Budget exceeded (stream): ${err.message}`);
              res.status(429).json(
                this.formatBudgetError(canonical.metadata.source_format, err),
              );
              rootSpan.end();
              return;
            }
            throw err;
          }
          currentPhase = 'budgetRecord';
          await this.recordBudgetUsage(canonical, scResponse.usage, scResponse.model);
          await this.logCall({
            requestId,
            canonical,
            tier: 'direct',
            score: 0,
            nodeId: 'hook',
            model: scResponse.model,
            statusCode: 200,
            isFallback: false,
            latencyMs: Date.now() - streamStartTime,
            usage: scResponse.usage,
            error: null,
            retryCount: 0,
          });
          this.writeSyntheticStreamResponse(res, canonical.metadata.source_format, scResponse);
          rootSpan.end();
          return;
        }
        canonical = (hookResult.data as { request: CanonicalRequest }).request;
      }

      // ── Budget Check ──
      currentPhase = 'budgetCheck';
      try {
        await this.checkBudget(canonical);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          this.logger.warn(`Budget exceeded (stream): ${err.message}`);
          res.status(429).json(
            this.formatBudgetError(canonical.metadata.source_format, err),
          );
          rootSpan.end();
          return;
        }
        throw err;
      }

      // ── Cache Lookup (stream) ──
      currentPhase = 'cacheLookup';
      if (this.cacheService.shouldCache(canonical)) {
        const cacheStart = Date.now();
        const cached = this.cacheService.lookup(canonical);
        if (cached) {
          const cacheLatency = Date.now() - cacheStart;

          await this.recordBudgetUsage(canonical, cached.usage, cached.model);
          this.writeSyntheticStreamResponse(res, canonical.metadata.source_format, cached);

          await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
            model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
            usage: cached.usage, error: null, retryCount: 0 });
          this.telemetry.cacheOperations.add(1, { operation: 'hit' });
          rootSpan.setAttribute('gateway.cache', 'hit');
          rootSpan.end();
          return;
        }
      }

      const { route, tier, score, domainHint, modalityHints, experimentGroup, experimentGroupsByTarget } =
        await this.resolveSmartRoute(canonical, store);
      const retryConfig = this.config.retry;

      const startTime = Date.now();

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
        usedNodeId = target.node;
        usedModel = target.model;
        isFallback = !isFirstTarget;

        currentPhase = 'preUpstream';
        const preUpstreamResult = await this.runPreUpstreamHooks(
          canonical,
          target.node,
          target.model,
          store,
        );
        if (preUpstreamResult.shortCircuit) {
          const scResponse = preUpstreamResult.shortCircuit;
          await this.recordBudgetUsage(canonical, scResponse.usage, scResponse.model);
          const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
            experimentGroupsByTarget,
            target.node,
            target.model,
            experimentGroup,
          );
          await this.logCall({
            requestId,
            canonical,
            tier,
            score,
            nodeId: target.node,
            model: scResponse.model,
            statusCode: 200,
            isFallback: !isFirstTarget,
            latencyMs: Date.now() - startTime,
            usage: scResponse.usage,
            error: null,
            retryCount: totalRetries,
            experimentGroup: resolvedExperimentGroup,
            domainHint,
            modalityHints,
          });
          this.writeSyntheticStreamResponse(
            res,
            canonical.metadata.source_format,
            scResponse,
          );
          rootSpan.end();
          return;
        }
        const requestForTarget = preUpstreamResult.request;

        // Connection-phase retry loop for this target
        const maxAttempts = 1 + retryConfig.max_retries;
        let connected = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const lease = await this.acquireConcurrencySlot(
              target.node,
              target.model,
            );
            try {
              const stream = this.providerClient.forwardStream(
                requestForTarget, target.node, target.model,
              );

              // Stream events to client
              const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
              const accumulatedText: string[] = []; // For cache store
              let streamModel = '';
              let streamId = '';
              let streamStopReason = '';

              currentPhase = 'upstreamStream';
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
                  if (event.usage.cache_creation_input_tokens) usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
                  if (event.usage.cache_read_input_tokens) usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
                  streamStopReason = event.stop_reason;
                }

                // ── streamEvent Hook ──
                let outputEvent = event;
                if (!this.hooks.isEmpty()) {
                  const hookResult = await this.hooks.run(
                    'streamEvent',
                    { request: requestForTarget, event } as Record<string, unknown>,
                    store,
                    this.config.getFullConfig(),
                  );
                  if (hookResult.shortCircuit && (hookResult.shortCircuit as Record<string, unknown>).__drop) {
                    continue; // Drop this event
                  }
                  outputEvent = (hookResult.data as { event: CanonicalStreamEvent }).event;
                }

                const sseText = serializer.serialize(outputEvent);
                if (sseText) {
                  ensureStreamHeaders();
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

              const { costUsd } = await this.recordBudgetUsage(canonical, usage, usedModel);

              const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
                experimentGroupsByTarget,
                usedNodeId,
                usedModel,
                experimentGroup,
              );
              await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
                statusCode: 200, isFallback, latencyMs, usage, error: null,
                retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
                domainHint, modalityHints });

              // ── Telemetry Metrics (stream success) ──
              const streamTotalTokens = usage.input_tokens + usage.output_tokens;
              rootSpan.setAttributes({
                'gateway.tier': tier,
                'gateway.node': usedNodeId,
                'gateway.model': usedModel,
                'gateway.is_fallback': isFallback,
                'gen_ai.request.model': usedModel,
                'gen_ai.usage.input_tokens': usage.input_tokens,
                'gen_ai.usage.output_tokens': usage.output_tokens,
              });
              this.telemetry.requestTotal.add(1, { tier, node: usedNodeId, model: usedModel, status: 200 });
              this.telemetry.requestDuration.record(latencyMs, { tier, node: usedNodeId });
              this.telemetry.tokensUsage.add(streamTotalTokens, { node: usedNodeId, model: usedModel, direction: 'total' });
              if (costUsd > 0) {
                this.telemetry.costTotal.add(costUsd, { node: usedNodeId, model: usedModel });
              }

              res.end();
              rootSpan.end();
              return;
            } finally {
              lease.release();
            }
          } catch (err) {
            lastError = err as Error;
            if (lastError instanceof ConcurrencyLimitError) {
              this.logger.warn(lastError.message);
              if (!lastError.fallbackAllowed) {
                if (!headersFlushed) {
                  res.status(lastError.statusCode).json(
                    this.formatError(
                      canonical.metadata.source_format,
                      lastError.statusCode,
                      lastError.message,
                    ),
                  );
                  rootSpan.end();
                  return;
                }
                const errorEvent: CanonicalStreamEvent = {
                  type: 'error',
                  error: { message: lastError.message, code: 'concurrency_limited' },
                };
                ensureStreamHeaders();
                res.write(serializer.serialize(errorEvent));
                res.end();
                rootSpan.end();
                return;
              }
              break;
            }

            if (connected || streamConnected) {
              // Transmission phase — don't retry, send error event
              this.logger.warn(`Stream interrupted from ${target.node}: ${lastError.message}`);
              this.circuitBreaker.recordFailure(target.node, target.model);
              this.routingService.recordTargetResult?.(
                target.node,
                target.model,
                Date.now() - startTime,
                502,
              );
              const recovered = await this.runOnErrorHooks(
                canonical,
                lastError,
                'streamTransmission',
                store,
              );
              const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
                experimentGroupsByTarget,
                target.node,
                target.model,
                experimentGroup,
              );
              if (recovered && !headersFlushed) {
                await this.recordSyntheticSuccess({
                  requestId,
                  canonical,
                  response: recovered,
                  tier,
                  score,
                  nodeId: 'hook',
                  isFallback: !isFirstTarget,
                  latencyMs: Date.now() - startTime,
                  retryCount: totalRetries,
                  experimentGroup: resolvedExperimentGroup,
                });
                this.writeSyntheticStreamResponse(res, canonical.metadata.source_format, recovered);
                rootSpan.end();
                return;
              }
              const errorEvent: CanonicalStreamEvent = {
                type: 'error',
                error: { message: lastError.message, code: 'stream_error' },
              };
              ensureStreamHeaders();
              res.write(serializer.serialize(errorEvent));
              res.end();

              await this.logCall({ requestId, canonical, tier, score, nodeId: target.node, model: target.model,
                statusCode: 502, isFallback: !isFirstTarget, latencyMs: Date.now() - startTime,
                usage: { input_tokens: 0, output_tokens: 0 }, error: lastError.message,
                retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
                domainHint, modalityHints });
              this.telemetry.upstreamErrors.add(1, { node: target.node, reason: 'stream_error' });
              rootSpan.end();
              return;
            }

            // Connection phase failure — check if retryable
            const statusCode = lastError instanceof ProviderError ? lastError.statusCode : 0;
            this.routingService.recordTargetResult?.(
              target.node,
              target.model,
              Date.now() - startTime,
              statusCode || 0,
            );
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

      // All nodes failed before stream connected
      const errorMsg = lastError?.message || 'All nodes failed';
      const failureStatus = this.resolveFailureStatus(lastError);
      const recovered = await this.runOnErrorHooks(
        canonical,
        lastError || new Error(errorMsg),
        'upstreamFailure',
        store,
      );
      const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
        experimentGroupsByTarget,
        usedNodeId,
        usedModel,
        experimentGroup,
      );
      if (recovered) {
        await this.recordSyntheticSuccess({
          requestId,
          canonical,
          response: recovered,
          tier,
          score,
          nodeId: 'hook',
          isFallback,
          latencyMs: Date.now() - startTime,
          retryCount: totalRetries,
          experimentGroup: resolvedExperimentGroup,
        });
        this.writeSyntheticStreamResponse(res, canonical.metadata.source_format, recovered);
        rootSpan.end();
        return;
      }
      await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
        statusCode: failureStatus, isFallback, latencyMs: Date.now() - startTime,
        usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg,
        retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
        domainHint, modalityHints });
      this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
      res.status(failureStatus).json(
        this.formatError(canonical.metadata.source_format, failureStatus, errorMsg),
      );
      rootSpan.end();
    } catch (err) {
      const recovered = await this.runOnErrorHooks(
        canonical,
        err as Error,
        currentPhase,
        store,
      );
      if (recovered && !headersFlushed) {
        await this.recordSyntheticSuccess({
          requestId,
          canonical,
          response: recovered,
          tier: 'direct',
          score: 0,
          nodeId: 'hook',
          latencyMs: Date.now() - streamStartTime,
        });
        this.writeSyntheticStreamResponse(res, canonical.metadata.source_format, recovered);
        rootSpan.end();
        return;
      }

      if (err instanceof GatewayRequestRejectedError && !headersFlushed) {
        res.status(err.statusCode).json(
          this.formatError(
            canonical.metadata.source_format,
            err.statusCode,
            err.message,
          ),
        );
        rootSpan.end();
        return;
      }

      if (!headersFlushed) {
        const failureStatus = this.resolveFailureStatus(err as Error);
        res.status(failureStatus).json(
          this.formatError(
            canonical.metadata.source_format,
            failureStatus,
            (err as Error).message,
          ),
        );
      }
      rootSpan.end();
      if (headersFlushed) {
        throw err;
      }
    }
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
  private async resolveSmartRoute(
    canonical: CanonicalRequest,
    store?: Map<string, unknown>,
  ): Promise<SmartRouteResolution> {
    const requestedModel = canonical.metadata.original_model;

    if (this.shouldPinMessagesRequestToClaude(canonical)) {
      const pinnedNode = this.findPinnedMessagesNode(requestedModel);
      if (pinnedNode) {
        this.assertRouteModeAllowed(canonical, 'direct');
        const pinnedModel =
          requestedModel && requestedModel !== 'auto'
            ? this.resolvePinnedMessagesModel(requestedModel, pinnedNode.id)
            : pinnedNode.models[0];
        this.assertTargetAllowed(canonical, pinnedNode.id, pinnedModel);

        this.logger.log(
          `Pinned messages route: "${requestedModel || 'auto'}" → node "${pinnedNode.id}" (model: ${pinnedModel})`,
        );

        return {
          route: {
            primary: { node: pinnedNode.id, model: pinnedModel },
            fallbacks: [],
          },
          tier: 'direct',
          score: 0,
          domainHint: null,
          experimentGroup: null,
          experimentGroupsByTarget: {},
        };
      }
    }

    // ── 1. Direct model specification ──
    if (requestedModel && requestedModel !== 'auto') {
      const resolved = this.config.resolveModel(requestedModel);

      if (resolved) {
        this.assertRouteModeAllowed(canonical, 'direct');
        this.assertTargetAllowed(canonical, resolved.nodeId, resolved.model);
        this.logger.log(
          `Direct route: "${requestedModel}" → node "${resolved.nodeId}" (model: ${resolved.model})`,
        );

        // ── Vision mismatch warning for direct routes ──
        const reqModalities = detectRequestModalities(canonical);
        if (reqModalities.has('vision')) {
          const modelModalities = this.capabilityService.resolveModelModalities(
            resolved.nodeId,
            resolved.model,
          );
          if (!modelModalities.includes('vision')) {
            this.logger.warn(
              `Direct route: model "${resolved.model}" on node "${resolved.nodeId}" may not support vision, but proceeding as requested`,
            );
          }
        }

        // Build fallbacks from other nodes (modality-aware)
        const fallbacks = this.filterAllowedTargets(
          canonical,
          this.buildDirectFallbacks(canonical, resolved.nodeId),
        );

        return {
          route: {
            primary: { node: resolved.nodeId, model: resolved.model },
            fallbacks,
          },
          tier: 'direct',
          score: 0,
          domainHint: null,
          experimentGroup: null,
          experimentGroupsByTarget: {},
        };
      }

      // Unknown model — fall through to auto routing (not an error)
      if (canonical.metadata.api_key_permissions) {
        this.assertRouteModeAllowed(canonical, 'direct');
        throw new GatewayRequestRejectedError(
          `Model "${requestedModel}" is not configured. Use "auto" or a node/model prefix for direct routing.`,
          400,
        );
      }
      this.logger.log(
        `Model "${requestedModel}" not recognized, falling through to auto routing`,
      );
    }

    // ── 2. Score-based routing (model = "auto" or unspecified) ──
    this.assertRouteModeAllowed(canonical, 'auto');
    const scoringResult = this.telemetry.withSpanSync(
      'gateway.scoring',
      { 'gateway.requested_model': requestedModel || 'auto' },
      (span) => {
        const result = this.scoringService.score(canonical);
        span.setAttributes({
          'gateway.scoring.tier': result.tier,
          'gateway.scoring.score': result.score,
          'gateway.scoring.fast_path': result.fastPath || '',
          'gateway.scoring.domain_hint': result.domainHint || '',
        });
        return result;
      },
    );
    let effectiveTier = scoringResult.tier;
    let effectiveScore = scoringResult.score;

    // ── postScoring Hook ──
    if (store && !this.hooks.isEmpty()) {
      const hookResult = await this.hooks.run(
        'postScoring',
        {
          request: canonical,
          tier: scoringResult.tier,
          score: scoringResult.score,
          dimensions: scoringResult.dimensions,
        } as Record<string, unknown>,
        store,
        this.config.getFullConfig(),
      );
      const hookData = hookResult.data as { tier: Tier; score: number };
      effectiveTier = hookData.tier;
      effectiveScore = hookData.score;
    }

    const routeDecision = this.telemetry.withSpanSync(
      'gateway.routing',
      { 'gateway.tier': effectiveTier, 'gateway.score': effectiveScore },
      (span) => {
        const decision = this.routingService.resolve(
          effectiveTier,
          effectiveScore,
          canonical.metadata.session_key,
          scoringResult.domainHint,
          scoringResult.modalityHints,
        );
        span.setAttributes({
          'gateway.routing.primary_node': decision.primary.node,
          'gateway.routing.fallback_count': decision.fallbacks.length,
          'gateway.routing.experiment_group': decision.experimentGroup || '',
        });
        return decision;
      },
    );

    this.logger.log(
      `Scored route: score=${scoringResult.score.toFixed(4)} → tier="${routeDecision.tier}"` +
      `${routeDecision.momentumAdjusted ? ' (momentum-adjusted)' : ''}` +
      `${routeDecision.domainHint ? ` [domain: ${routeDecision.domainHint}]` : ''}` +
      `${scoringResult.modalityHints ? ` [modalities: ${scoringResult.modalityHints.join(',')}]` : ''}` +
      ` → primary="${routeDecision.primary.node}"` +
      `${scoringResult.fastPath ? ` [fast-path: ${scoringResult.fastPath}]` : ''}`,
    );

    const constrainedRoute = this.constrainAutoRoute(canonical, {
      primary: routeDecision.primary,
      fallbacks: routeDecision.fallbacks,
    });

    return {
      route: constrainedRoute,
      tier: routeDecision.tier,
      score: scoringResult.score,
      domainHint: routeDecision.domainHint || scoringResult.domainHint || null,
      modalityHints: scoringResult.modalityHints,
      experimentGroup: routeDecision.experimentGroup,
      experimentGroupsByTarget: routeDecision.experimentGroupsByTarget || {},
    };
  }

  private buildDirectFallbacks(
    canonical: CanonicalRequest,
    primaryNodeId: string,
  ): { node: string; model: string }[] {
    if (this.shouldStayOnPrimaryNode(canonical, primaryNodeId)) {
      return [];
    }

    const otherNodes = this.config.nodes
      .filter((n) => n.id !== primaryNodeId)
      .map((n) => ({ node: n.id, model: n.models[0] }));

    // If the request requires vision, sort vision-capable nodes first
    const reqModalities = detectRequestModalities(canonical);
    if (reqModalities.has('vision') && otherNodes.length > 1) {
      const compatible: { node: string; model: string }[] = [];
      const incompatible: { node: string; model: string }[] = [];

      for (const target of otherNodes) {
        const modalities = this.capabilityService.resolveModelModalities(
          target.node,
          target.model,
        );
        if (modalities.includes('vision')) {
          compatible.push(target);
        } else {
          incompatible.push(target);
        }
      }

      return [...compatible, ...incompatible];
    }

    return otherNodes;
  }

  private assertRouteModeAllowed(
    canonical: CanonicalRequest,
    mode: 'auto' | 'direct',
  ): void {
    const permissions = canonical.metadata.api_key_permissions;
    if (!permissions) return;

    if (mode === 'auto' && !permissions.allow_auto) {
      throw new GatewayRequestRejectedError(
        'This API key is not allowed to use automatic model routing.',
        403,
      );
    }

    if (mode === 'direct' && !permissions.allow_direct) {
      throw new GatewayRequestRejectedError(
        'This API key is not allowed to use direct model routing.',
        403,
      );
    }
  }

  private assertTargetAllowed(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
  ): void {
    if (this.isTargetAllowed(canonical, nodeId, model)) return;
    throw new GatewayRequestRejectedError(
      `This API key is not allowed to use ${nodeId}/${model}.`,
      403,
    );
  }

  private constrainAutoRoute(
    canonical: CanonicalRequest,
    route: {
      primary: { node: string; model: string };
      fallbacks: { node: string; model: string }[];
    },
  ): {
    primary: { node: string; model: string };
    fallbacks: { node: string; model: string }[];
  } {
    if (!canonical.metadata.api_key_permissions) return route;

    const allowedTargets = this.filterAllowedTargets(canonical, [
      route.primary,
      ...route.fallbacks,
    ]);

    if (allowedTargets.length === 0) {
      throw new GatewayRequestRejectedError(
        'This API key has no permitted models for the resolved automatic route.',
        403,
      );
    }

    return {
      primary: allowedTargets[0],
      fallbacks: allowedTargets.slice(1),
    };
  }

  private filterAllowedTargets(
    canonical: CanonicalRequest,
    targets: { node: string; model: string }[],
  ): { node: string; model: string }[] {
    return targets.filter((target) =>
      this.isTargetAllowed(canonical, target.node, target.model),
    );
  }

  private isTargetAllowed(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
  ): boolean {
    const permissions = canonical.metadata.api_key_permissions;
    if (!permissions) return true;

    const nodeAllowed =
      permissions.allowed_nodes.length === 0 ||
      permissions.allowed_nodes.includes(nodeId);
    const modelAllowed =
      permissions.allowed_models.length === 0 ||
      permissions.allowed_models.includes(model);

    return nodeAllowed && modelAllowed;
  }

  private shouldStayOnPrimaryNode(
    canonical: CanonicalRequest,
    primaryNodeId: string,
  ): boolean {
    return (
      this.config.getNode(primaryNodeId)?.protocol === 'messages' &&
      this.shouldPinMessagesRequestToClaude(canonical)
    );
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

  private findPinnedMessagesNode(requestedModel?: string): NodeConfig | undefined {
    if (requestedModel && requestedModel !== 'auto') {
      const resolved = this.config.resolveModel(requestedModel);
      const resolvedNode = resolved ? this.config.getNode(resolved.nodeId) : undefined;
      if (resolvedNode?.protocol === 'messages') {
        return resolvedNode;
      }
    }

    return this.config.nodes.find((node) => node.protocol === 'messages');
  }

  private resolvePinnedMessagesModel(requestedModel: string, nodeId: string): string {
    const resolved = this.config.resolveModel(requestedModel);
    if (resolved?.nodeId === nodeId) {
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

  private formatBudgetError(sourceFormat: SourceFormat, err: BudgetExceededError): Record<string, unknown> {
    const details = err.toDetails();
    switch (sourceFormat) {
      case 'messages':
        return {
          type: 'error',
          error: {
            type: 'budget_exceeded',
            message: err.message,
            details,
          },
        };
      case 'chat_completions':
      case 'responses':
      default:
        return {
          error: {
            message: err.message,
            type: 'budget_exceeded',
            code: err.budgetType,
            details,
          },
        };
    }
  }

  private resolveFailureStatus(err: Error | null | undefined): number {
    if (err instanceof ProviderError && err.statusCode > 0) {
      return err.statusCode;
    }
    if (err instanceof ConcurrencyLimitError) {
      return err.statusCode;
    }
    return 502;
  }

  private async runPreUpstreamHooks(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
    store: Map<string, unknown>,
  ): Promise<{ request: CanonicalRequest; shortCircuit?: CanonicalResponse }> {
    if (this.hooks.isEmpty()) {
      return { request: canonical };
    }

    const hookResult = await this.hooks.run(
      'preUpstream',
      { request: canonical, nodeId, model } as Record<string, unknown>,
      store,
      this.config.getFullConfig(),
    );

    if (hookResult.shortCircuit) {
      return {
        request: canonical,
        shortCircuit: hookResult.shortCircuit as CanonicalResponse,
      };
    }

    return {
      request: (hookResult.data as { request: CanonicalRequest }).request,
    };
  }

  private async runOnErrorHooks(
    canonical: CanonicalRequest,
    err: Error,
    phase: string,
    store: Map<string, unknown>,
  ): Promise<CanonicalResponse | null> {
    if (this.hooks.isEmpty()) {
      return null;
    }

    try {
      const hookResult = await this.hooks.run(
        'onError',
        { request: canonical, error: err, phase } as Record<string, unknown>,
        store,
        this.config.getFullConfig(),
      );
      if (hookResult.shortCircuit) {
        return hookResult.shortCircuit as CanonicalResponse;
      }
    } catch (hookErr) {
      this.logger.error(`onError hook failed: ${(hookErr as Error).message}`);
    }

    return null;
  }

  private writeSyntheticStreamResponse(
    res: ExpressResponse,
    sourceFormat: SourceFormat,
    canonical: CanonicalResponse,
  ): void {
    const serializer = this.createSerializer(sourceFormat);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const startEvt: CanonicalStreamEvent = { type: 'start', id: canonical.id, model: canonical.model };
    const startText = serializer.serialize(startEvt);
    if (startText) res.write(startText);

    for (const block of canonical.content) {
      if (block.type === 'text') {
        const deltaEvt: CanonicalStreamEvent = {
          type: 'delta',
          content: { type: 'text', text: block.text },
        };
        const deltaText = serializer.serialize(deltaEvt);
        if (deltaText) res.write(deltaText);
      }
    }

    const stopEvt: CanonicalStreamEvent = {
      type: 'stop',
      stop_reason: canonical.stop_reason,
      usage: canonical.usage,
    };
    const stopText = serializer.serialize(stopEvt);
    if (stopText) res.write(stopText);

    res.end();
  }

  private resolveExperimentGroupForTarget(
    experimentGroupsByTarget: Record<string, string> | undefined,
    nodeId: string,
    model: string,
    fallbackExperimentGroup: string | null,
  ): string | null {
    return experimentGroupsByTarget?.[this.buildExperimentTargetKey(nodeId, model)] || fallbackExperimentGroup;
  }

  private buildExperimentTargetKey(nodeId: string, model: string): string {
    return `${nodeId}:${model}`;
  }

  // ══════════════════════════════════════════════════════
  // Budget Accounting
  // ══════════════════════════════════════════════════════

  private async checkBudget(canonical: CanonicalRequest): Promise<void> {
    if (canonical.metadata.api_key_id) {
      await this.budgetService.check(
        canonical.metadata.api_key_name || undefined,
        canonical.metadata.api_key_id,
      );
      return;
    }

    await this.budgetService.check(canonical.metadata.api_key_name || undefined);
  }

  private async recordBudgetUsage(
    canonical: CanonicalRequest,
    usage: TokenUsage,
    model: string,
  ): Promise<{ totalTokens: number; costUsd: number }> {
    const pricing = this.config.getModelPricing(model);
    const costUsd = this.calculateCost(usage, pricing);
    const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);

    if (canonical.metadata.api_key_id) {
      await this.budgetService.record(
        totalTokens,
        costUsd,
        canonical.metadata.api_key_name || undefined,
        canonical.metadata.api_key_id,
      );
    } else {
      await this.budgetService.record(
        totalTokens,
        costUsd,
        canonical.metadata.api_key_name || undefined,
      );
    }

    return { totalTokens, costUsd };
  }

  private async recordSyntheticSuccess(params: {
    requestId: string;
    canonical: CanonicalRequest;
    response: CanonicalResponse;
    tier: Tier;
    score: number;
    nodeId: string;
    isFallback?: boolean;
    latencyMs: number;
    retryCount?: number;
    experimentGroup?: string | null;
    domainHint?: string | null;
    modalityHints?: string[];
  }): Promise<void> {
    await this.recordBudgetUsage(
      params.canonical,
      params.response.usage,
      params.response.model,
    );
    await this.logCall({
      requestId: params.requestId,
      canonical: params.canonical,
      tier: params.tier,
      score: params.score,
      nodeId: params.nodeId,
      model: params.response.model,
      statusCode: 200,
      isFallback: params.isFallback || false,
      latencyMs: params.latencyMs,
      usage: params.response.usage,
      error: null,
      retryCount: params.retryCount || 0,
      experimentGroup: params.experimentGroup || null,
      domainHint: params.domainHint,
      modalityHints: params.modalityHints,
    });
  }

  // ══════════════════════════════════════════════════════
  // Cost Calculation (cache-aware)
  // ══════════════════════════════════════════════════════

  private calculateCost(usage: TokenUsage, pricing?: ModelPricing): number {
    if (!pricing) return 0;
    const cacheCreate = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const normalInput = Math.max(0, usage.input_tokens - cacheCreate - cacheRead);
    return (
      (normalInput / 1_000_000) * pricing.input +
      (cacheCreate / 1_000_000) * (pricing.cache_creation_input ?? pricing.input) +
      (cacheRead / 1_000_000) * (pricing.cache_read_input ?? pricing.input) +
      (usage.output_tokens / 1_000_000) * pricing.output
    );
  }

  // ══════════════════════════════════════════════════════
  // Call Logging
  // ══════════════════════════════════════════════════════

  async logCall(params: {
    requestId: string; canonical: CanonicalRequest; tier: Tier; score: number;
    nodeId: string; model: string; statusCode: number; isFallback: boolean;
    latencyMs: number; usage: TokenUsage; error: string | null;
    retryCount?: number;
    experimentGroup?: string | null;
    domainHint?: string | null;
    modalityHints?: string[];
  }): Promise<void> {
    try {
      const pricing = this.config.getModelPricing(params.model);
      const costUsd = this.calculateCost(params.usage, pricing);

      const log = this.callLogRepo.create({
        request_id: params.requestId,
        source_format: params.canonical.metadata.source_format,
        tier: params.tier, score: params.score,
        node_id: params.nodeId, model: params.model,
        input_tokens: params.usage.input_tokens, output_tokens: params.usage.output_tokens,
        cache_creation_input_tokens: params.usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: params.usage.cache_read_input_tokens || 0,
        cost_usd: costUsd, latency_ms: params.latencyMs,
        status_code: params.statusCode, is_fallback: params.isFallback,
        session_key: params.canonical.metadata.session_key || null,
        error: params.error,
        api_key_name: params.canonical.metadata.api_key_name || null,
        api_key_id: params.canonical.metadata.api_key_id || null,
        retry_count: params.retryCount || 0,
        experiment_group: params.experimentGroup || null,
      });
      const saved = await this.callLogRepo.save(log);

      // Push to SSE stream for real-time dashboard
      this.logEventBus.emit(saved);

      // Optional hosted control-plane metadata upload. This is privacy-preserving:
      // it derives metadata only from CallLog and never includes prompt/response bodies.
      this.telemetryUploader.enqueue(saved, {
        domainHint: params.domainHint,
        modalities: params.modalityHints || Array.from(detectRequestModalities(params.canonical)),
      });
    } catch (err) {
      this.logger.error(`Failed to log call: ${(err as Error).message}`);
    }
  }
}
