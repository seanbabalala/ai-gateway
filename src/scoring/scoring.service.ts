// ===================================================================
// ScoringService — 14-Dimension Request Complexity Scoring Engine
// ===================================================================
// Scores a CanonicalRequest to determine its complexity tier:
//   simple → standard → complex → reasoning
//
// Features:
//   - 14 weighted dimensions (keyword, structural, tool-based)
//   - Fast-path short-circuits for obvious cases
//   - Configurable thresholds from gateway.config.yaml
//   - Custom dimension weights via config (routing.scoring.weights)
//   - Custom keywords injected into tries (routing.scoring.custom_keywords)
// ===================================================================

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CanonicalRequest, Tier } from '../canonical/canonical.types';
import { detectRequestModalities } from '../canonical/modality-detection';
import { Modality } from '../config/modality';
import { PluginRegistryService } from '../plugins/plugin-registry.service';

// Keyword dimensions
import {
  scoreSimpleIndicators,
  scoreCodeGeneration,
  scoreCodeFrontend,
  scoreCodeBackend,
  scoreFormalLogic,
  scoreTechnicalTerms,
  scoreAnalyticalReasoning,
  detectCodeDomain,
  extractLastUserText,
  resetTries,
  injectCustomKeywords,
} from './dimensions/keyword.dimension';

// Structural dimensions
import {
  scoreTokenCount,
  scoreConversationDepth,
  scoreConstraintDensity,
  scoreExpectedOutputLength,
  scoreCodeToProse,
  scoreMultiStep,
} from './dimensions/structural.dimension';

// Tool dimension
import { scoreToolCount } from './dimensions/tool.dimension';

// ─── Dimension Weights (defaults) ─────────────────────────

interface DimensionWeight {
  name: string;
  weight: number;
  scorer: (req: CanonicalRequest) => number;
}

const DEFAULT_DIMENSIONS: DimensionWeight[] = [
  { name: 'simpleIndicators',    weight: 0.10, scorer: scoreSimpleIndicators },
  { name: 'codeGeneration',      weight: 0.08, scorer: scoreCodeGeneration },
  { name: 'codeFrontend',        weight: 0.04, scorer: scoreCodeFrontend },
  { name: 'codeBackend',         weight: 0.04, scorer: scoreCodeBackend },
  { name: 'formalLogic',         weight: 0.10, scorer: scoreFormalLogic },
  { name: 'technicalTerms',      weight: 0.08, scorer: scoreTechnicalTerms },
  { name: 'multiStep',           weight: 0.08, scorer: scoreMultiStep },
  { name: 'analyticalReasoning', weight: 0.08, scorer: scoreAnalyticalReasoning },
  { name: 'tokenCount',          weight: 0.08, scorer: scoreTokenCount },
  { name: 'toolCount',           weight: 0.10, scorer: scoreToolCount },
  { name: 'conversationDepth',   weight: 0.06, scorer: scoreConversationDepth },
  { name: 'constraintDensity',   weight: 0.06, scorer: scoreConstraintDensity },
  { name: 'expectedOutputLength', weight: 0.06, scorer: scoreExpectedOutputLength },
  { name: 'codeToProse',         weight: 0.04, scorer: scoreCodeToProse },
];

// ─── Scoring Result ───────────────────────────────────────

export interface ScoringResult {
  tier: Tier;
  score: number;
  dimensions: Record<string, number>;
  domainHint: 'frontend' | 'backend' | null; // code domain signal for routing
  modalityHints?: Modality[]; // modalities required by the request (e.g. ['text', 'vision'])
  fastPath?: string; // which fast-path was triggered (if any)
}

// ─── Service ──────────────────────────────────────────────

@Injectable()
export class ScoringService implements OnModuleInit {
  private readonly logger = new Logger(ScoringService.name);
  private dimensions: DimensionWeight[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  onModuleInit(): void {
    this.initDimensions();
  }

  /**
   * Build the effective dimension list by merging defaults with config overrides.
   * Also injects custom keywords into the tries.
   */
  private initDimensions(): void {
    const scoring = this.config.routing?.scoring;
    const weightOverrides = scoring?.weights;
    const customKeywords = scoring?.custom_keywords;

    // Merge weights
    this.dimensions = DEFAULT_DIMENSIONS.map((dim) => {
      const override = weightOverrides?.[dim.name];
      return override !== undefined
        ? { ...dim, weight: override }
        : { ...dim };
    });

    // Log overrides
    if (weightOverrides && Object.keys(weightOverrides).length > 0) {
      this.logger.log(
        `Custom dimension weights: ${JSON.stringify(weightOverrides)}`,
      );
    }

    // Reset and rebuild tries with custom keywords
    if (customKeywords && customKeywords.length > 0) {
      resetTries(); // Clear singletons so they rebuild fresh
      injectCustomKeywords(customKeywords);
      this.logger.log(
        `Injected ${customKeywords.length} custom keyword rule(s) into scoring tries`,
      );
    }

    // Merge plugin-registered scoring dimensions
    const pluginDims = this.pluginRegistry.getDimensions();
    for (const pd of pluginDims) {
      this.dimensions.push({
        name: pd.name,
        weight: weightOverrides?.[pd.name] ?? pd.defaultWeight,
        scorer: pd.scorer,
      });
    }
    if (pluginDims.length) {
      this.logger.log(
        `Merged ${pluginDims.length} plugin scoring dimension(s)`,
      );
    }
  }

  /**
   * Score a canonical request and return its complexity tier + score.
   */
  score(req: CanonicalRequest): ScoringResult {
    // ── Detect request modalities (vision, audio, etc.) ──
    const requestModalities = detectRequestModalities(req);
    const hasVision = requestModalities.has('vision');
    const modalityHints: Modality[] = requestModalities.size > 1
      ? Array.from(requestModalities)
      : undefined as unknown as Modality[];

    // ── Fast Path 1: Very short + simple ──
    // Skip if request contains images (vision requests need at least standard)
    const lastUserText = extractLastUserText(req);
    if (
      lastUserText.length < 50 &&
      !req.tools?.length &&
      req.messages.length <= 2 &&
      !hasVision
    ) {
      const simpleScore = scoreSimpleIndicators(req);
      if (simpleScore < -0.2) {
        this.logger.debug(`Fast-path: simple (short message + simple indicator)`);
        return {
          tier: 'simple',
          score: simpleScore * 0.10,
          dimensions: { simpleIndicators: simpleScore },
          domainHint: null,
          modalityHints: modalityHints || undefined,
          fastPath: 'short_simple',
        };
      }
    }

    // ── Fast Path 2: Formal logic detected → reasoning ──
    const logicScore = scoreFormalLogic(req);
    if (logicScore >= 0.7) {
      this.logger.debug(`Fast-path: reasoning (strong formal logic signals)`);
      return {
        tier: 'reasoning',
        score: logicScore * 0.10,
        dimensions: { formalLogic: logicScore },
        domainHint: null,
        modalityHints: modalityHints || undefined,
        fastPath: 'formal_logic',
      };
    }

    // ── Fast Path 3: Has tools → at least standard ──
    const hasTools = (req.tools?.length || 0) > 0;

    // ── Full scoring ──
    const dimensions: Record<string, number> = {};
    let weightedSum = 0;

    for (const dim of this.dimensions) {
      const rawScore = dim.scorer(req);
      dimensions[dim.name] = rawScore;
      weightedSum += rawScore * dim.weight;
    }

    // Apply tool floor: if tools exist, ensure at least standard
    let tier = this.scoreToTier(weightedSum);
    if (hasTools && tier === 'simple') {
      tier = 'standard';
    }

    // Apply vision floor: if images exist, ensure at least standard
    if (hasVision && tier === 'simple') {
      tier = 'standard';
    }

    // ── Detect code domain hint ──
    const domainHint = detectCodeDomain(req);

    this.logger.debug(
      `Scored request: ${weightedSum.toFixed(4)} → ${tier}${domainHint ? ` [${domainHint}]` : ''}${hasVision ? ' [vision]' : ''} | dims: ${JSON.stringify(dimensions)}`,
    );

    return { tier, score: weightedSum, dimensions, domainHint, modalityHints: modalityHints || undefined };
  }

  /**
   * Map a numeric score to a Tier using config thresholds.
   */
  private scoreToTier(score: number): Tier {
    const scoring = this.config.routing.scoring;
    const simpleMax = scoring?.simple_max ?? -0.1;
    const standardMax = scoring?.standard_max ?? 0.08;
    const complexMax = scoring?.complex_max ?? 0.35;

    if (score <= simpleMax) return 'simple';
    if (score <= standardMax) return 'standard';
    if (score <= complexMax) return 'complex';
    return 'reasoning';
  }
}
