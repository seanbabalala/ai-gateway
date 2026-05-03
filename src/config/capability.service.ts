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
import {
  ModelCapabilityConfig,
  ModelPricing,
  NodeConfig,
  RouteTarget,
} from './gateway.config';
import {
  CapabilityEndpoint,
  CapabilityIOType,
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
  modalities: Modality[];
  endpoints?: Partial<Record<CapabilityEndpoint, string>>;
  input_types?: (CapabilityIOType | string)[];
  output_types?: (CapabilityIOType | string)[];
  max_file_size?: number;
  supports_streaming?: boolean;
  supports_realtime?: boolean;
  supports_rerank?: boolean;
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
   * Resolution merges node-level declarations, model-level overrides, embedding
   * model declarations, model-name inference, and legacy capability fallback.
   */
  resolveNodeModalities(nodeId: string): Modality[] {
    const node = this.config.getNode(nodeId);
    if (!node) return [...DEFAULT_MODALITIES];

    const modalities = new Set<Modality>();

    if (node.modalities && node.modalities.length > 0) {
      for (const modality of node.modalities) modalities.add(modality);
    }

    const modelIds = [
      ...(node.models || []),
      ...(node.embedding_models || []),
      ...(node.rerank_models || []),
      ...(node.image_models || []),
      ...(node.audio_models || []),
      ...(node.video_models || []),
      ...(node.realtime_models || []),
    ];
    let anyInferred = modalities.size > 0;

    for (const model of modelIds) {
      const modelModalities = this.resolveModelModalities(nodeId, model);
      if (modelModalities.length > 0) {
        anyInferred = true;
        for (const m of modelModalities) {
          modalities.add(m);
        }
      }
    }

    if (anyInferred) {
      return Array.from(modalities);
    }

    const caps = this.getNodeCapabilities(nodeId);
    if (caps.includes('vision')) {
      modalities.add('vision');
      return Array.from(modalities);
    }

    return [...DEFAULT_MODALITIES];
  }

  /**
   * Resolve modalities for a specific node + model combination.
   * More precise than resolveNodeModalities — checks the specific model.
   *
   * Resolution:
   *   1. Explicit model_capabilities[model].modalities
   *   2. Explicit node.modalities
   *   3. Endpoint/support flags that imply embedding/rerank/realtime
   *   4. Specific model-name inference
   *   5. Capability fallback
   *   6. Default — ['text']
   */
  resolveModelModalities(nodeId: string, model: string): Modality[] {
    const node = this.config.getNode(nodeId);
    if (!node) return [...DEFAULT_MODALITIES];
    const modelCapability = node.model_capabilities?.[model];

    if (modelCapability?.modalities && modelCapability.modalities.length > 0) {
      return this.withImpliedModalities(
        modelCapability.modalities,
        node,
        model,
        modelCapability,
        false,
      );
    }

    if (node.modalities && node.modalities.length > 0) {
      return this.withImpliedModalities(
        node.modalities,
        node,
        model,
        modelCapability,
        false,
      );
    }

    const implied = this.impliedModalities(node, model, modelCapability, true);
    if (implied.length > 0) {
      return implied;
    }

    const inferred = inferModelModalities(model);
    if (inferred) {
      return this.withImpliedModalities(
        inferred,
        node,
        model,
        modelCapability,
        false,
      );
    }

    const caps = this.getNodeCapabilities(nodeId);
    if (caps.includes('vision')) {
      return this.withImpliedModalities(
        ['text', 'vision'],
        node,
        model,
        modelCapability,
        false,
      );
    }

    return this.withImpliedModalities(
      DEFAULT_MODALITIES,
      node,
      model,
      modelCapability,
      false,
    );
  }

  /** Resolve v0.3 routing metadata for a node/model target. */
  resolveModelRoutingCapabilities(
    nodeId: string,
    model: string,
  ): ResolvedModelRoutingCapabilities {
    const node = this.config.getNode(nodeId);
    const modelCapability = node?.model_capabilities?.[model];
    const endpoints =
      node || modelCapability
        ? {
            ...(node?.endpoints || {}),
            ...(modelCapability?.endpoints || {}),
          }
        : {};
    const resolvedEndpoints = Object.keys(endpoints).length > 0
      ? endpoints
      : undefined;

    return {
      modalities: this.resolveModelModalities(nodeId, model),
      endpoints: resolvedEndpoints,
      input_types: modelCapability?.input_types ?? node?.input_types,
      output_types: modelCapability?.output_types ?? node?.output_types,
      max_file_size:
        modelCapability?.max_file_size ?? node?.max_file_size,
      supports_streaming:
        modelCapability?.supports_streaming ?? node?.supports_streaming,
      supports_realtime:
        modelCapability?.supports_realtime ?? node?.supports_realtime,
      supports_rerank:
        modelCapability?.supports_rerank ?? node?.supports_rerank,
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

  private withImpliedModalities(
    configured: readonly Modality[],
    node: NodeConfig,
    model: string,
    modelCapability?: ModelCapabilityConfig,
    includeNodeDefaults = false,
  ): Modality[] {
    const modalities = new Set<Modality>(configured);
    for (const modality of this.impliedModalities(
      node,
      model,
      modelCapability,
      includeNodeDefaults,
    )) {
      modalities.add(modality);
    }
    return Array.from(modalities);
  }

  private impliedModalities(
    node: NodeConfig,
    model: string,
    modelCapability?: ModelCapabilityConfig,
    includeNodeDefaults = false,
  ): Modality[] {
    const modalities = new Set<Modality>();
    if (
      node.embedding_models?.includes(model) ||
      modelCapability?.dimensions !== undefined
    ) {
      modalities.add('text');
      modalities.add('embedding');
    }
    if (node.rerank_models?.includes(model)) {
      modalities.add('rerank');
    }
    if (node.image_models?.includes(model)) {
      modalities.add('image');
    }
    if (node.audio_models?.includes(model)) {
      modalities.add('audio');
    }
    if (node.video_models?.includes(model)) {
      modalities.add('video');
    }
    if (node.realtime_models?.includes(model)) {
      modalities.add('realtime');
    }

    const inputTypes = [
      ...(includeNodeDefaults ? (node.input_types || []) : []),
      ...(modelCapability?.input_types || []),
    ];
    const outputTypes = [
      ...(includeNodeDefaults ? (node.output_types || []) : []),
      ...(modelCapability?.output_types || []),
    ];
    if (inputTypes.includes('image') || outputTypes.includes('image')) {
      modalities.add('image');
    }
    if (inputTypes.includes('audio') || outputTypes.includes('audio')) {
      modalities.add('audio');
    }
    if (inputTypes.includes('video') || outputTypes.includes('video')) {
      modalities.add('video');
    }
    if (inputTypes.includes('embedding') || outputTypes.includes('embedding')) {
      modalities.add('embedding');
    }

    const endpoints = modelCapability?.endpoints || {};
    if (endpoints.image) modalities.add('image');
    if (endpoints.audio) modalities.add('audio');
    if (endpoints.video) modalities.add('video');
    if (
      endpoints.rerank ||
      modelCapability?.supports_rerank ||
      (includeNodeDefaults && node.supports_rerank)
    ) {
      modalities.add('rerank');
    }
    if (
      endpoints.realtime ||
      modelCapability?.supports_realtime ||
      (includeNodeDefaults && node.supports_realtime)
    ) {
      modalities.add('realtime');
    }

    return Array.from(modalities);
  }
}
