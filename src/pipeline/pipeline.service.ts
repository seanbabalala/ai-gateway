import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Response as ExpressResponse } from 'express';
import { SpanKind } from '@opentelemetry/api';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import {
  RetryConfig,
  ModelPricing,
  NodeConfig,
  RouteTarget,
} from '../config/gateway.config';
import {
  CanonicalRequest,
  CanonicalEmbeddingRequest,
  CanonicalEmbeddingResponse,
  CanonicalRerankRequest,
  CanonicalRerankResponse,
  CanonicalMediaRequest,
  CanonicalMediaResponse,
  CanonicalResponse,
  CanonicalStreamEvent,
  SourceFormat,
  Tier,
  TokenUsage,
} from '../canonical/canonical.types';
import { detectRequestModalities } from '../canonical/modality-detection';
import { Modality, supportsModalities } from '../config/modality';
import {
  normalizeStructuredOutputFromBody,
  resolveStructuredOutputForwarding,
  structuredOutputSchema,
} from '../canonical/structured-output';
import {
  normalizeReasoningFromBody,
  resolveReasoningForwarding,
} from '../canonical/reasoning-effort';
import {
  ProviderClientService,
  ProviderError,
} from '../providers/provider-client.service';
import { ScoringService } from '../scoring/scoring.service';
import {
  RoutingConstraintError,
  RoutingService,
  RouteSelectionHints,
} from '../routing/routing.service';
import { estimateCanonicalRequestTokens } from '../routing/token-estimator';
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
import {
  anthropicCompatibleError,
  applyGatewayRequestIdHeaders,
  openAiCompatibleError,
} from '../http/public-contract';
import { CallLog, RouteDecisionLog } from '../database/entities';
import { TelemetryService } from '../telemetry/telemetry.service';
import { AlertService } from '../alerts/alert.service';
import { LogSinkService } from '../log-sinks/log-sink.service';
import { EmbeddingBatchingService } from './embedding-batching.service';
import { ShadowTrafficService } from '../shadow/shadow-traffic.service';
import {
  RouteDecisionCandidateCapabilityEvidence,
  RouteDecisionCacheEvidence,
  RouteDecisionCompatibilityEvidence,
  RouteDecisionTrace,
  routeTargetKey,
} from '../routing/route-decision-trace';
import { pricingEvidenceFromModelPricing } from '../catalog/pricing-governance';
import { compatibilityEvidence } from '../catalog/compatibility-profiles';

export interface PipelineResult {
  body: Record<string, unknown> | Buffer | string;
  statusCode: number;
  contentType?: string;
  requestId?: string;
  nodeId?: string;
  model?: string;
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
  routeTrace: RouteDecisionTrace;
}

type FallbackReason =
  | 'upstream_error'
  | 'rate_limited'
  | 'timeout'
  | 'structured_output_parse_failed'
  | 'structured_output_schema_failed'
  | 'cost_downgrade'
  | 'concurrency_limited';

interface NodeAttemptResult {
  response: CanonicalResponse | null;
  lastError: Error | null;
  retries: number;
  fallbackReason: FallbackReason | null;
}

interface EmbeddingAttemptResult {
  response: CanonicalEmbeddingResponse | null;
  lastError: Error | null;
  retries: number;
  fallbackReason: FallbackReason | null;
}

interface RerankAttemptResult {
  response: CanonicalRerankResponse | null;
  lastError: Error | null;
  retries: number;
  fallbackReason: FallbackReason | null;
}

interface MediaAttemptResult {
  response: CanonicalMediaResponse | null;
  lastError: Error | null;
  retries: number;
  fallbackReason: FallbackReason | null;
}

interface PrimaryAttemptResult extends NodeAttemptResult {
  usedTarget: RouteTarget;
  usedFallback: boolean;
  fallbackFromNode: string | null;
  remainingFallbacks: RouteTarget[];
}

class StructuredOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly fallbackReason:
      | 'structured_output_parse_failed'
      | 'structured_output_schema_failed',
  ) {
    super(message);
    this.name = 'StructuredOutputValidationError';
  }
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

type LoggableCanonicalRequest =
  | CanonicalRequest
  | CanonicalEmbeddingRequest
  | CanonicalRerankRequest
  | CanonicalMediaRequest;

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
    @InjectRepository(RouteDecisionLog)
    private readonly routeDecisionRepo: Repository<RouteDecisionLog>,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly logSinks?: LogSinkService,
    @Optional() private readonly embeddingBatching?: EmbeddingBatchingService,
    @Optional() private readonly shadowTraffic?: ShadowTrafficService,
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
        'gateway.session_id':
          canonical.metadata.session_id || canonical.metadata.session_key || '',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.trace_id': canonical.metadata.trace_id || '',
        'gateway.stream': false,
        'gateway.structured_output.requested':
          canonical.structured_output?.requested ?? false,
        'gateway.structured_output.type':
          canonical.structured_output?.type || '',
        'gateway.reasoning.requested':
          canonical.reasoning?.requested ?? false,
        'gateway.reasoning.effort':
          canonical.reasoning_effort || '',
      },
      async (rootSpan) => {
        const store = new Map<string, unknown>([
          ['request_id', requestId],
          ['session_id', canonical.metadata.session_id || canonical.metadata.session_key || null],
          ['trace_id', canonical.metadata.trace_id || null],
        ]);
        let currentPhase = 'preRequest';

        try {
          this.assertApiKeyRequestAllowed(canonical);

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
                  return this.budgetErrorResult(
                    canonical.metadata.source_format,
                    err,
                    requestId,
                  );
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
              return this.successResult(
                requestId,
                this.denormalizeForClient(scResponse, canonical.metadata.source_format),
              );
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
              return this.budgetErrorResult(
                canonical.metadata.source_format,
                err,
                requestId,
              );
            }
            throw err;
          }

          // ── Cache Lookup ──
          currentPhase = 'cacheLookup';
          const cacheStart = Date.now();
          const promptCacheEligible = this.cacheService.shouldCache(canonical);
          store.set('local_prompt_cache_eligible', promptCacheEligible);
          store.set('local_prompt_cache_hit', false);
          store.set('local_prompt_cache_lookup', promptCacheEligible ? 'miss' : 'disabled');
          if (promptCacheEligible) {
            const cached = await this.lookupCachedResponse(canonical);
            if (cached) {
              store.set('local_prompt_cache_hit', true);
              store.set('local_prompt_cache_lookup', 'hit');
              const cacheLatency = Date.now() - cacheStart;
              this.telemetry.recordCacheHit();
              rootSpan.setAttribute('gateway.cache', 'hit');
              const responseBody = this.denormalizeForClient(cached, canonical.metadata.source_format);
              await this.recordBudgetUsage(canonical, cached.usage, cached.model);
              await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
                model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
                usage: cached.usage, error: null, retryCount: 0,
                routeTrace: this.buildPipelineRouteTrace({
                  mode: 'cache',
                  canonical,
                  tier: 'cached',
                  score: 0,
                  route: { primary: { node: 'cache', model: cached.model }, fallbacks: [] },
                  reason: 'local prompt cache hit',
                  selectionHints: this.cacheSelectionHintsFromStore(store),
                }) });
              return this.successResult(requestId, responseBody);
            }
            this.telemetry.recordCacheMiss();
          }

          const semanticCacheEligible =
            typeof this.cacheService.shouldSemanticCache === 'function'
              ? this.cacheService.shouldSemanticCache(canonical)
              : false;
          store.set('semantic_cache_enabled', this.config.semanticCache.enabled);
          store.set('semantic_cache_match', false);
          store.set('semantic_cache_hit', false);
          store.set('semantic_cache_score', null);
          store.set('semantic_cache_threshold', this.config.semanticCache.similarity_threshold);
          store.set('semantic_cache_metadata_only', false);
          store.set('semantic_cache_reason', semanticCacheEligible ? 'miss' : 'disabled');
          if (semanticCacheEligible) {
            const semanticStart = Date.now();
            const semantic = this.lookupSemanticCachedResponse(canonical);
            store.set('semantic_cache_match', semantic.matched);
            store.set('semantic_cache_hit', semantic.hit);
            store.set('semantic_cache_score', semantic.score);
            store.set('semantic_cache_threshold', semantic.threshold);
            store.set('semantic_cache_metadata_only', semantic.metadataOnly);
            store.set('semantic_cache_reason', semantic.reason);
            rootSpan.setAttribute('gateway.semantic_cache', semantic.reason);
            if (semantic.response) {
              const cacheLatency = Date.now() - semanticStart;
              this.telemetry.recordCacheHit();
              rootSpan.setAttribute('gateway.cache', 'semantic_hit');
              const responseBody = this.denormalizeForClient(
                semantic.response,
                canonical.metadata.source_format,
              );
              await this.recordBudgetUsage(
                canonical,
                semantic.response.usage,
                semantic.response.model,
              );
              await this.logCall({
                requestId,
                canonical,
                tier: 'cached',
                score: 0,
                nodeId: 'semantic_cache',
                model: semantic.response.model,
                statusCode: 200,
                isFallback: false,
                latencyMs: cacheLatency,
                usage: semantic.response.usage,
                error: null,
                retryCount: 0,
                semanticCacheHit: true,
                semanticCacheScore: semantic.score,
                routeTrace: this.buildPipelineRouteTrace({
                  mode: 'cache',
                  canonical,
                  tier: 'cached',
                  score: 0,
                  route: {
                    primary: { node: 'semantic_cache', model: semantic.response.model },
                    fallbacks: [],
                  },
                  reason: 'semantic cache hit',
                  selectionHints: this.cacheSelectionHintsFromStore(store),
                }),
              });
              return this.successResult(requestId, responseBody);
            }
          }

          // ── Route Resolution ──
          currentPhase = 'routeResolution';
          const { route, tier, score, domainHint, modalityHints, experimentGroup, experimentGroupsByTarget, routeTrace } =
            await this.resolveSmartRoute(canonical, store);
          rootSpan.setAttributes({ 'gateway.tier': tier, 'gateway.score': score });
          const retryConfig = this.config.retry;
          const costDowngrade = this.applyCostDowngrade(canonical, route, tier);
          const activeRoute = costDowngrade.route;
          const activeRouteTrace = this.applyCostDowngradeToTrace(
            routeTrace,
            route,
            activeRoute,
            costDowngrade.reason,
          );
          const originalPrimary = route.primary;

          let canonicalResponse: CanonicalResponse | null = null;
          let usedNodeId = activeRoute.primary.node;
          let usedModel = activeRoute.primary.model;
          let isFallback = costDowngrade.reason !== null;
          let lastError: Error | null = null;
          let totalRetries = 0;
          let fallbackReason: FallbackReason | null = costDowngrade.reason;
          let fallbackFromNode: string | null = costDowngrade.reason
            ? originalPrimary.node
            : null;
          let fallbacksToTry = activeRoute.fallbacks;

          // Try primary with retries
          currentPhase = 'preUpstream';
          const primaryResult = await this.tryPrimaryWithOptionalTimeoutRace(
            canonical,
            activeRoute.primary,
            fallbacksToTry,
            { tier, score, is_fallback: isFallback, fallback_reason: fallbackReason },
            retryConfig,
            store,
          );
          totalRetries += primaryResult.retries;
          usedNodeId = primaryResult.usedTarget.node;
          usedModel = primaryResult.usedTarget.model;
          fallbacksToTry = primaryResult.remainingFallbacks;

          if (primaryResult.response) {
            canonicalResponse = primaryResult.response;
            isFallback = isFallback || primaryResult.usedFallback;
            fallbackReason = primaryResult.fallbackReason || fallbackReason;
            fallbackFromNode = primaryResult.fallbackFromNode || fallbackFromNode;
          } else {
            lastError = primaryResult.lastError;
            fallbackReason = primaryResult.fallbackReason;
            fallbackFromNode = primaryResult.fallbackFromNode || activeRoute.primary.node;
          }

          // Try fallbacks with retries
          if (!canonicalResponse && fallbacksToTry.length > 0) {
            for (const fb of fallbacksToTry) {
              this.logger.log(`Trying fallback: ${fb.node} (${fb.model})`);
              usedNodeId = fb.node;
              usedModel = fb.model;
              currentPhase = 'preUpstream';
              const fbResult = await this.tryNodeWithRetry(
                canonical, fb.node, fb.model,
                {
                  tier,
                  score,
                  is_fallback: true,
                  fallback_reason: fallbackReason || 'upstream_error',
                },
                retryConfig,
                store,
              );
              totalRetries += fbResult.retries;

              if (fbResult.response) {
                canonicalResponse = fbResult.response;
                isFallback = true;
                fallbackReason = fallbackReason || 'upstream_error';
                break;
              }
              fallbackFromNode = fb.node;
              fallbackReason = fbResult.fallbackReason || fallbackReason;
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
                fallbackReason,
                fallbackFromNode,
                routeTrace: activeRouteTrace,
              });
              return this.successResult(
                requestId,
                this.denormalizeForClient(recovered, canonical.metadata.source_format),
              );
            }
            this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
            await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
              statusCode: failureStatus,
              isFallback, latencyMs: 0, usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg,
              retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
              domainHint, modalityHints, fallbackReason,
              fallbackFromNode, routeTrace: activeRouteTrace });
            return this.errorResult(
              canonical.metadata.source_format,
              failureStatus,
              errorMsg,
              requestId,
            );
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
          await this.storeCachedResponse(canonical, canonicalResponse);
          this.storeSemanticCachedResponse(canonical, canonicalResponse);
          this.telemetry.recordCacheStore();

          // ── Budget Record ──
          currentPhase = 'budgetRecord';
          const { costUsd, totalTokens } = await this.recordBudgetUsage(
            canonical,
            canonicalResponse.usage,
            usedModel,
            usedNodeId,
          );

          // ── Telemetry Metrics ──
          const durationMs = Date.now() - startTime;
          rootSpan.setAttributes({
            'gateway.node': usedNodeId,
            'gateway.model': usedModel,
            'gateway.is_fallback': isFallback,
            'gateway.fallback_reason': fallbackReason || '',
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
            experimentGroup: resolvedExperimentGroup, domainHint, modalityHints,
            fallbackReason, fallbackFromNode, routeTrace: activeRouteTrace });
          this.shadowTraffic?.enqueueChat(
            requestId,
            canonical,
            canonicalResponse,
            usedNodeId,
            usedModel,
          );

          return this.successResult(requestId, responseBody);
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
            return this.successResult(
              requestId,
              this.denormalizeForClient(recovered, canonical.metadata.source_format),
            );
          }
          if (err instanceof GatewayRequestRejectedError) {
            return this.errorResult(
              canonical.metadata.source_format,
              err.statusCode,
              err.message,
              requestId,
            );
          }
          if (err instanceof RoutingConstraintError) {
            return this.errorResult(
              canonical.metadata.source_format,
              err.statusCode,
              err.message,
              requestId,
            );
          }
          throw err;
        }
      }, // end of async (rootSpan)
      SpanKind.SERVER,
    ); // end of withSpan
  }

  async processEmbeddings(
    canonical: CanonicalEmbeddingRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<PipelineResult> {
    const requestId = uuidv4();
    const startTime = Date.now();
    const requestedModel = canonical.model || canonical.metadata.original_model || 'auto';

    return this.telemetry.withSpan(
      'gateway.request',
      {
        'gateway.request_id': requestId,
        'gateway.source_format': 'embeddings',
        'gateway.model': requestedModel,
        'gateway.session_id':
          canonical.metadata.session_id || canonical.metadata.session_key || '',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.trace_id': canonical.metadata.trace_id || '',
        'gateway.stream': false,
      },
      async (rootSpan) => {
        try {
          this.assertApiKeyRequestAllowed(canonical);

          const validationError = this.validateEmbeddingRequest(canonical);
          if (validationError) {
            return this.errorResult('embeddings', 400, validationError, requestId);
          }

          try {
            await this.checkBudget(canonical);
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              this.logger.warn(`Budget exceeded (embeddings): ${err.message}`);
              return this.budgetErrorResult('embeddings', err, requestId);
            }
            throw err;
          }

          this.assertRouteModeAllowed(
            canonical,
            requestedModel === 'auto' ? 'auto' : 'direct',
          );
          const route = this.routingService.resolveEmbeddingRoute(
            requestedModel,
            canonical.dimensions,
            (target) => this.isTargetAllowed(canonical, target.node, target.model),
          );
          const tier: Tier = route.mode === 'direct' ? 'direct' : 'standard';
          const targets = [route.primary, ...route.fallbacks];
          const retryConfig = this.config.retry;
          let response: CanonicalEmbeddingResponse | null = null;
          let lastError: Error | null = null;
          let totalRetries = 0;
          let usedNodeId = route.primary.node;
          let usedModel = route.primary.model;
          let isFallback = false;
          let fallbackReason: FallbackReason | null = null;
          let fallbackFromNode: string | null = null;

          for (const [index, target] of targets.entries()) {
            usedNodeId = target.node;
            usedModel = target.model;
            isFallback = index > 0;
            if (isFallback && !fallbackFromNode) {
              fallbackFromNode = route.primary.node;
              this.logger.log(`Trying embedding fallback: ${target.node} (${target.model})`);
            }

            const attempt = await this.tryEmbeddingNodeWithRetry(
              canonical,
              target.node,
              target.model,
              {
                tier,
                score: 0,
                is_fallback: isFallback,
                fallback_reason: isFallback ? fallbackReason || 'upstream_error' : null,
              },
              retryConfig,
              options,
            );
            totalRetries += attempt.retries;
            if (attempt.response) {
              response = attempt.response;
              fallbackReason = isFallback
                ? fallbackReason || attempt.fallbackReason || 'upstream_error'
                : attempt.fallbackReason;
              break;
            }
            lastError = attempt.lastError;
            fallbackReason = attempt.fallbackReason || fallbackReason;
          }

          if (!response) {
            const errorMsg = lastError?.message || 'All embedding nodes failed';
            const failureStatus = this.resolveFailureStatus(lastError);
            this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
            await this.logCall({
              requestId,
              canonical,
              tier,
              score: 0,
              nodeId: usedNodeId,
              model: usedModel,
              statusCode: failureStatus,
              isFallback,
              latencyMs: Date.now() - startTime,
              usage: { input_tokens: 0, output_tokens: 0 },
              error: errorMsg,
              retryCount: totalRetries,
              fallbackReason,
              fallbackFromNode,
              routeTrace: route.trace,
            });
            return this.errorResult(
              'embeddings',
              failureStatus,
              errorMsg,
              requestId,
            );
          }

          if (response.usage.input_tokens === 0) {
            response.usage.input_tokens = this.estimateEmbeddingInputTokens(canonical.input);
          }

          const { costUsd, totalTokens } = await this.recordBudgetUsage(
            canonical,
            response.usage,
            usedModel,
            usedNodeId,
          );
          const durationMs = Date.now() - startTime;
          rootSpan.setAttributes({
            'gateway.node': usedNodeId,
            'gateway.model': usedModel,
            'gateway.is_fallback': isFallback,
            'gateway.fallback_reason': fallbackReason || '',
            'gen_ai.request.model': usedModel,
            'gen_ai.usage.input_tokens': response.usage.input_tokens,
            'gen_ai.usage.output_tokens': response.usage.output_tokens,
          });
          this.telemetry.requestTotal.add(1, { tier, node: usedNodeId, model: usedModel, status: 200 });
          this.telemetry.requestDuration.record(durationMs, { tier, node: usedNodeId });
          this.telemetry.tokensUsage.add(totalTokens, { node: usedNodeId, model: usedModel, direction: 'total' });
          if (costUsd > 0) {
            this.telemetry.costTotal.add(costUsd, { node: usedNodeId, model: usedModel });
          }

          await this.logCall({
            requestId,
            canonical,
            tier,
            score: 0,
            nodeId: usedNodeId,
            model: usedModel,
            statusCode: 200,
            isFallback,
            latencyMs: response.routing.latency_ms,
            usage: response.usage,
            error: null,
            retryCount: totalRetries,
            fallbackReason,
            fallbackFromNode,
            routeTrace: route.trace,
          });
          this.shadowTraffic?.enqueueEmbeddings(
            requestId,
            canonical,
            response,
            usedNodeId,
            usedModel,
          );

          return this.successResult(
            requestId,
            this.denormalizeEmbeddingForClient(response),
          );
        } catch (err) {
          if (err instanceof GatewayRequestRejectedError) {
            return this.errorResult(
              'embeddings',
              err.statusCode,
              err.message,
              requestId,
            );
          }
          if (err instanceof RoutingConstraintError) {
            return this.errorResult(
              'embeddings',
              err.statusCode,
              err.message,
              requestId,
            );
          }
          throw err;
        }
      },
      SpanKind.SERVER,
    );
  }

  async processRerank(
    canonical: CanonicalRerankRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<PipelineResult> {
    const requestId = uuidv4();
    const startTime = Date.now();
    const requestedModel = canonical.model || canonical.metadata.original_model || 'auto';

    return this.telemetry.withSpan(
      'gateway.request',
      {
        'gateway.request_id': requestId,
        'gateway.source_format': 'rerank',
        'gateway.model': requestedModel,
        'gateway.session_id':
          canonical.metadata.session_id || canonical.metadata.session_key || '',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.trace_id': canonical.metadata.trace_id || '',
        'gateway.stream': false,
      },
      async (rootSpan) => {
        try {
          this.assertApiKeyRequestAllowed(canonical);

          const validationError = this.validateRerankRequest(canonical);
          if (validationError) {
            return this.errorResult('rerank', 400, validationError, requestId);
          }

          try {
            await this.checkBudget(canonical);
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              this.logger.warn(`Budget exceeded (rerank): ${err.message}`);
              return this.budgetErrorResult('rerank', err, requestId);
            }
            throw err;
          }

          this.assertRouteModeAllowed(
            canonical,
            requestedModel === 'auto' ? 'auto' : 'direct',
          );
          const route = this.routingService.resolveRerankRoute(
            requestedModel,
            (target) => this.isTargetAllowed(canonical, target.node, target.model),
            this.buildRerankRouteSelectionHints(canonical),
          );
          const tier: Tier = route.mode === 'direct' ? 'direct' : 'standard';
          const targets = [route.primary, ...route.fallbacks];
          const retryConfig = this.config.retry;
          let response: CanonicalRerankResponse | null = null;
          let lastError: Error | null = null;
          let totalRetries = 0;
          let usedNodeId = route.primary.node;
          let usedModel = route.primary.model;
          let isFallback = false;
          let fallbackReason: FallbackReason | null = null;
          let fallbackFromNode: string | null = null;

          for (const [index, target] of targets.entries()) {
            usedNodeId = target.node;
            usedModel = target.model;
            isFallback = index > 0;
            if (isFallback && !fallbackFromNode) {
              fallbackFromNode = route.primary.node;
              this.logger.log(`Trying rerank fallback: ${target.node} (${target.model})`);
            }

            const attempt = await this.tryRerankNodeWithRetry(
              canonical,
              target.node,
              target.model,
              {
                tier,
                score: 0,
                is_fallback: isFallback,
                fallback_reason: isFallback ? fallbackReason || 'upstream_error' : null,
              },
              retryConfig,
              options,
            );
            totalRetries += attempt.retries;
            if (attempt.response) {
              response = attempt.response;
              fallbackReason = isFallback
                ? fallbackReason || attempt.fallbackReason || 'upstream_error'
                : attempt.fallbackReason;
              break;
            }
            lastError = attempt.lastError;
            fallbackReason = attempt.fallbackReason || fallbackReason;
          }

          if (!response) {
            const errorMsg = lastError?.message || 'All rerank nodes failed';
            const failureStatus = this.resolveFailureStatus(lastError);
            this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
            await this.logCall({
              requestId,
              canonical,
              tier,
              score: 0,
              nodeId: usedNodeId,
              model: usedModel,
              statusCode: failureStatus,
              isFallback,
              latencyMs: Date.now() - startTime,
              usage: { input_tokens: 0, output_tokens: 0 },
              error: errorMsg,
              retryCount: totalRetries,
              fallbackReason,
              fallbackFromNode,
              routeTrace: route.trace,
            });
            return this.errorResult(
              'rerank',
              failureStatus,
              errorMsg,
              requestId,
            );
          }

          if (response.usage.input_tokens === 0) {
            response.usage.input_tokens = this.estimateRerankInputTokens(canonical);
          }

          const { costUsd, totalTokens } = await this.recordBudgetUsage(
            canonical,
            response.usage,
            usedModel,
            usedNodeId,
          );
          const durationMs = Date.now() - startTime;
          rootSpan.setAttributes({
            'gateway.node': usedNodeId,
            'gateway.model': usedModel,
            'gateway.is_fallback': isFallback,
            'gateway.fallback_reason': fallbackReason || '',
            'gen_ai.request.model': usedModel,
            'gen_ai.usage.input_tokens': response.usage.input_tokens,
            'gen_ai.usage.output_tokens': response.usage.output_tokens,
          });
          this.telemetry.requestTotal.add(1, { tier, node: usedNodeId, model: usedModel, status: 200 });
          this.telemetry.requestDuration.record(durationMs, { tier, node: usedNodeId });
          this.telemetry.tokensUsage.add(totalTokens, { node: usedNodeId, model: usedModel, direction: 'total' });
          if (costUsd > 0) {
            this.telemetry.costTotal.add(costUsd, { node: usedNodeId, model: usedModel });
          }

          await this.logCall({
            requestId,
            canonical,
            tier,
            score: 0,
            nodeId: usedNodeId,
            model: usedModel,
            statusCode: 200,
            isFallback,
            latencyMs: response.routing.latency_ms,
            usage: response.usage,
            error: null,
            retryCount: totalRetries,
            fallbackReason,
            fallbackFromNode,
            routeTrace: route.trace,
          });

          return this.successResult(
            requestId,
            this.denormalizeRerankForClient(response),
          );
        } catch (err) {
          if (err instanceof GatewayRequestRejectedError) {
            return this.errorResult(
              'rerank',
              err.statusCode,
              err.message,
              requestId,
            );
          }
          if (err instanceof RoutingConstraintError) {
            return this.errorResult(
              'rerank',
              err.statusCode,
              err.message,
              requestId,
            );
          }
          throw err;
        }
      },
      SpanKind.SERVER,
    );
  }

  async processMedia(
    canonical: CanonicalMediaRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<PipelineResult> {
    const requestId = uuidv4();
    const startTime = Date.now();
    const requestedModel = canonical.model || canonical.metadata.original_model || 'auto';

    return this.telemetry.withSpan(
      'gateway.request',
      {
        'gateway.request_id': requestId,
        'gateway.source_format': canonical.source_format,
        'gateway.model': requestedModel,
        'gateway.session_id':
          canonical.metadata.session_id || canonical.metadata.session_key || '',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.trace_id': canonical.metadata.trace_id || '',
        'gateway.stream': false,
        'gateway.media.type': canonical.media.media_type,
        'gateway.media.operation': canonical.media.operation,
        'gateway.media.multipart': canonical.media.multipart,
        'gateway.media.byte_size': canonical.media.byte_size,
      },
      async (rootSpan) => {
        try {
          this.assertApiKeyRequestAllowed(canonical);

          const validationError = this.validateMediaRequest(canonical);
          if (validationError) {
            return this.errorResult(
              canonical.source_format,
              400,
              validationError,
              requestId,
            );
          }

          try {
            await this.checkBudget(canonical);
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              this.logger.warn(`Budget exceeded (${canonical.source_format}): ${err.message}`);
              return this.budgetErrorResult(
                canonical.source_format,
                err,
                requestId,
              );
            }
            throw err;
          }

          this.assertRouteModeAllowed(
            canonical,
            requestedModel === 'auto' ? 'auto' : 'direct',
          );
          const route = this.routingService.resolveMediaRoute(
            canonical.source_format,
            requestedModel,
            (target) => this.isTargetAllowed(canonical, target.node, target.model),
            this.buildMediaRouteSelectionHints(canonical),
          );
          const tier: Tier = route.mode === 'direct' ? 'direct' : 'standard';
          const targets = [route.primary, ...route.fallbacks];
          const retryConfig = this.config.retry;
          let response: CanonicalMediaResponse | null = null;
          let lastError: Error | null = null;
          let totalRetries = 0;
          let usedNodeId = route.primary.node;
          let usedModel = route.primary.model;
          let isFallback = false;
          let fallbackReason: FallbackReason | null = null;
          let fallbackFromNode: string | null = null;

          for (const [index, target] of targets.entries()) {
            usedNodeId = target.node;
            usedModel = target.model;
            isFallback = index > 0;
            if (isFallback && !fallbackFromNode) {
              fallbackFromNode = route.primary.node;
              this.logger.log(`Trying ${canonical.source_format} fallback: ${target.node} (${target.model})`);
            }

            const attempt = await this.tryMediaNodeWithRetry(
              canonical,
              target.node,
              target.model,
              {
                tier,
                score: 0,
                is_fallback: isFallback,
                fallback_reason: isFallback ? fallbackReason || 'upstream_error' : null,
              },
              retryConfig,
              options,
            );
            totalRetries += attempt.retries;
            if (attempt.response) {
              response = attempt.response;
              fallbackReason = isFallback
                ? fallbackReason || attempt.fallbackReason || 'upstream_error'
                : attempt.fallbackReason;
              break;
            }
            lastError = attempt.lastError;
            fallbackReason = attempt.fallbackReason || fallbackReason;
          }

          if (!response) {
            const errorMsg = lastError?.message || `All ${canonical.source_format} nodes failed`;
            const failureStatus = this.resolveFailureStatus(lastError);
            this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
            await this.logCall({
              requestId,
              canonical,
              tier,
              score: 0,
              nodeId: usedNodeId,
              model: usedModel,
              statusCode: failureStatus,
              isFallback,
              latencyMs: Date.now() - startTime,
              usage: { input_tokens: 0, output_tokens: 0 },
              error: errorMsg,
              retryCount: totalRetries,
              fallbackReason,
              fallbackFromNode,
              routeTrace: route.trace,
            });
            return this.errorResult(
              canonical.source_format,
              failureStatus,
              errorMsg,
              requestId,
            );
          }

          if (response.usage.input_tokens === 0 && response.usage.output_tokens === 0) {
            response.usage.input_tokens = this.estimateMediaInputTokens(canonical);
          }

          const { costUsd, totalTokens } = await this.recordBudgetUsage(
            canonical,
            response.usage,
            usedModel,
            usedNodeId,
          );
          const durationMs = Date.now() - startTime;
          rootSpan.setAttributes({
            'gateway.node': usedNodeId,
            'gateway.model': usedModel,
            'gateway.is_fallback': isFallback,
            'gateway.fallback_reason': fallbackReason || '',
            'gen_ai.request.model': usedModel,
            'gen_ai.usage.input_tokens': response.usage.input_tokens,
            'gen_ai.usage.output_tokens': response.usage.output_tokens,
          });
          this.telemetry.requestTotal.add(1, { tier, node: usedNodeId, model: usedModel, status: 200 });
          this.telemetry.requestDuration.record(durationMs, { tier, node: usedNodeId });
          this.telemetry.tokensUsage.add(totalTokens, { node: usedNodeId, model: usedModel, direction: 'total' });
          if (costUsd > 0) {
            this.telemetry.costTotal.add(costUsd, { node: usedNodeId, model: usedModel });
          }

          await this.logCall({
            requestId,
            canonical,
            tier,
            score: 0,
            nodeId: usedNodeId,
            model: usedModel,
            statusCode: 200,
            isFallback,
            latencyMs: response.routing.latency_ms,
            usage: response.usage,
            error: null,
              retryCount: totalRetries,
              fallbackReason,
              fallbackFromNode,
              mediaProviderResponseType: response.provider_response_type,
              routeTrace: route.trace,
            });

          return this.successResult(requestId, response.body, 200, {
            contentType: response.content_type,
            nodeId: usedNodeId,
            model: usedModel,
          });
        } catch (err) {
          if (err instanceof GatewayRequestRejectedError) {
            return this.errorResult(
              canonical.source_format,
              err.statusCode,
              err.message,
              requestId,
            );
          }
          if (err instanceof RoutingConstraintError) {
            return this.errorResult(
              canonical.source_format,
              err.statusCode,
              err.message,
              requestId,
            );
          }
          throw err;
        }
      },
      SpanKind.SERVER,
    );
  }

  // ══════════════════════════════════════════════════════
  // Retry Helper — try a single node with retries + backoff
  // ══════════════════════════════════════════════════════

  private async tryPrimaryWithOptionalTimeoutRace(
    canonical: CanonicalRequest,
    primary: RouteTarget,
    fallbacks: RouteTarget[],
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    retryConfig: RetryConfig,
    store?: Map<string, unknown>,
  ): Promise<PrimaryAttemptResult> {
    const primaryPromise = this.tryNodeWithRetry(
      canonical,
      primary.node,
      primary.model,
      routingMeta,
      retryConfig,
      store,
    );

    const timeoutPolicy = this.config.fallbackPolicy.timeout;
    const shouldRace =
      timeoutPolicy.enabled &&
      timeoutPolicy.race_fallback &&
      timeoutPolicy.threshold_ms !== undefined &&
      fallbacks.length > 0;

    if (!shouldRace) {
      const result = await primaryPromise;
      return {
        ...result,
        usedTarget: primary,
        usedFallback: false,
        fallbackFromNode: result.fallbackReason ? primary.node : null,
        remainingFallbacks: fallbacks,
      };
    }

    const primaryWrapped = primaryPromise.then((result) => ({
      kind: 'primary' as const,
      result,
    }));
    const timeoutWrapped = this.sleep(timeoutPolicy.threshold_ms!).then(() => ({
      kind: 'timeout' as const,
    }));
    const first = await Promise.race([primaryWrapped, timeoutWrapped]);
    if (first.kind === 'primary') {
      return {
        ...first.result,
        usedTarget: primary,
        usedFallback: false,
        fallbackFromNode: first.result.fallbackReason ? primary.node : null,
        remainingFallbacks: fallbacks,
      };
    }

    const fallback = fallbacks[0];
    this.logger.warn(
      `Timeout race fallback: ${primary.node}/${primary.model} exceeded ` +
        `${timeoutPolicy.threshold_ms}ms; starting ${fallback.node}/${fallback.model}`,
    );

    const fallbackPromise = this.tryNodeWithRetry(
      canonical,
      fallback.node,
      fallback.model,
      {
        ...routingMeta,
        is_fallback: true,
        fallback_reason: 'timeout',
      },
      retryConfig,
      store,
    );
    primaryPromise.catch(() => undefined);
    fallbackPromise.catch(() => undefined);

    const fallbackWrapped = fallbackPromise.then((result) => ({
      kind: 'fallback' as const,
      result,
    }));
    const winner = await Promise.race([primaryWrapped, fallbackWrapped]);
    const remainingFallbacks = fallbacks.slice(1);

    if (winner.kind === 'fallback') {
      if (winner.result.response) {
        return {
          ...winner.result,
          usedTarget: fallback,
          usedFallback: true,
          fallbackReason: 'timeout',
          fallbackFromNode: primary.node,
          remainingFallbacks,
        };
      }
      const primaryResult = await primaryPromise;
      if (primaryResult.response) {
        return {
          ...primaryResult,
          usedTarget: primary,
          usedFallback: false,
          fallbackFromNode: primaryResult.fallbackReason ? primary.node : null,
          remainingFallbacks,
        };
      }
      return {
        ...winner.result,
        usedTarget: fallback,
        usedFallback: true,
        fallbackReason: winner.result.fallbackReason || 'timeout',
        fallbackFromNode: primary.node,
        remainingFallbacks,
      };
    }

    if (winner.result.response) {
      return {
        ...winner.result,
        usedTarget: primary,
        usedFallback: false,
        fallbackFromNode: winner.result.fallbackReason ? primary.node : null,
        remainingFallbacks,
      };
    }
    const fallbackResult = await fallbackPromise;
    if (fallbackResult.response) {
      return {
        ...fallbackResult,
        usedTarget: fallback,
        usedFallback: true,
        fallbackReason: 'timeout',
        fallbackFromNode: primary.node,
        remainingFallbacks,
      };
    }

    return {
      ...fallbackResult,
      usedTarget: fallback,
      usedFallback: true,
      fallbackReason: fallbackResult.fallbackReason || 'timeout',
      fallbackFromNode: primary.node,
      remainingFallbacks,
    };
  }

  private async tryNodeWithRetry(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    retryConfig: RetryConfig,
    store?: Map<string, unknown>,
  ): Promise<NodeAttemptResult> {
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
          fallbackReason: null,
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
            this.forwardWithFallbackTimeout(
              requestForNode,
              nodeId,
              model,
              routingMeta,
            ),
        );
        this.assertStructuredOutputResponse(requestForNode, response);
        this.circuitBreaker.recordSuccess(nodeId, model);
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          response.routing.latency_ms,
          200,
        );
        return { response, lastError: null, retries, fallbackReason: null };
      } catch (err) {
        lastError = err as Error;
        const fallbackReason = this.resolveFallbackReason(lastError);
        if (lastError instanceof ConcurrencyLimitError) {
          this.logger.warn(lastError.message);
          if (!lastError.fallbackAllowed) {
            throw new GatewayRequestRejectedError(
              lastError.message,
              lastError.statusCode,
            );
          }
          return {
            response: null,
            lastError,
            retries,
            fallbackReason: 'concurrency_limited',
          };
        }
        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          Date.now() - attemptStart,
          statusCode || 0,
        );
        const isRetryable = retryConfig.retryable_status.includes(statusCode);
        const shouldImmediateFallback =
          this.shouldImmediateFallback(lastError) || fallbackReason === 'timeout';
        const isLastAttempt = attempt >= maxAttempts - 1;

        if (!isRetryable || isLastAttempt || shouldImmediateFallback) {
          // Not retryable or exhausted retries — record failure and give up
          this.logger.warn(
            `Node ${nodeId} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}` +
            (isLastAttempt && attempt > 0 ? ' — retries exhausted' : '') +
            (shouldImmediateFallback ? ' — immediate fallback policy' : ''),
          );
          if (!(lastError instanceof StructuredOutputValidationError)) {
            this.circuitBreaker.recordFailure(nodeId, model);
          }
          return {
            response: null,
            lastError,
            retries,
            fallbackReason,
          };
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

    return {
      response: null,
      lastError,
      retries,
      fallbackReason: lastError ? this.resolveFallbackReason(lastError) : null,
    };
  }

  private async tryEmbeddingNodeWithRetry(
    canonical: CanonicalEmbeddingRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    retryConfig: RetryConfig,
    options: { signal?: AbortSignal } = {},
  ): Promise<EmbeddingAttemptResult> {
    const maxAttempts = 1 + retryConfig.max_retries;
    let lastError: Error | null = null;
    let retries = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.forwardEmbeddingsMaybeBatched(
          canonical,
          nodeId,
          model,
          routingMeta,
          options,
        );
        this.circuitBreaker.recordSuccess(nodeId, model);
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          response.routing.latency_ms,
          200,
        );
        return { response, lastError: null, retries, fallbackReason: null };
      } catch (err) {
        lastError = err as Error;
        const fallbackReason = this.resolveFallbackReason(lastError);
        if (lastError instanceof ConcurrencyLimitError) {
          this.logger.warn(lastError.message);
          if (!lastError.fallbackAllowed) {
            throw new GatewayRequestRejectedError(
              lastError.message,
              lastError.statusCode,
            );
          }
          return {
            response: null,
            lastError,
            retries,
            fallbackReason: 'concurrency_limited',
          };
        }

        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          Date.now() - attemptStart,
          statusCode || 0,
        );
        const isRetryable = retryConfig.retryable_status.includes(statusCode);
        const shouldImmediateFallback =
          this.shouldImmediateFallback(lastError) || fallbackReason === 'timeout';
        const isLastAttempt = attempt >= maxAttempts - 1;

        if (!isRetryable || isLastAttempt || shouldImmediateFallback) {
          this.logger.warn(
            `Embedding node ${nodeId} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}` +
            (isLastAttempt && attempt > 0 ? ' — retries exhausted' : '') +
            (shouldImmediateFallback ? ' — immediate fallback policy' : ''),
          );
          this.circuitBreaker.recordFailure(nodeId, model);
          return {
            response: null,
            lastError,
            retries,
            fallbackReason,
          };
        }

        retries++;
        const delay = this.calculateBackoff(
          attempt,
          retryConfig,
          statusCode === 429 ? lastError : undefined,
        );
        this.logger.warn(
          `Embedding node ${nodeId} returned ${statusCode} (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }

    return {
      response: null,
      lastError,
      retries,
      fallbackReason: lastError ? this.resolveFallbackReason(lastError) : null,
    };
  }

  private async tryRerankNodeWithRetry(
    canonical: CanonicalRerankRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    retryConfig: RetryConfig,
    options: { signal?: AbortSignal } = {},
  ): Promise<RerankAttemptResult> {
    const maxAttempts = 1 + retryConfig.max_retries;
    let lastError: Error | null = null;
    let retries = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.withConcurrencySlot(nodeId, model, () =>
          this.forwardRerankWithFallbackTimeout(
            canonical,
            nodeId,
            model,
            routingMeta,
            options,
          ),
        );
        this.circuitBreaker.recordSuccess(nodeId, model);
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          response.routing.latency_ms,
          200,
        );
        return { response, lastError: null, retries, fallbackReason: null };
      } catch (err) {
        lastError = err as Error;
        const fallbackReason = this.resolveFallbackReason(lastError);
        if (lastError instanceof ConcurrencyLimitError) {
          this.logger.warn(lastError.message);
          if (!lastError.fallbackAllowed) {
            throw new GatewayRequestRejectedError(
              lastError.message,
              lastError.statusCode,
            );
          }
          return {
            response: null,
            lastError,
            retries,
            fallbackReason: 'concurrency_limited',
          };
        }

        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          Date.now() - attemptStart,
          statusCode || 0,
        );
        const isRetryable = retryConfig.retryable_status.includes(statusCode);
        const shouldImmediateFallback =
          this.shouldImmediateFallback(lastError) || fallbackReason === 'timeout';
        const isLastAttempt = attempt >= maxAttempts - 1;

        if (!isRetryable || isLastAttempt || shouldImmediateFallback) {
          this.logger.warn(
            `Rerank node ${nodeId} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}` +
            (isLastAttempt && attempt > 0 ? ' — retries exhausted' : '') +
            (shouldImmediateFallback ? ' — immediate fallback policy' : ''),
          );
          this.circuitBreaker.recordFailure(nodeId, model);
          return {
            response: null,
            lastError,
            retries,
            fallbackReason,
          };
        }

        retries++;
        const delay = this.calculateBackoff(
          attempt,
          retryConfig,
          statusCode === 429 ? lastError : undefined,
        );
        this.logger.warn(
          `Rerank node ${nodeId} returned ${statusCode} (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }

    return {
      response: null,
      lastError,
      retries,
      fallbackReason: lastError ? this.resolveFallbackReason(lastError) : null,
    };
  }

  private async tryMediaNodeWithRetry(
    canonical: CanonicalMediaRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    retryConfig: RetryConfig,
    options: { signal?: AbortSignal } = {},
  ): Promise<MediaAttemptResult> {
    const maxAttempts = 1 + retryConfig.max_retries;
    let lastError: Error | null = null;
    let retries = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.withConcurrencySlot(nodeId, model, () =>
          this.forwardMediaWithFallbackTimeout(
            canonical,
            nodeId,
            model,
            routingMeta,
            options,
          ),
        );
        this.circuitBreaker.recordSuccess(nodeId, model);
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          response.routing.latency_ms,
          200,
        );
        return { response, lastError: null, retries, fallbackReason: null };
      } catch (err) {
        lastError = err as Error;
        const fallbackReason = this.resolveFallbackReason(lastError);
        if (lastError instanceof ConcurrencyLimitError) {
          this.logger.warn(lastError.message);
          if (!lastError.fallbackAllowed) {
            throw new GatewayRequestRejectedError(
              lastError.message,
              lastError.statusCode,
            );
          }
          return {
            response: null,
            lastError,
            retries,
            fallbackReason: 'concurrency_limited',
          };
        }

        const statusCode = err instanceof ProviderError ? err.statusCode : 0;
        this.routingService.recordTargetResult?.(
          nodeId,
          model,
          Date.now() - attemptStart,
          statusCode || 0,
        );
        const isRetryable = retryConfig.retryable_status.includes(statusCode);
        const shouldImmediateFallback =
          this.shouldImmediateFallback(lastError) || fallbackReason === 'timeout';
        const isLastAttempt = attempt >= maxAttempts - 1;

        if (!isRetryable || isLastAttempt || shouldImmediateFallback) {
          this.logger.warn(
            `${canonical.source_format} node ${nodeId} failed (attempt ${attempt + 1}/${maxAttempts}): ${lastError.message}` +
            (isLastAttempt && attempt > 0 ? ' — retries exhausted' : '') +
            (shouldImmediateFallback ? ' — immediate fallback policy' : ''),
          );
          this.circuitBreaker.recordFailure(nodeId, model);
          return {
            response: null,
            lastError,
            retries,
            fallbackReason,
          };
        }

        retries++;
        const delay = this.calculateBackoff(
          attempt,
          retryConfig,
          statusCode === 429 ? lastError : undefined,
        );
        this.logger.warn(
          `${canonical.source_format} node ${nodeId} returned ${statusCode} (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }

    return {
      response: null,
      lastError,
      retries,
      fallbackReason: lastError ? this.resolveFallbackReason(lastError) : null,
    };
  }

  private shouldImmediateFallback(err: Error): boolean {
    return (
      err instanceof ProviderError &&
      err.statusCode === 429 &&
      this.config.fallbackPolicy.immediate_429
    );
  }

  private resolveFallbackReason(err: Error): FallbackReason {
    if (err instanceof ConcurrencyLimitError) return 'concurrency_limited';
    if (err instanceof StructuredOutputValidationError) {
      return err.fallbackReason;
    }
    if (err instanceof ProviderError) {
      if (err.statusCode === 429 || err.failureType === 'rate_limited') {
        return 'rate_limited';
      }
      if (err.failureType === 'timeout') return 'timeout';
    }
    return 'upstream_error';
  }

  private resolveFallbackTimeoutMs(): number | undefined {
    const timeoutPolicy = this.config.fallbackPolicy.timeout;
    if (!timeoutPolicy.enabled) return undefined;
    if (timeoutPolicy.race_fallback) return undefined;
    return timeoutPolicy.threshold_ms;
  }

  private forwardWithFallbackTimeout(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
  ): Promise<CanonicalResponse> {
    const timeoutMs = this.resolveFallbackTimeoutMs();
    if (timeoutMs === undefined) {
      return this.providerClient.forward(
        canonical,
        nodeId,
        model,
        routingMeta,
      );
    }
    return this.providerClient.forward(
      canonical,
      nodeId,
      model,
      routingMeta,
      { timeoutMs },
    );
  }

  private forwardEmbeddingsWithFallbackTimeout(
    canonical: CanonicalEmbeddingRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<CanonicalEmbeddingResponse> {
    const timeoutMs = this.resolveFallbackTimeoutMs();
    if (timeoutMs === undefined) {
      return this.providerClient.forwardEmbeddings(
        canonical,
        nodeId,
        model,
        routingMeta,
        { signal: options.signal },
      );
    }
    return this.providerClient.forwardEmbeddings(
      canonical,
      nodeId,
      model,
      routingMeta,
      { timeoutMs, signal: options.signal },
    );
  }

  private forwardRerankWithFallbackTimeout(
    canonical: CanonicalRerankRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<CanonicalRerankResponse> {
    const timeoutMs = this.resolveFallbackTimeoutMs();
    if (timeoutMs === undefined) {
      return this.providerClient.forwardRerank(
        canonical,
        nodeId,
        model,
        routingMeta,
        { signal: options.signal },
      );
    }
    return this.providerClient.forwardRerank(
      canonical,
      nodeId,
      model,
      routingMeta,
      { timeoutMs, signal: options.signal },
    );
  }

  private forwardMediaWithFallbackTimeout(
    canonical: CanonicalMediaRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<CanonicalMediaResponse> {
    const timeoutMs = this.resolveFallbackTimeoutMs();
    if (timeoutMs === undefined) {
      return this.providerClient.forwardMedia(
        canonical,
        nodeId,
        model,
        routingMeta,
        { signal: options.signal },
      );
    }
    return this.providerClient.forwardMedia(
      canonical,
      nodeId,
      model,
      routingMeta,
      { timeoutMs, signal: options.signal },
    );
  }

  private forwardEmbeddingsMaybeBatched(
    canonical: CanonicalEmbeddingRequest,
    nodeId: string,
    model: string,
    routingMeta: {
      tier: Tier;
      score: number;
      is_fallback: boolean;
      fallback_reason?: string | null;
    },
    options: { signal?: AbortSignal } = {},
  ): Promise<CanonicalEmbeddingResponse> {
    const dispatch = (
      request: CanonicalEmbeddingRequest,
      dispatchNodeId: string,
      dispatchModel: string,
      dispatchRoutingMeta: {
        tier: Tier;
        score: number;
        is_fallback: boolean;
        fallback_reason?: string | null;
      },
    ) =>
      this.withConcurrencySlot(dispatchNodeId, dispatchModel, () =>
        this.forwardEmbeddingsWithFallbackTimeout(
          request,
          dispatchNodeId,
          dispatchModel,
          dispatchRoutingMeta,
          options,
        ),
      );

    if (!this.embeddingBatching) {
      return dispatch(canonical, nodeId, model, routingMeta);
    }

    return this.embeddingBatching.enqueue(
      canonical,
      nodeId,
      model,
      routingMeta,
      dispatch,
      options,
    );
  }

  private forwardStreamWithFallbackTimeout(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<CanonicalStreamEvent> {
    const timeoutMs = this.resolveFallbackTimeoutMs();
    if (timeoutMs === undefined) {
      return this.providerClient.forwardStream(canonical, nodeId, model, {
        signal: options.signal,
      });
    }
    return this.providerClient.forwardStream(
      canonical,
      nodeId,
      model,
      { timeoutMs, signal: options.signal },
    );
  }

  private assertStructuredOutputResponse(
    canonical: CanonicalRequest,
    response: CanonicalResponse,
  ): void {
    const policy = this.config.fallbackPolicy.structured_output;
    if (!policy.enabled) return;

    const intent = this.extractStructuredOutputIntent(canonical);
    if (!intent) return;

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (policy.fallback_on_parse_error) {
        throw new StructuredOutputValidationError(
          'Structured output response was not valid JSON.',
          'structured_output_parse_failed',
        );
      }
      return;
    }

    if (intent.schema && policy.fallback_on_schema_error) {
      const errors = this.validateSimpleJsonSchema(parsed, intent.schema);
      if (errors.length > 0) {
        throw new StructuredOutputValidationError(
          `Structured output response failed schema validation: ${errors.join('; ')}`,
          'structured_output_schema_failed',
        );
      }
    }
  }

  private extractStructuredOutputIntent(
    canonical: CanonicalRequest,
  ): { schema?: Record<string, unknown> } | null {
    if (canonical.structured_output?.requested) {
      const schema = structuredOutputSchema(canonical.response_format);
      return schema ? { schema } : {};
    }

    const raw = canonical.metadata.raw_body;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const structured = normalizeStructuredOutputFromBody(
        canonical.metadata.source_format,
        raw as Record<string, unknown>,
      );
      if (structured.structured_output?.requested) {
        const schema = structuredOutputSchema(structured.response_format);
        return schema ? { schema } : {};
      }
    }

    return null;
  }

  private validateSimpleJsonSchema(
    value: unknown,
    schema: Record<string, unknown>,
    path = '$',
  ): string[] {
    const errors: string[] = [];
    const type = schema.type;
    if (typeof type === 'string' && !this.matchesJsonSchemaType(value, type)) {
      errors.push(`${path} must be ${type}`);
      return errors;
    }
    if (
      Array.isArray(type) &&
      !type.some((item) => typeof item === 'string' && this.matchesJsonSchemaType(value, item))
    ) {
      errors.push(`${path} must match one of ${type.join(', ')}`);
      return errors;
    }

    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of the configured enum values`);
    }
    if (schema.const !== undefined && schema.const !== value) {
      errors.push(`${path} must equal the configured const value`);
    }

    if (this.isPlainObject(value)) {
      const properties = this.isPlainObject(schema.properties)
        ? schema.properties
        : {};
      if (Array.isArray(schema.required)) {
        for (const requiredKey of schema.required) {
          if (
            typeof requiredKey === 'string' &&
            !(requiredKey in value)
          ) {
            errors.push(`${path}.${requiredKey} is required`);
          }
        }
      }

      for (const [key, childSchema] of Object.entries(properties)) {
        if (
          key in value &&
          this.isPlainObject(childSchema)
        ) {
          errors.push(
            ...this.validateSimpleJsonSchema(
              value[key],
              childSchema,
              `${path}.${key}`,
            ),
          );
        }
      }

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            errors.push(`${path}.${key} is not allowed`);
          }
        }
      }
    }

    if (Array.isArray(value) && this.isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(
          ...this.validateSimpleJsonSchema(
            item,
            schema.items as Record<string, unknown>,
            `${path}[${index}]`,
          ),
        );
      });
    }

    return errors;
  }

  private matchesJsonSchemaType(value: unknown, type: string): boolean {
    switch (type) {
      case 'object':
        return this.isPlainObject(value);
      case 'array':
        return Array.isArray(value);
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return Number.isInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      default:
        return true;
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    const store = new Map<string, unknown>([
      ['request_id', requestId],
      ['session_id', canonical.metadata.session_id || canonical.metadata.session_key || null],
      ['trace_id', canonical.metadata.trace_id || null],
    ]);
    let currentPhase = 'preRequest';
    let headersFlushed = false;
    const streamAbort = new AbortController();
    let streamCanceled = false;
    let streamCompleted = false;

    const onClientClose = () => {
      if (!streamCompleted && !(res as { writableEnded?: boolean }).writableEnded) {
        streamCanceled = true;
        streamAbort.abort();
      }
    };
    res.on?.('close', onClientClose);

    // Manual span for streaming (can't use withSpan with generators)
    const rootSpan = this.telemetry.tracer.startSpan('gateway.request', {
      kind: SpanKind.SERVER,
      attributes: {
        'gateway.request_id': requestId,
        'gateway.source_format': canonical.metadata.source_format,
        'gateway.model': canonical.metadata.original_model || 'auto',
        'gateway.session_id':
          canonical.metadata.session_id || canonical.metadata.session_key || '',
        'gateway.session_key': canonical.metadata.session_key || '',
        'gateway.trace_id': canonical.metadata.trace_id || '',
        'gateway.stream': true,
      },
    });

    const ensureStreamHeaders = () => {
      if (headersFlushed) return;
      applyGatewayRequestIdHeaders(res, requestId);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      headersFlushed = true;
    };

    const sendStreamErrorResponse = (
      statusCode: number,
      body: Record<string, unknown>,
    ) => {
      applyGatewayRequestIdHeaders(res, requestId);
      headersFlushed = true;
      res.status(statusCode).json(body);
    };

    try {
      this.assertApiKeyRequestAllowed(canonical);

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
              sendStreamErrorResponse(
                429,
                this.formatBudgetError(
                  canonical.metadata.source_format,
                  err,
                  requestId,
                ),
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
          this.writeSyntheticStreamResponse(
            res,
            canonical.metadata.source_format,
            scResponse,
            requestId,
          );
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
          sendStreamErrorResponse(
            429,
            this.formatBudgetError(
              canonical.metadata.source_format,
              err,
              requestId,
            ),
          );
          rootSpan.end();
          return;
        }
        throw err;
      }

      // ── Cache Lookup (stream) ──
      currentPhase = 'cacheLookup';
      const streamPromptCacheEligible = this.shouldUseStreamCache(canonical);
      store.set('local_prompt_cache_eligible', streamPromptCacheEligible);
      store.set('local_prompt_cache_hit', false);
      store.set('local_prompt_cache_lookup', streamPromptCacheEligible ? 'miss' : 'disabled');
      if (streamPromptCacheEligible) {
        const cacheStart = Date.now();
        const cached = await this.lookupCachedResponse(canonical);
        if (cached) {
          store.set('local_prompt_cache_hit', true);
          store.set('local_prompt_cache_lookup', 'hit');
          const cacheLatency = Date.now() - cacheStart;

          await this.recordBudgetUsage(canonical, cached.usage, cached.model);
          streamCompleted = true;
          this.writeSyntheticStreamResponse(
            res,
            canonical.metadata.source_format,
            cached,
            requestId,
          );

          await this.logCall({ requestId, canonical, tier: 'cached', score: 0, nodeId: 'cache',
            model: cached.model, statusCode: 200, isFallback: false, latencyMs: cacheLatency,
            usage: cached.usage, error: null, retryCount: 0,
            routeTrace: this.buildPipelineRouteTrace({
              mode: 'cache',
              canonical,
              tier: 'cached',
              score: 0,
              route: { primary: { node: 'cache', model: cached.model }, fallbacks: [] },
              reason: 'local stream prompt cache hit',
              selectionHints: this.cacheSelectionHintsFromStore(store),
            }) });
          this.telemetry.recordCacheHit();
          rootSpan.setAttribute('gateway.cache', 'hit');
          rootSpan.end();
          return;
        }
      }

      const { route, tier, score, domainHint, modalityHints, experimentGroup, experimentGroupsByTarget, routeTrace } =
        await this.resolveSmartRoute(canonical, store);
      const retryConfig = this.config.retry;
      const costDowngrade = this.applyCostDowngrade(canonical, route, tier);
      const activeRoute = costDowngrade.route;
      const activeRouteTrace = this.applyCostDowngradeToTrace(
        routeTrace,
        route,
        activeRoute,
        costDowngrade.reason,
      );
      const originalPrimary = route.primary;

      const startTime = Date.now();

      // Create serializer for client's source format
      const serializer = this.createSerializer(canonical.metadata.source_format);

      // Try primary + fallbacks (connection-phase fallback + retry)
      const targets = [activeRoute.primary, ...activeRoute.fallbacks];
      let streamConnected = false;
      let usedNodeId = activeRoute.primary.node;
      let usedModel = activeRoute.primary.model;
      let isFallback = costDowngrade.reason !== null;
      let lastError: Error | null = null;
      let totalRetries = 0;
      let fallbackReason: FallbackReason | null = costDowngrade.reason;
      let fallbackFromNode: string | null = costDowngrade.reason
        ? originalPrimary.node
        : null;

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const isFirstTarget = i === 0;
        usedNodeId = target.node;
        usedModel = target.model;
        isFallback = !isFirstTarget || costDowngrade.reason !== null;

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
            isFallback,
            latencyMs: Date.now() - startTime,
            usage: scResponse.usage,
            error: null,
            retryCount: totalRetries,
            experimentGroup: resolvedExperimentGroup,
            domainHint,
            modalityHints,
            fallbackReason,
            fallbackFromNode,
            routeTrace: activeRouteTrace,
          });
          this.writeSyntheticStreamResponse(
            res,
            canonical.metadata.source_format,
            scResponse,
            requestId,
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
              const stream = this.forwardStreamWithFallbackTimeout(
                requestForTarget,
                target.node,
                target.model,
                { signal: streamAbort.signal },
              );

              // Stream events to client
              const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };
              const accumulatedText: string[] = []; // For cache store
              let streamModel = '';
              let streamId = '';
              let streamStopReason = '';

              currentPhase = 'upstreamStream';
              for await (const event of stream) {
                if (streamCanceled) {
                  throw new Error('Client canceled stream.');
                }
                streamConnected = true;
                connected = true;
                usedNodeId = target.node;
                usedModel = target.model;
                isFallback = !isFirstTarget || costDowngrade.reason !== null;

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
              if (streamCanceled) {
                throw new Error('Client canceled stream.');
              }

              // Stream completed successfully
              const latencyMs = Date.now() - startTime;
              this.circuitBreaker.recordSuccess(target.node, target.model);

              // ── Cache Store (from stream accumulation) ──
              if (
                !streamCanceled &&
                this.shouldUseStreamCache(canonical) &&
                accumulatedText.length > 0
              ) {
                const assembledResponse: CanonicalResponse = {
                  id: streamId || `cache-${requestId}`,
                  content: [{ type: 'text', text: accumulatedText.join('') }],
                  stop_reason: (streamStopReason || 'end_turn') as CanonicalResponse['stop_reason'],
                  usage: { ...usage },
                  model: streamModel || usedModel,
                  routing: {
                    tier,
                    node: usedNodeId,
                    latency_ms: latencyMs,
                    score,
                    is_fallback: isFallback,
                    fallback_reason: fallbackReason,
                  },
                };
                await this.storeCachedResponse(canonical, assembledResponse);
              }

              const { costUsd } = await this.recordBudgetUsage(
                canonical,
                usage,
                usedModel,
                usedNodeId,
              );

              const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
                experimentGroupsByTarget,
                usedNodeId,
                usedModel,
                experimentGroup,
              );
              await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
                statusCode: 200, isFallback, latencyMs, usage, error: null,
                retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
                domainHint, modalityHints, fallbackReason,
                fallbackFromNode, routeTrace: activeRouteTrace });
              if (accumulatedText.length > 0) {
                this.shadowTraffic?.enqueueChat(
                  requestId,
                  canonical,
                  {
                    id: streamId || `stream-${requestId}`,
                    content: [{ type: 'text', text: accumulatedText.join('') }],
                    stop_reason: (streamStopReason || 'end_turn') as CanonicalResponse['stop_reason'],
                    usage: { ...usage },
                    model: streamModel || usedModel,
                    routing: {
                      tier,
                      node: usedNodeId,
                      latency_ms: latencyMs,
                      score,
                      is_fallback: isFallback,
                      fallback_reason: fallbackReason,
                    },
                  },
                  usedNodeId,
                  usedModel,
                );
              }

              // ── Telemetry Metrics (stream success) ──
              const streamTotalTokens = usage.input_tokens + usage.output_tokens;
              rootSpan.setAttributes({
                'gateway.tier': tier,
                'gateway.node': usedNodeId,
                'gateway.model': usedModel,
                'gateway.is_fallback': isFallback,
                'gateway.fallback_reason': fallbackReason || '',
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

              streamCompleted = true;
              res.end();
              rootSpan.end();
              return;
            } finally {
              lease.release();
            }
          } catch (err) {
            lastError = err as Error;
            const attemptFallbackReason = this.resolveFallbackReason(lastError);
            if (streamCanceled) {
              this.logger.warn(`Client canceled stream from ${target.node}`);
              const resolvedExperimentGroup = this.resolveExperimentGroupForTarget(
                experimentGroupsByTarget,
                target.node,
                target.model,
                experimentGroup,
              );
              await this.logCall({ requestId, canonical, tier, score, nodeId: target.node, model: target.model,
                statusCode: 499, isFallback, latencyMs: Date.now() - startTime,
                usage: { input_tokens: 0, output_tokens: 0 }, error: 'Client canceled stream',
                retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
                domainHint, modalityHints, fallbackReason,
                fallbackFromNode, routeTrace: activeRouteTrace });
              rootSpan.end();
              return;
            }
            if (lastError instanceof ConcurrencyLimitError) {
              this.logger.warn(lastError.message);
              if (!lastError.fallbackAllowed) {
                if (!headersFlushed) {
                  sendStreamErrorResponse(
                    lastError.statusCode,
                    this.formatError(
                      canonical.metadata.source_format,
                      lastError.statusCode,
                      lastError.message,
                      requestId,
                    ),
                  );
                  rootSpan.end();
                  return;
                }
                const errorEvent: CanonicalStreamEvent = {
                  type: 'error',
                  error: {
                    message: lastError.message,
                    code: 'concurrency_limited',
                    type: 'server_error',
                    request_id: requestId,
                  },
                };
                ensureStreamHeaders();
                res.write(serializer.serialize(errorEvent));
                res.end();
                rootSpan.end();
                return;
              }
              fallbackReason = 'concurrency_limited';
              fallbackFromNode = target.node;
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
                  isFallback,
                  latencyMs: Date.now() - startTime,
                  retryCount: totalRetries,
                  experimentGroup: resolvedExperimentGroup,
                  fallbackReason,
                  fallbackFromNode,
                  routeTrace: activeRouteTrace,
                });
                this.writeSyntheticStreamResponse(
                  res,
                  canonical.metadata.source_format,
                  recovered,
                  requestId,
                );
                rootSpan.end();
                return;
              }
              const errorEvent: CanonicalStreamEvent = {
                type: 'error',
                error: {
                  message: lastError.message,
                  code: 'stream_error',
                  type: 'server_error',
                  request_id: requestId,
                },
              };
              ensureStreamHeaders();
              res.write(serializer.serialize(errorEvent));
              res.end();

              await this.logCall({ requestId, canonical, tier, score, nodeId: target.node, model: target.model,
                statusCode: 502, isFallback, latencyMs: Date.now() - startTime,
                usage: { input_tokens: 0, output_tokens: 0 }, error: lastError.message,
                retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
                domainHint, modalityHints, fallbackReason,
                fallbackFromNode, routeTrace: activeRouteTrace });
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
            const shouldImmediateFallback =
              this.shouldImmediateFallback(lastError) ||
              attemptFallbackReason === 'timeout';
            const isLastAttempt = attempt >= maxAttempts - 1;

            if (isRetryable && !isLastAttempt && !shouldImmediateFallback) {
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
              (attempt > 0 ? ` (after ${attempt + 1} attempts)` : '') +
              (shouldImmediateFallback ? ' — immediate fallback policy' : ''),
            );
            this.circuitBreaker.recordFailure(target.node, target.model);
            fallbackReason = attemptFallbackReason;
            fallbackFromNode = target.node;
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
          fallbackReason,
          fallbackFromNode,
          routeTrace: activeRouteTrace,
        });
        this.writeSyntheticStreamResponse(
          res,
          canonical.metadata.source_format,
          recovered,
          requestId,
        );
        rootSpan.end();
        return;
      }
      await this.logCall({ requestId, canonical, tier, score, nodeId: usedNodeId, model: usedModel,
        statusCode: failureStatus, isFallback, latencyMs: Date.now() - startTime,
        usage: { input_tokens: 0, output_tokens: 0 }, error: errorMsg,
        retryCount: totalRetries, experimentGroup: resolvedExperimentGroup,
        domainHint, modalityHints, fallbackReason,
        fallbackFromNode, routeTrace: activeRouteTrace });
      this.telemetry.upstreamErrors.add(1, { node: usedNodeId, reason: 'all_failed' });
      sendStreamErrorResponse(
        failureStatus,
        this.formatError(
          canonical.metadata.source_format,
          failureStatus,
          errorMsg,
          requestId,
        ),
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
        this.writeSyntheticStreamResponse(
          res,
          canonical.metadata.source_format,
          recovered,
          requestId,
        );
        rootSpan.end();
        return;
      }

      if (err instanceof GatewayRequestRejectedError && !headersFlushed) {
        sendStreamErrorResponse(
          err.statusCode,
          this.formatError(
            canonical.metadata.source_format,
            err.statusCode,
            err.message,
            requestId,
          ),
        );
        rootSpan.end();
        return;
      }

      if (err instanceof RoutingConstraintError && !headersFlushed) {
        sendStreamErrorResponse(
          err.statusCode,
          this.formatError(
            canonical.metadata.source_format,
            err.statusCode,
            err.message,
            requestId,
          ),
        );
        rootSpan.end();
        return;
      }

      if (!headersFlushed) {
        const failureStatus = this.resolveFailureStatus(err as Error);
        sendStreamErrorResponse(
          failureStatus,
          this.formatError(
            canonical.metadata.source_format,
            failureStatus,
            (err as Error).message,
            requestId,
          ),
        );
      }
      rootSpan.end();
      if (headersFlushed) {
        throw err;
      }
    } finally {
      res.off?.('close', onClientClose);
    }
  }

  // ══════════════════════════════════════════════════════
  // Fallback Policy Helpers
  // ══════════════════════════════════════════════════════

  private applyCostDowngrade(
    canonical: CanonicalRequest,
    route: {
      primary: RouteTarget;
      fallbacks: RouteTarget[];
    },
    tier: Tier,
  ): {
    route: {
      primary: RouteTarget;
      fallbacks: RouteTarget[];
    };
    reason: FallbackReason | null;
  } {
    const policy = this.config.fallbackPolicy.cost_downgrade;
    if (
      tier === 'direct' ||
      !policy.enabled ||
      !policy.max_estimated_cost_usd
    ) {
      return { route, reason: null };
    }

    const allTargets = [route.primary, ...route.fallbacks];
    if (allTargets.length <= 1) return { route, reason: null };

    const estimates = allTargets.map((target) => ({
      target,
      estimatedCost: this.estimateRequestCostUsd(canonical, target.model),
    }));
    const primaryEstimate = estimates[0].estimatedCost;
    if (
      primaryEstimate === null ||
      primaryEstimate <= policy.max_estimated_cost_usd
    ) {
      return { route, reason: null };
    }

    const downgrade = estimates
      .slice(1)
      .filter((item) =>
        item.estimatedCost !== null &&
        item.estimatedCost < primaryEstimate &&
        item.estimatedCost <= policy.max_estimated_cost_usd!,
      )
      .sort((a, b) => (a.estimatedCost ?? 0) - (b.estimatedCost ?? 0))[0];

    if (!downgrade) return { route, reason: null };

    this.logger.log(
      `Cost downgrade: estimated ${primaryEstimate.toFixed(6)} USD for ` +
        `${route.primary.node}/${route.primary.model}, routing to ` +
        `${downgrade.target.node}/${downgrade.target.model} instead`,
    );

    return {
      route: {
        primary: downgrade.target,
        fallbacks: allTargets.filter((target) => target !== downgrade.target),
      },
      reason: 'cost_downgrade',
    };
  }

  private estimateRequestCostUsd(
    canonical: CanonicalRequest,
    model: string,
  ): number | null {
    const pricing = this.config.getModelPricing(model);
    if (!pricing) return null;
    const estimatedInputTokens = this.estimateRequestTokens(canonical);
    const estimatedOutputTokens = canonical.max_tokens ?? 1024;
    return (
      (estimatedInputTokens / 1_000_000) * pricing.input +
      (estimatedOutputTokens / 1_000_000) * pricing.output
    );
  }

  private estimateRequestTokens(canonical: CanonicalRequest): number {
    const text = canonical.messages
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      )
      .join('\n');
    const toolChars = canonical.tools ? JSON.stringify(canonical.tools).length : 0;
    return Math.max(1, Math.ceil((text.length + toolChars) / 4));
  }

  private estimateEmbeddingInputTokens(input: unknown): number {
    if (typeof input === 'string') {
      return Math.max(1, Math.ceil(input.length / 4));
    }
    if (!Array.isArray(input)) {
      return 0;
    }
    if (input.every((item) => typeof item === 'string')) {
      return Math.max(
        1,
        Math.ceil((input as string[]).reduce((sum, item) => sum + item.length, 0) / 4),
      );
    }
    if (input.every((item) => typeof item === 'number')) {
      return input.length;
    }
    if (
      input.every((item) =>
        Array.isArray(item) &&
        item.every((token) => typeof token === 'number'),
      )
    ) {
      return (input as number[][]).reduce((sum, tokens) => sum + tokens.length, 0);
    }
    return 0;
  }

  private estimateRerankInputTokens(canonical: CanonicalRerankRequest): number {
    const documentChars = canonical.documents.reduce((sum, document) => {
      if (typeof document === 'string') return sum + document.length;
      return sum + JSON.stringify(document).length;
    }, 0);
    return Math.max(1, Math.ceil((canonical.query.length + documentChars) / 4));
  }

  private estimateMediaInputTokens(canonical: CanonicalMediaRequest): number {
    if (Buffer.isBuffer(canonical.payload)) {
      const model = canonical.metadata.original_model || canonical.model || '';
      return Math.max(1, Math.ceil(model.length / 4));
    }

    const payload = canonical.payload as Record<string, unknown>;
    const textFields = ['prompt', 'input', 'text'];
    const text = textFields
      .map((field) => payload[field])
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    if (!text) return 1;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private validateEmbeddingRequest(canonical: CanonicalEmbeddingRequest): string | null {
    if (!this.isValidEmbeddingInput(canonical.input)) {
      return 'Embeddings input must be a string, string array, token array, or array of token arrays.';
    }
    if (
      canonical.dimensions !== undefined &&
      (!Number.isInteger(canonical.dimensions) || canonical.dimensions <= 0)
    ) {
      return 'Embeddings dimensions must be a positive integer when provided.';
    }
    return null;
  }

  private validateRerankRequest(canonical: CanonicalRerankRequest): string | null {
    if (!canonical.query || canonical.query.trim().length === 0) {
      return 'Rerank query must be a non-empty string.';
    }
    if (!Array.isArray(canonical.documents) || canonical.documents.length === 0) {
      return 'Rerank documents must be a non-empty array.';
    }
    if (
      canonical.top_n !== undefined &&
      (!Number.isInteger(canonical.top_n) || canonical.top_n <= 0)
    ) {
      return 'Rerank top_n must be a positive integer when provided.';
    }
    if (
      canonical.top_n !== undefined &&
      canonical.top_n > canonical.documents.length
    ) {
      return 'Rerank top_n cannot exceed the number of documents.';
    }
    return null;
  }

  private validateMediaRequest(canonical: CanonicalMediaRequest): string | null {
    if (!canonical.model || canonical.model.trim().length === 0) {
      return 'Media model must be a non-empty string or "auto".';
    }
    if (canonical.is_multipart) {
      return null;
    }
    if (Buffer.isBuffer(canonical.payload)) {
      return 'Raw media payloads must use multipart/form-data.';
    }
    if (
      canonical.source_format === 'image_generation' &&
      typeof canonical.payload.prompt !== 'string'
    ) {
      return 'Image generation requests must include a string prompt.';
    }
    if (
      canonical.source_format === 'audio_speech' &&
      typeof canonical.payload.input !== 'string'
    ) {
      return 'Audio speech requests must include a string input.';
    }
    if (
      canonical.source_format === 'video_generation' &&
      typeof canonical.payload.prompt !== 'string'
    ) {
      return 'Video generation requests must include a string prompt.';
    }
    return null;
  }

  private isValidEmbeddingInput(input: unknown): boolean {
    if (typeof input === 'string') return true;
    if (!Array.isArray(input) || input.length === 0) return false;
    return (
      input.every((item) => typeof item === 'string') ||
      input.every((item) => typeof item === 'number' && Number.isFinite(item)) ||
      input.every((item) =>
        Array.isArray(item) &&
        item.length > 0 &&
        item.every((token) => typeof token === 'number' && Number.isFinite(token)),
      )
    );
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
        this.assertContextWindow(canonical, pinnedNode.id, pinnedModel);

        this.logger.log(
          `Pinned messages route: "${requestedModel || 'auto'}" → node "${pinnedNode.id}" (model: ${pinnedModel})`,
        );
        const route = {
          primary: { node: pinnedNode.id, model: pinnedModel },
          fallbacks: [],
        };

        return {
          route,
          tier: 'direct',
          score: 0,
          domainHint: null,
          experimentGroup: null,
          experimentGroupsByTarget: {},
          routeTrace: this.buildPipelineRouteTrace({
            mode: 'pinned',
            canonical,
            tier: 'direct',
            score: 0,
            route,
            reason: 'Anthropic Messages compatibility pin',
            selectionHints: this.cacheSelectionHintsFromStore(store),
          }),
        };
      }
    }

    // ── 1. Direct model specification ──
    if (requestedModel && requestedModel !== 'auto') {
      const resolved = this.config.resolveModel(requestedModel);

      if (resolved) {
        this.assertRouteModeAllowed(canonical, 'direct');
        this.assertTargetAllowed(canonical, resolved.nodeId, resolved.model);
        this.assertContextWindow(canonical, resolved.nodeId, resolved.model);
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
          if (!supportsModalities(modelModalities, ['vision'])) {
            this.logger.warn(
              `Direct route: model "${resolved.model}" on node "${resolved.nodeId}" may not support vision, but proceeding as requested`,
            );
          }
        }

        // Build fallbacks from other nodes (modality-aware)
        const fallbacks = this.filterContextCompatibleFallbacks(
          canonical,
          this.filterAllowedTargets(
            canonical,
            this.buildDirectFallbacks(canonical, resolved.nodeId),
          ),
        );

        const route = {
          primary: { node: resolved.nodeId, model: resolved.model },
          fallbacks,
        };

        return {
          route,
          tier: 'direct',
          score: 0,
          domainHint: null,
          experimentGroup: null,
          experimentGroupsByTarget: {},
          routeTrace: this.buildPipelineRouteTrace({
            mode: 'direct',
            canonical,
            tier: 'direct',
            score: 0,
            route,
            reason: `direct model match for "${requestedModel}"`,
            selectionHints: this.cacheSelectionHintsFromStore(store),
          }),
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

    const tokenEstimate = estimateCanonicalRequestTokens(canonical);
    const requiresStructuredOutput = this.requestRequiresStructuredOutput(canonical);
    const reasoningFields = this.resolveReasoningSelectionFields(canonical);
    const requestRouteHints = this.routeSelectionHintsForTrace(canonical);

    const routeDecision = this.telemetry.withSpanSync(
      'gateway.routing',
      {
        'gateway.tier': effectiveTier,
        'gateway.score': effectiveScore,
        'gateway.estimated_context_tokens': tokenEstimate.context_tokens,
        'gateway.routing.optimization': this.config.routing.optimization || '',
      },
      (span) => {
        const decision = this.routingService.resolve(
          effectiveTier,
          effectiveScore,
          canonical.metadata.session_key,
          scoringResult.domainHint,
          scoringResult.modalityHints,
          {
            ...requestRouteHints,
            estimated_input_tokens: tokenEstimate.input_tokens,
            estimated_output_tokens: tokenEstimate.output_tokens,
            estimated_context_tokens: tokenEstimate.context_tokens,
            ...this.cacheSelectionHintsFromStore(store),
            requires_structured_output: requiresStructuredOutput,
            requires_reasoning: reasoningFields.requires_reasoning,
            reasoning_effort: reasoningFields.reasoning_effort,
            reasoning_budget_tokens: reasoningFields.reasoning_budget_tokens,
            reasoning_strategy: reasoningFields.reasoning_strategy,
            required_capabilities: reasoningFields.requires_reasoning
              ? Array.from(new Set([...(scoringResult.modalityHints || ['text']).map(String), 'reasoning']))
              : requestRouteHints.required_capabilities,
          },
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
    const baseRouteTrace = routeDecision.trace || this.buildPipelineRouteTrace({
      mode: 'auto',
      canonical,
      tier: routeDecision.tier,
      score: scoringResult.score,
      route: {
        primary: routeDecision.primary,
        fallbacks: routeDecision.fallbacks,
      },
      reason: 'automatic routing',
      domainHint: routeDecision.domainHint || scoringResult.domainHint || null,
      modalityHints: scoringResult.modalityHints,
      selectionHints: this.cacheSelectionHintsFromStore(store),
    });
    const routeTrace = this.applyTargetFilterToTrace(
      baseRouteTrace,
      [constrainedRoute.primary, ...constrainedRoute.fallbacks],
      'api_key_or_namespace_policy',
      'API key or namespace policy removed this target from the automatic route',
    );

    return {
      route: constrainedRoute,
      tier: routeDecision.tier,
      score: scoringResult.score,
      domainHint: routeDecision.domainHint || scoringResult.domainHint || null,
      modalityHints: scoringResult.modalityHints,
      experimentGroup: routeDecision.experimentGroup,
      experimentGroupsByTarget: routeDecision.experimentGroupsByTarget || {},
      routeTrace,
    };
  }

  private buildPipelineRouteTrace(input: {
    mode: RouteDecisionTrace['mode'];
    canonical: LoggableCanonicalRequest;
    tier: Tier;
    score: number;
    route: {
      primary: RouteTarget;
      fallbacks: RouteTarget[];
    };
    reason: string;
    domainHint?: string | null;
    modalityHints?: string[];
    selectionHints?: Partial<RouteSelectionHints>;
  }): RouteDecisionTrace {
    const targets = [input.route.primary, ...input.route.fallbacks];
    const selectedKey = routeTargetKey(input.route.primary);
    const tokenEstimate =
      input.canonical.metadata.source_format === 'chat_completions' ||
      input.canonical.metadata.source_format === 'responses' ||
      input.canonical.metadata.source_format === 'messages'
        ? estimateCanonicalRequestTokens(input.canonical as CanonicalRequest)
        : null;
    const requestEvidenceHints = this.routeSelectionHintsForTrace(input.canonical);
    const reasoningFields =
      input.canonical.metadata.source_format !== 'embeddings' &&
      input.canonical.metadata.source_format !== 'rerank' &&
      !this.isMediaCanonical(input.canonical)
        ? this.resolveReasoningSelectionFields(input.canonical as CanonicalRequest)
        : {
            requires_reasoning: false,
            reasoning_effort: null,
            reasoning_budget_tokens: null,
            reasoning_strategy: null,
          };
    const traceSelectionHints: RouteSelectionHints = {
      ...requestEvidenceHints,
      ...input.selectionHints,
      estimated_input_tokens: tokenEstimate?.input_tokens ?? undefined,
      estimated_output_tokens: tokenEstimate?.output_tokens ?? undefined,
      estimated_context_tokens: tokenEstimate?.context_tokens ?? undefined,
      requires_structured_output:
        input.canonical.metadata.source_format !== 'embeddings' &&
        this.requestRequiresStructuredOutput(input.canonical as CanonicalRequest),
      requires_reasoning: reasoningFields.requires_reasoning,
      reasoning_effort: reasoningFields.reasoning_effort,
      reasoning_budget_tokens: reasoningFields.reasoning_budget_tokens,
      reasoning_strategy: reasoningFields.reasoning_strategy,
      required_capabilities: reasoningFields.requires_reasoning
        ? this.uniqueTraceStrings([
            ...(requestEvidenceHints.required_capabilities || []),
            'reasoning',
          ])
        : requestEvidenceHints.required_capabilities,
    };

    return {
      version: 1,
      requested_model: input.canonical.metadata.original_model || null,
      mode: input.mode,
      tier: input.tier,
      score: input.score,
      domain_hints: {
        domain: input.domainHint || null,
        modalities: input.modalityHints || this.modalitiesForLog(input.canonical),
      },
      scoring: {
        tier: input.tier,
        score: input.score,
        momentum_adjusted: false,
      },
      constraints: {
        estimated_input_tokens: tokenEstimate?.input_tokens ?? null,
        estimated_output_tokens: tokenEstimate?.output_tokens ?? null,
        estimated_context_tokens: tokenEstimate?.context_tokens ?? null,
        requires_structured_output:
          input.canonical.metadata.source_format !== 'embeddings' &&
          this.requestRequiresStructuredOutput(input.canonical as CanonicalRequest),
        requires_reasoning: traceSelectionHints.requires_reasoning || false,
        reasoning_effort: traceSelectionHints.reasoning_effort ?? null,
        reasoning_budget_tokens: traceSelectionHints.reasoning_budget_tokens ?? null,
        reasoning_strategy: traceSelectionHints.reasoning_strategy ?? null,
        local_prompt_cache_eligible: Boolean(traceSelectionHints.local_prompt_cache_eligible),
        local_prompt_cache_hit: Boolean(traceSelectionHints.local_prompt_cache_hit),
        local_prompt_cache_lookup: traceSelectionHints.local_prompt_cache_lookup ?? null,
        semantic_cache_enabled: Boolean(traceSelectionHints.semantic_cache_enabled),
        semantic_cache_match: Boolean(traceSelectionHints.semantic_cache_match),
        semantic_cache_hit: Boolean(traceSelectionHints.semantic_cache_hit),
        semantic_cache_score: traceSelectionHints.semantic_cache_score ?? null,
        semantic_cache_threshold: traceSelectionHints.semantic_cache_threshold ?? null,
        semantic_cache_metadata_only:
          Boolean(traceSelectionHints.semantic_cache_metadata_only),
        semantic_cache_reason: traceSelectionHints.semantic_cache_reason ?? null,
      },
      modality_evidence: this.buildPipelineTraceModalityEvidence(
        traceSelectionHints,
        targets,
      ),
      cache_evidence: this.buildPipelineTraceCacheEvidence(traceSelectionHints, targets),
      candidate_targets: targets.map((target, index) => {
        const capabilities =
          this.capabilityService.resolveModelRoutingCapabilities?.(
            target.node,
            target.model,
          ) || {};
        const pricing = this.config.getModelPricing(target.model, target.node);
        const estimatedCost =
          pricing && tokenEstimate
            ? this.calculateCost(
                {
                  input_tokens: tokenEstimate.input_tokens,
                  output_tokens: tokenEstimate.output_tokens,
                },
                pricing,
              )
            : null;
        const maxContextTokens = capabilities.max_context_tokens ?? null;
        const contextTokens = tokenEstimate?.context_tokens;
        const capabilityEvidence = this.buildPipelineCandidateCapabilityEvidence(
          target,
          traceSelectionHints,
        );
        const cacheEvidence = this.buildPipelineCandidateCacheEvidence(
          target,
          traceSelectionHints,
        );
        const compatibility = this.buildPipelineCompatibilityEvidence(
          target,
          traceSelectionHints,
          routeTargetKey(target) === selectedKey,
          true,
        );
        return {
          node: target.node,
          model: target.model,
          weight: null,
          position: index,
          circuit_state:
            String(this.circuitBreaker.getCircuitState?.(target.node, target.model) || 'CLOSED'),
          circuit_available:
            String(this.circuitBreaker.getCircuitState?.(target.node, target.model) || 'CLOSED') !== 'OPEN',
          selected: routeTargetKey(target) === selectedKey,
          fallback: index > 0,
          filter_reasons: [],
          scores: {
            cost:
              estimatedCost === null
                ? null
                : Number((1 / (1 + estimatedCost)).toFixed(4)),
            latency: null,
            context:
              contextTokens && maxContextTokens
                ? Number(Math.max(0, 1 - contextTokens / maxContextTokens).toFixed(4))
                : null,
            cache: cacheEvidence.cache_score,
          },
          metrics: {
            estimated_cost_usd:
              estimatedCost === null ? null : Number(estimatedCost.toFixed(6)),
            avg_latency_ms: null,
            p95_latency_ms: null,
            max_context_tokens: maxContextTokens,
            context_fit:
              !contextTokens || !maxContextTokens
                ? 'unknown'
                : contextTokens > maxContextTokens
                  ? 'overflow'
                  : contextTokens > maxContextTokens * 0.8
                    ? 'near_limit'
                    : 'safe',
            structured_output:
              typeof capabilities.structured_output === 'boolean'
                ? capabilities.structured_output
                : null,
            reasoning:
              typeof capabilities.supports_reasoning === 'boolean'
                ? capabilities.supports_reasoning
                : null,
            provider_cache_hit_rate: cacheEvidence.observed_cache_hit_rate,
            estimated_cache_savings_usd: cacheEvidence.estimated_cache_savings_usd,
          },
          capability_evidence: capabilityEvidence,
          cache_evidence: cacheEvidence,
          compatibility_evidence: compatibility,
        };
      }),
      filters: [],
      load_balancing: {
        strategy:
          input.mode === 'embedding_auto' || input.mode === 'embedding_direct'
            ? 'embedding'
            : input.mode === 'cache'
              ? 'cache'
              : input.mode === 'hook'
                ? 'hook'
                : 'direct',
        source:
          input.mode === 'embedding_auto' || input.mode === 'embedding_direct'
            ? 'embedding'
            : input.mode === 'cache'
              ? 'cache'
              : input.mode === 'hook'
                ? 'hook'
                : 'direct',
        selected: input.route.primary,
        target_count: targets.length,
        reason: input.reason,
      },
      fallback_chain: input.route.fallbacks,
      cost_downgrade: null,
      final_selection: {
        node: input.route.primary.node,
        model: input.route.primary.model,
        reason: input.reason,
        is_fallback: false,
        fallback_reason: null,
      },
      privacy: {
        prompt: false,
        response: false,
        raw_headers: false,
        provider_keys: false,
      },
    };
  }

  private routeSelectionHintsForTrace(
    canonical: LoggableCanonicalRequest,
  ): RouteSelectionHints {
    if (canonical.metadata.source_format === 'embeddings') {
      const embedding = canonical as CanonicalEmbeddingRequest;
      return {
        requested_modality: 'embedding',
        input_types: ['text'],
        output_types: ['embedding'],
        required_capabilities: ['embedding'],
        endpoint_strategy: 'embeddings',
        source_format: 'embeddings',
        estimated_output_tokens: embedding.dimensions,
      };
    }
    if (canonical.metadata.source_format === 'rerank') {
      return this.buildRerankRouteSelectionHints(canonical as CanonicalRerankRequest);
    }
    if (this.isMediaCanonical(canonical)) {
      return this.buildMediaRouteSelectionHints(canonical);
    }

    const modalities = Array.from(detectRequestModalities(canonical as CanonicalRequest));
    const requested =
      modalities.find((modality) => modality === 'vision') ||
      modalities.find((modality) => modality !== 'text') ||
      'text';
    const reasoningFields = this.resolveReasoningSelectionFields(
      canonical as CanonicalRequest,
    );
    return {
      requested_modality: requested,
      input_types: modalities.includes('vision') ? ['text', 'image'] : ['text'],
      output_types: ['text'],
      file_count: modalities.includes('vision') ? this.countImageBlocks(canonical as CanonicalRequest) : 0,
      byte_size: null,
      required_capabilities: reasoningFields.requires_reasoning
        ? this.uniqueTraceStrings([...(modalities.length > 0 ? modalities : ['text']), 'reasoning'])
        : (modalities.length > 0 ? modalities : ['text']),
      endpoint_strategy: canonical.metadata.source_format,
      source_format: canonical.metadata.source_format,
      stream: Boolean((canonical as CanonicalRequest).stream),
      requires_reasoning: reasoningFields.requires_reasoning,
      reasoning_effort: reasoningFields.reasoning_effort,
      reasoning_budget_tokens: reasoningFields.reasoning_budget_tokens,
      reasoning_strategy: reasoningFields.reasoning_strategy,
    };
  }

  private buildRerankRouteSelectionHints(
    canonical: CanonicalRerankRequest,
  ): RouteSelectionHints {
    const documents = Array.isArray(canonical.documents) ? canonical.documents : [];
    const documentBytes = documents.reduce((sum, document) => {
      const value = typeof document === 'string' ? document : JSON.stringify(document);
      return sum + Buffer.byteLength(value || '', 'utf8');
    }, 0);
    return {
      requested_modality: 'rerank',
      input_types: ['text', 'documents'],
      output_types: ['ranked_documents'],
      file_count: 0,
      byte_size: Buffer.byteLength(canonical.query || '', 'utf8') + documentBytes,
      required_capabilities: ['rerank'],
      endpoint_strategy: 'rerank',
      source_format: 'rerank',
    };
  }

  private buildMediaRouteSelectionHints(
    canonical: CanonicalMediaRequest,
  ): RouteSelectionHints {
    const byteSize = this.mediaPayloadByteSize(canonical);
    const fileCount = this.mediaFileCount(canonical);
    if (canonical.source_format === 'image_generation') {
      return {
        requested_modality: 'image',
        input_types: ['text'],
        output_types: ['image'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['image'],
        endpoint_strategy: 'image_generation',
        source_format: canonical.source_format,
      };
    }
    if (canonical.source_format === 'image_edit') {
      return {
        requested_modality: 'image',
        input_types: ['text', 'image', 'file'],
        output_types: ['image'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['image'],
        endpoint_strategy: 'image_edit',
        source_format: canonical.source_format,
      };
    }
    if (canonical.source_format === 'image_variation') {
      return {
        requested_modality: 'image',
        input_types: ['image', 'file'],
        output_types: ['image'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['image'],
        endpoint_strategy: 'image_variation',
        source_format: canonical.source_format,
      };
    }
    if (canonical.source_format === 'audio_transcription') {
      return {
        requested_modality: 'audio',
        input_types: ['audio', 'file'],
        output_types: ['text'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['audio'],
        endpoint_strategy: 'audio_transcription',
        source_format: canonical.source_format,
      };
    }
    if (canonical.source_format === 'audio_translation') {
      return {
        requested_modality: 'audio',
        input_types: ['audio', 'file'],
        output_types: ['text'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['audio'],
        endpoint_strategy: 'audio_translation',
        source_format: canonical.source_format,
      };
    }
    if (canonical.source_format === 'video_generation') {
      return {
        requested_modality: 'video',
        input_types: ['text', 'image'],
        output_types: ['video'],
        file_count: fileCount,
        byte_size: byteSize,
        multipart: canonical.is_multipart,
        required_capabilities: ['video'],
        endpoint_strategy: 'video_generation',
        source_format: canonical.source_format,
      };
    }
    return {
      requested_modality: 'audio',
      input_types: ['text'],
      output_types: ['audio'],
      file_count: fileCount,
      byte_size: byteSize,
      multipart: canonical.is_multipart,
      required_capabilities: ['audio'],
      endpoint_strategy: 'audio_speech',
      source_format: canonical.source_format,
    };
  }

  private buildPipelineTraceModalityEvidence(
    hints: RouteSelectionHints,
    targets: RouteTarget[],
  ) {
    const candidates = targets.map((target) => ({
      target,
      evidence: this.buildPipelineCandidateCapabilityEvidence(target, hints),
    }));
    return {
      requested_modality: hints.requested_modality ?? null,
      input_types: this.uniqueTraceStrings(hints.input_types || []),
      output_types: this.uniqueTraceStrings(hints.output_types || []),
      file_count: hints.file_count ?? null,
      byte_size: hints.byte_size ?? null,
      required_capabilities: this.uniqueTraceStrings(hints.required_capabilities || []),
      endpoint_strategy: hints.endpoint_strategy ?? null,
      filtered_by_capability: candidates
        .filter((candidate) => candidate.evidence.filtered_by_capability)
        .map((candidate) => ({
          node: candidate.target.node,
          model: candidate.target.model,
          reason: 'capability_unsupported',
          missing_capabilities: candidate.evidence.missing_capabilities,
        })),
      filtered_by_file_size: candidates
        .filter((candidate) => candidate.evidence.filtered_by_file_size)
        .map((candidate) => ({
          node: candidate.target.node,
          model: candidate.target.model,
          reason: 'file_size_exceeded',
          byte_size: candidate.evidence.byte_size,
          max_file_size: candidate.evidence.max_file_size,
        })),
    };
  }

  private cacheSelectionHintsFromStore(
    store?: Map<string, unknown>,
  ): Partial<RouteSelectionHints> {
    const lookup = store?.get('local_prompt_cache_lookup');
    return {
      local_prompt_cache_eligible: store?.get('local_prompt_cache_eligible') === true,
      local_prompt_cache_hit: store?.get('local_prompt_cache_hit') === true,
      local_prompt_cache_lookup:
        lookup === 'hit' ||
        lookup === 'miss' ||
        lookup === 'disabled' ||
        lookup === 'skipped'
          ? lookup
          : null,
      semantic_cache_enabled: store?.get('semantic_cache_enabled') === true,
      semantic_cache_match: store?.get('semantic_cache_match') === true,
      semantic_cache_hit: store?.get('semantic_cache_hit') === true,
      semantic_cache_score:
        typeof store?.get('semantic_cache_score') === 'number'
          ? (store.get('semantic_cache_score') as number)
          : null,
      semantic_cache_threshold:
        typeof store?.get('semantic_cache_threshold') === 'number'
          ? (store.get('semantic_cache_threshold') as number)
          : null,
      semantic_cache_metadata_only:
        store?.get('semantic_cache_metadata_only') === true,
      semantic_cache_reason:
        typeof store?.get('semantic_cache_reason') === 'string'
          ? (store.get('semantic_cache_reason') as string)
          : null,
    };
  }

  private buildPipelineTraceCacheEvidence(
    hints: RouteSelectionHints,
    targets: RouteTarget[],
  ) {
    const candidates = targets.map((target) =>
      this.buildPipelineCandidateCacheEvidence(target, hints),
    );
    const providerCache = candidates.some((candidate) => candidate.provider_prompt_cache);
    const discounted = candidates.some((candidate) =>
      (candidate.estimated_cache_savings_usd || 0) > 0,
    );
    const notes = new Set<string>();
    if (hints.local_prompt_cache_hit) notes.add('local_prompt_cache_hit');
    if (hints.local_prompt_cache_eligible && !hints.local_prompt_cache_hit) {
      notes.add('local_prompt_cache_miss');
    }
    if (hints.semantic_cache_hit) notes.add('semantic_cache_hit');
    if (hints.semantic_cache_match && !hints.semantic_cache_hit) {
      notes.add('semantic_cache_metadata_match');
    }
    if (providerCache) notes.add('provider_cache_capable_candidates');
    if (discounted) notes.add('cache_read_price_considered');
    return {
      local_prompt_cache_eligible: Boolean(hints.local_prompt_cache_eligible),
      local_prompt_cache_hit: Boolean(hints.local_prompt_cache_hit),
      local_prompt_cache_lookup: hints.local_prompt_cache_lookup ?? null,
      semantic_cache_enabled: Boolean(hints.semantic_cache_enabled),
      semantic_cache_match: Boolean(hints.semantic_cache_match),
      semantic_cache_hit: Boolean(hints.semantic_cache_hit),
      semantic_cache_score: hints.semantic_cache_score ?? null,
      semantic_cache_threshold: hints.semantic_cache_threshold ?? null,
      semantic_cache_metadata_only: Boolean(hints.semantic_cache_metadata_only),
      semantic_cache_reason: hints.semantic_cache_reason ?? null,
      cache_aware_routing:
        providerCache ||
        Boolean(hints.local_prompt_cache_hit) ||
        Boolean(hints.semantic_cache_match),
      provider_cache_preference: providerCache || discounted,
      notes: Array.from(notes),
    };
  }

  private buildPipelineCandidateCacheEvidence(
    target: RouteTarget,
    hints: RouteSelectionHints,
  ): RouteDecisionCacheEvidence {
    const capabilities =
      this.capabilityService.resolveModelRoutingCapabilities?.(
        target.node,
        target.model,
      ) || {};
    const pricing = capabilities.pricing || this.config.getModelPricing(target.model, target.node);
    const localEligible = hints.local_prompt_cache_eligible === true;
    const localHit = hints.local_prompt_cache_hit === true;
    const providerReadCache = Boolean(
      capabilities.read_cache ||
      capabilities.prompt_cache ||
      pricing?.cache_read_input !== undefined,
    );
    const providerWriteCache = Boolean(
      capabilities.write_cache ||
      capabilities.prompt_cache ||
      pricing?.cache_creation_input !== undefined,
    );
    const providerPromptCache = Boolean(
      capabilities.prompt_cache ||
      providerReadCache ||
      providerWriteCache,
    );
    const inputTokens = hints.estimated_input_tokens ?? 1_000_000;
    const outputTokens = hints.estimated_output_tokens ?? 1_000_000;
    const baseCost =
      pricing && Number.isFinite(pricing.input) && Number.isFinite(pricing.output)
        ? (inputTokens / 1_000_000) * pricing.input +
          (outputTokens / 1_000_000) * pricing.output
        : null;
    const supportsDiscountedRead =
      providerReadCache &&
      pricing?.cache_read_input !== undefined &&
      pricing.cache_read_input < pricing.input;
    const priorHitRate = supportsDiscountedRead && localEligible ? 0.05 : supportsDiscountedRead ? 0.02 : 0;
    const adjustedCost =
      pricing && baseCost !== null && supportsDiscountedRead
        ? (inputTokens / 1_000_000) *
            (priorHitRate * (pricing.cache_read_input as number) +
              (1 - priorHitRate) * pricing.input) +
          (outputTokens / 1_000_000) * pricing.output
        : baseCost;
    const savings =
      baseCost !== null && adjustedCost !== null
        ? Math.max(0, baseCost - adjustedCost)
        : null;
    const cacheScore = providerPromptCache
      ? Math.min(
          1,
          0.35 +
            (providerReadCache ? 0.25 : 0) +
            (providerWriteCache ? 0.15 : 0) +
            Math.min(0.25, priorHitRate * 0.25),
        )
      : localHit
        ? 1
        : null;

    return {
      local_prompt_cache_eligible: localEligible,
      local_prompt_cache_hit: localHit,
      local_prompt_cache_lookup: hints.local_prompt_cache_lookup ?? null,
      provider_prompt_cache: providerPromptCache,
      provider_read_cache: providerReadCache,
      provider_write_cache: providerWriteCache,
      observed_cache_hit_rate: null,
      observed_cache_read_tokens: 0,
      observed_cache_creation_tokens: 0,
      input_price_per_mtok: pricing?.input ?? null,
      cache_read_price_per_mtok: pricing?.cache_read_input ?? null,
      cache_write_price_per_mtok: pricing?.cache_creation_input ?? null,
      estimated_base_cost_usd:
        baseCost === null ? null : Number(baseCost.toFixed(6)),
      estimated_cache_adjusted_cost_usd:
        adjustedCost === null ? null : Number(adjustedCost.toFixed(6)),
      estimated_cache_savings_usd:
        savings === null ? null : Number(savings.toFixed(6)),
      cache_score: cacheScore === null ? null : Number(cacheScore.toFixed(4)),
      reason: localHit
        ? 'local_prompt_cache_hit'
        : supportsDiscountedRead && (savings || 0) > 0
          ? 'provider_cache_read_price_preferred'
          : providerPromptCache
            ? 'provider_prompt_cache_capable'
            : localEligible
              ? 'local_prompt_cache_miss'
              : 'cache_not_applicable',
    };
  }

  private buildPipelineCompatibilityEvidence(
    target: RouteTarget,
    hints: RouteSelectionHints,
    selected: boolean,
    eligible: boolean,
  ): RouteDecisionCompatibilityEvidence {
    return compatibilityEvidence({
      node: this.config.getNode(target.node),
      catalog: this.config.getMergedCatalog(),
      sourceFormat: hints.source_format,
      requestedModality: hints.requested_modality,
      stream: hints.stream,
      multipart: hints.multipart,
      selected,
      eligible,
    });
  }

  private buildPipelineCandidateCapabilityEvidence(
    target: RouteTarget,
    hints: RouteSelectionHints,
  ): RouteDecisionCandidateCapabilityEvidence {
    const capabilities =
      this.capabilityService.resolveModelRoutingCapabilities?.(
        target.node,
        target.model,
      ) || {};
    const supportedModalities = this.uniqueTraceStrings(
      capabilities.modalities ||
        this.capabilityService.resolveModelModalities?.(target.node, target.model) ||
        [],
    );
    const inputTypes = this.uniqueTraceStrings(
      capabilities.input_types || this.inferTraceInputTypes(supportedModalities),
    );
    const outputTypes = this.uniqueTraceStrings(
      capabilities.output_types || this.inferTraceOutputTypes(supportedModalities),
    );
    const required = this.uniqueTraceStrings(
      hints.required_capabilities ||
        (hints.requested_modality ? [hints.requested_modality] : []),
    );
    const matched = required.filter((requirement) =>
      this.traceCandidateSupportsRequirement(
        requirement,
        capabilities,
        supportedModalities,
        inputTypes,
        outputTypes,
      ),
    );
    const missing = required.filter((requirement) => !matched.includes(requirement));
    const byteSize = hints.byte_size ?? null;
    const maxFileSize = capabilities.max_file_size ?? null;
    const endpoint = this.pipelineEndpointEvidence(
      target,
      hints.requested_modality ?? null,
      hints.source_format,
      capabilities.endpoints,
    );
    const pricingEvidence = pricingEvidenceFromModelPricing(
      capabilities.pricing || this.config.getModelPricing(target.model, target.node),
    );

    return {
      requested_modality: hints.requested_modality ?? null,
      supported_modalities: supportedModalities,
      input_types: inputTypes,
      output_types: outputTypes,
      required_capabilities: required,
      matched_capabilities: matched,
      missing_capabilities: missing,
      endpoint_strategy: hints.endpoint_strategy || endpoint.strategy,
      endpoint_status: endpoint.status,
      endpoint: endpoint.path,
      file_count: hints.file_count ?? null,
      byte_size: byteSize,
      max_file_size: maxFileSize,
      filtered_by_capability: missing.length > 0,
      filtered_by_file_size:
        byteSize !== null &&
        maxFileSize !== null &&
        Number.isFinite(byteSize) &&
        Number.isFinite(maxFileSize) &&
        byteSize > maxFileSize,
      pricing_source: pricingEvidence.pricing_source,
      pricing_confidence: pricingEvidence.pricing_confidence,
      pricing_stale: pricingEvidence.pricing_stale,
      pricing_used_from: pricingEvidence.pricing_used_from,
      missing_price_units: pricingEvidence.missing_price_units,
      estimated_cost_basis: pricingEvidence.estimated_cost_basis,
      catalog_source:
        (capabilities as { catalog_source?: string; source?: string }).catalog_source ||
        (capabilities as { source?: string }).source ||
        'config',
    };
  }

  private traceCandidateSupportsRequirement(
    requirement: string,
    capabilities: Record<string, any>,
    supportedModalities: string[],
    inputTypes: string[],
    outputTypes: string[],
  ): boolean {
    const normalized = requirement.toLowerCase();
    if (normalized === 'image' || normalized === 'vision') {
      return supportsModalities(supportedModalities as any, ['image']);
    }
    if (normalized === 'audio') {
      return supportedModalities.includes('audio') ||
        inputTypes.includes('audio') ||
        outputTypes.includes('audio');
    }
    if (normalized === 'embedding' || normalized === 'embeddings') {
      return supportedModalities.includes('embedding') ||
        inputTypes.includes('embedding') ||
        outputTypes.includes('embedding') ||
        capabilities.dimensions !== undefined;
    }
    if (normalized === 'rerank') {
      return supportedModalities.includes('rerank') ||
        capabilities.supports_rerank === true ||
        Boolean(capabilities.endpoints?.rerank);
    }
    if (normalized === 'realtime') {
      return supportedModalities.includes('realtime') ||
        capabilities.supports_realtime === true ||
        Boolean(capabilities.endpoints?.realtime);
    }
    if (normalized === 'reasoning' || normalized === 'thinking') {
      return capabilities.supports_reasoning === true;
    }
    if (normalized === 'prompt_cache') {
      return capabilities.prompt_cache === true ||
        capabilities.read_cache === true ||
        capabilities.write_cache === true;
    }
    if (normalized === 'read_cache') return capabilities.read_cache === true;
    if (normalized === 'write_cache') return capabilities.write_cache === true;
    if (normalized === 'video') {
      return supportedModalities.includes('video') ||
        inputTypes.includes('video') ||
        outputTypes.includes('video') ||
        Boolean(capabilities.endpoints?.video);
    }
    return (
      supportedModalities.includes(normalized) ||
      inputTypes.includes(normalized) ||
      outputTypes.includes(normalized)
    );
  }

  private pipelineEndpointEvidence(
    target: RouteTarget,
    requestedModality: string | null,
    sourceFormat: string | null | undefined,
    endpoints?: Record<string, string>,
  ): { strategy: string; status: string; path: string | null } {
    const key = this.pipelineEndpointKey(requestedModality, sourceFormat);
    if (key && endpoints?.[key]) {
      return { strategy: 'native', status: 'configured', path: endpoints[key] };
    }
    const node = this.config.getNode(target.node);
    const legacy = this.pipelineLegacyEndpoint(node, requestedModality, sourceFormat);
    if (legacy) return { strategy: 'configured', status: 'configured', path: legacy };
    const fallback = this.pipelineDefaultEndpoint(requestedModality, sourceFormat);
    if (fallback) return { strategy: 'default', status: 'default', path: fallback };
    if (node?.endpoint) return { strategy: 'passthrough', status: 'fallback', path: node.endpoint };
    return { strategy: 'missing', status: 'missing', path: null };
  }

  private pipelineEndpointKey(
    requestedModality: string | null,
    sourceFormat: string | null | undefined,
  ): string | null {
    if (sourceFormat === 'image_generation' || sourceFormat === 'image_edit' || sourceFormat === 'image_variation') return 'image';
    if (sourceFormat === 'audio_transcription' || sourceFormat === 'audio_translation' || sourceFormat === 'audio_speech') return 'audio';
    if (sourceFormat === 'video_generation') return 'video';
    if (requestedModality === 'embedding') return 'embeddings';
    if (requestedModality === 'rerank') return 'rerank';
    if (requestedModality === 'realtime') return 'realtime';
    if (requestedModality === 'video') return 'video';
    return null;
  }

  private pipelineLegacyEndpoint(
    node: NodeConfig | undefined,
    requestedModality: string | null,
    sourceFormat: string | null | undefined,
  ): string | null {
    if (!node) return null;
    if (sourceFormat === 'image_generation') return node.images_generations_endpoint || null;
    if (sourceFormat === 'image_edit') return node.images_edits_endpoint || null;
    if (sourceFormat === 'image_variation') return node.images_variations_endpoint || null;
    if (sourceFormat === 'audio_transcription') return node.audio_transcriptions_endpoint || null;
    if (sourceFormat === 'audio_translation') return node.audio_translations_endpoint || null;
    if (sourceFormat === 'audio_speech') return node.audio_speech_endpoint || null;
    if (sourceFormat === 'video_generation') return node.video_endpoint || node.video_generations_endpoint || null;
    if (requestedModality === 'embedding') return node.embeddings_endpoint || null;
    if (requestedModality === 'rerank') return node.rerank_endpoint || null;
    if (requestedModality === 'realtime') return node.realtime_endpoint || null;
    return null;
  }

  private pipelineDefaultEndpoint(
    requestedModality: string | null,
    sourceFormat: string | null | undefined,
  ): string | null {
    if (sourceFormat === 'image_generation') return '/v1/images/generations';
    if (sourceFormat === 'image_edit') return '/v1/images/edits';
    if (sourceFormat === 'image_variation') return '/v1/images/variations';
    if (sourceFormat === 'audio_transcription') return '/v1/audio/transcriptions';
    if (sourceFormat === 'audio_translation') return '/v1/audio/translations';
    if (sourceFormat === 'audio_speech') return '/v1/audio/speech';
    if (sourceFormat === 'video_generation') return '/v1/videos/generations';
    if (requestedModality === 'embedding') return '/v1/embeddings';
    if (requestedModality === 'rerank') return '/v1/rerank';
    if (requestedModality === 'realtime') return '/v1/realtime';
    return null;
  }

  private inferTraceInputTypes(modalities: readonly string[]): string[] {
    const input = new Set<string>();
    if (modalities.includes('text') || modalities.includes('embedding') || modalities.includes('rerank')) input.add('text');
    if (modalities.includes('vision') || modalities.includes('image')) input.add('image');
    if (modalities.includes('audio')) input.add('audio');
    if (modalities.includes('rerank')) input.add('documents');
    if (modalities.includes('realtime')) input.add('events');
    return Array.from(input);
  }

  private inferTraceOutputTypes(modalities: readonly string[]): string[] {
    const output = new Set<string>();
    if (modalities.includes('text') || modalities.includes('vision')) output.add('text');
    if (modalities.includes('image')) output.add('image');
    if (modalities.includes('audio')) output.add('audio');
    if (modalities.includes('embedding')) output.add('embedding');
    if (modalities.includes('rerank')) output.add('ranked_documents');
    if (modalities.includes('realtime')) output.add('events');
    return Array.from(output);
  }

  private countImageBlocks(canonical: CanonicalRequest): number {
    const messages = Array.isArray(canonical.messages) ? canonical.messages : [];
    return messages.reduce((count, message) => {
      if (!Array.isArray(message.content)) return count;
      return count + message.content.filter((block) => block.type === 'image').length;
    }, 0);
  }

  private mediaPayloadByteSize(canonical: CanonicalMediaRequest): number | null {
    if (Buffer.isBuffer(canonical.payload)) return canonical.payload.length;
    try {
      return Buffer.byteLength(JSON.stringify(canonical.payload || {}), 'utf8');
    } catch {
      return null;
    }
  }

  private mediaFileCount(canonical: CanonicalMediaRequest): number {
    if (Buffer.isBuffer(canonical.payload)) {
      const text = canonical.payload.toString('latin1');
      return (text.match(/filename="/g) || []).length;
    }
    const payload = canonical.payload as Record<string, unknown>;
    return ['image', 'file', 'audio']
      .map((key) => payload[key])
      .filter((value) => value !== undefined && value !== null).length;
  }

  private isMediaCanonical(
    canonical: LoggableCanonicalRequest,
  ): canonical is CanonicalMediaRequest {
    return (
      canonical.metadata.source_format === 'image_generation' ||
      canonical.metadata.source_format === 'image_edit' ||
      canonical.metadata.source_format === 'audio_transcription' ||
      canonical.metadata.source_format === 'audio_speech'
    );
  }

  private uniqueTraceStrings(values: readonly unknown[]): string[] {
    return Array.from(
      new Set(
        values
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .map((value) => value.toLowerCase()),
      ),
    );
  }

  private applyTargetFilterToTrace(
    trace: RouteDecisionTrace,
    allowedTargets: RouteTarget[],
    reason: string,
    message: string,
  ): RouteDecisionTrace {
    const next = this.cloneRouteTrace(trace);
    const allowed = new Set(allowedTargets.map(routeTargetKey));
    const selectedAllowedKey = allowedTargets[0] ? routeTargetKey(allowedTargets[0]) : null;
    for (const candidate of next.candidate_targets) {
      const key = `${candidate.node}:${candidate.model}`;
      if (allowed.has(key)) continue;
      if (!candidate.filter_reasons.includes(reason)) {
        candidate.filter_reasons.push(reason);
      }
      next.filters.push({
        node: candidate.node,
        model: candidate.model,
        stage: 'authorization',
        reason: message,
      });
      candidate.selected = false;
      candidate.fallback = false;
    }
    next.candidate_targets.forEach((candidate) => {
      const key = `${candidate.node}:${candidate.model}`;
      if (!allowed.has(key)) return;
      candidate.selected = key === selectedAllowedKey;
      candidate.fallback = allowed.has(key) && !candidate.selected;
    });
    if (allowedTargets[0]) {
      next.load_balancing.selected = allowedTargets[0];
      next.load_balancing.target_count = allowedTargets.length;
      next.fallback_chain = allowedTargets.slice(1);
      next.final_selection = {
        node: allowedTargets[0].node,
        model: allowedTargets[0].model,
        reason: next.final_selection.reason,
        is_fallback: false,
        fallback_reason: null,
      };
    }
    return next;
  }

  private applyCostDowngradeToTrace(
    trace: RouteDecisionTrace,
    originalRoute: { primary: RouteTarget; fallbacks: RouteTarget[] },
    activeRoute: { primary: RouteTarget; fallbacks: RouteTarget[] },
    reason: FallbackReason | null,
  ): RouteDecisionTrace {
    if (reason !== 'cost_downgrade') return trace;
    const next = this.cloneRouteTrace(trace);
    next.cost_downgrade = {
      applied: true,
      from: originalRoute.primary,
      to: activeRoute.primary,
      reason: 'estimated cost exceeded routing.fallback_policy.cost_downgrade.max_estimated_cost_usd',
    };
    next.final_selection = {
      node: activeRoute.primary.node,
      model: activeRoute.primary.model,
      reason: 'cost downgrade selected a lower-cost configured fallback',
      is_fallback: true,
      fallback_reason: 'cost_downgrade',
    };
    next.fallback_chain = activeRoute.fallbacks;
    for (const candidate of next.candidate_targets) {
      const key = `${candidate.node}:${candidate.model}`;
      candidate.selected = key === routeTargetKey(activeRoute.primary);
      candidate.fallback = activeRoute.fallbacks.some((target) => routeTargetKey(target) === key);
    }
    return next;
  }

  private cloneRouteTrace(trace: RouteDecisionTrace): RouteDecisionTrace {
    return JSON.parse(JSON.stringify(trace)) as RouteDecisionTrace;
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

    // If the request requires non-text modalities, keep only compatible
    // direct fallbacks. The direct primary itself is still honored.
    const reqModalities = detectRequestModalities(canonical);
    const requiredModalities = Array.from(reqModalities);
    if (requiredModalities.length > 1 && otherNodes.length > 0) {
      return otherNodes.filter((target) => {
        const modalities = this.capabilityService.resolveModelModalities(
          target.node,
          target.model,
        );
        return supportsModalities(modalities, requiredModalities);
      });
    }

    return otherNodes;
  }

  private assertRouteModeAllowed(
    canonical: LoggableCanonicalRequest,
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

  private assertApiKeyRequestAllowed(canonical: LoggableCanonicalRequest): void {
    const permissions = canonical.metadata.api_key_permissions;
    if (!permissions) return;

    const endpoint = this.permissionEndpointForRequest(canonical);
    const allowedEndpoints = permissions.allowed_endpoints || [];
    const allowedModalities = permissions.allowed_modalities || [];

    if (
      allowedEndpoints.length > 0 &&
      !this.permissionEndpointAliases(endpoint, canonical.metadata.source_format)
        .some((candidate) => allowedEndpoints.includes(candidate))
    ) {
      throw new GatewayRequestRejectedError(
        `This API key is not allowed to use endpoint "${endpoint}".`,
        403,
      );
    }

    const requestedModalities = this.permissionModalitiesForRequest(canonical);
    if (
      allowedModalities.length > 0 &&
      requestedModalities.some(
        (modality) => !allowedModalities.includes(modality),
      )
    ) {
      throw new GatewayRequestRejectedError(
        `This API key is not allowed to use modality "${requestedModalities.join(',')}".`,
        403,
      );
    }
  }

  private permissionEndpointForRequest(canonical: LoggableCanonicalRequest): string {
    const source = canonical.metadata.source_format;
    if (
      source === 'image_generation' ||
      source === 'image_edit' ||
      source === 'image_variation'
    ) {
      return 'images';
    }
    if (
      source === 'audio_transcription' ||
      source === 'audio_translation' ||
      source === 'audio_speech'
    ) {
      return 'audio';
    }
    if (source === 'video_generation') return 'video';
    return source;
  }

  private permissionEndpointAliases(endpoint: string, source: SourceFormat): string[] {
    const aliases = new Set<string>([endpoint, source]);
    if (endpoint === 'images') aliases.add('image');
    if (endpoint === 'audio') aliases.add('audio');
    if (endpoint === 'video') aliases.add('video');
    return Array.from(aliases);
  }

  private permissionModalitiesForRequest(canonical: LoggableCanonicalRequest): Modality[] {
    const source = canonical.metadata.source_format;
    if (source === 'embeddings') return ['embedding'];
    if (source === 'rerank') return ['rerank'];
    if (
      source === 'image_generation' ||
      source === 'image_edit' ||
      source === 'image_variation'
    ) {
      return ['image'];
    }
    if (
      source === 'audio_transcription' ||
      source === 'audio_translation' ||
      source === 'audio_speech'
    ) {
      return ['audio'];
    }
    if (source === 'video_generation') return ['video'];

    const detected = detectRequestModalities(canonical as CanonicalRequest);
    return detected.has('vision') ? ['vision'] : ['text'];
  }

  private assertTargetAllowed(
    canonical: LoggableCanonicalRequest,
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
    canonical: LoggableCanonicalRequest,
    targets: { node: string; model: string }[],
  ): { node: string; model: string }[] {
    return targets.filter((target) =>
      this.isTargetAllowed(canonical, target.node, target.model),
    );
  }

  private filterContextCompatibleFallbacks(
    canonical: CanonicalRequest,
    targets: { node: string; model: string }[],
  ): { node: string; model: string }[] {
    const estimate = estimateCanonicalRequestTokens(canonical);
    return targets.filter((target) => {
      const maxContextTokens =
        this.capabilityService.resolveModelRoutingCapabilities(
          target.node,
          target.model,
        ).max_context_tokens;
      return !maxContextTokens || estimate.context_tokens <= maxContextTokens;
    });
  }

  private assertContextWindow(
    canonical: CanonicalRequest,
    nodeId: string,
    model: string,
  ): void {
    const maxContextTokens =
      this.capabilityService.resolveModelRoutingCapabilities(
        nodeId,
        model,
      ).max_context_tokens;
    if (!maxContextTokens) return;

    const estimate = estimateCanonicalRequestTokens(canonical);
    if (estimate.context_tokens > maxContextTokens) {
      throw new GatewayRequestRejectedError(
        `Direct route ${nodeId}/${model} has max_context_tokens=${maxContextTokens}, but the request is estimated at ${estimate.context_tokens} context tokens.`,
        400,
      );
    }

    if (estimate.context_tokens > maxContextTokens * 0.8) {
      this.logger.warn(
        `Direct route ${nodeId}/${model} is estimated at ${estimate.context_tokens} context tokens, over 80% of configured max_context_tokens=${maxContextTokens}.`,
      );
    }
  }

  private requestRequiresStructuredOutput(canonical: CanonicalRequest): boolean {
    if (canonical.structured_output?.requested) return true;

    const rawBody = canonical.metadata.raw_body;
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return false;
    }
    const body = rawBody as Record<string, unknown>;
    if (body.response_format !== undefined) {
      return true;
    }
    const text = body.text;
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      const format = (text as Record<string, unknown>).format;
      if (format && typeof format === 'object' && !Array.isArray(format)) {
        return (format as Record<string, unknown>).type !== 'text';
      }
    }
    return false;
  }

  private resolveReasoningSelectionFields(canonical: CanonicalRequest): {
    requires_reasoning: boolean;
    reasoning_effort: string | null;
    reasoning_budget_tokens: number | null;
    reasoning_strategy: string | null;
  } {
    const intent =
      canonical.reasoning ||
      (
        canonical.metadata.raw_body &&
        typeof canonical.metadata.raw_body === 'object' &&
        !Array.isArray(canonical.metadata.raw_body)
          ? normalizeReasoningFromBody(
              canonical.metadata.source_format,
              canonical.metadata.raw_body as Record<string, unknown>,
            ).reasoning
          : undefined
      );

    return {
      requires_reasoning: Boolean(intent?.requested),
      reasoning_effort: intent?.effort || null,
      reasoning_budget_tokens: intent?.budget_tokens || null,
      reasoning_strategy: intent?.source || null,
    };
  }

  private isTargetAllowed(
    canonical: LoggableCanonicalRequest,
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

  private shouldUseStreamCache(canonical: CanonicalRequest): boolean {
    const cache = this.cacheService as PromptCacheService & {
      shouldCacheStream?: (request: CanonicalRequest) => boolean;
    };
    return typeof cache.shouldCacheStream === 'function'
      ? cache.shouldCacheStream(canonical)
      : false;
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

  private denormalizeEmbeddingForClient(
    canonical: CanonicalEmbeddingResponse,
  ): Record<string, unknown> {
    return {
      object: 'list',
      data: canonical.data.map((item) => ({
        object: 'embedding',
        embedding: item.embedding,
        index: item.index,
      })),
      model: canonical.model,
      usage: {
        prompt_tokens: canonical.usage.input_tokens,
        total_tokens:
          canonical.usage.input_tokens + canonical.usage.output_tokens,
      },
    };
  }

  private denormalizeRerankForClient(
    canonical: CanonicalRerankResponse,
  ): Record<string, unknown> {
    return {
      id: canonical.id,
      object: canonical.object,
      model: canonical.model,
      results: canonical.results.map((item) => ({
        index: item.index,
        relevance_score: item.relevance_score,
        ...(item.document !== undefined ? { document: item.document } : {}),
      })),
      usage: {
        prompt_tokens: canonical.usage.input_tokens,
        total_tokens:
          canonical.usage.input_tokens + canonical.usage.output_tokens,
      },
    };
  }

  // ══════════════════════════════════════════════════════
  // Error Formatting
  // ══════════════════════════════════════════════════════

  private successResult(
    requestId: string,
    body: PipelineResult['body'],
    statusCode = 200,
    extra: Partial<Pick<PipelineResult, 'contentType' | 'nodeId' | 'model'>> = {},
  ): PipelineResult {
    return {
      requestId,
      body,
      statusCode,
      ...extra,
    };
  }

  private errorResult(
    sourceFormat: SourceFormat,
    statusCode: number,
    message: string,
    requestId: string,
  ): PipelineResult {
    return this.successResult(
      requestId,
      this.formatError(sourceFormat, statusCode, message, requestId),
      statusCode,
    );
  }

  private budgetErrorResult(
    sourceFormat: SourceFormat,
    err: BudgetExceededError,
    requestId: string,
  ): PipelineResult {
    return this.successResult(
      requestId,
      this.formatBudgetError(sourceFormat, err, requestId),
      429,
    );
  }

  private formatError(
    sourceFormat: SourceFormat,
    statusCode: number,
    message: string,
    requestId?: string,
  ): Record<string, unknown> {
    switch (sourceFormat) {
      case 'chat_completions':
      case 'responses':
      case 'embeddings':
      case 'rerank':
      case 'image_generation':
      case 'image_edit':
      case 'image_variation':
      case 'audio_transcription':
      case 'audio_translation':
      case 'audio_speech':
      case 'video_generation':
      case 'batch':
        return openAiCompatibleError(message, {
          type: 'server_error',
          code: String(statusCode),
          requestId,
        });
      case 'messages':
        return anthropicCompatibleError(message, {
          type: 'api_error',
          requestId,
        });
      default:
        return openAiCompatibleError(message, {
          type: 'internal_error',
          code: String(statusCode),
          requestId,
        });
    }
  }

  private formatBudgetError(
    sourceFormat: SourceFormat,
    err: BudgetExceededError,
    requestId?: string,
  ): Record<string, unknown> {
    const details = err.toDetails();
    switch (sourceFormat) {
      case 'messages':
        return anthropicCompatibleError(err.message, {
          type: 'budget_exceeded',
          details,
          requestId,
        });
      case 'chat_completions':
      case 'responses':
      default:
        return openAiCompatibleError(err.message, {
          type: 'budget_exceeded',
          code: err.budgetType,
          details,
          requestId,
        });
    }
  }

  private resolveFailureStatus(err: Error | null | undefined): number {
    if (err instanceof ProviderError && err.statusCode > 0) {
      return err.statusCode;
    }
    if (err instanceof ConcurrencyLimitError) {
      return err.statusCode;
    }
    if (err instanceof StructuredOutputValidationError) {
      return 422;
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
    requestId?: string,
  ): void {
    const serializer = this.createSerializer(sourceFormat);
    applyGatewayRequestIdHeaders(res, requestId);
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

  private async lookupCachedResponse(
    canonical: CanonicalRequest,
  ): Promise<CanonicalResponse | null> {
    if (typeof this.cacheService.lookupAsync === 'function') {
      return this.cacheService.lookupAsync(canonical);
    }
    return this.cacheService.lookup(canonical);
  }

  private async storeCachedResponse(
    canonical: CanonicalRequest,
    response: CanonicalResponse,
  ): Promise<void> {
    if (typeof this.cacheService.storeAsync === 'function') {
      await this.cacheService.storeAsync(canonical, response);
      return;
    }
    this.cacheService.store(canonical, response);
  }

  private lookupSemanticCachedResponse(canonical: CanonicalRequest) {
    if (typeof this.cacheService.lookupSemantic === 'function') {
      return this.cacheService.lookupSemantic(canonical);
    }
    return {
      matched: false,
      hit: false,
      score: null,
      threshold: this.config.semanticCache.similarity_threshold,
      response: null,
      metadataOnly: false,
      reason: 'disabled' as const,
    };
  }

  private storeSemanticCachedResponse(
    canonical: CanonicalRequest,
    response: CanonicalResponse,
  ): void {
    if (typeof this.cacheService.storeSemantic === 'function') {
      this.cacheService.storeSemantic(canonical, response);
    }
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

  private async checkBudget(canonical: LoggableCanonicalRequest): Promise<void> {
    if (canonical.metadata.namespace_id) {
      if (canonical.metadata.team_id) {
        await this.budgetService.check(
          canonical.metadata.api_key_name || undefined,
          canonical.metadata.api_key_id || undefined,
          canonical.metadata.namespace_id,
          canonical.metadata.team_id,
        );
      } else {
        await this.budgetService.check(
          canonical.metadata.api_key_name || undefined,
          canonical.metadata.api_key_id || undefined,
          canonical.metadata.namespace_id,
        );
      }
      return;
    }

    if (canonical.metadata.team_id) {
      await this.budgetService.check(
        canonical.metadata.api_key_name || undefined,
        canonical.metadata.api_key_id || undefined,
        undefined,
        canonical.metadata.team_id,
      );
      return;
    }

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
    canonical: LoggableCanonicalRequest,
    usage: TokenUsage,
    model: string,
    nodeId?: string,
  ): Promise<{ totalTokens: number; costUsd: number }> {
    const pricing = this.config.getModelPricing(model, nodeId);
    const costUsd = this.calculateCost(usage, pricing);
    const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);

    if (canonical.metadata.namespace_id) {
      if (canonical.metadata.team_id) {
        await this.budgetService.record(
          totalTokens,
          costUsd,
          canonical.metadata.api_key_name || undefined,
          canonical.metadata.api_key_id || undefined,
          canonical.metadata.namespace_id,
          canonical.metadata.team_id,
        );
      } else {
        await this.budgetService.record(
          totalTokens,
          costUsd,
          canonical.metadata.api_key_name || undefined,
          canonical.metadata.api_key_id || undefined,
          canonical.metadata.namespace_id,
        );
      }
    } else if (canonical.metadata.team_id) {
      await this.budgetService.record(
        totalTokens,
        costUsd,
        canonical.metadata.api_key_name || undefined,
        canonical.metadata.api_key_id || undefined,
        undefined,
        canonical.metadata.team_id,
      );
    } else if (canonical.metadata.api_key_id) {
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
    semanticCacheHit?: boolean;
    semanticCacheScore?: number | null;
    experimentGroup?: string | null;
    domainHint?: string | null;
    modalityHints?: string[];
    fallbackReason?: FallbackReason | null;
    fallbackFromNode?: string | null;
    routeTrace?: RouteDecisionTrace;
    mediaProviderResponseType?: string | null;
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
      fallbackReason: params.fallbackReason,
      fallbackFromNode: params.fallbackFromNode,
      routeTrace: params.routeTrace,
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
    requestId: string; canonical: LoggableCanonicalRequest; tier: Tier; score: number;
    nodeId: string; model: string; statusCode: number; isFallback: boolean;
    latencyMs: number; usage: TokenUsage; error: string | null;
    retryCount?: number;
    semanticCacheHit?: boolean;
    semanticCacheScore?: number | null;
    experimentGroup?: string | null;
    domainHint?: string | null;
    modalityHints?: string[];
    fallbackReason?: FallbackReason | null;
    fallbackFromNode?: string | null;
    routeTrace?: RouteDecisionTrace;
    mediaProviderResponseType?: string | null;
  }): Promise<void> {
    try {
      const pricing = this.config.getModelPricing(params.model, params.nodeId);
      const costUsd = this.calculateCost(params.usage, pricing);
      const structuredOutput = this.resolveStructuredOutputLogFields(
        params.canonical,
        params.nodeId,
        params.model,
      );
      const reasoning = this.resolveReasoningLogFields(
        params.canonical,
        params.nodeId,
        params.model,
      );
      const media = this.resolveMediaLogFields(
        params.canonical,
        params.mediaProviderResponseType,
      );

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
        fallback_reason: params.fallbackReason || null,
        structured_output_requested:
          structuredOutput.structured_output_requested,
        structured_output_type: structuredOutput.structured_output_type,
        structured_output_strategy:
          structuredOutput.structured_output_strategy,
        structured_output_supported:
          structuredOutput.structured_output_supported,
        structured_output_schema_name:
          structuredOutput.structured_output_schema_name,
        reasoning_requested: reasoning.reasoning_requested,
        reasoning_effort: reasoning.reasoning_effort,
        reasoning_strategy: reasoning.reasoning_strategy,
        reasoning_supported: reasoning.reasoning_supported,
        reasoning_budget_tokens: reasoning.reasoning_budget_tokens,
        reasoning_source: reasoning.reasoning_source,
        reasoning_reason: reasoning.reasoning_reason,
        media_type: media.media_type,
        media_operation: media.media_operation,
        media_multipart: media.media_multipart,
        media_file_count: media.media_file_count,
        media_byte_size: media.media_byte_size,
        media_requested_format: media.media_requested_format,
        media_response_format: media.media_response_format,
        media_provider_response_type: media.media_provider_response_type,
        session_id:
          params.canonical.metadata.session_id ||
          params.canonical.metadata.session_key ||
          null,
        session_key: params.canonical.metadata.session_key || null,
        trace_id: params.canonical.metadata.trace_id || null,
        error: params.error,
        api_key_name: params.canonical.metadata.api_key_name || null,
        api_key_id: params.canonical.metadata.api_key_id || null,
        namespace_id: params.canonical.metadata.namespace_id || null,
        team_id: params.canonical.metadata.team_id || null,
        retry_count: params.retryCount || 0,
        semantic_cache_hit: params.semanticCacheHit || false,
        semantic_cache_score:
          params.semanticCacheScore === undefined ? null : params.semanticCacheScore,
        experiment_group: params.experimentGroup || null,
      });
      this.telemetry.recordCallMetrics({
        tier: params.tier,
        node: params.nodeId,
        model: this.metricModelLabel(params.nodeId, params.model),
        statusCode: params.statusCode,
        latencyMs: params.latencyMs,
        inputTokens: params.usage.input_tokens || 0,
        outputTokens: params.usage.output_tokens || 0,
        cacheCreationInputTokens: params.usage.cache_creation_input_tokens || 0,
        cacheReadInputTokens: params.usage.cache_read_input_tokens || 0,
        costUsd,
        isFallback: params.isFallback,
        fallbackReason: params.fallbackReason || null,
        fallbackFromNode: params.fallbackFromNode || null,
      });
      if (
        params.statusCode >= 200 &&
        params.statusCode < 400 &&
        !params.error &&
        params.nodeId !== 'cache' &&
        params.nodeId !== 'hook'
      ) {
        this.routingService.recordTargetUsage?.(
          params.nodeId,
          params.model,
          params.usage,
        );
      }
      const saved = await this.callLogRepo.save(log);

      try {
        await this.saveRouteDecisionTrace(params);
      } catch (err) {
        this.logger.warn(`Failed to save route decision trace: ${(err as Error).message}`);
      }

      // Push to SSE stream for real-time dashboard
      this.logEventBus.emit(saved);
      this.alerts?.recordCall(saved);
      try {
        this.logSinks?.enqueue(saved);
      } catch (err) {
        this.logger.warn(`Failed to enqueue external log sinks: ${(err as Error).message}`);
      }

      // Optional hosted control-plane metadata upload. This is privacy-preserving:
      // it derives metadata only from CallLog and never includes prompt/response bodies.
      this.telemetryUploader.enqueue(saved, {
        domainHint: params.domainHint,
        modalities: params.modalityHints || this.modalitiesForLog(params.canonical),
      });
    } catch (err) {
      this.logger.error(`Failed to log call: ${(err as Error).message}`);
    }
  }

  private resolveStructuredOutputLogFields(
    canonical: LoggableCanonicalRequest,
    nodeId: string,
    model: string,
  ): {
    structured_output_requested: boolean;
    structured_output_type: string | null;
    structured_output_strategy: string | null;
    structured_output_supported: boolean | null;
    structured_output_schema_name: string | null;
  } {
    if (canonical.metadata.source_format === 'embeddings' || !('messages' in canonical)) {
      return {
        structured_output_requested: false,
        structured_output_type: null,
        structured_output_strategy: null,
        structured_output_supported: null,
        structured_output_schema_name: null,
      };
    }

    const node = this.config.getNode(nodeId);
    const declaredSupport = node
      ? this.capabilityService.resolveModelRoutingCapabilities(
          node.id,
          model,
        ).structured_output
      : null;
    const responseFormat =
      canonical.response_format ||
      (
        canonical.metadata.raw_body &&
        typeof canonical.metadata.raw_body === 'object' &&
        !Array.isArray(canonical.metadata.raw_body)
          ? normalizeStructuredOutputFromBody(
              canonical.metadata.source_format,
              canonical.metadata.raw_body as Record<string, unknown>,
            ).response_format
          : undefined
      );
    const forwarding = resolveStructuredOutputForwarding(
      responseFormat,
      canonical.metadata.source_format,
      node?.protocol,
      declaredSupport,
    );

    return {
      structured_output_requested: forwarding.requested,
      structured_output_type: forwarding.type,
      structured_output_strategy: forwarding.strategy,
      structured_output_supported: forwarding.supported,
      structured_output_schema_name: forwarding.schema_name,
    };
  }

  private resolveReasoningLogFields(
    canonical: LoggableCanonicalRequest,
    nodeId: string,
    model: string,
  ): {
    reasoning_requested: boolean;
    reasoning_effort: string | null;
    reasoning_strategy: string | null;
    reasoning_supported: boolean | null;
    reasoning_budget_tokens: number | null;
    reasoning_source: string | null;
    reasoning_reason: string | null;
  } {
    if (canonical.metadata.source_format === 'embeddings' || !('messages' in canonical)) {
      return {
        reasoning_requested: false,
        reasoning_effort: null,
        reasoning_strategy: null,
        reasoning_supported: null,
        reasoning_budget_tokens: null,
        reasoning_source: null,
        reasoning_reason: null,
      };
    }

    const node = this.config.getNode(nodeId);
    const declaredSupport = node
      ? this.capabilityService.resolveModelRoutingCapabilities(
          node.id,
          model,
        ).supports_reasoning
      : null;
    const intent =
      canonical.reasoning ||
      (
        canonical.metadata.raw_body &&
        typeof canonical.metadata.raw_body === 'object' &&
        !Array.isArray(canonical.metadata.raw_body)
          ? normalizeReasoningFromBody(
              canonical.metadata.source_format,
              canonical.metadata.raw_body as Record<string, unknown>,
            ).reasoning
          : undefined
      );
    const forwarding = resolveReasoningForwarding(
      intent,
      canonical.metadata.source_format,
      node?.protocol,
      declaredSupport,
    );

    return {
      reasoning_requested: forwarding.requested,
      reasoning_effort: forwarding.effort,
      reasoning_strategy: forwarding.strategy,
      reasoning_supported: forwarding.supported,
      reasoning_budget_tokens: forwarding.budget_tokens,
      reasoning_source: forwarding.source,
      reasoning_reason: forwarding.reason,
    };
  }

  private resolveMediaLogFields(
    canonical: LoggableCanonicalRequest,
    providerResponseType?: string | null,
  ): {
    media_type: string | null;
    media_operation: string | null;
    media_multipart: boolean | null;
    media_file_count: number | null;
    media_byte_size: number | null;
    media_requested_format: string | null;
    media_response_format: string | null;
    media_provider_response_type: string | null;
  } {
    if (!('media' in canonical) || !canonical.media) {
      return {
        media_type: null,
        media_operation: null,
        media_multipart: null,
        media_file_count: null,
        media_byte_size: null,
        media_requested_format: null,
        media_response_format: null,
        media_provider_response_type: null,
      };
    }

    return {
      media_type: canonical.media.media_type,
      media_operation: canonical.media.operation,
      media_multipart: canonical.media.multipart,
      media_file_count: canonical.media.file_count,
      media_byte_size: canonical.media.byte_size,
      media_requested_format: canonical.media.requested_format || null,
      media_response_format: canonical.media.response_format || null,
      media_provider_response_type: providerResponseType || null,
    };
  }

  private async saveRouteDecisionTrace(
    params: {
      requestId: string; canonical: LoggableCanonicalRequest; tier: Tier; score: number;
      nodeId: string; model: string; statusCode: number; isFallback: boolean;
      latencyMs: number; usage: TokenUsage; error: string | null;
      retryCount?: number;
      experimentGroup?: string | null;
      domainHint?: string | null;
      modalityHints?: string[];
      fallbackReason?: FallbackReason | null;
      fallbackFromNode?: string | null;
      routeTrace?: RouteDecisionTrace;
    },
  ): Promise<void> {
    const trace = this.finalizeRouteTrace(params);
    const log = this.routeDecisionRepo.create({
      request_id: params.requestId,
      source_format: params.canonical.metadata.source_format,
      tier: params.tier,
      score: params.score,
      route_mode: trace.mode,
      strategy: String(trace.load_balancing.strategy),
      selected_node_id: params.nodeId,
      selected_model: params.model,
      domain_hint: trace.domain_hints.domain,
      candidate_count: trace.candidate_targets.length,
      filtered_count: trace.filters.length,
      status_code: params.statusCode,
      is_fallback: params.isFallback,
      fallback_reason: params.fallbackReason || null,
      session_id:
        params.canonical.metadata.session_id ||
        params.canonical.metadata.session_key ||
        null,
      trace_id: params.canonical.metadata.trace_id || null,
      api_key_name: params.canonical.metadata.api_key_name || null,
      api_key_id: params.canonical.metadata.api_key_id || null,
      namespace_id: params.canonical.metadata.namespace_id || null,
      trace_json: JSON.stringify(trace),
    });
    await this.routeDecisionRepo.save(log);
  }

  private finalizeRouteTrace(params: {
    requestId: string; canonical: LoggableCanonicalRequest; tier: Tier; score: number;
    nodeId: string; model: string; statusCode: number; isFallback: boolean;
    error: string | null;
    fallbackReason?: FallbackReason | null;
    routeTrace?: RouteDecisionTrace;
  }): RouteDecisionTrace {
    const trace = params.routeTrace
      ? this.cloneRouteTrace(params.routeTrace)
      : this.buildPipelineRouteTrace({
          mode:
            params.nodeId === 'cache'
              ? 'cache'
              : params.nodeId === 'hook'
                ? 'hook'
                : params.canonical.metadata.source_format === 'embeddings'
                  ? 'embedding_auto'
                  : 'direct',
          canonical: params.canonical,
          tier: params.tier,
          score: params.score,
          route: {
            primary: { node: params.nodeId, model: params.model },
            fallbacks: [],
          },
          reason: 'minimal trace from call log metadata',
        });

    trace.request_id = params.requestId;
    trace.session_id =
      params.canonical.metadata.session_id ||
      params.canonical.metadata.session_key ||
      null;
    trace.trace_id = params.canonical.metadata.trace_id || null;
    trace.source_format = params.canonical.metadata.source_format;
    trace.requested_model = params.canonical.metadata.original_model || null;
    trace.tier = params.tier;
    trace.score = params.score;
    if (params.canonical.metadata.source_format !== 'embeddings' && 'messages' in params.canonical) {
      const reasoning = this.resolveReasoningLogFields(
        params.canonical,
        params.nodeId,
        params.model,
      );
      trace.constraints.requires_reasoning = reasoning.reasoning_requested;
      trace.constraints.reasoning_effort = reasoning.reasoning_effort;
      trace.constraints.reasoning_budget_tokens = reasoning.reasoning_budget_tokens;
      trace.constraints.reasoning_strategy = reasoning.reasoning_strategy;
    }
    trace.final_selection = {
      node: params.nodeId,
      model: params.model,
      reason: params.isFallback
        ? `final target was selected through fallback${params.fallbackReason ? `: ${params.fallbackReason}` : ''}`
        : trace.final_selection.reason,
      is_fallback: params.isFallback,
      fallback_reason: params.fallbackReason || null,
    };
    trace.outcome = {
      status_code: params.statusCode,
      error: params.error ? this.sanitizeTraceError(params.error) : null,
    };
    trace.privacy = {
      prompt: false,
      response: false,
      raw_headers: false,
      provider_keys: false,
    };

    for (const candidate of trace.candidate_targets) {
      const selected = candidate.node === params.nodeId && candidate.model === params.model;
      candidate.selected = selected;
      candidate.fallback = !selected && trace.fallback_chain.some((target) =>
        target.node === candidate.node && target.model === candidate.model,
      );
    }
    return trace;
  }

  private sanitizeTraceError(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes('budget')) return 'budget_rejected';
    if (lower.includes('rate limit') || lower.includes('429')) return 'rate_limited';
    if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
    if (lower.includes('structured') || lower.includes('schema') || lower.includes('json')) {
      return 'structured_output_validation_failed';
    }
    if (lower.includes('circuit')) return 'circuit_open';
    if (lower.includes('client canceled') || lower.includes('client cancelled')) {
      return 'client_canceled';
    }
    return 'upstream_error_redacted';
  }

  private metricModelLabel(nodeId: string, model: string): string {
    if (nodeId === 'cache' || nodeId === 'hook') {
      return nodeId;
    }
    const node = this.config.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return 'unknown';
    if (
      node.models.includes(model) ||
      node.embedding_models?.includes(model) ||
      node.rerank_models?.includes(model) ||
      node.image_models?.includes(model) ||
      node.audio_models?.includes(model) ||
      node.video_models?.includes(model)
    ) {
      return model;
    }
    const prefix = node.model_prefixes?.find((value) => model.startsWith(value));
    return prefix ? `${node.id}:${prefix}*` : 'unlisted';
  }

  private modalitiesForLog(canonical: LoggableCanonicalRequest): string[] {
    if (
      canonical.metadata.source_format === 'embeddings' ||
      canonical.metadata.source_format === 'rerank'
    ) {
      return ['text'];
    }
    if (
      canonical.metadata.source_format === 'image_generation' ||
      canonical.metadata.source_format === 'image_edit' ||
      canonical.metadata.source_format === 'image_variation'
    ) {
      return ['vision'];
    }
    if (
      canonical.metadata.source_format === 'audio_transcription' ||
      canonical.metadata.source_format === 'audio_translation' ||
      canonical.metadata.source_format === 'audio_speech'
    ) {
      return ['audio'];
    }
    if (canonical.metadata.source_format === 'video_generation') {
      return ['video'];
    }
    return Array.from(detectRequestModalities(canonical as CanonicalRequest));
  }

}
