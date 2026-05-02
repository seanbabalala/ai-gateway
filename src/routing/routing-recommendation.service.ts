import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { RouteTarget } from '../config/gateway.config';
import {
  AdaptiveRoutingStatsOptions,
  AdaptiveRoutingStatsService,
  AdaptiveRoutingStatsWindow,
  RouteTargetStats,
} from './adaptive-routing-stats.service';

export interface RecommendationSavings {
  cost_usd_per_1k_calls: number;
  window_cost_usd: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
}

export interface AdaptiveRoutingRecommendation {
  id: string;
  tier: string;
  type: 'promote_primary' | 'investigate_primary' | 'collect_more_data';
  current_primary: RouteTarget;
  suggested_primary: RouteTarget | null;
  suggested_fallbacks: RouteTarget[];
  reasons: string[];
  confidence: number;
  potential_savings: RecommendationSavings;
  risks: string[];
  evidence: {
    current: RouteTargetStats | null;
    candidate: RouteTargetStats | null;
    tier_calls: number;
  };
}

export interface AdaptiveRoutingRecommendationResponse {
  mode: 'recommendation_only';
  generated_at: string;
  stats: AdaptiveRoutingStatsWindow;
  recommendations: AdaptiveRoutingRecommendation[];
}

@Injectable()
export class RoutingRecommendationService {
  constructor(
    private readonly config: ConfigService,
    private readonly statsService: AdaptiveRoutingStatsService,
  ) {}

  async getRecommendations(
    options: AdaptiveRoutingStatsOptions = {},
  ): Promise<AdaptiveRoutingRecommendationResponse> {
    const stats = await this.statsService.getWindow(options);
    const recommendations = Object.entries(this.config.routing.tiers).map(
      ([tier, route]) => this.recommendForTier(tier, route, stats),
    );

    return {
      mode: 'recommendation_only',
      generated_at: new Date().toISOString(),
      stats,
      recommendations,
    };
  }

  private recommendForTier(
    tier: string,
    route: {
      primary: RouteTarget;
      fallbacks: RouteTarget[];
      split?: Array<RouteTarget & { weight: number; name?: string }>;
    },
    stats: AdaptiveRoutingStatsWindow,
  ): AdaptiveRoutingRecommendation {
    const tierStats = stats.tiers.find((item) => item.tier === tier);
    const targetStats = new Map(
      (tierStats?.targets || []).map((target) => [this.targetKey(target), target]),
    );
    const current = targetStats.get(this.targetKey(route.primary)) || null;
    const candidates = this.uniqueTargets([
      ...route.fallbacks,
      ...(route.split || []).map((variant) => ({
        node: variant.node,
        model: variant.model,
      })),
    ]).filter((target) => this.targetKey(target) !== this.targetKey(route.primary));
    const viableCandidates = candidates
      .map((target) => ({
        target,
        stats: targetStats.get(this.targetKey(target)) || null,
      }))
      .filter(
        (item): item is { target: RouteTarget; stats: RouteTargetStats } =>
          Boolean(item.stats && item.stats.calls >= stats.min_samples),
      );

    if (!current || current.calls < stats.min_samples || viableCandidates.length === 0) {
      return this.collectMoreDataRecommendation(
        tier,
        route,
        current,
        tierStats?.calls || 0,
        stats.min_samples,
      );
    }

    const ranked = viableCandidates
      .map((candidate) => ({
        ...candidate,
        score: this.candidateScore(current, candidate.stats),
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];

    if (best && this.shouldPromote(current, best.stats, best.score)) {
      const suggestedFallbacks = this.uniqueTargets([
        route.primary,
        ...route.fallbacks.filter(
          (target) => this.targetKey(target) !== this.targetKey(best.target),
        ),
      ]);
      return this.promoteRecommendation(
        tier,
        route,
        best.target,
        suggestedFallbacks,
        current,
        best.stats,
        tierStats?.calls || 0,
        best.score,
      );
    }

    if (this.shouldInvestigate(current, tierStats?.fallback_rate || 0)) {
      return this.investigateRecommendation(
        tier,
        route,
        current,
        tierStats?.calls || 0,
        tierStats?.fallback_rate || 0,
      );
    }

    return this.collectMoreDataRecommendation(
      tier,
      route,
      current,
      tierStats?.calls || 0,
      stats.min_samples,
    );
  }

  private promoteRecommendation(
    tier: string,
    route: { primary: RouteTarget; fallbacks: RouteTarget[] },
    candidate: RouteTarget,
    suggestedFallbacks: RouteTarget[],
    current: RouteTargetStats,
    candidateStats: RouteTargetStats,
    tierCalls: number,
    score: number,
  ): AdaptiveRoutingRecommendation {
    const latencyP50Delta = current.p50_latency_ms - candidateStats.p50_latency_ms;
    const latencyP95Delta = current.p95_latency_ms - candidateStats.p95_latency_ms;
    const costDelta = current.avg_cost_usd - candidateStats.avg_cost_usd;
    const successDelta = candidateStats.success_rate - current.success_rate;
    const reasons: string[] = [];

    if (latencyP50Delta > 0) {
      reasons.push(
        `${candidate.node}:${candidate.model} is ${Math.round(latencyP50Delta)}ms faster at p50 latency.`,
      );
    }
    if (latencyP95Delta > 0) {
      reasons.push(
        `${candidate.node}:${candidate.model} is ${Math.round(latencyP95Delta)}ms faster at p95 latency.`,
      );
    }
    if (costDelta > 0) {
      reasons.push(
        `${candidate.node}:${candidate.model} is $${(costDelta * 1000).toFixed(4)} cheaper per 1k calls in this window.`,
      );
    }
    if (successDelta > 0) {
      reasons.push(
        `${candidate.node}:${candidate.model} has a ${(successDelta * 100).toFixed(1)} point higher success rate.`,
      );
    }
    if (reasons.length === 0) {
      reasons.push(`${candidate.node}:${candidate.model} is the strongest observed alternative for this tier.`);
    }

    const risks = this.baseRisks(candidateStats);
    if (candidateStats.calls < Math.max(current.calls * 0.5, 20)) {
      risks.push('Candidate has fewer observations than the current primary.');
    }
    if (candidateStats.success_rate < current.success_rate) {
      risks.push('Candidate is slightly less reliable in the current window.');
    }

    return {
      id: `${tier}:promote:${candidate.node}:${candidate.model}`,
      tier,
      type: 'promote_primary',
      current_primary: route.primary,
      suggested_primary: candidate,
      suggested_fallbacks: suggestedFallbacks,
      reasons,
      confidence: this.confidence(current, candidateStats, score),
      potential_savings: {
        cost_usd_per_1k_calls: this.roundSavings(Math.max(0, costDelta * 1000)),
        window_cost_usd: this.roundSavings(Math.max(0, costDelta * current.calls)),
        p50_latency_ms: Math.max(0, Math.round(latencyP50Delta)),
        p95_latency_ms: Math.max(0, Math.round(latencyP95Delta)),
      },
      risks,
      evidence: {
        current,
        candidate: candidateStats,
        tier_calls: tierCalls,
      },
    };
  }

  private investigateRecommendation(
    tier: string,
    route: { primary: RouteTarget; fallbacks: RouteTarget[] },
    current: RouteTargetStats,
    tierCalls: number,
    tierFallbackRate: number,
  ): AdaptiveRoutingRecommendation {
    const reasons = [
      `${route.primary.node}:${route.primary.model} is below the recommended reliability threshold.`,
    ];
    if (tierFallbackRate > 0.15) {
      reasons.push(`Fallback responses represent ${(tierFallbackRate * 100).toFixed(1)}% of this tier.`);
    }

    return {
      id: `${tier}:investigate:${route.primary.node}:${route.primary.model}`,
      tier,
      type: 'investigate_primary',
      current_primary: route.primary,
      suggested_primary: null,
      suggested_fallbacks: route.fallbacks,
      reasons,
      confidence: 0.58,
      potential_savings: {
        cost_usd_per_1k_calls: 0,
        window_cost_usd: 0,
        p50_latency_ms: 0,
        p95_latency_ms: 0,
      },
      risks: [
        'No better configured fallback has enough local samples yet.',
        'Review upstream errors before changing routing manually.',
      ],
      evidence: {
        current,
        candidate: null,
        tier_calls: tierCalls,
      },
    };
  }

  private collectMoreDataRecommendation(
    tier: string,
    route: { primary: RouteTarget; fallbacks: RouteTarget[] },
    current: RouteTargetStats | null,
    tierCalls: number,
    minSamples: number,
  ): AdaptiveRoutingRecommendation {
    return {
      id: `${tier}:collect-more-data`,
      tier,
      type: 'collect_more_data',
      current_primary: route.primary,
      suggested_primary: null,
      suggested_fallbacks: route.fallbacks,
      reasons: [
        `Need at least ${minSamples} samples for the current primary and one fallback before recommending a route change.`,
      ],
      confidence: 0.2,
      potential_savings: {
        cost_usd_per_1k_calls: 0,
        window_cost_usd: 0,
        p50_latency_ms: 0,
        p95_latency_ms: 0,
      },
      risks: [
        'The recommendation engine is observation-only and will not edit routing automatically.',
      ],
      evidence: {
        current,
        candidate: null,
        tier_calls: tierCalls,
      },
    };
  }

  private shouldPromote(
    current: RouteTargetStats,
    candidate: RouteTargetStats,
    score: number,
  ): boolean {
    const reliabilityFloor = Math.max(0.9, current.success_rate - 0.03);
    const materiallyBetter =
      current.p50_latency_ms - candidate.p50_latency_ms >= 50 ||
      current.p95_latency_ms - candidate.p95_latency_ms >= 100 ||
      current.avg_cost_usd - candidate.avg_cost_usd > 0 ||
      candidate.success_rate - current.success_rate >= 0.03;

    return candidate.success_rate >= reliabilityFloor && materiallyBetter && score > 0.12;
  }

  private shouldInvestigate(
    current: RouteTargetStats,
    tierFallbackRate: number,
  ): boolean {
    return current.success_rate < 0.95 || tierFallbackRate > 0.2;
  }

  private candidateScore(
    current: RouteTargetStats,
    candidate: RouteTargetStats,
  ): number {
    const reliabilityDelta = candidate.success_rate - current.success_rate;
    const latencyScore = this.positiveRatio(
      current.p50_latency_ms - candidate.p50_latency_ms,
      Math.max(current.p50_latency_ms, 1),
    );
    const p95Score = this.positiveRatio(
      current.p95_latency_ms - candidate.p95_latency_ms,
      Math.max(current.p95_latency_ms, 1),
    );
    const costScore = this.positiveRatio(
      current.avg_cost_usd - candidate.avg_cost_usd,
      Math.max(current.avg_cost_usd, 0.000001),
    );

    return reliabilityDelta * 1.5 + latencyScore * 0.35 + p95Score * 0.2 + costScore * 0.25;
  }

  private confidence(
    current: RouteTargetStats,
    candidate: RouteTargetStats,
    score: number,
  ): number {
    const sampleFactor = Math.min(1, Math.min(current.calls, candidate.calls) / 50);
    const reliabilityFactor = Math.min(current.success_rate, candidate.success_rate);
    const improvementFactor = Math.min(1, Math.max(0, score));
    const fallbackPenalty = candidate.fallback_rate > 0.8 ? 0.08 : 0;

    return Number(
      Math.min(
        0.95,
        Math.max(
          0.35,
          0.35 + sampleFactor * 0.25 + reliabilityFactor * 0.2 + improvementFactor * 0.2 - fallbackPenalty,
        ),
      ).toFixed(2),
    );
  }

  private baseRisks(candidateStats: RouteTargetStats): string[] {
    const risks = [
      'Recommendation-only mode does not apply changes; review routing config manually.',
    ];

    if (candidateStats.fallback_rate > 0.8) {
      risks.push('Candidate was mostly observed as a fallback, so primary-load behavior may differ.');
    }
    if (candidateStats.calls < 20) {
      risks.push('Candidate sample size is still small.');
    }

    return risks;
  }

  private positiveRatio(delta: number, denominator: number): number {
    if (delta <= 0 || denominator <= 0) return 0;
    return Math.min(1, delta / denominator);
  }

  private uniqueTargets(targets: RouteTarget[]): RouteTarget[] {
    const seen = new Set<string>();
    const result: RouteTarget[] = [];
    for (const target of targets) {
      const key = this.targetKey(target);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(target);
      }
    }
    return result;
  }

  private targetKey(target: Pick<RouteTarget, 'node' | 'model'>): string {
    return `${target.node}:${target.model}`;
  }

  private roundSavings(value: number): number {
    return Number(value.toFixed(6));
  }
}
