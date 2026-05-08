import { Injectable, Logger, Optional } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { BudgetService } from '../budget/budget.service';
import {
  CanonicalRequest,
  CanonicalResponse,
  Tier,
} from '../canonical/canonical.types';
import {
  RouteDecisionAsyncEvalEvidence,
  RouteDecisionCostOptimizerEvidence,
  RouteDecisionQualityGateEvidence,
  RouteDecisionQualityGateEvent,
  RouteDecisionTokenPredictionEvidence,
  RouteDecisionTrace,
  routeTargetKey,
} from '../routing/route-decision-trace';
import type {
  IntelligenceQualityGateRuleConfig,
  RouteTarget,
} from '../config/gateway.config';
import { estimateCanonicalRequestTokens, TokenEstimate } from '../routing/token-estimator';
import { AdaptiveRoutingStatsService, RouteTargetStats } from '../routing/adaptive-routing-stats.service';
import { AlertService } from '../alerts/alert.service';

export interface IntelligenceRouteInput {
  canonical: CanonicalRequest;
  tier: Tier;
  score: number;
  route: {
    primary: RouteTarget;
    fallbacks: RouteTarget[];
  };
  routeTrace: RouteDecisionTrace;
}

export interface IntelligenceRouteDecision {
  route: {
    primary: RouteTarget;
    fallbacks: RouteTarget[];
  };
  routeTrace: RouteDecisionTrace;
  rejected?: {
    statusCode: number;
    message: string;
  };
  fallbackReason?: 'cost_downgrade' | null;
  fallbackFromNode?: string | null;
}

export interface QualityGateInput {
  canonical: CanonicalRequest;
  response: CanonicalResponse;
  target: RouteTarget;
  fallbacks: RouteTarget[];
  tier: Tier;
  score: number;
  streamStarted: boolean;
}

export interface QualityGateResult {
  response: CanonicalResponse;
  traceEvidence: RouteDecisionQualityGateEvidence;
  shouldFallback: boolean;
  shouldRetry: boolean;
  alertOnly: boolean;
  failureReasons: string[];
}

export interface AsyncEvalInput {
  canonical: CanonicalRequest;
  response?: CanonicalResponse;
  target: RouteTarget;
  requestId: string;
  statusCode: number;
  latencyMs: number;
}

@Injectable()
export class IntelligenceLoopService {
  private readonly logger = new Logger(IntelligenceLoopService.name);
  private readonly recentAsyncEvalJobs: Array<{
    id: string;
    request_id: string;
    created_at: string;
    workspace_id: string | null;
    dimensions: string[];
    target: RouteTarget;
  }> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly budgetService: BudgetService,
    @Optional() private readonly adaptiveStats?: AdaptiveRoutingStatsService,
    @Optional() private readonly alerts?: AlertService,
  ) {}

  async evaluateRoute(input: IntelligenceRouteInput): Promise<IntelligenceRouteDecision> {
    let route = {
      primary: input.route.primary,
      fallbacks: [...input.route.fallbacks],
    };
    let trace = this.cloneTrace(input.routeTrace);

    const tokenPrediction = await this.buildTokenPredictionEvidence(
      input.canonical,
      route.primary,
    );
    trace = this.withIntelligence(trace, { token_prediction: tokenPrediction });

    if (
      tokenPrediction.action === 'rejected' &&
      this.config.intelligence.token_prediction.budget_policy === 'reject'
    ) {
      return {
        route,
        routeTrace: trace,
        rejected: {
          statusCode: 429,
          message: 'Token prediction exceeds the configured budget policy.',
        },
      };
    }

    const optimizer = await this.buildCostOptimizerEvidence(
      input.canonical,
      route,
      tokenPrediction,
    );
    const optimizedRoute = this.applyOptimizerDecision(route, optimizer, tokenPrediction);
    route = optimizedRoute.route;
    optimizer.applied = optimizedRoute.applied;
    optimizer.from = optimizedRoute.from;
    optimizer.to = optimizedRoute.to;
    if (optimizedRoute.applied) {
      optimizer.reason = optimizedRoute.reason;
      tokenPrediction.action =
        tokenPrediction.action === 'downgrade_requested'
          ? 'downgraded'
          : tokenPrediction.action;
      trace = this.applyFinalTarget(trace, route.primary, route.fallbacks, optimizedRoute.reason);
    }
    trace = this.withIntelligence(trace, {
      token_prediction: tokenPrediction,
      optimizer,
    });

    return {
      route,
      routeTrace: trace,
      fallbackReason: optimizedRoute.applied ? 'cost_downgrade' : null,
      fallbackFromNode: optimizedRoute.applied ? input.route.primary.node : null,
    };
  }

  evaluateQualityGate(input: QualityGateInput): QualityGateResult {
    const gateConfig = this.config.intelligence.quality_gate;
    if (!gateConfig.enabled) {
      return {
        response: input.response,
        traceEvidence: {
          enabled: false,
          mode: 'disabled',
          final_status: 'skipped',
          events: [],
          reason: 'quality_gate_disabled',
        },
        shouldFallback: false,
        shouldRetry: false,
        alertOnly: false,
        failureReasons: [],
      };
    }

    const events: RouteDecisionQualityGateEvent[] = [];
    for (const rule of gateConfig.rules || []) {
      if (rule.enabled === false) continue;
      if (!this.qualityRuleMatches(rule, input)) {
        events.push({
          rule_id: rule.id,
          status: 'skipped',
          actions: rule.actions || [],
          failure_reasons: ['rule_scope_not_matched'],
          selected_action: 'skip',
          stream_started: input.streamStarted,
          retry_attempted: false,
          fallback_attempted: false,
        });
        continue;
      }

      const failureReasons = this.evaluateQualityRule(rule, input);
      const failed = failureReasons.length > 0;
      const actions = rule.actions || ['alert'];
      const selectedAction = failed
        ? input.streamStarted
          ? 'alert'
          : actions.includes('fallback') && input.fallbacks.length > 0
            ? 'fallback'
            : actions.includes('retry')
              ? 'retry'
              : actions.includes('alert')
                ? 'alert'
                : 'none'
        : 'none';
      events.push({
        rule_id: rule.id,
        status: failed ? 'failed' : 'passed',
        actions,
        failure_reasons: failureReasons,
        selected_action: selectedAction,
        stream_started: input.streamStarted,
        retry_attempted: false,
        fallback_attempted: false,
      });
    }

    const failedEvents = events.filter((event) => event.status === 'failed');
    const failureReasons = [...new Set(failedEvents.flatMap((event) => event.failure_reasons))];
    const selectedActions = new Set(failedEvents.map((event) => event.selected_action));
    const shouldFallback = selectedActions.has('fallback');
    const shouldRetry = !shouldFallback && selectedActions.has('retry');
    const alertOnly =
      failedEvents.length > 0 && !shouldFallback && !shouldRetry;

    return {
      response: input.response,
      traceEvidence: {
        enabled: true,
        mode: failedEvents.length > 0 ? 'enforced' : 'metadata_only',
        final_status:
          events.length === 0
            ? 'skipped'
            : failedEvents.length > 0
              ? 'failed'
              : 'passed',
        events,
        reason:
          failedEvents.length > 0
            ? 'quality_gate_failed'
            : events.length === 0
              ? 'no_quality_gate_rules'
              : 'quality_gate_passed',
      },
      shouldFallback,
      shouldRetry,
      alertOnly,
      failureReasons,
    };
  }

  markQualityGateAction(
    evidence: RouteDecisionQualityGateEvidence,
    action: 'retry' | 'fallback' | 'alert',
  ): RouteDecisionQualityGateEvidence {
    return {
      ...evidence,
      events: evidence.events.map((event) =>
        event.status === 'failed' && event.selected_action === action
          ? {
              ...event,
              retry_attempted: action === 'retry' || event.retry_attempted,
              fallback_attempted: action === 'fallback' || event.fallback_attempted,
            }
          : event,
      ),
    };
  }

  enqueueAsyncEval(input: AsyncEvalInput): RouteDecisionAsyncEvalEvidence {
    const asyncEval = this.config.intelligence.async_eval;
    if (!asyncEval.enabled) {
      return {
        enabled: false,
        queued: false,
        sample_rate: asyncEval.sample_rate,
        dimensions: asyncEval.dimensions,
        metadata_only: true,
        job_id: null,
        reason: 'async_eval_disabled',
      };
    }

    const sampleRate = Math.max(0, Math.min(1, asyncEval.sample_rate));
    if (sampleRate <= 0) {
      return {
        enabled: true,
        queued: false,
        sample_rate: sampleRate,
        dimensions: asyncEval.dimensions,
        metadata_only: asyncEval.metadata_only,
        job_id: null,
        reason: 'sample_rate_zero',
      };
    }
    if (this.sampleBucket(input.requestId) >= sampleRate) {
      return {
        enabled: true,
        queued: false,
        sample_rate: sampleRate,
        dimensions: asyncEval.dimensions,
        metadata_only: asyncEval.metadata_only,
        job_id: null,
        reason: 'sampled_out',
      };
    }

    const jobId = `eval_${uuidv4()}`;
    this.recentAsyncEvalJobs.push({
      id: jobId,
      request_id: input.requestId,
      created_at: new Date().toISOString(),
      workspace_id: input.canonical.metadata.workspace_id || null,
      dimensions: asyncEval.dimensions,
      target: input.target,
    });
    const maxJobs = Math.max(1, asyncEval.max_recent_jobs);
    if (this.recentAsyncEvalJobs.length > maxJobs) {
      this.recentAsyncEvalJobs.splice(0, this.recentAsyncEvalJobs.length - maxJobs);
    }

    return {
      enabled: true,
      queued: true,
      sample_rate: sampleRate,
      dimensions: asyncEval.dimensions,
      metadata_only: asyncEval.metadata_only,
      job_id: jobId,
      reason: 'metadata_eval_queued',
    };
  }

  qualityGateStreamingEvidence(): RouteDecisionQualityGateEvidence {
    const qualityGate = this.config.intelligence.quality_gate;
    return {
      enabled: qualityGate.enabled,
      mode: qualityGate.enabled ? 'metadata_only' : 'disabled',
      final_status: 'skipped',
      events: [],
      reason: qualityGate.enabled
        ? 'streaming_no_post_start_retry'
        : 'quality_gate_disabled',
    };
  }

  withIntelligence(
    trace: RouteDecisionTrace,
    evidence: Partial<NonNullable<RouteDecisionTrace['intelligence']>>,
  ): RouteDecisionTrace {
    return {
      ...trace,
      intelligence: {
        ...(trace.intelligence || {}),
        ...evidence,
      },
    };
  }

  emitQualityGateAlert(
    input: QualityGateInput,
    evidence: RouteDecisionQualityGateEvidence,
    failureReasons: string[],
  ): void {
    if (!this.alerts || failureReasons.length === 0) return;
    this.alerts.emit({
      type: 'quality_gate_failed',
      severity: 'warning',
      message: `Quality gate failed for ${input.target.node}/${input.target.model}.`,
      dedupeKey: `${input.target.node}:${input.target.model}:${failureReasons.join(',')}`,
      details: {
        node: input.target.node,
        model: input.target.model,
        tier: input.tier,
        agent_virtual_model: input.canonical.metadata.agent_virtual_model || null,
        failure_reasons: failureReasons,
        metadata_only: true,
        gate_reason: evidence.reason,
      },
    });
  }

  private async buildTokenPredictionEvidence(
    canonical: CanonicalRequest,
    primary: RouteTarget,
  ): Promise<RouteDecisionTokenPredictionEvidence> {
    const tokenPrediction = this.config.intelligence.token_prediction;
    const estimate = estimateCanonicalRequestTokens(canonical);
    const estimatedCost = this.estimateCostUsd(estimate, primary);
    const budget = await this.resolveBudgetHeadroom(canonical);
    const risk = this.resolveBudgetRisk(
      estimatedCost,
      budget.remainingUsd,
      budget.usageRatio,
      tokenPrediction.near_limit_ratio,
    );
    const action =
      !tokenPrediction.enabled
        ? 'skipped'
        : risk === 'over_limit' && tokenPrediction.budget_policy === 'reject'
          ? 'rejected'
          : risk === 'over_limit' && tokenPrediction.budget_policy === 'downgrade'
            ? 'downgrade_requested'
            : 'observed';

    return {
      enabled: tokenPrediction.enabled,
      estimated_input_tokens: estimate.input_tokens,
      estimated_output_tokens: estimate.output_tokens,
      estimated_context_tokens: estimate.context_tokens,
      estimated_cost_usd: this.roundNullable(estimatedCost, 6),
      budget_policy: tokenPrediction.budget_policy,
      budget_scope: budget.scope,
      budget_limit_usd: this.roundNullable(budget.limitUsd, 6),
      budget_current_usd: this.roundNullable(budget.currentUsd, 6),
      budget_remaining_usd: this.roundNullable(budget.remainingUsd, 6),
      budget_usage_ratio: this.roundNullable(budget.usageRatio, 4),
      risk,
      action,
      reason:
        !tokenPrediction.enabled
          ? 'token_prediction_disabled'
          : risk === 'unknown'
            ? 'missing_price_or_budget'
            : risk,
    };
  }

  private async buildCostOptimizerEvidence(
    canonical: CanonicalRequest,
    route: { primary: RouteTarget; fallbacks: RouteTarget[] },
    tokenPrediction: RouteDecisionTokenPredictionEvidence,
  ): Promise<RouteDecisionCostOptimizerEvidence> {
    const optimizer = this.config.intelligence.cost_optimizer;
    const targets = [route.primary, ...route.fallbacks];
    const stats = await this.loadStatsByTarget();
    const estimates = targets.map((target) =>
      this.scoreOptimizerCandidate(
        canonical,
        target,
        routeTargetKey(route.primary),
        stats.get(routeTargetKey(target)),
        tokenPrediction,
      ),
    );

    return {
      enabled: optimizer.enabled,
      action: optimizer.action,
      objective: optimizer.objective,
      applied: false,
      from: null,
      to: null,
      reason: optimizer.enabled ? 'optimizer_evidence_recorded' : 'optimizer_disabled',
      budget_remaining_usd: tokenPrediction.budget_remaining_usd,
      quality_critical: this.isQualityCritical(canonical),
      candidates: estimates,
    };
  }

  private scoreOptimizerCandidate(
    canonical: CanonicalRequest,
    target: RouteTarget,
    selectedKey: string,
    stats: RouteTargetStats | undefined,
    tokenPrediction: RouteDecisionTokenPredictionEvidence,
  ): RouteDecisionCostOptimizerEvidence['candidates'][number] {
    const tokenEstimate = estimateCanonicalRequestTokens(canonical);
    const estimatedCost = this.estimateCostUsd(tokenEstimate, target);
    const capabilities = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    );
    const qualityScore =
      typeof capabilities.quality_score === 'number'
        ? Math.max(0, Math.min(1, capabilities.quality_score))
        : stats && stats.success_rate > 0
          ? stats.success_rate
          : null;
    const latencyMs =
      stats && stats.avg_latency_ms > 0 ? stats.avg_latency_ms : null;
    const successRate =
      stats && stats.calls >= this.config.intelligence.cost_optimizer.min_samples
        ? stats.success_rate
        : null;
    const cacheHitProbability =
      this.cacheHitProbabilityFromTraceCandidate(target, tokenPrediction);
    const compositeScore = this.compositeOptimizerScore({
      cost: estimatedCost,
      latencyMs,
      successRate,
      qualityScore,
      cacheHitProbability,
    });
    const rejectedReasons: string[] = [];
    if (estimatedCost === null) rejectedReasons.push('missing_price');
    if (
      tokenPrediction.budget_remaining_usd !== null &&
      estimatedCost !== null &&
      estimatedCost > tokenPrediction.budget_remaining_usd
    ) {
      rejectedReasons.push('estimated_cost_over_budget');
    }
    if (
      this.isQualityCritical(canonical) &&
      !this.allowsQualityCriticalDowngrade(tokenPrediction) &&
      routeTargetKey(target) !== selectedKey
    ) {
      rejectedReasons.push('quality_critical_downgrade_blocked');
    }

    return {
      node: target.node,
      model: target.model,
      estimated_cost_usd: this.roundNullable(estimatedCost, 6),
      cache_hit_probability: this.roundNullable(cacheHitProbability, 4),
      latency_ms: this.roundNullable(latencyMs, 0),
      success_rate: this.roundNullable(successRate, 4),
      quality_score: this.roundNullable(qualityScore, 4),
      composite_score: this.roundNullable(compositeScore, 4),
      selected: routeTargetKey(target) === selectedKey,
      rejected_reasons: rejectedReasons,
    };
  }

  private applyOptimizerDecision(
    route: { primary: RouteTarget; fallbacks: RouteTarget[] },
    optimizer: RouteDecisionCostOptimizerEvidence,
    tokenPrediction: RouteDecisionTokenPredictionEvidence,
  ): {
    route: { primary: RouteTarget; fallbacks: RouteTarget[] };
    applied: boolean;
    from: RouteTarget | null;
    to: RouteTarget | null;
    reason: string;
  } {
    const optimizeRequested = optimizer.enabled && optimizer.action === 'optimize';
    const budgetDowngradeRequested = tokenPrediction.action === 'downgrade_requested';
    if (!optimizeRequested && !budgetDowngradeRequested) {
      return {
        route,
        applied: false,
        from: null,
        to: null,
        reason: optimizer.reason,
      };
    }
    const primaryKey = routeTargetKey(route.primary);
    const primaryEvidence = optimizer.candidates.find(
      (candidate) => `${candidate.node}:${candidate.model}` === primaryKey,
    );
    if (!primaryEvidence) {
      return { route, applied: false, from: null, to: null, reason: 'primary_evidence_missing' };
    }
    const optimizerConfig = this.config.intelligence.cost_optimizer;
    const allowedCandidates = optimizer.candidates.filter(
      (candidate) =>
        candidate.rejected_reasons.length === 0 &&
        `${candidate.node}:${candidate.model}` !== primaryKey &&
        candidate.composite_score !== null,
    );
    const best = allowedCandidates.sort((a, b) => {
      if (budgetDowngradeRequested && !optimizeRequested) {
        if ((a.estimated_cost_usd ?? Number.POSITIVE_INFINITY) !== (b.estimated_cost_usd ?? Number.POSITIVE_INFINITY)) {
          return (a.estimated_cost_usd ?? Number.POSITIVE_INFINITY) -
            (b.estimated_cost_usd ?? Number.POSITIVE_INFINITY);
        }
      } else if ((a.composite_score ?? 0) !== (b.composite_score ?? 0)) {
        return (b.composite_score ?? 0) - (a.composite_score ?? 0);
      }
      return (a.estimated_cost_usd ?? Number.POSITIVE_INFINITY) -
        (b.estimated_cost_usd ?? Number.POSITIVE_INFINITY);
    })[0];
    if (!best || primaryEvidence.estimated_cost_usd === null || best.estimated_cost_usd === null) {
      return { route, applied: false, from: null, to: null, reason: 'no_eligible_optimizer_candidate' };
    }
    if (best.estimated_cost_usd >= primaryEvidence.estimated_cost_usd) {
      return { route, applied: false, from: null, to: null, reason: 'no_lower_cost_candidate' };
    }
    const savingsRatio =
      primaryEvidence.estimated_cost_usd > 0
        ? (primaryEvidence.estimated_cost_usd - best.estimated_cost_usd) /
          primaryEvidence.estimated_cost_usd
        : 0;
    if (optimizeRequested && savingsRatio < optimizerConfig.min_savings_ratio) {
      return { route, applied: false, from: null, to: null, reason: 'savings_below_threshold' };
    }
    if (
      primaryEvidence.latency_ms !== null &&
      best.latency_ms !== null &&
      best.latency_ms >
        primaryEvidence.latency_ms * (1 + optimizerConfig.max_latency_penalty_ratio)
    ) {
      return { route, applied: false, from: null, to: null, reason: 'latency_penalty_too_high' };
    }
    if (
      primaryEvidence.quality_score !== null &&
      best.quality_score !== null &&
      primaryEvidence.quality_score - best.quality_score >
        optimizerConfig.max_quality_penalty
    ) {
      return { route, applied: false, from: null, to: null, reason: 'quality_penalty_too_high' };
    }

    const bestTarget = { node: best.node, model: best.model };
    return {
      route: {
        primary: bestTarget,
        fallbacks: [route.primary, ...route.fallbacks].filter(
          (target) => routeTargetKey(target) !== routeTargetKey(bestTarget),
        ),
      },
      applied: true,
      from: route.primary,
      to: bestTarget,
      reason: budgetDowngradeRequested && !optimizeRequested
        ? 'token_prediction_budget_downgrade_selected_candidate'
        : 'cost_optimizer_selected_lower_cost_candidate',
    };
  }

  private allowsQualityCriticalDowngrade(
    tokenPrediction: RouteDecisionTokenPredictionEvidence,
  ): boolean {
    if (this.config.intelligence.cost_optimizer.allow_quality_critical_downgrade) {
      return true;
    }
    return (
      tokenPrediction.action === 'downgrade_requested' &&
      this.config.intelligence.token_prediction.allow_quality_critical_downgrade
    );
  }

  private qualityRuleMatches(
    rule: IntelligenceQualityGateRuleConfig,
    input: QualityGateInput,
  ): boolean {
    if (rule.source_formats?.length && !rule.source_formats.includes(input.canonical.metadata.source_format)) {
      return false;
    }
    if (rule.tiers?.length && !rule.tiers.includes(input.tier)) return false;
    if (rule.models?.length && !rule.models.includes(input.target.model)) return false;
    if (
      rule.agent_virtual_models?.length &&
      !rule.agent_virtual_models.includes(input.canonical.metadata.agent_virtual_model || '')
    ) {
      return false;
    }
    return true;
  }

  private evaluateQualityRule(
    rule: IntelligenceQualityGateRuleConfig,
    input: QualityGateInput,
  ): string[] {
    const failures: string[] = [];
    if (
      rule.min_output_tokens !== undefined &&
      input.response.usage.output_tokens < rule.min_output_tokens
    ) {
      failures.push('min_output_tokens');
    }
    if (
      rule.max_latency_ms !== undefined &&
      input.response.routing.latency_ms > rule.max_latency_ms
    ) {
      failures.push('max_latency_ms');
    }
    if (
      rule.fail_on_stop_reasons?.length &&
      rule.fail_on_stop_reasons.includes(input.response.stop_reason)
    ) {
      failures.push('stop_reason');
    }
    if (rule.require_text) {
      const hasText = input.response.content.some(
        (block) => block.type === 'text' && block.text.trim().length > 0,
      );
      if (!hasText) failures.push('empty_text');
    }
    return failures;
  }

  private async resolveBudgetHeadroom(
    canonical: CanonicalRequest,
  ): Promise<{
    scope: RouteDecisionTokenPredictionEvidence['budget_scope'];
    limitUsd: number | null;
    currentUsd: number | null;
    remainingUsd: number | null;
    usageRatio: number | null;
  }> {
    if (!this.config.intelligence.token_prediction.enabled) {
      return {
        scope: 'none',
        limitUsd: null,
        currentUsd: null,
        remainingUsd: null,
        usageRatio: null,
      };
    }
    try {
      const statuses = await this.budgetService.getStatus(
        canonical.metadata.api_key_name || undefined,
        canonical.metadata.api_key_id || undefined,
        canonical.metadata.namespace_id || undefined,
        canonical.metadata.team_id || undefined,
      );
      const costStatuses = statuses.filter((status) => status.type.includes('cost'));
      if (costStatuses.length === 0) {
        return {
          scope: 'none',
          limitUsd: null,
          currentUsd: null,
          remainingUsd: null,
          usageRatio: null,
        };
      }
      const tightest = costStatuses.sort(
        (a, b) => (a.limit - a.current) - (b.limit - b.current),
      )[0];
      return {
        scope: tightest.scope as RouteDecisionTokenPredictionEvidence['budget_scope'],
        limitUsd: tightest.limit,
        currentUsd: tightest.current,
        remainingUsd: Math.max(0, tightest.limit - tightest.current),
        usageRatio: tightest.limit > 0 ? tightest.current / tightest.limit : null,
      };
    } catch (err) {
      this.logger.warn(`Token prediction budget status unavailable: ${(err as Error).message}`);
      return {
        scope: 'none',
        limitUsd: null,
        currentUsd: null,
        remainingUsd: null,
        usageRatio: null,
      };
    }
  }

  private resolveBudgetRisk(
    estimatedCost: number | null,
    remainingUsd: number | null,
    usageRatio: number | null,
    nearLimitRatio: number,
  ): RouteDecisionTokenPredictionEvidence['risk'] {
    if (estimatedCost === null || remainingUsd === null) return 'unknown';
    if (estimatedCost > remainingUsd) return 'over_limit';
    if (usageRatio !== null && usageRatio >= nearLimitRatio) return 'near_limit';
    if (remainingUsd > 0 && estimatedCost / remainingUsd >= nearLimitRatio) {
      return 'near_limit';
    }
    return 'within_budget';
  }

  private estimateCostUsd(
    tokenEstimate: Pick<TokenEstimate, 'input_tokens' | 'output_tokens'>,
    target: RouteTarget,
  ): number | null {
    const pricing = this.config.getModelPricing(target.model, target.node);
    if (!pricing) return null;
    return (
      (tokenEstimate.input_tokens / 1_000_000) * pricing.input +
      (tokenEstimate.output_tokens / 1_000_000) * pricing.output
    );
  }

  private async loadStatsByTarget(): Promise<Map<string, RouteTargetStats>> {
    if (!this.adaptiveStats) return new Map();
    try {
      const config = this.config.intelligence.cost_optimizer;
      const window = await this.adaptiveStats.getWindow({
        windowHours: config.history_window_hours,
        minSamples: config.min_samples,
      });
      return new Map(window.targets.map((target) => [target.key, target]));
    } catch (err) {
      this.logger.warn(`Optimizer historical stats unavailable: ${(err as Error).message}`);
      return new Map();
    }
  }

  private compositeOptimizerScore(input: {
    cost: number | null;
    latencyMs: number | null;
    successRate: number | null;
    qualityScore: number | null;
    cacheHitProbability: number | null;
  }): number | null {
    const objective = this.config.intelligence.cost_optimizer.objective;
    const costScore = input.cost === null ? null : 1 / (1 + input.cost * 1000);
    const latencyScore = input.latencyMs === null ? null : 1 / (1 + input.latencyMs / 1000);
    const successScore = input.successRate ?? 0.75;
    const qualityScore = input.qualityScore ?? successScore;
    const cacheScore = input.cacheHitProbability ?? 0;
    if (costScore === null && latencyScore === null) return null;
    const weights =
      objective === 'cost'
        ? { cost: 0.55, latency: 0.15, success: 0.15, quality: 0.1, cache: 0.05 }
        : objective === 'latency'
          ? { cost: 0.2, latency: 0.45, success: 0.15, quality: 0.15, cache: 0.05 }
          : objective === 'quality'
            ? { cost: 0.15, latency: 0.15, success: 0.2, quality: 0.45, cache: 0.05 }
            : { cost: 0.35, latency: 0.25, success: 0.15, quality: 0.2, cache: 0.05 };
    return (
      (costScore ?? 0.5) * weights.cost +
      (latencyScore ?? 0.5) * weights.latency +
      successScore * weights.success +
      qualityScore * weights.quality +
      cacheScore * weights.cache
    );
  }

  private cacheHitProbabilityFromTraceCandidate(
    target: RouteTarget,
    tokenPrediction: RouteDecisionTokenPredictionEvidence,
  ): number | null {
    if (!tokenPrediction.enabled) return null;
    const capabilities = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    );
    if (capabilities.read_cache || capabilities.prompt_cache) return 0.05;
    return 0;
  }

  private isQualityCritical(canonical: CanonicalRequest): boolean {
    const hint = canonical.metadata.agent_routing_hint || {};
    return (
      canonical.reasoning?.requested === true ||
      canonical.structured_output?.requested === true ||
      hint.depth === 'deep' ||
      hint.task === 'security_audit' ||
      canonical.metadata.agent_virtual_model === 'coding-deep' ||
      canonical.metadata.agent_virtual_model === 'coding-security'
    );
  }

  private applyFinalTarget(
    trace: RouteDecisionTrace,
    primary: RouteTarget,
    fallbacks: RouteTarget[],
    reason: string,
  ): RouteDecisionTrace {
    const next = this.cloneTrace(trace);
    next.load_balancing.selected = primary;
    next.load_balancing.target_count = 1 + fallbacks.length;
    next.load_balancing.reason = reason;
    next.fallback_chain = fallbacks;
    next.final_selection = {
      node: primary.node,
      model: primary.model,
      reason,
      is_fallback: true,
      fallback_reason: 'cost_downgrade',
    };
    for (const candidate of next.candidate_targets) {
      const key = `${candidate.node}:${candidate.model}`;
      candidate.selected = key === routeTargetKey(primary);
      candidate.fallback = fallbacks.some((target) => routeTargetKey(target) === key);
    }
    return next;
  }

  private sampleBucket(seed: string): number {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  private cloneTrace(trace: RouteDecisionTrace): RouteDecisionTrace {
    return JSON.parse(JSON.stringify(trace)) as RouteDecisionTrace;
  }

  private roundNullable(value: number | null | undefined, digits: number): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Number(value.toFixed(digits));
  }
}
