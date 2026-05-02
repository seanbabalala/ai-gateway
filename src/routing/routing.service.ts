// ===================================================================
// RoutingService — Tier-based route resolution with circuit breaker
// ===================================================================
// Resolves a Tier → primary node + fallback chain.
// Integrates with CircuitBreakerService to skip unhealthy nodes.
// Integrates with MomentumService for session-level tier smoothing.
// Supports domain hints (frontend/backend/etc) for domain-aware routing.
//
// Domain preference resolution (in priority order):
//   1. Explicit: routing.domain_preferences.{domain} → ordered node list
//   2. Tag-based: nodes with matching tag are promoted
//   3. Default: tier config order unchanged
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CapabilityService } from '../config/capability.service';
import { CanonicalMediaSourceFormat, Tier } from '../canonical/canonical.types';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MomentumService } from './momentum.service';
import {
  LoadBalancingStrategy,
  RouteTarget,
  RoutingOptimization,
  SplitVariant,
  TierConfig,
  WeightedRouteTarget,
} from '../config/gateway.config';
import { Modality, supportsModalities } from '../config/modality';
import { v4 as uuidv4 } from 'uuid';

export interface RouteDecision {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  tier: Tier;
  score: number;
  momentumAdjusted: boolean;
  domainHint: 'frontend' | 'backend' | null;
  experimentGroup: string | null;  // A/B split: "tier:variantName" format, null when no split
  experimentGroupsByTarget: Record<string, string>;
  loadBalancing: RouteLoadBalancingDecision;
}

export type EffectiveRoutingStrategy =
  | LoadBalancingStrategy
  | RoutingOptimization
  | 'primary_fallback'
  | 'split';

export interface RouteLoadBalancingDecision {
  strategy: EffectiveRoutingStrategy;
  source: 'primary_fallback' | 'targets' | 'split';
  selected: RouteTarget;
  target_count: number;
}

export interface RouteTargetMetrics {
  node: string;
  model: string;
  weight: number | null;
  samples: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_latency_ms: number | null;
  last_status_code: number | null;
}

export interface RoutingTierStatus {
  strategy: EffectiveRoutingStrategy;
  source: 'primary_fallback' | 'targets' | 'split';
  targets: RouteTargetMetrics[];
  last_selected: {
    node: string;
    model: string;
    selected_at: string;
    strategy: EffectiveRoutingStrategy;
    reason: string;
  } | null;
}

export interface RouteSelectionHints {
  estimated_input_tokens?: number;
  estimated_output_tokens?: number;
  estimated_context_tokens?: number;
  requires_structured_output?: boolean;
}

export interface EmbeddingRouteDecision {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  mode: 'auto' | 'direct';
}

export interface RerankRouteDecision {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  mode: 'auto' | 'direct';
}

export interface MediaRouteDecision {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  mode: 'auto' | 'direct';
}

interface SelectedRouteTarget {
  target: WeightedRouteTarget;
  strategy: EffectiveRoutingStrategy;
}

export class RoutingConstraintError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'RoutingConstraintError';
  }
}

/**
 * FNV-1a 32-bit hash — deterministic, fast, no dependencies.
 * Used for A/B split bucket assignment (session stickiness).
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly roundRobinCounters = new Map<string, number>();
  private readonly latencyWindows = new Map<string, number[]>();
  private readonly targetLastStatus = new Map<string, {
    latencyMs: number;
    statusCode: number;
  }>();
  private readonly lastSelections = new Map<string, RoutingTierStatus['last_selected']>();
  private readonly latencyWindowSize = 50;

  constructor(
    private readonly config: ConfigService,
    private readonly capabilityService: CapabilityService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly momentum: MomentumService,
  ) {}

  /**
   * Resolve a route for a given tier + score.
   *
   * 1. Apply momentum smoothing (if session key provided)
   * 2. Look up tier config for primary + fallbacks
   * 3. Filter out nodes with OPEN circuit breaker
   * 3.5. Modality-aware filtering
   * 4. Apply domain hint adjustments (config preference → tag fallback)
   * 5. Build final route
   */
  resolve(
    tier: Tier,
    score: number,
    sessionKey?: string,
    domainHint?: 'frontend' | 'backend' | null,
    modalityHints?: Modality[],
    selectionHints: RouteSelectionHints = {},
  ): RouteDecision {
    const hint = domainHint || null;

    // ── Step 1: Momentum smoothing ──
    const { tier: effectiveTier, adjusted } = this.momentum.apply(
      tier,
      score,
      sessionKey,
    );

    // ── Step 2: Get tier config ──
    const tierConfig = this.config.routing.tiers[effectiveTier];
    if (!tierConfig) {
      const firstTier = Object.keys(this.config.routing.tiers)[0];
      this.logger.warn(
        `No config for tier "${effectiveTier}", falling back to "${firstTier}"`,
      );
      const fallbackConfig = this.config.routing.tiers[firstTier];
      const modalityCompatibleTargets = this.filterTargetsByModalities(
        effectiveTier,
        this.normalizeTierTargets(fallbackConfig).targets,
        modalityHints,
      );
      const fallbackTargets = this.applyCapabilityConstraints(
        effectiveTier,
        modalityCompatibleTargets,
        selectionHints,
      );
      const selected = fallbackTargets[0];
      return {
        primary: selected,
        fallbacks: fallbackTargets.slice(1).map((target) => this.toRouteTarget(target)),
        tier: effectiveTier,
        score,
        momentumAdjusted: adjusted,
        domainHint: hint,
        experimentGroup: null,
        experimentGroupsByTarget: {},
        loadBalancing: {
          strategy: 'primary_fallback',
          source: 'primary_fallback',
          selected,
          target_count: fallbackTargets.length,
        },
      };
    }

    // ── Step 2.5: A/B split — override targets if split is configured ──
    let experimentGroup: string | null = null;

    if (tierConfig.split && tierConfig.split.length > 0) {
      const splitResult = this.resolveABSplit(
        tierConfig.split, effectiveTier, sessionKey,
      );
      // Use split-derived targets for Steps 3+
      const splitAllTargets = splitResult.orderedTargets;

      // Filter by circuit breaker
      let splitAvailable = splitAllTargets.filter((t) =>
        this.circuitBreaker.isAvailable(t.node, t.model),
      );

      if (splitAvailable.length === 0) {
        this.logger.warn(
          `All split variants for tier "${effectiveTier}" have open circuits. Using all variants as last resort.`,
        );
        splitAvailable = splitAllTargets;
      }

      splitAvailable = this.filterTargetsByModalities(
        effectiveTier,
        splitAvailable,
        modalityHints,
      );

      // Domain hint reordering on split targets
      let splitOrdered = [...splitAvailable];
      if (hint && splitAvailable.length > 1) {
        const preferredNodes = this.resolvePreferredNodes(hint);
        if (preferredNodes.length > 0) {
          splitOrdered = this.reorderByPreference(splitAvailable, preferredNodes);
        }
      }

      splitOrdered = this.applyCapabilityConstraints(
        effectiveTier,
        splitOrdered,
        selectionHints,
      );

      experimentGroup = this.resolveExperimentGroupForTarget(
        splitResult.experimentGroupsByTarget,
        splitOrdered[0],
      );
      this.recordSelection(
        effectiveTier,
        splitOrdered[0],
        'split',
        'split',
        'A/B split experiment',
      );

      return {
        primary: splitOrdered[0],
        fallbacks: splitOrdered.slice(1),
        tier: effectiveTier,
        score,
        momentumAdjusted: adjusted,
        domainHint: hint,
        experimentGroup,
        experimentGroupsByTarget: splitResult.experimentGroupsByTarget,
        loadBalancing: {
          strategy: 'split',
          source: 'split',
          selected: splitOrdered[0],
          target_count: splitOrdered.length,
        },
      };
    }

    // ── Step 3: Normalize routing schema + filter by circuit breaker ──
    const normalized = this.normalizeTierTargets(tierConfig);
    let availableTargets = normalized.targets.filter((t) =>
      this.circuitBreaker.isAvailable(t.node, t.model),
    );

    if (availableTargets.length === 0) {
      this.logger.warn(
        `All nodes for tier "${effectiveTier}" have open circuits. Using all targets as last resort.`,
      );
      availableTargets = normalized.targets;
    }

    // ── Step 3.5: Modality-aware filtering ──
    availableTargets = this.filterTargetsByModalities(
      effectiveTier,
      availableTargets,
      modalityHints,
    );

    // ── Step 4: Apply domain hint reordering ──
    let orderedTargets = [...availableTargets];

    if (hint && availableTargets.length > 1) {
      const preferredNodes = this.resolvePreferredNodes(hint);

      if (preferredNodes.length > 0) {
        orderedTargets = this.reorderByPreference(availableTargets, preferredNodes);

        if (orderedTargets[0].node !== availableTargets[0].node) {
          this.logger.log(
            `Domain hint "${hint}": promoted node "${orderedTargets[0].node}" over "${availableTargets[0].node}"`,
          );
        }
      }
    }

    orderedTargets = this.applyCapabilityConstraints(
      effectiveTier,
      orderedTargets,
      selectionHints,
    );

    // ── Step 5: Apply load-balancing strategy and build final route ──
    const selection = this.selectTargetByStrategy(
      effectiveTier,
      normalized.strategy,
      orderedTargets,
      sessionKey,
      selectionHints,
    );
    const primary = selection.target;
    const fallbacks = orderedTargets
      .filter((target) => target !== primary)
      .map((target) => this.toRouteTarget(target));

    if (tierConfig.primary && primary.node !== tierConfig.primary.node && !hint) {
      this.logger.log(
        `Primary node "${tierConfig.primary.node}" unavailable (circuit OPEN), promoting "${primary.node}"`,
      );
    }

    this.recordSelection(
      effectiveTier,
      primary,
      selection.strategy,
      normalized.source,
      this.selectionReason(selection.strategy, primary),
    );

    return {
      primary: this.toRouteTarget(primary),
      fallbacks,
      tier: effectiveTier,
      score,
      momentumAdjusted: adjusted,
      domainHint: hint,
      experimentGroup: null,
      experimentGroupsByTarget: {},
      loadBalancing: {
        strategy: selection.strategy,
        source: normalized.source,
        selected: this.toRouteTarget(primary),
        target_count: orderedTargets.length,
      },
    };
  }

  recordTargetResult(
    node: string,
    model: string,
    latencyMs: number,
    statusCode: number,
  ): void {
    const key = this.buildExperimentTargetKey(node, model);
    this.targetLastStatus.set(key, { latencyMs, statusCode });
    if (statusCode < 200 || statusCode >= 400 || latencyMs < 0) return;

    const samples = this.latencyWindows.get(key) || [];
    samples.push(latencyMs);
    if (samples.length > this.latencyWindowSize) {
      samples.splice(0, samples.length - this.latencyWindowSize);
    }
    this.latencyWindows.set(key, samples);
  }

  resolveEmbeddingRoute(
    requestedModel: string | undefined,
    dimensions?: number,
    targetFilter: (target: RouteTarget) => boolean = () => true,
  ): EmbeddingRouteDecision {
    const model = requestedModel || 'auto';
    const allTargets = this.getEmbeddingTargets();

    if (model !== 'auto') {
      const resolved = this.config.resolveEmbeddingModel(model);
      if (!resolved) {
        throw new RoutingConstraintError(
          `Embedding model "${model}" is not configured. Use "auto" or configure nodes[].embedding_models.`,
          400,
        );
      }
      const primary = { node: resolved.nodeId, model: resolved.model };
      if (!targetFilter(primary)) {
        throw new RoutingConstraintError(
          `This API key is not allowed to use ${primary.node}/${primary.model}.`,
          403,
        );
      }
      if (!this.embeddingDimensionsCompatible(primary, dimensions)) {
        throw new RoutingConstraintError(
          `Embedding model ${primary.node}/${primary.model} does not advertise support for dimensions=${dimensions}.`,
          400,
        );
      }
      const fallbacks = this.rankEmbeddingTargets(
        this.filterEmbeddingTargets(
          allTargets.filter((target) =>
            target.node !== primary.node || target.model !== primary.model,
          ),
          dimensions,
          targetFilter,
        ),
      );
      return { primary, fallbacks, mode: 'direct' };
    }

    const candidates = this.rankEmbeddingTargets(
      this.filterEmbeddingTargets(allTargets, dimensions, targetFilter),
    );
    if (candidates.length === 0) {
      throw new RoutingConstraintError(
        dimensions
          ? `No configured embedding model can satisfy dimensions=${dimensions}.`
          : 'No embedding models are configured.',
        400,
      );
    }

    return {
      primary: candidates[0],
      fallbacks: candidates.slice(1),
      mode: 'auto',
    };
  }

  resolveRerankRoute(
    requestedModel: string | undefined,
    targetFilter: (target: RouteTarget) => boolean = () => true,
  ): RerankRouteDecision {
    const model = requestedModel || 'auto';
    const allTargets = this.getRerankTargets();

    if (model !== 'auto') {
      const resolved = this.config.resolveRerankModel(model);
      if (!resolved) {
        throw new RoutingConstraintError(
          `Rerank model "${model}" is not configured. Use "auto" or configure nodes[].rerank_models.`,
          400,
        );
      }
      const primary = { node: resolved.nodeId, model: resolved.model };
      if (!targetFilter(primary)) {
        throw new RoutingConstraintError(
          `This API key is not allowed to use ${primary.node}/${primary.model}.`,
          403,
        );
      }
      const fallbacks = this.rankRerankTargets(
        this.filterRerankTargets(
          allTargets.filter((target) =>
            target.node !== primary.node || target.model !== primary.model,
          ),
          targetFilter,
        ),
      );
      return { primary, fallbacks, mode: 'direct' };
    }

    const candidates = this.rankRerankTargets(
      this.filterRerankTargets(allTargets, targetFilter),
    );
    if (candidates.length === 0) {
      throw new RoutingConstraintError(
        'No rerank models are configured.',
        400,
      );
    }

    return {
      primary: candidates[0],
      fallbacks: candidates.slice(1),
      mode: 'auto',
    };
  }

  resolveMediaRoute(
    sourceFormat: CanonicalMediaSourceFormat,
    requestedModel: string | undefined,
    targetFilter: (target: RouteTarget) => boolean = () => true,
  ): MediaRouteDecision {
    const model = requestedModel || 'auto';
    const kind = this.mediaKind(sourceFormat);
    const allTargets = this.getMediaTargets(kind);

    if (model !== 'auto') {
      const resolved =
        kind === 'image'
          ? this.config.resolveImageModel(model)
          : this.config.resolveAudioModel(model);
      if (!resolved) {
        throw new RoutingConstraintError(
          `${kind === 'image' ? 'Image' : 'Audio'} model "${model}" is not configured. Use "auto" or configure nodes[].${kind}_models.`,
          400,
        );
      }
      const primary = { node: resolved.nodeId, model: resolved.model };
      if (!targetFilter(primary)) {
        throw new RoutingConstraintError(
          `This API key is not allowed to use ${primary.node}/${primary.model}.`,
          403,
        );
      }
      const fallbacks = this.rankMediaTargets(
        this.filterMediaTargets(
          allTargets.filter((target) =>
            target.node !== primary.node || target.model !== primary.model,
          ),
          targetFilter,
        ),
      );
      return { primary, fallbacks, mode: 'direct' };
    }

    const candidates = this.rankMediaTargets(
      this.filterMediaTargets(allTargets, targetFilter),
    );
    if (candidates.length === 0) {
      throw new RoutingConstraintError(
        `No ${kind} models are configured.`,
        400,
      );
    }

    return {
      primary: candidates[0],
      fallbacks: candidates.slice(1),
      mode: 'auto',
    };
  }

  getRoutingStatus(): Record<string, RoutingTierStatus> {
    const result: Record<string, RoutingTierStatus> = {};
    for (const [tier, tierConfig] of Object.entries(this.config.routing.tiers || {})) {
      const normalized = tierConfig.split?.length
        ? {
            strategy: 'split' as EffectiveRoutingStrategy,
            source: 'split' as const,
            targets: tierConfig.split.map((variant) => ({
              node: variant.node,
              model: variant.model,
              weight: variant.weight,
              name: variant.name,
            })),
          }
        : this.normalizeTierTargets(tierConfig);
      const effectiveStrategy =
        normalized.source === 'split'
          ? normalized.strategy
          : this.config.routing.optimization || normalized.strategy;

      result[tier] = {
        strategy: effectiveStrategy,
        source: normalized.source,
        targets: normalized.targets.map((target) => this.buildTargetMetrics(target)),
        last_selected: this.lastSelections.get(tier) || null,
      };
    }
    return result;
  }

  private normalizeTierTargets(tierConfig: TierConfig): {
    targets: WeightedRouteTarget[];
    strategy: EffectiveRoutingStrategy;
    source: 'primary_fallback' | 'targets';
  } {
    if (tierConfig.targets && tierConfig.targets.length > 0) {
      return {
        targets: tierConfig.targets.map((target) => ({ ...target, weight: target.weight ?? 1 })),
        strategy: tierConfig.strategy || 'weighted',
        source: 'targets',
      };
    }

    const legacyTargets = [
      tierConfig.primary,
      ...(tierConfig.fallbacks || []),
    ].filter(Boolean).map((target) => ({
      ...(target as RouteTarget),
      weight: 1,
    }));

    return {
      targets: legacyTargets,
      strategy: 'primary_fallback',
      source: 'primary_fallback',
    };
  }

  private selectTargetByStrategy(
    tier: string,
    strategy: EffectiveRoutingStrategy,
    targets: WeightedRouteTarget[],
    sessionKey?: string,
    selectionHints: RouteSelectionHints = {},
  ): SelectedRouteTarget {
    if (targets.length === 0) {
      throw new Error(`No route targets available for tier "${tier}"`);
    }
    if (targets.length === 1 || strategy === 'split') {
      return { target: targets[0], strategy };
    }

    const contextPreferred = this.selectContextPreferredTarget(
      targets,
      selectionHints,
    );
    if (contextPreferred) {
      return { target: contextPreferred, strategy };
    }

    const optimization = this.config.routing.optimization;
    if (optimization) {
      const optimizedTarget = this.selectTargetByOptimization(
        optimization,
        targets,
        selectionHints,
      );
      if (optimizedTarget) {
        return { target: optimizedTarget, strategy: optimization };
      }
    }

    if (strategy === 'primary_fallback') {
      return { target: targets[0], strategy };
    }

    switch (strategy) {
      case 'round_robin':
        return { target: this.selectRoundRobin(tier, targets), strategy };
      case 'least_latency':
        return { target: this.selectLeastLatency(targets), strategy };
      case 'random':
        return {
          target: targets[Math.floor(Math.random() * targets.length)] || targets[0],
          strategy,
        };
      case 'weighted':
      default:
        return { target: this.selectWeighted(tier, targets, sessionKey), strategy };
    }
  }

  private selectTargetByOptimization(
    optimization: RoutingOptimization,
    targets: WeightedRouteTarget[],
    selectionHints: RouteSelectionHints,
  ): WeightedRouteTarget | null {
    switch (optimization) {
      case 'cost':
        return this.selectLowestCost(targets, selectionHints);
      case 'latency':
        return this.selectLeastLatency(targets);
      case 'balanced':
        return this.selectBalanced(targets, selectionHints);
      case 'quality':
        return this.selectHighestQuality(targets);
      default:
        return null;
    }
  }

  private selectContextPreferredTarget(
    targets: WeightedRouteTarget[],
    selectionHints: RouteSelectionHints,
  ): WeightedRouteTarget | null {
    const estimatedContextTokens = selectionHints.estimated_context_tokens;
    if (!estimatedContextTokens || estimatedContextTokens <= 0) return null;

    const safe: WeightedRouteTarget[] = [];
    const unknown: WeightedRouteTarget[] = [];
    let nearLimitCount = 0;

    for (const target of targets) {
      const maxContextTokens =
        this.capabilityService.resolveModelRoutingCapabilities(
          target.node,
          target.model,
        ).max_context_tokens;
      if (!maxContextTokens) {
        unknown.push(target);
      } else if (estimatedContextTokens > maxContextTokens * 0.8) {
        nearLimitCount++;
      } else {
        safe.push(target);
      }
    }

    if (nearLimitCount === 0) return null;
    return safe[0] || unknown[0] || null;
  }

  private selectLowestCost(
    targets: WeightedRouteTarget[],
    selectionHints: RouteSelectionHints,
  ): WeightedRouteTarget | null {
    const priced = targets
      .map((target, index) => ({
        target,
        index,
        cost: this.estimateTargetCost(target, selectionHints),
      }))
      .filter((item) => item.cost !== null);

    if (priced.length === 0) return null;

    priced.sort((a, b) => {
      if (a.cost !== b.cost) return (a.cost as number) - (b.cost as number);
      return a.index - b.index;
    });
    return priced[0].target;
  }

  private selectBalanced(
    targets: WeightedRouteTarget[],
    selectionHints: RouteSelectionHints,
  ): WeightedRouteTarget | null {
    const entries = targets.map((target, index) => ({
      target,
      index,
      cost: this.estimateTargetCost(target, selectionHints),
      latency: this.averageLatency(target.node, target.model),
    }));
    const costs = entries
      .map((entry) => entry.cost)
      .filter((value): value is number => value !== null);
    const latencies = entries
      .map((entry) => entry.latency)
      .filter((value): value is number => value !== null);

    if (costs.length === 0 && latencies.length === 0) return null;

    const minCost = costs.length ? Math.min(...costs) : 0;
    const maxCost = costs.length ? Math.max(...costs) : 0;
    const minLatency = latencies.length ? Math.min(...latencies) : 0;
    const maxLatency = latencies.length ? Math.max(...latencies) : 0;

    const normalized = entries.map((entry) => ({
      ...entry,
      score:
        this.normalizeMetric(entry.cost, minCost, maxCost) * 0.6 +
        this.normalizeMetric(entry.latency, minLatency, maxLatency) * 0.4,
    }));

    normalized.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.index - b.index;
    });
    return normalized[0].target;
  }

  private selectHighestQuality(
    targets: WeightedRouteTarget[],
  ): WeightedRouteTarget | null {
    const scored = targets
      .map((target, index) => ({
        target,
        index,
        quality:
          this.capabilityService.resolveModelRoutingCapabilities(
            target.node,
            target.model,
          ).quality_score ?? null,
      }))
      .filter((item) => item.quality !== null);

    if (scored.length === 0) return null;

    scored.sort((a, b) => {
      if (a.quality !== b.quality) return (b.quality as number) - (a.quality as number);
      return a.index - b.index;
    });
    return scored[0].target;
  }

  private estimateTargetCost(
    target: RouteTarget,
    selectionHints: RouteSelectionHints,
  ): number | null {
    const pricing = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    ).pricing;
    if (!pricing) return null;

    const inputTokens = selectionHints.estimated_input_tokens ?? 1_000_000;
    const outputTokens = selectionHints.estimated_output_tokens ?? 1_000_000;
    return (
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    );
  }

  private getEmbeddingTargets(): RouteTarget[] {
    const targets: RouteTarget[] = [];
    for (const node of this.config.nodes) {
      for (const model of node.embedding_models || []) {
        targets.push({ node: node.id, model });
      }
    }
    return targets;
  }

  private getRerankTargets(): RouteTarget[] {
    const targets: RouteTarget[] = [];
    for (const node of this.config.nodes) {
      for (const model of node.rerank_models || []) {
        targets.push({ node: node.id, model });
      }
    }
    return targets;
  }

  private mediaKind(sourceFormat: CanonicalMediaSourceFormat): 'image' | 'audio' {
    return sourceFormat === 'image_generation' || sourceFormat === 'image_edit'
      ? 'image'
      : 'audio';
  }

  private getMediaTargets(kind: 'image' | 'audio'): RouteTarget[] {
    const targets: RouteTarget[] = [];
    for (const node of this.config.nodes) {
      const models = kind === 'image' ? node.image_models : node.audio_models;
      for (const model of models || []) {
        targets.push({ node: node.id, model });
      }
    }
    return targets;
  }

  private filterMediaTargets(
    targets: RouteTarget[],
    targetFilter: (target: RouteTarget) => boolean,
  ): RouteTarget[] {
    return targets
      .filter(targetFilter)
      .filter((target) => this.circuitBreaker.isAvailable(target.node, target.model));
  }

  private rankMediaTargets(targets: RouteTarget[]): RouteTarget[] {
    return [...targets].sort((a, b) => {
      const aCost = this.estimateMediaCost(a);
      const bCost = this.estimateMediaCost(b);
      if (aCost !== bCost) return aCost - bCost;
      return targets.indexOf(a) - targets.indexOf(b);
    });
  }

  private estimateMediaCost(target: RouteTarget): number {
    const pricing = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    ).pricing;
    return pricing ? pricing.input : Number.POSITIVE_INFINITY;
  }

  private filterEmbeddingTargets(
    targets: RouteTarget[],
    dimensions: number | undefined,
    targetFilter: (target: RouteTarget) => boolean,
  ): RouteTarget[] {
    const allowed = targets
      .filter(targetFilter)
      .filter((target) => this.circuitBreaker.isAvailable(target.node, target.model));
    if (!dimensions) return allowed;

    const exact = allowed.filter((target) =>
      this.embeddingDimensionsCompatible(target, dimensions, false),
    );
    if (exact.length > 0) return exact;

    return allowed.filter((target) =>
      this.embeddingDimensionsCompatible(target, dimensions, true),
    );
  }

  private embeddingDimensionsCompatible(
    target: RouteTarget,
    dimensions: number | undefined,
    allowUnknown = true,
  ): boolean {
    if (!dimensions) return true;
    const configured = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    ).dimensions;
    if (configured === undefined) return allowUnknown;
    if (typeof configured === 'number') return configured === dimensions;
    return configured.includes(dimensions);
  }

  private rankEmbeddingTargets(targets: RouteTarget[]): RouteTarget[] {
    return [...targets].sort((a, b) => {
      const aCost = this.estimateEmbeddingCost(a);
      const bCost = this.estimateEmbeddingCost(b);
      if (aCost !== bCost) return aCost - bCost;
      return targets.indexOf(a) - targets.indexOf(b);
    });
  }

  private filterRerankTargets(
    targets: RouteTarget[],
    targetFilter: (target: RouteTarget) => boolean,
  ): RouteTarget[] {
    return targets
      .filter(targetFilter)
      .filter((target) => this.circuitBreaker.isAvailable(target.node, target.model));
  }

  private rankRerankTargets(targets: RouteTarget[]): RouteTarget[] {
    return [...targets].sort((a, b) => {
      const aCost = this.estimateRerankCost(a);
      const bCost = this.estimateRerankCost(b);
      if (aCost !== bCost) return aCost - bCost;
      return targets.indexOf(a) - targets.indexOf(b);
    });
  }

  private estimateRerankCost(target: RouteTarget): number {
    const pricing = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    ).pricing;
    return pricing ? pricing.input : Number.POSITIVE_INFINITY;
  }

  private estimateEmbeddingCost(target: RouteTarget): number {
    const pricing = this.capabilityService.resolveModelRoutingCapabilities(
      target.node,
      target.model,
    ).pricing;
    return pricing ? pricing.input : Number.POSITIVE_INFINITY;
  }

  private normalizeMetric(
    value: number | null,
    min: number,
    max: number,
  ): number {
    if (value === null) return 1;
    if (max <= min) return 0;
    return (value - min) / (max - min);
  }

  private selectRoundRobin(
    tier: string,
    targets: WeightedRouteTarget[],
  ): WeightedRouteTarget {
    const index = this.roundRobinCounters.get(tier) || 0;
    const selected = targets[index % targets.length];
    this.roundRobinCounters.set(tier, index + 1);
    return selected;
  }

  private selectWeighted(
    tier: string,
    targets: WeightedRouteTarget[],
    sessionKey?: string,
  ): WeightedRouteTarget {
    const weights = targets.map((target) => Math.max(0, target.weight ?? 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return targets[0];

    const seed = sessionKey ? fnv1a32(`${tier}:${sessionKey}`) / 0xffffffff : Math.random();
    let bucket = seed * total;
    for (let i = 0; i < targets.length; i++) {
      bucket -= weights[i];
      if (bucket < 0) return targets[i];
    }
    return targets[targets.length - 1];
  }

  private selectLeastLatency(targets: WeightedRouteTarget[]): WeightedRouteTarget {
    const coldTarget = targets.find((target) =>
      this.getLatencySamples(target.node, target.model).length === 0,
    );
    if (coldTarget) return coldTarget;

    return [...targets].sort((a, b) => {
      const aAvg = this.averageLatency(a.node, a.model) ?? Number.POSITIVE_INFINITY;
      const bAvg = this.averageLatency(b.node, b.model) ?? Number.POSITIVE_INFINITY;
      if (aAvg !== bAvg) return aAvg - bAvg;
      return targets.indexOf(a) - targets.indexOf(b);
    })[0];
  }

  private buildTargetMetrics(target: WeightedRouteTarget): RouteTargetMetrics {
    const samples = this.getLatencySamples(target.node, target.model);
    const lastStatus = this.targetLastStatus.get(this.buildExperimentTargetKey(target.node, target.model));
    return {
      node: target.node,
      model: target.model,
      weight: target.weight ?? null,
      samples: samples.length,
      avg_latency_ms: this.average(samples),
      p95_latency_ms: this.percentile(samples, 0.95),
      last_latency_ms: lastStatus?.latencyMs ?? null,
      last_status_code: lastStatus?.statusCode ?? null,
    };
  }

  private recordSelection(
    tier: string,
    target: RouteTarget,
    strategy: EffectiveRoutingStrategy,
    source: 'primary_fallback' | 'targets' | 'split',
    reason: string,
  ): void {
    this.lastSelections.set(tier, {
      node: target.node,
      model: target.model,
      selected_at: new Date().toISOString(),
      strategy,
      reason: `${source}: ${reason}`,
    });
  }

  private selectionReason(
    strategy: EffectiveRoutingStrategy,
    target: RouteTarget,
  ): string {
    if (strategy === 'cost') {
      const cost = this.estimateTargetCost(target, {});
      return cost === null ? 'lowest configured cost' : `lowest estimated cost (${cost.toFixed(6)} USD)`;
    }
    if (strategy === 'latency') {
      const avg = this.averageLatency(target.node, target.model);
      return avg === null ? 'latency optimization cold-start fallback' : `lowest local average latency (${avg}ms)`;
    }
    if (strategy === 'balanced') return 'balanced local cost and latency score';
    if (strategy === 'quality') return 'highest configured quality score';
    if (strategy === 'least_latency') {
      const avg = this.averageLatency(target.node, target.model);
      return avg === null ? 'cold-start ordered fallback' : `lowest local average latency (${avg}ms)`;
    }
    if (strategy === 'round_robin') return 'next round-robin slot';
    if (strategy === 'random') return 'random target';
    if (strategy === 'weighted') return 'weighted target selection';
    return 'legacy primary/fallback order';
  }

  private applyCapabilityConstraints<T extends RouteTarget>(
    tier: string,
    targets: T[],
    selectionHints: RouteSelectionHints,
  ): T[] {
    let constrained = targets;

    if (selectionHints.requires_structured_output) {
      constrained = this.preferStructuredOutputTargets(tier, constrained);
    }

    const estimatedContextTokens = selectionHints.estimated_context_tokens;
    if (
      estimatedContextTokens === undefined ||
      estimatedContextTokens <= 0 ||
      constrained.length === 0
    ) {
      return constrained;
    }

    const safe: T[] = [];
    const unknown: T[] = [];
    const nearLimit: T[] = [];
    const overflow: T[] = [];

    for (const target of constrained) {
      const maxContextTokens =
        this.capabilityService.resolveModelRoutingCapabilities(
          target.node,
          target.model,
        ).max_context_tokens;

      if (!maxContextTokens) {
        unknown.push(target);
      } else if (estimatedContextTokens > maxContextTokens) {
        overflow.push(target);
      } else if (estimatedContextTokens > maxContextTokens * 0.8) {
        nearLimit.push(target);
      } else {
        safe.push(target);
      }
    }

    const fits = [...safe, ...unknown, ...nearLimit];
    if (fits.length === 0) {
      const largestWindow = Math.max(
        ...overflow.map((target) =>
          this.capabilityService.resolveModelRoutingCapabilities(
            target.node,
            target.model,
          ).max_context_tokens || 0,
        ),
      );
      throw new RoutingConstraintError(
        `No route targets for tier "${tier}" can fit the estimated ${estimatedContextTokens} context tokens` +
          (largestWindow ? ` (largest configured window: ${largestWindow}).` : '.'),
        400,
      );
    }

    if (overflow.length > 0) {
      this.logger.warn(
        `Context-aware routing removed ${overflow.length} target(s) for tier "${tier}" because estimated context ${estimatedContextTokens} exceeds their configured windows.`,
      );
    }

    if (safe.length > 0 && nearLimit.length > 0) {
      this.logger.debug(
        `Context-aware routing demoted ${nearLimit.length} near-limit target(s) for tier "${tier}" over 80% of context window.`,
      );
    }

    return fits;
  }

  private filterTargetsByModalities<T extends RouteTarget>(
    tier: string,
    targets: T[],
    modalityHints?: Modality[],
  ): T[] {
    const required = Array.from(new Set(modalityHints || []));
    if (required.length === 0 || targets.length === 0) return targets;

    const compatible = targets.filter((target) => {
      const targetModalities = this.capabilityService.resolveModelModalities(
        target.node,
        target.model,
      );
      return supportsModalities(targetModalities, required);
    });

    if (compatible.length === 0) {
      throw new RoutingConstraintError(
        `No route targets for tier "${tier}" support required modalities [${required.join(', ')}].`,
        400,
      );
    }

    const removed = targets.length - compatible.length;
    if (removed > 0) {
      this.logger.debug(
        `Modality-aware routing removed ${removed} target(s) for tier "${tier}" because they do not support [${required.join(', ')}].`,
      );
    }

    return compatible;
  }

  private preferStructuredOutputTargets<T extends RouteTarget>(
    tier: string,
    targets: T[],
  ): T[] {
    const supported: T[] = [];
    const unknown: T[] = [];
    const unsupported: T[] = [];

    for (const target of targets) {
      const structuredOutput =
        this.capabilityService.resolveModelRoutingCapabilities(
          target.node,
          target.model,
        ).structured_output;
      if (structuredOutput === true) {
        supported.push(target);
      } else if (structuredOutput === false) {
        unsupported.push(target);
      } else {
        unknown.push(target);
      }
    }

    if (supported.length > 0) {
      return [...supported, ...unknown];
    }

    if (unknown.length === 0 && unsupported.length > 0) {
      throw new RoutingConstraintError(
        `No route targets for tier "${tier}" declare structured output support.`,
        400,
      );
    }

    return [...unknown, ...unsupported];
  }

  private toRouteTarget(target: RouteTarget): RouteTarget {
    return { node: target.node, model: target.model };
  }

  private averageLatency(node: string, model: string): number | null {
    return this.average(this.getLatencySamples(node, model));
  }

  private getLatencySamples(node: string, model: string): number[] {
    return this.latencyWindows.get(this.buildExperimentTargetKey(node, model)) || [];
  }

  private average(samples: number[]): number | null {
    if (samples.length === 0) return null;
    return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  }

  private percentile(samples: number[], percentile: number): number | null {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.ceil(percentile * sorted.length) - 1,
    );
    return sorted[index];
  }

  /**
   * Resolve A/B split: hash the session key into a bucket and select a variant.
   * The selected variant becomes primary; remaining variants become fallbacks.
   * Uses FNV-1a 32-bit hash for deterministic, sticky routing.
   */
  private resolveABSplit(
    variants: SplitVariant[],
    tier: string,
    sessionKey?: string,
  ): { orderedTargets: RouteTarget[]; experimentGroupsByTarget: Record<string, string> } {
    const hash = fnv1a32(sessionKey || uuidv4());
    const bucket = hash % 100;

    let cumulative = 0;
    let selectedIdx = 0;
    for (let i = 0; i < variants.length; i++) {
      cumulative += variants[i].weight;
      if (bucket < cumulative) {
        selectedIdx = i;
        break;
      }
    }

    const selected = variants[selectedIdx];
    const name = selected.name || `${selected.node}:${selected.model}`;
    const primary: RouteTarget = { node: selected.node, model: selected.model };
    const fallbacks = variants
      .filter((_, i) => i !== selectedIdx)
      .map(v => ({ node: v.node, model: v.model }));
    const experimentGroupsByTarget = Object.fromEntries(
      variants.map((variant) => {
        const variantName = variant.name || `${variant.node}:${variant.model}`;
        return [
          this.buildExperimentTargetKey(variant.node, variant.model),
          `${tier}:${variantName}`,
        ];
      }),
    );

    this.logger.log(
      `A/B split tier="${tier}": bucket=${bucket} → variant="${name}" (weight=${selected.weight})`,
    );

    return {
      orderedTargets: [primary, ...fallbacks],
      experimentGroupsByTarget,
    };
  }

  private resolveExperimentGroupForTarget(
    experimentGroupsByTarget: Record<string, string>,
    target: RouteTarget,
  ): string | null {
    return experimentGroupsByTarget[this.buildExperimentTargetKey(target.node, target.model)] || null;
  }

  private buildExperimentTargetKey(node: string, model: string): string {
    return `${node}:${model}`;
  }

  /**
   * Resolve preferred node IDs for a domain hint.
   *
   * Priority:
   *   1. Explicit config: routing.domain_preferences.{domain}
   *   2. Tag-based: all nodes with the domain as a tag, sorted by tier cost (cheap → expensive)
   *   3. Capability-based: nodes whose capabilities include the domain hint
   */
  private resolvePreferredNodes(domain: string): string[] {
    // 1. Check explicit config
    const explicit = this.config.routing.domain_preferences?.[domain];
    if (explicit && explicit.length > 0) {
      return explicit;
    }

    // 2. Fallback to tag matching — find nodes tagged with this domain
    const tagged = this.config.nodes
      .filter((n) => n.tags?.includes(domain))
      .map((n) => n.id);

    if (tagged.length > 0) {
      this.logger.debug(
        `Domain "${domain}": no explicit preference, using tag match: [${tagged.join(', ')}]`,
      );
      return tagged;
    }

    // 3. Fallback to capability matching — find nodes with matching capability
    const capabilityMatched = this.config.nodes
      .filter((n) => n.capabilities?.includes(domain))
      .map((n) => n.id);

    if (capabilityMatched.length > 0) {
      this.logger.debug(
        `Domain "${domain}": no tag match, using capability match: [${capabilityMatched.join(', ')}]`,
      );
    }

    return capabilityMatched;
  }

  /**
   * Reorder targets so preferred nodes come first (while keeping their relative order).
   * Non-preferred targets maintain their original order after preferred ones.
   */
  private reorderByPreference<T extends RouteTarget>(
    targets: T[],
    preferredNodes: string[],
  ): T[] {
    const preferred: T[] = [];
    const rest: T[] = [];

    // Walk through preferred list in order to maintain priority
    for (const prefNode of preferredNodes) {
      const found = targets.find((t) => t.node === prefNode);
      if (found) {
        preferred.push(found);
      }
    }

    // Add remaining targets not in preferred list
    for (const t of targets) {
      if (!preferred.includes(t)) {
        rest.push(t);
      }
    }

    return [...preferred, ...rest];
  }
}
