// ===================================================================
// CapabilityService — Capability-based tier & routing recommendation
// ===================================================================
// Bridges the user-facing capability tags with the internal routing system.
// Does NOT modify the scoring engine — purely an advisory/recommendation layer.
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from './config.service';
import {
  CAPABILITY_REGISTRY,
  CAPABILITY_MAP,
  TAG_TO_CAPABILITY_MAP,
  VALID_CAPABILITY_IDS,
  CapabilityDefinition,
} from './capabilities';
import { ModelPricing, NodeConfig, RouteTarget } from './gateway.config';
import {
  Modality,
  inferModelModalities,
  DEFAULT_MODALITIES,
} from './modality';

export interface TierRecommendation {
  tier: string;
  score: number;
  suitable: boolean;
  label: string; // 'Best fit' | 'Good fit' | 'Fallback only' | 'Not recommended'
}

export interface RoutingRecommendation {
  tier: string;
  primary: RouteTarget | null;
  fallbacks: RouteTarget[];
  score: number;
}

export interface ResolvedModelRoutingCapabilities {
  max_context_tokens?: number;
  structured_output: boolean | null;
  dimensions?: number | number[];
  pricing?: ModelPricing;
  quality_score?: number;
}

@Injectable()
export class CapabilityService {
  private readonly logger = new Logger(CapabilityService.name);

  constructor(private readonly config: ConfigService) {}

  /** Return the full capability registry (all 10 definitions) */
  getRegistry(): CapabilityDefinition[] {
    return CAPABILITY_REGISTRY;
  }

  /** Get capabilities for a specific node — prefers explicit `capabilities`, falls back to tag inference */
  getNodeCapabilities(nodeId: string): string[] {
    const node = this.config.getNode(nodeId);
    if (!node) return [];

    if (node.capabilities && node.capabilities.length > 0) {
      return node.capabilities.filter((c) => VALID_CAPABILITY_IDS.includes(c));
    }

    // Fallback: infer from tags
    if (node.tags && node.tags.length > 0) {
      return this.inferCapabilitiesFromTags(node.tags);
    }

    return [];
  }

  /** Infer capability IDs from free-text tags (backward compatibility) */
  inferCapabilitiesFromTags(tags: string[]): string[] {
    const capabilities = new Set<string>();

    for (const tag of tags) {
      const normalized = tag.toLowerCase().trim();
      const mapped = TAG_TO_CAPABILITY_MAP[normalized];
      if (mapped) {
        capabilities.add(mapped);
      }
    }

    return Array.from(capabilities);
  }

  /** Given a set of capabilities, recommend tier suitability scores */
  recommendTiers(capabilities: string[]): TierRecommendation[] {
    const validCaps = capabilities.filter((c) => CAPABILITY_MAP[c]);
    if (validCaps.length === 0) {
      return this.getDefaultTierRecommendations();
    }

    const tiers = ['simple', 'standard', 'complex', 'reasoning'] as const;
    const results: TierRecommendation[] = [];

    for (const tier of tiers) {
      let totalScore = 0;
      for (const capId of validCaps) {
        const cap = CAPABILITY_MAP[capId];
        totalScore += cap.tierAffinity[tier];
      }
      const avgScore = totalScore / validCaps.length;
      const rounded = Number(avgScore.toFixed(2));

      results.push({
        tier,
        score: rounded,
        suitable: rounded > 0.4,
        label: this.getTierLabel(rounded),
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /** Generate routing recommendations based on node capabilities and tier affinities */
  recommendRouting(
    nodes?: NodeConfig[],
  ): RoutingRecommendation[] {
    const allNodes = nodes || this.config.nodes;
    const tiers = ['simple', 'standard', 'complex', 'reasoning'] as const;
    const recommendations: RoutingRecommendation[] = [];

    for (const tier of tiers) {
      // Score each node for this tier
      const scored = allNodes.map((node) => {
        const caps = this.resolveNodeCapabilities(node);
        let tierScore = 0;
        if (caps.length > 0) {
          for (const capId of caps) {
            const cap = CAPABILITY_MAP[capId];
            if (cap) {
              tierScore += cap.tierAffinity[tier];
            }
          }
          tierScore /= caps.length;
        }

        // Price factor: for simple/standard tiers, cheaper models get a small bonus
        const priceFactor = this.getPriceFactor(node, tier);
        const finalScore = tierScore + priceFactor;

        return { node, score: finalScore, model: node.models[0] || '' };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Filter out nodes with very low scores
      const viable = scored.filter((s) => s.score > 0.1);

      if (viable.length > 0) {
        recommendations.push({
          tier,
          primary: { node: viable[0].node.id, model: viable[0].model },
          fallbacks: viable
            .slice(1, 3)
            .map((s) => ({ node: s.node.id, model: s.model })),
          score: Number(viable[0].score.toFixed(2)),
        });
      } else {
        // Use first available node as fallback
        const fallbackNode = allNodes[0];
        recommendations.push({
          tier,
          primary: fallbackNode
            ? { node: fallbackNode.id, model: fallbackNode.models[0] || '' }
            : null,
          fallbacks: [],
          score: 0,
        });
      }
    }

    return recommendations;
  }

  // ── Modality Resolution ────────────────────────────────────────

  /**
   * Resolve supported modalities for a node.
   *
   * Three-layer resolution (in priority order):
   *   1. Explicit `node.modalities` config — direct return
   *   2. Model-name inference — merge modalities from all models in the node
   *   3. Capability fallback — node has 'vision' capability → add vision
   *   4. Default — ['text']
   */
  resolveNodeModalities(nodeId: string): Modality[] {
    const node = this.config.getNode(nodeId);
    if (!node) return [...DEFAULT_MODALITIES];

    // 1. Explicit modalities config (highest priority)
    if (node.modalities && node.modalities.length > 0) {
      return node.modalities;
    }

    // 2. Model-name inference — union of all models' inferred modalities
    const modalities = new Set<Modality>(['text']);
    let anyInferred = false;

    for (const model of node.models) {
      const inferred = inferModelModalities(model);
      if (inferred) {
        anyInferred = true;
        for (const m of inferred) {
          modalities.add(m);
        }
      }
    }

    if (anyInferred) {
      return Array.from(modalities);
    }

    // 3. Capability fallback — check if node has 'vision' capability
    const caps = this.getNodeCapabilities(nodeId);
    if (caps.includes('vision')) {
      modalities.add('vision');
      return Array.from(modalities);
    }

    // 4. Default: text-only
    return [...DEFAULT_MODALITIES];
  }

  /**
   * Resolve modalities for a specific node + model combination.
   * More precise than resolveNodeModalities — checks the specific model.
   *
   * Resolution:
   *   1. Explicit `node.modalities` — direct return
   *   2. Specific model-name inference
   *   3. Capability fallback
   *   4. Default — ['text']
   */
  resolveModelModalities(nodeId: string, model: string): Modality[] {
    const node = this.config.getNode(nodeId);
    if (!node) return [...DEFAULT_MODALITIES];

    // 1. Explicit modalities config (highest priority)
    if (node.modalities && node.modalities.length > 0) {
      return node.modalities;
    }

    // 2. Specific model-name inference
    const inferred = inferModelModalities(model);
    if (inferred) {
      return inferred;
    }

    // 3. Capability fallback
    const caps = this.getNodeCapabilities(nodeId);
    if (caps.includes('vision')) {
      return ['text', 'vision'];
    }

    // 4. Default: text-only
    return [...DEFAULT_MODALITIES];
  }

  /** Resolve v0.3 routing metadata for a node/model target. */
  resolveModelRoutingCapabilities(
    nodeId: string,
    model: string,
  ): ResolvedModelRoutingCapabilities {
    const node = this.config.getNode(nodeId);
    const modelCapability = node?.model_capabilities?.[model];

    return {
      max_context_tokens:
        modelCapability?.max_context_tokens ?? node?.max_context_tokens,
      structured_output:
        modelCapability?.structured_output ?? node?.structured_output ?? null,
      dimensions: modelCapability?.dimensions,
      pricing:
        modelCapability?.pricing ?? this.config.getModelPricing(model, nodeId),
      quality_score: modelCapability?.quality_score,
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private resolveNodeCapabilities(node: NodeConfig): string[] {
    if (node.capabilities && node.capabilities.length > 0) {
      return node.capabilities.filter((c) => VALID_CAPABILITY_IDS.includes(c));
    }
    if (node.tags && node.tags.length > 0) {
      return this.inferCapabilitiesFromTags(node.tags);
    }
    return [];
  }

  private getPriceFactor(
    node: NodeConfig,
    tier: string,
  ): number {
    // For simple/standard tiers, give a small bonus to cheaper models
    if (tier !== 'simple' && tier !== 'standard') return 0;

    const model = node.models[0];
    if (!model) return 0;

    const pricing = this.config.getModelPricing(model);
    if (!pricing) return 0;

    // Average cost per 1M tokens
    const avgCost = (pricing.input + pricing.output) / 2;

    // Cheap models (< $1/1M) get +0.1, expensive models (> $20/1M) get -0.05
    if (avgCost < 1) return 0.1;
    if (avgCost < 5) return 0.05;
    if (avgCost > 20) return -0.05;
    return 0;
  }

  private getTierLabel(score: number): string {
    if (score >= 0.7) return 'Best fit';
    if (score >= 0.5) return 'Good fit';
    if (score >= 0.3) return 'Fallback only';
    return 'Not recommended';
  }

  private getDefaultTierRecommendations(): TierRecommendation[] {
    return [
      { tier: 'simple', score: 0.25, suitable: false, label: 'Not recommended' },
      { tier: 'standard', score: 0.5, suitable: true, label: 'Good fit' },
      { tier: 'complex', score: 0.5, suitable: true, label: 'Good fit' },
      { tier: 'reasoning', score: 0.25, suitable: false, label: 'Not recommended' },
    ];
  }
}
