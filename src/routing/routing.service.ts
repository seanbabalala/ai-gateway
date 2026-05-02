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
import { Tier } from '../canonical/canonical.types';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MomentumService } from './momentum.service';
import {
  LoadBalancingStrategy,
  RouteTarget,
  SplitVariant,
  TierConfig,
  WeightedRouteTarget,
} from '../config/gateway.config';
import { Modality } from '../config/modality';
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

export type EffectiveRoutingStrategy = LoadBalancingStrategy | 'primary_fallback' | 'split';

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
   * 3.5. Modality-aware reordering (compatible nodes first)
   * 4. Apply domain hint adjustments (config preference → tag fallback)
   * 5. Build final route
   */
  resolve(
    tier: Tier,
    score: number,
    sessionKey?: string,
    domainHint?: 'frontend' | 'backend' | null,
    modalityHints?: Modality[],
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
      const fallbackTargets = this.normalizeTierTargets(fallbackConfig).targets;
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

      // Modality-aware reordering on split targets
      if (modalityHints && modalityHints.length > 0) {
        const compatible: RouteTarget[] = [];
        const incompatible: RouteTarget[] = [];
        for (const target of splitAvailable) {
          const targetModalities = this.capabilityService.resolveModelModalities(target.node, target.model);
          const supported = modalityHints.every((m) => targetModalities.includes(m));
          (supported ? compatible : incompatible).push(target);
        }
        splitAvailable = [...compatible, ...incompatible];
      }

      // Domain hint reordering on split targets
      let splitOrdered = [...splitAvailable];
      if (hint && splitAvailable.length > 1) {
        const preferredNodes = this.resolvePreferredNodes(hint);
        if (preferredNodes.length > 0) {
          splitOrdered = this.reorderByPreference(splitAvailable, preferredNodes);
        }
      }

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

    // ── Step 3.5: Modality-aware reordering ──
    // Compatible nodes (support all required modalities) go first.
    // Incompatible nodes are pushed to the end as last resort (not removed).
    if (modalityHints && modalityHints.length > 0) {
      const compatible: WeightedRouteTarget[] = [];
      const incompatible: WeightedRouteTarget[] = [];

      for (const target of availableTargets) {
        const targetModalities = this.capabilityService.resolveModelModalities(
          target.node,
          target.model,
        );
        const supported = modalityHints.every((m) =>
          targetModalities.includes(m),
        );
        if (supported) {
          compatible.push(target);
        } else {
          incompatible.push(target);
        }
      }

      // Reorder: compatible first, then incompatible as fallback
      availableTargets = [...compatible, ...incompatible];

      if (compatible.length === 0) {
        this.logger.warn(
          `No nodes support modalities [${modalityHints.join(', ')}] for tier "${effectiveTier}". Using all targets as last resort.`,
        );
      } else if (incompatible.length > 0) {
        this.logger.debug(
          `Modality filter: ${compatible.length} compatible, ${incompatible.length} demoted to fallback end`,
        );
      }
    }

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

    // ── Step 5: Apply load-balancing strategy and build final route ──
    const primary = this.selectTargetByStrategy(
      effectiveTier,
      normalized.strategy,
      orderedTargets,
      sessionKey,
    );
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
      normalized.strategy,
      normalized.source,
      this.selectionReason(normalized.strategy, primary),
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
        strategy: normalized.strategy,
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

      result[tier] = {
        strategy: normalized.strategy,
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
  ): WeightedRouteTarget {
    if (targets.length === 0) {
      throw new Error(`No route targets available for tier "${tier}"`);
    }
    if (targets.length === 1 || strategy === 'primary_fallback' || strategy === 'split') {
      return targets[0];
    }

    switch (strategy) {
      case 'round_robin':
        return this.selectRoundRobin(tier, targets);
      case 'least_latency':
        return this.selectLeastLatency(targets);
      case 'random':
        return targets[Math.floor(Math.random() * targets.length)] || targets[0];
      case 'weighted':
      default:
        return this.selectWeighted(tier, targets, sessionKey);
    }
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
    if (strategy === 'least_latency') {
      const avg = this.averageLatency(target.node, target.model);
      return avg === null ? 'cold-start ordered fallback' : `lowest local average latency (${avg}ms)`;
    }
    if (strategy === 'round_robin') return 'next round-robin slot';
    if (strategy === 'random') return 'random target';
    if (strategy === 'weighted') return 'weighted target selection';
    return 'legacy primary/fallback order';
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
