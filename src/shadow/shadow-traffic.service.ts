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

interface ShadowTargetContext {
  requestId: string;
  namespaceId?: string | null;
  apiKeyId?: string | null;
  apiKeyName?: string | null;
  sourceFormat: string;
  primaryNode: string;
  primaryModel: string;
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
    if (!target) {
      await this.saveSkipped('chat', context, 'Shadow target is not configured or not found.');
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
        promptSample: this.promptSample(canonical),
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
        error: (err as Error).message,
        promptSample: this.promptSample(canonical),
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
    if (!target) {
      await this.saveSkipped('embeddings', context, 'Shadow target is not configured or not found.');
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
        promptSample: this.embeddingPromptSample(canonical),
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
        error: (err as Error).message,
        promptSample: this.embeddingPromptSample(canonical),
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

  private truncate(value: string, max = 4000): string {
    return value.length > max ? `${value.slice(0, max)}...[truncated]` : value;
  }

  private async saveSkipped(
    kind: ShadowTrafficKind,
    context: ShadowTargetContext,
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
      error,
      promptSample: null,
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
    error?: string | null;
    promptSample: string | null;
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
      status_code: params.statusCode,
      error: params.error || null,
      input_tokens: params.usage.input_tokens || 0,
      output_tokens: params.usage.output_tokens || 0,
      prompt_sample: params.promptSample,
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
