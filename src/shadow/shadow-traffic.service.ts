import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import {
  CanonicalEmbeddingRequest,
  CanonicalEmbeddingResponse,
  CanonicalRequest,
  CanonicalResponse,
  TokenUsage,
} from '../canonical/canonical.types';
import {
  ProviderClientService,
  ProviderError,
} from '../providers/provider-client.service';
import {
  ShadowTrafficKind,
  ShadowTrafficResult,
} from '../database/entities/shadow-traffic-result.entity';
import { ModelPricing } from '../config/gateway.config';

interface ShadowTargetContext {
  requestId: string;
  namespaceId?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  sourceFormat: string;
  primaryNode: string;
  primaryModel: string;
}

interface PrimaryObservation {
  latencyMs: number | null;
  usage: TokenUsage;
  costUsd: number;
  responseSample: string | null;
}

export interface ShadowTrafficComparisonReport {
  window: {
    rows: number;
    compared: number;
    skipped: number;
    namespace_id: string | null;
  };
  success: {
    primary_success_rate: number | null;
    shadow_success_rate: number | null;
    shadow_sent: number;
    shadow_failed: number;
  };
  latency: {
    avg_primary_ms: number | null;
    avg_shadow_ms: number | null;
    delta_ms: number | null;
    verdict: 'faster' | 'similar' | 'slower' | 'unknown';
  };
  cost: {
    avg_primary_usd: number | null;
    avg_shadow_usd: number | null;
    total_primary_usd: number;
    total_shadow_usd: number;
    delta_usd: number | null;
    potential_savings_usd: number;
    verdict: 'cheaper' | 'similar' | 'more_expensive' | 'unknown';
  };
  quality: {
    evaluated: number;
    average_score: number | null;
    status: 'not_evaluated' | 'similar' | 'watch' | 'diverged';
    reason: string;
  };
  recommendation: {
    decision: 'not_enough_data' | 'promote_candidate' | 'keep_primary' | 'investigate';
    confidence: number;
    reasons: string[];
    risk_notes: string[];
  };
}

@Injectable()
export class ShadowTrafficService {
  private readonly logger = new Logger(ShadowTrafficService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly providerClient: ProviderClientService,
    @InjectRepository(ShadowTrafficResult)
    private readonly shadowRepo: Repository<ShadowTrafficResult>,
  ) {}

  enqueueChat(
    requestId: string,
    canonical: CanonicalRequest,
    response: CanonicalResponse,
    primaryNode: string,
    primaryModel: string,
  ): void {
    if (!this.shouldMirror()) return;
    void this.dispatchChat(requestId, canonical, response, primaryNode, primaryModel)
      .catch((err) => this.logger.warn(`Shadow chat dispatch failed: ${(err as Error).message}`));
  }

  enqueueEmbeddings(
    requestId: string,
    canonical: CanonicalEmbeddingRequest,
    response: CanonicalEmbeddingResponse,
    primaryNode: string,
    primaryModel: string,
  ): void {
    if (!this.shouldMirror()) return;
    void this.dispatchEmbeddings(requestId, canonical, response, primaryNode, primaryModel)
      .catch((err) => this.logger.warn(`Shadow embeddings dispatch failed: ${(err as Error).message}`));
  }

  async dispatchChat(
    requestId: string,
    canonical: CanonicalRequest,
    response: CanonicalResponse,
    primaryNode: string,
    primaryModel: string,
  ): Promise<void> {
    const target = this.resolveTarget(primaryModel);
    const context = this.contextFromCanonical(
      requestId,
      canonical,
      primaryNode,
      primaryModel,
    );
    const primary = this.primaryChatObservation(response, primaryNode, primaryModel);
    if (!target) {
      await this.saveSkipped('chat', context, primary, 'Shadow target is not configured or not found.');
      return;
    }

    const cfg = this.config.shadowTraffic;
    const start = Date.now();
    try {
      const shadowResponse = await this.providerClient.forward(
        this.cloneChatRequest(canonical),
        target.node,
        target.model,
        {
          tier: 'direct',
          score: 0,
          is_fallback: false,
          fallback_reason: null,
        },
        cfg.timeout_ms > 0 ? { timeoutMs: cfg.timeout_ms } : {},
      );
      await this.saveResult({
        kind: 'chat',
        context,
        shadowNode: target.node,
        shadowModel: target.model,
        status: 'sent',
        latencyMs: Date.now() - start,
        statusCode: 200,
        usage: shadowResponse.usage,
        primary,
        shadowCostUsd: this.calculateCostFor(target.model, target.node, shadowResponse.usage),
        promptSample: this.promptSample(canonical),
        primaryResponseSample: primary.responseSample,
        responseSample: this.chatResponseSample(shadowResponse),
      });
    } catch (err) {
      await this.saveResult({
        kind: 'chat',
        context,
        shadowNode: target.node,
        shadowModel: target.model,
        status: 'failed',
        latencyMs: Date.now() - start,
        statusCode: err instanceof ProviderError ? err.statusCode || null : null,
        usage: { input_tokens: 0, output_tokens: 0 },
        primary,
        shadowCostUsd: 0,
        error: (err as Error).message,
        promptSample: this.promptSample(canonical),
        primaryResponseSample: primary.responseSample,
        responseSample: null,
      });
    }
  }

  async dispatchEmbeddings(
    requestId: string,
    canonical: CanonicalEmbeddingRequest,
    response: CanonicalEmbeddingResponse,
    primaryNode: string,
    primaryModel: string,
  ): Promise<void> {
    const target = this.resolveTarget(primaryModel);
    const context = this.contextFromCanonical(
      requestId,
      canonical,
      primaryNode,
      primaryModel,
    );
    const primary = this.primaryEmbeddingObservation(response, primaryNode, primaryModel);
    if (!target) {
      await this.saveSkipped('embeddings', context, primary, 'Shadow target is not configured or not found.');
      return;
    }

    const cfg = this.config.shadowTraffic;
    const start = Date.now();
    try {
      const shadowResponse = await this.providerClient.forwardEmbeddings(
        this.cloneEmbeddingRequest(canonical),
        target.node,
        target.model,
        {
          tier: 'direct',
          score: 0,
          is_fallback: false,
          fallback_reason: null,
        },
        cfg.timeout_ms > 0 ? { timeoutMs: cfg.timeout_ms } : {},
      );
      await this.saveResult({
        kind: 'embeddings',
        context,
        shadowNode: target.node,
        shadowModel: target.model,
        status: 'sent',
        latencyMs: Date.now() - start,
        statusCode: 200,
        usage: shadowResponse.usage,
        primary,
        shadowCostUsd: this.calculateCostFor(target.model, target.node, shadowResponse.usage),
        promptSample: this.embeddingPromptSample(canonical),
        primaryResponseSample: primary.responseSample,
        responseSample: this.embeddingResponseSample(shadowResponse),
      });
    } catch (err) {
      await this.saveResult({
        kind: 'embeddings',
        context,
        shadowNode: target.node,
        shadowModel: target.model,
        status: 'failed',
        latencyMs: Date.now() - start,
        statusCode: err instanceof ProviderError ? err.statusCode || null : null,
        usage: { input_tokens: 0, output_tokens: 0 },
        primary,
        shadowCostUsd: 0,
        error: (err as Error).message,
        promptSample: this.embeddingPromptSample(canonical),
        primaryResponseSample: primary.responseSample,
        responseSample: null,
      });
    }
  }

  async recent(namespaceId?: string, limit = 50): Promise<ShadowTrafficResult[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    return this.shadowRepo.find({
      where: namespaceId ? { namespace_id: namespaceId } : undefined,
      order: { timestamp: 'DESC' },
      take: safeLimit,
    });
  }

  buildComparisonReport(
    rows: ShadowTrafficResult[],
    namespaceId?: string,
  ): ShadowTrafficComparisonReport {
    const compared = rows.filter((row) => row.status !== 'skipped');
    const sent = rows.filter((row) => row.status === 'sent');
    const failed = rows.filter((row) => row.status === 'failed');
    const skipped = rows.filter((row) => row.status === 'skipped');
    const primaryLatencies = rows
      .map((row) => row.primary_latency_ms)
      .filter((value): value is number => typeof value === 'number');
    const shadowLatencies = compared
      .map((row) => row.latency_ms)
      .filter((value): value is number => typeof value === 'number');
    const avgPrimaryLatency = this.average(primaryLatencies);
    const avgShadowLatency = this.average(shadowLatencies);
    const latencyDelta = avgPrimaryLatency === null || avgShadowLatency === null
      ? null
      : this.round(avgShadowLatency - avgPrimaryLatency, 2);

    const primaryCosts = rows.map((row) => Number(row.primary_cost_usd || 0));
    const shadowCosts = rows.map((row) => Number(row.shadow_cost_usd || 0));
    const totalPrimaryCost = this.round(primaryCosts.reduce((sum, value) => sum + value, 0), 8);
    const totalShadowCost = this.round(shadowCosts.reduce((sum, value) => sum + value, 0), 8);
    const avgPrimaryCost = rows.length > 0 ? this.round(totalPrimaryCost / rows.length, 8) : null;
    const avgShadowCost = rows.length > 0 ? this.round(totalShadowCost / rows.length, 8) : null;
    const costDelta = avgPrimaryCost === null || avgShadowCost === null
      ? null
      : this.round(avgShadowCost - avgPrimaryCost, 8);
    const qualityScores = rows
      .map((row) => this.scoreOutputQuality(row))
      .filter((value): value is number => typeof value === 'number');
    const avgQuality = this.average(qualityScores);

    const successRate = compared.length > 0
      ? this.round(sent.length / compared.length, 4)
      : null;
    const primarySuccessRate = rows.length > 0 ? 1 : null;
    const latencyVerdict = this.latencyVerdict(latencyDelta);
    const costVerdict = this.costVerdict(costDelta);
    const qualityStatus = this.qualityStatus(avgQuality, qualityScores.length);
    const recommendation = this.buildRecommendation({
      rows,
      compared,
      failed,
      skipped,
      successRate,
      latencyVerdict,
      costVerdict,
      qualityStatus,
      avgQuality,
    });

    return {
      window: {
        rows: rows.length,
        compared: compared.length,
        skipped: skipped.length,
        namespace_id: namespaceId || null,
      },
      success: {
        primary_success_rate: primarySuccessRate,
        shadow_success_rate: successRate,
        shadow_sent: sent.length,
        shadow_failed: failed.length,
      },
      latency: {
        avg_primary_ms: avgPrimaryLatency,
        avg_shadow_ms: avgShadowLatency,
        delta_ms: latencyDelta,
        verdict: latencyVerdict,
      },
      cost: {
        avg_primary_usd: avgPrimaryCost,
        avg_shadow_usd: avgShadowCost,
        total_primary_usd: totalPrimaryCost,
        total_shadow_usd: totalShadowCost,
        delta_usd: costDelta,
        potential_savings_usd: this.round(Math.max(totalPrimaryCost - totalShadowCost, 0), 8),
        verdict: costVerdict,
      },
      quality: {
        evaluated: qualityScores.length,
        average_score: avgQuality === null ? null : this.round(avgQuality, 4),
        status: qualityStatus,
        reason: qualityScores.length > 0
          ? 'response_sample_heuristic'
          : 'response_samples_disabled_or_missing',
      },
      recommendation,
    };
  }

  getStatus() {
    const cfg = this.config.shadowTraffic;
    return {
      enabled: cfg.enabled,
      sample_rate: cfg.sample_rate,
      target_node: cfg.target_node || null,
      target_model: cfg.target_model || null,
      timeout_ms: cfg.timeout_ms || null,
      max_recent_results: cfg.max_recent_results,
      compare: cfg.compare,
      privacy: {
        stores_prompts: cfg.compare.store_prompts,
        stores_responses: cfg.compare.store_responses,
        raw_headers: false,
        provider_keys: false,
      },
    };
  }

  private shouldMirror(): boolean {
    const cfg = this.config.shadowTraffic;
    if (!cfg.enabled) return false;
    if (cfg.sample_rate <= 0) return false;
    if (cfg.sample_rate >= 1) return true;
    return Math.random() < cfg.sample_rate;
  }

  private resolveTarget(primaryModel: string): { node: string; model: string } | null {
    const cfg = this.config.shadowTraffic;
    if (!cfg.target_node) return null;
    const node = this.config.getNode(cfg.target_node);
    if (!node) return null;
    const model = cfg.target_model || primaryModel || node.models[0] || node.embedding_models?.[0];
    if (!model) return null;
    return { node: node.id, model };
  }

  private contextFromCanonical(
    requestId: string,
    canonical: CanonicalRequest | CanonicalEmbeddingRequest,
    primaryNode: string,
    primaryModel: string,
  ): ShadowTargetContext {
    return {
      requestId,
      namespaceId: canonical.metadata.namespace_id || null,
      apiKeyId: canonical.metadata.api_key_id || null,
      apiKeyName: canonical.metadata.api_key_name || null,
      sourceFormat: canonical.metadata.source_format,
      primaryNode,
      primaryModel,
    };
  }

  private cloneChatRequest(canonical: CanonicalRequest): CanonicalRequest {
    const cloned = JSON.parse(JSON.stringify(canonical)) as CanonicalRequest;
    cloned.stream = false;
    cloned.metadata = {
      ...cloned.metadata,
      raw_headers: {},
    };
    return cloned;
  }

  private cloneEmbeddingRequest(canonical: CanonicalEmbeddingRequest): CanonicalEmbeddingRequest {
    const cloned = JSON.parse(JSON.stringify(canonical)) as CanonicalEmbeddingRequest;
    cloned.metadata = {
      ...cloned.metadata,
      raw_headers: {},
    };
    return cloned;
  }

  private promptSample(canonical: CanonicalRequest): string | null {
    if (!this.config.shadowTraffic.compare.store_prompts) return null;
    return this.truncate(JSON.stringify({ messages: canonical.messages, tools: canonical.tools || [] }));
  }

  private embeddingPromptSample(canonical: CanonicalEmbeddingRequest): string | null {
    if (!this.config.shadowTraffic.compare.store_prompts) return null;
    return this.truncate(JSON.stringify({ input: canonical.input, dimensions: canonical.dimensions ?? null }));
  }

  private chatResponseSample(response: CanonicalResponse): string | null {
    if (!this.config.shadowTraffic.compare.store_responses) return null;
    return this.truncate(JSON.stringify({ content: response.content, stop_reason: response.stop_reason }));
  }

  private embeddingResponseSample(response: CanonicalEmbeddingResponse): string | null {
    if (!this.config.shadowTraffic.compare.store_responses) return null;
    return this.truncate(JSON.stringify({ data: response.data, usage: response.usage }));
  }

  private primaryChatObservation(
    response: CanonicalResponse,
    primaryNode: string,
    primaryModel: string,
  ): PrimaryObservation {
    return {
      latencyMs: response.routing?.latency_ms ?? null,
      usage: response.usage,
      costUsd: this.calculateCostFor(primaryModel, primaryNode, response.usage),
      responseSample: this.chatResponseSample(response),
    };
  }

  private primaryEmbeddingObservation(
    response: CanonicalEmbeddingResponse,
    primaryNode: string,
    primaryModel: string,
  ): PrimaryObservation {
    return {
      latencyMs: response.routing?.latency_ms ?? null,
      usage: response.usage,
      costUsd: this.calculateCostFor(primaryModel, primaryNode, response.usage),
      responseSample: this.embeddingResponseSample(response),
    };
  }

  private calculateCostFor(model: string, nodeId: string, usage: TokenUsage): number {
    const pricing = this.config.getModelPricing(model, nodeId) as ModelPricing | undefined;
    if (!pricing) return 0;
    const cacheCreate = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const normalInput = Math.max((usage.input_tokens || 0) - cacheCreate - cacheRead, 0);
    const cost =
      (normalInput / 1_000_000) * pricing.input +
      (cacheCreate / 1_000_000) * (pricing.cache_creation_input ?? pricing.input) +
      (cacheRead / 1_000_000) * (pricing.cache_read_input ?? pricing.input) +
      ((usage.output_tokens || 0) / 1_000_000) * pricing.output;
    return this.round(cost, 8);
  }

  private truncate(value: string, max = 4000): string {
    return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    return this.round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
  }

  private round(value: number, digits = 4): number {
    return Number(value.toFixed(digits));
  }

  private latencyVerdict(deltaMs: number | null): ShadowTrafficComparisonReport['latency']['verdict'] {
    if (deltaMs === null) return 'unknown';
    if (deltaMs <= -50) return 'faster';
    if (deltaMs >= 50) return 'slower';
    return 'similar';
  }

  private costVerdict(deltaUsd: number | null): ShadowTrafficComparisonReport['cost']['verdict'] {
    if (deltaUsd === null) return 'unknown';
    if (deltaUsd <= -0.000001) return 'cheaper';
    if (deltaUsd >= 0.000001) return 'more_expensive';
    return 'similar';
  }

  private qualityStatus(
    score: number | null,
    evaluated: number,
  ): ShadowTrafficComparisonReport['quality']['status'] {
    if (evaluated === 0 || score === null) return 'not_evaluated';
    if (score >= 0.75) return 'similar';
    if (score >= 0.5) return 'watch';
    return 'diverged';
  }

  private scoreOutputQuality(row: ShadowTrafficResult): number | null {
    if (!row.primary_response_sample || !row.response_sample) return null;
    const primary = this.extractComparableSample(row.primary_response_sample);
    const shadow = this.extractComparableSample(row.response_sample);
    if (!primary && !shadow) return 1;
    if (!primary || !shadow) return 0;
    if (primary === shadow) return 1;

    const shorter = Math.min(primary.length, shadow.length);
    const longer = Math.max(primary.length, shadow.length);
    if (longer === 0) return 1;
    const ratio = shorter / longer;
    if (ratio >= 0.85) return 0.85;
    if (ratio >= 0.6) return 0.65;
    if (ratio >= 0.35) return 0.4;
    return 0.2;
  }

  private extractComparableSample(sample: string): string {
    try {
      const parsed = JSON.parse(sample) as Record<string, unknown>;
      if (Array.isArray(parsed.content)) {
        return parsed.content
          .map((block) => {
            if (typeof block === 'string') return block;
            if (block && typeof block === 'object' && 'text' in block) {
              return String((block as { text?: unknown }).text ?? '');
            }
            return JSON.stringify(block);
          })
          .join(' ')
          .trim();
      }
      if (Array.isArray(parsed.data)) {
        return parsed.data
          .map((item) => {
            if (!item || typeof item !== 'object') return '';
            const embedding = (item as { embedding?: unknown }).embedding;
            const length = Array.isArray(embedding) ? embedding.length : String(embedding ?? '').length;
            return `${(item as { index?: unknown }).index ?? ''}:${length}`;
          })
          .join('|');
      }
      return JSON.stringify(parsed);
    } catch {
      return sample.trim();
    }
  }

  private buildRecommendation(params: {
    rows: ShadowTrafficResult[];
    compared: ShadowTrafficResult[];
    failed: ShadowTrafficResult[];
    skipped: ShadowTrafficResult[];
    successRate: number | null;
    latencyVerdict: ShadowTrafficComparisonReport['latency']['verdict'];
    costVerdict: ShadowTrafficComparisonReport['cost']['verdict'];
    qualityStatus: ShadowTrafficComparisonReport['quality']['status'];
    avgQuality: number | null;
  }): ShadowTrafficComparisonReport['recommendation'] {
    const reasons: string[] = [];
    const riskNotes: string[] = [];
    const sampleConfidence = Math.min(params.rows.length / 50, 1);
    const successRate = params.successRate ?? 0;

    if (params.rows.length < 10) {
      riskNotes.push('sample_size_low');
    }
    if (params.skipped.length > 0) {
      riskNotes.push('shadow_target_skipped');
    }
    if (params.failed.length > 0) {
      riskNotes.push('shadow_failures_present');
    }
    if (params.qualityStatus === 'not_evaluated') {
      riskNotes.push('quality_not_evaluated_without_response_samples');
    } else if (params.qualityStatus === 'watch' || params.qualityStatus === 'diverged') {
      riskNotes.push('quality_drift_detected');
    }
    if (params.latencyVerdict === 'slower') {
      riskNotes.push('latency_regression');
    }
    if (params.costVerdict === 'more_expensive') {
      riskNotes.push('cost_regression');
    }

    if (params.rows.length < 10) {
      return {
        decision: 'not_enough_data',
        confidence: this.round(sampleConfidence * 0.4, 2),
        reasons: ['collect_more_shadow_samples'],
        risk_notes: riskNotes,
      };
    }

    if (successRate < 0.95 || params.qualityStatus === 'diverged') {
      reasons.push(successRate < 0.95 ? 'shadow_success_rate_below_threshold' : 'quality_diverged');
      return {
        decision: 'investigate',
        confidence: this.round(Math.max(sampleConfidence * 0.7, 0.3), 2),
        reasons,
        risk_notes: riskNotes,
      };
    }

    if (
      params.costVerdict === 'cheaper' &&
      params.latencyVerdict !== 'slower' &&
      params.qualityStatus !== 'watch'
    ) {
      reasons.push('shadow_candidate_cheaper_without_latency_or_quality_regression');
      return {
        decision: 'promote_candidate',
        confidence: this.round(Math.min(0.95, 0.55 + sampleConfidence * 0.35), 2),
        reasons,
        risk_notes: riskNotes,
      };
    }

    reasons.push('primary_route_still_safer');
    return {
      decision: 'keep_primary',
      confidence: this.round(Math.min(0.9, 0.45 + sampleConfidence * 0.3), 2),
      reasons,
      risk_notes: riskNotes,
    };
  }

  private async saveSkipped(
    kind: ShadowTrafficKind,
    context: ShadowTargetContext,
    primary: PrimaryObservation,
    error: string,
  ): Promise<void> {
    const cfg = this.config.shadowTraffic;
    await this.saveResult({
      kind,
      context,
      shadowNode: cfg.target_node || 'unconfigured',
      shadowModel: cfg.target_model || 'unconfigured',
      status: 'skipped',
      latencyMs: null,
      statusCode: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      primary,
      shadowCostUsd: 0,
      error,
      promptSample: null,
      primaryResponseSample: primary.responseSample,
      responseSample: null,
    });
  }

  private async saveResult(params: {
    kind: ShadowTrafficKind;
    context: ShadowTargetContext;
    shadowNode: string;
    shadowModel: string;
    status: 'sent' | 'failed' | 'skipped';
    latencyMs: number | null;
    statusCode: number | null;
    usage: TokenUsage;
    primary: PrimaryObservation;
    shadowCostUsd: number;
    error?: string | null;
    promptSample: string | null;
    primaryResponseSample: string | null;
    responseSample: string | null;
  }): Promise<void> {
    const saved = await this.shadowRepo.save(this.shadowRepo.create({
      request_id: params.context.requestId,
      kind: params.kind,
      namespace_id: params.context.namespaceId || null,
      api_key_id: params.context.apiKeyId || null,
      api_key_name: params.context.apiKeyName || null,
      source_format: params.context.sourceFormat,
      primary_node: params.context.primaryNode,
      primary_model: params.context.primaryModel,
      shadow_node: params.shadowNode,
      shadow_model: params.shadowModel,
      status: params.status,
      latency_ms: params.latencyMs,
      primary_latency_ms: params.primary.latencyMs,
      status_code: params.statusCode,
      error: params.error || null,
      input_tokens: params.usage.input_tokens || 0,
      output_tokens: params.usage.output_tokens || 0,
      primary_input_tokens: params.primary.usage.input_tokens || 0,
      primary_output_tokens: params.primary.usage.output_tokens || 0,
      primary_cost_usd: params.primary.costUsd,
      shadow_cost_usd: params.shadowCostUsd,
      prompt_sample: params.promptSample,
      primary_response_sample: params.primaryResponseSample,
      response_sample: params.responseSample,
    }));

    await this.enforceRetention(saved.id);
  }

  private async enforceRetention(newestId: number): Promise<void> {
    const maxRecent = this.config.shadowTraffic.max_recent_results;
    if (maxRecent <= 0) return;

    try {
      const rows = await this.shadowRepo.find({
        order: { timestamp: 'DESC' },
        skip: maxRecent,
        take: 200,
      });
      const staleIds = rows
        .map((row) => row.id)
        .filter((id) => id !== newestId);
      if (staleIds.length > 0) {
        await this.shadowRepo.delete({ id: In(staleIds) });
      }
    } catch (err) {
      this.logger.debug(`Shadow retention cleanup skipped: ${(err as Error).message}`);
    }
  }
}
