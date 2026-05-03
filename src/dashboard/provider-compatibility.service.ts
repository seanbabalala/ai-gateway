import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NodeConfig } from '../config/gateway.config';
import {
  ProviderCompatibilityCapability,
  ProviderCompatibilityResult,
  ProviderCompatibilityStatus,
} from '../database/entities';

export interface ProviderCompatibilityMatrixItem {
  capability: ProviderCompatibilityCapability;
  configured: boolean;
  tested: boolean;
  last_status: ProviderCompatibilityStatus | null;
  last_checked_at: string | null;
  failure_reason: string | null;
  latency_ms: number | null;
  status_code: number | null;
  test_mode: string | null;
  requires_confirmation: boolean;
}

export interface ProviderCompatibilityTestOptions {
  capabilities?: ProviderCompatibilityCapability[];
  confirm_expensive?: boolean;
}

export interface ProviderCompatibilityTestSummary {
  success: boolean;
  status: number;
  latency_ms: number;
  message: string;
  matrix: ProviderCompatibilityMatrixItem[];
}

type CapabilityPlan = {
  capability: ProviderCompatibilityCapability;
  configured: boolean;
  endpoint: string | null;
  model: string | null;
  testMode: 'safe_request' | 'endpoint_probe' | 'skipped';
  requiresConfirmation: boolean;
};

const CAPABILITIES: ProviderCompatibilityCapability[] = [
  'chat',
  'responses',
  'messages',
  'embeddings',
  'rerank',
  'images',
  'audio',
  'video',
  'realtime',
];

@Injectable()
export class ProviderCompatibilityService {
  constructor(
    @InjectRepository(ProviderCompatibilityResult)
    private readonly repo: Repository<ProviderCompatibilityResult>,
  ) {}

  async matrixForNodes(
    nodes: NodeConfig[],
  ): Promise<Record<string, ProviderCompatibilityMatrixItem[]>> {
    const nodeIds = nodes.map((node) => node.id);
    const saved = nodeIds.length
      ? await this.repo.find({ where: { node_id: In(nodeIds) } })
      : [];
    const byKey = new Map(
      saved.map((result) => [`${result.node_id}:${result.capability}`, result]),
    );
    const matrix: Record<string, ProviderCompatibilityMatrixItem[]> = {};
    for (const node of nodes) {
      matrix[node.id] = this.plansForNode(node).map((plan) =>
        this.toMatrixItem(plan, byKey.get(`${node.id}:${plan.capability}`)),
      );
    }
    return matrix;
  }

  async matrixForNode(node: NodeConfig): Promise<ProviderCompatibilityMatrixItem[]> {
    const saved = await this.repo.find({ where: { node_id: node.id } });
    const byCapability = new Map(saved.map((result) => [result.capability, result]));
    return this.plansForNode(node).map((plan) =>
      this.toMatrixItem(plan, byCapability.get(plan.capability)),
    );
  }

  async runNodeMatrix(
    node: NodeConfig,
    options: ProviderCompatibilityTestOptions = {},
  ): Promise<ProviderCompatibilityTestSummary> {
    const selected = new Set(options.capabilities?.length ? options.capabilities : CAPABILITIES);
    const plans = this.plansForNode(node).filter((plan) =>
      selected.has(plan.capability),
    );
    const tested: ProviderCompatibilityMatrixItem[] = [];

    for (const plan of plans) {
      if (!plan.configured) {
        tested.push(await this.persistSkipped(node, plan, 'Capability is not configured on this node.'));
        continue;
      }
      if (plan.requiresConfirmation && !options.confirm_expensive) {
        tested.push(await this.runEndpointProbe(node, plan));
        continue;
      }
      if (plan.testMode === 'endpoint_probe') {
        tested.push(await this.runEndpointProbe(node, plan));
        continue;
      }
      tested.push(await this.runSafeRequest(node, plan));
    }

    const matrix = await this.matrixForNode(node);
    const completed = tested.filter((item) => item.tested);
    const failures = completed.filter((item) => item.last_status === 'fail');
    const warnings = completed.filter((item) => item.last_status === 'warning');
    const latencyMs = completed.reduce((sum, item) => sum + (item.latency_ms || 0), 0);
    return {
      success: failures.length === 0,
      status: failures.length > 0 ? 400 : warnings.length > 0 ? 207 : 200,
      latency_ms: latencyMs,
      message:
        failures.length > 0
          ? `${failures.length} compatibility check(s) failed.`
          : warnings.length > 0
            ? `${warnings.length} compatibility check(s) need review.`
            : `Compatibility checks completed for ${completed.length} capability/capabilities.`,
      matrix,
    };
  }

  compatibilityDiagnostics(
    matrices: Record<string, ProviderCompatibilityMatrixItem[]>,
  ): Array<{
    severity: 'warning';
    code: 'provider_compatibility_failed' | 'provider_compatibility_untested';
    message: string;
    nodes: string[];
    capability?: string;
  }> {
    const diagnostics: Array<{
      severity: 'warning';
      code: 'provider_compatibility_failed' | 'provider_compatibility_untested';
      message: string;
      nodes: string[];
      capability?: string;
    }> = [];

    for (const [nodeId, matrix] of Object.entries(matrices)) {
      for (const item of matrix) {
        if (!item.configured) continue;
        if (item.last_status === 'fail') {
          diagnostics.push({
            severity: 'warning',
            code: 'provider_compatibility_failed',
            message:
              `Provider compatibility check failed for ${nodeId}/${item.capability}: ` +
              `${item.failure_reason || 'unknown failure'}`,
            nodes: [nodeId],
            capability: item.capability,
          });
        } else if (!item.tested) {
          diagnostics.push({
            severity: 'warning',
            code: 'provider_compatibility_untested',
            message:
              `Provider capability ${nodeId}/${item.capability} has not been tested from the Dashboard yet.`,
            nodes: [nodeId],
            capability: item.capability,
          });
        }
      }
    }
    return diagnostics;
  }

  private plansForNode(node: NodeConfig): CapabilityPlan[] {
    const textModel = node.models?.[0] || null;
    return [
      {
        capability: 'chat',
        configured: node.protocol === 'chat_completions' && Boolean(textModel),
        endpoint: node.endpoint,
        model: textModel,
        testMode: 'safe_request',
        requiresConfirmation: false,
      },
      {
        capability: 'responses',
        configured: node.protocol === 'responses' && Boolean(textModel),
        endpoint: node.endpoint,
        model: textModel,
        testMode: 'safe_request',
        requiresConfirmation: false,
      },
      {
        capability: 'messages',
        configured: node.protocol === 'messages' && Boolean(textModel),
        endpoint: node.endpoint,
        model: textModel,
        testMode: 'safe_request',
        requiresConfirmation: false,
      },
      {
        capability: 'embeddings',
        configured: Boolean(node.embedding_models?.length),
        endpoint: node.embeddings_endpoint || '/v1/embeddings',
        model: node.embedding_models?.[0] || null,
        testMode: 'safe_request',
        requiresConfirmation: false,
      },
      {
        capability: 'rerank',
        configured: Boolean(node.rerank_models?.length),
        endpoint: node.rerank_endpoint || '/v1/rerank',
        model: node.rerank_models?.[0] || null,
        testMode: 'safe_request',
        requiresConfirmation: false,
      },
      {
        capability: 'images',
        configured: Boolean(node.image_models?.length),
        endpoint: node.images_generations_endpoint || '/v1/images/generations',
        model: node.image_models?.[0] || null,
        testMode: 'endpoint_probe',
        requiresConfirmation: false,
      },
      {
        capability: 'audio',
        configured: Boolean(node.audio_models?.length),
        endpoint: node.audio_transcriptions_endpoint || '/v1/audio/transcriptions',
        model: node.audio_models?.[0] || null,
        testMode: 'endpoint_probe',
        requiresConfirmation: false,
      },
      {
        capability: 'video',
        configured: Boolean(node.video_models?.length),
        endpoint: node.video_endpoint || node.video_generations_endpoint || '/v1/videos/generations',
        model: node.video_models?.[0] || null,
        testMode: 'endpoint_probe',
        requiresConfirmation: true,
      },
      {
        capability: 'realtime',
        configured: Boolean(node.realtime_models?.length),
        endpoint: node.realtime_endpoint || '/v1/realtime',
        model: node.realtime_models?.[0] || null,
        testMode: 'endpoint_probe',
        requiresConfirmation: true,
      },
    ];
  }

  private toMatrixItem(
    plan: CapabilityPlan,
    saved?: ProviderCompatibilityResult,
  ): ProviderCompatibilityMatrixItem {
    return {
      capability: plan.capability,
      configured: plan.configured,
      tested: Boolean(saved?.tested),
      last_status: saved?.last_status || null,
      last_checked_at: saved?.last_checked_at || null,
      failure_reason: saved?.failure_reason || null,
      latency_ms: saved?.latency_ms ?? null,
      status_code: saved?.status_code ?? null,
      test_mode: saved?.test_mode || plan.testMode,
      requires_confirmation: plan.requiresConfirmation,
    };
  }

  private async persistSkipped(
    node: NodeConfig,
    plan: CapabilityPlan,
    reason: string,
  ): Promise<ProviderCompatibilityMatrixItem> {
    return this.persistResult(node, plan, {
      configured: false,
      tested: false,
      last_status: 'skipped',
      failure_reason: reason,
      latency_ms: null,
      status_code: null,
    });
  }

  private async runSafeRequest(
    node: NodeConfig,
    plan: CapabilityPlan,
  ): Promise<ProviderCompatibilityMatrixItem> {
    const started = Date.now();
    const url = this.buildHttpUrl(node, plan.endpoint);
    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: this.authHeaders(node),
        body: JSON.stringify(this.safeBodyFor(plan)),
      });
      const latencyMs = Date.now() - started;
      const classification = this.classifyResponse(response.status, plan.capability);
      await response.text().catch(() => '');
      return this.persistResult(node, plan, {
        configured: true,
        tested: true,
        last_status: classification.status,
        failure_reason: classification.reason,
        latency_ms: latencyMs,
        status_code: response.status,
      });
    } catch (err) {
      return this.persistResult(node, plan, {
        configured: true,
        tested: true,
        last_status: 'fail',
        failure_reason: this.classifyNetworkError(err),
        latency_ms: Date.now() - started,
        status_code: 0,
      });
    }
  }

  private async runEndpointProbe(
    node: NodeConfig,
    plan: CapabilityPlan,
  ): Promise<ProviderCompatibilityMatrixItem> {
    const started = Date.now();
    const url = this.buildHttpUrl(node, plan.endpoint);
    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'HEAD',
        headers: this.authHeaders(node, false),
      });
      return this.persistResult(node, plan, {
        configured: true,
        tested: true,
        last_status: this.classifyProbeStatus(response.status),
        failure_reason: this.probeReason(response.status),
        latency_ms: Date.now() - started,
        status_code: response.status,
      });
    } catch (err) {
      return this.persistResult(node, plan, {
        configured: true,
        tested: true,
        last_status: 'fail',
        failure_reason: this.classifyNetworkError(err),
        latency_ms: Date.now() - started,
        status_code: 0,
      });
    }
  }

  private async persistResult(
    node: NodeConfig,
    plan: CapabilityPlan,
    result: {
      configured: boolean;
      tested: boolean;
      last_status: ProviderCompatibilityStatus;
      failure_reason: string | null;
      latency_ms: number | null;
      status_code: number | null;
    },
  ): Promise<ProviderCompatibilityMatrixItem> {
    const existing = await this.repo.findOne({
      where: { node_id: node.id, capability: plan.capability },
    });
    const entity = this.repo.create({
      ...(existing || {}),
      node_id: node.id,
      capability: plan.capability,
      configured: result.configured,
      tested: result.tested,
      last_status: result.last_status,
      last_checked_at: result.tested
        ? new Date().toISOString()
        : existing?.last_checked_at || null,
      failure_reason: result.failure_reason ? this.sanitize(result.failure_reason) : null,
      latency_ms: result.latency_ms,
      status_code: result.status_code,
      test_mode: plan.testMode,
    });
    const saved = await this.repo.save(entity);
    return this.toMatrixItem(plan, saved);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    timeout.unref?.();
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private authHeaders(node: NodeConfig, json = true): Record<string, string> {
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
    const authType = node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'x-api-key') {
      headers['x-api-key'] = node.api_key;
      headers['anthropic-version'] = node.headers?.['anthropic-version'] || '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${node.api_key}`;
    }
    for (const [key, value] of Object.entries(node.headers || {})) {
      if (!this.isUnsafeHeader(key)) headers[key] = value;
    }
    return headers;
  }

  private safeBodyFor(plan: CapabilityPlan): Record<string, unknown> {
    const model = plan.model || 'auto';
    switch (plan.capability) {
      case 'responses':
        return {
          model,
          stream: false,
          max_output_tokens: 1,
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'ping' }],
            },
          ],
        };
      case 'messages':
        return {
          model,
          stream: false,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        };
      case 'embeddings':
        return {
          model,
          input: 'ping',
        };
      case 'rerank':
        return {
          model,
          query: 'ping',
          documents: ['ping'],
          top_n: 1,
        };
      case 'chat':
      default:
        return {
          model,
          stream: false,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        };
    }
  }

  private buildHttpUrl(node: NodeConfig, endpoint: string | null): string {
    const rawEndpoint = endpoint || node.endpoint;
    if (/^wss?:\/\//i.test(rawEndpoint)) {
      const url = new URL(rawEndpoint);
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      return url.toString();
    }
    if (/^https?:\/\//i.test(rawEndpoint)) {
      return rawEndpoint;
    }
    return `${node.base_url.replace(/\/+$/, '')}${rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`}`;
  }

  private classifyResponse(
    statusCode: number,
    capability: ProviderCompatibilityCapability,
  ): { status: ProviderCompatibilityStatus; reason: string | null } {
    if (statusCode >= 200 && statusCode < 300) {
      return { status: 'pass', reason: null };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { status: 'fail', reason: `Authentication failed for ${capability}.` };
    }
    if (statusCode === 404) {
      return { status: 'fail', reason: `Endpoint was not found for ${capability}.` };
    }
    if (statusCode === 400 || statusCode === 405 || statusCode === 422) {
      return {
        status: 'warning',
        reason: `Provider was reachable but returned HTTP ${statusCode}; request shape or model may need review.`,
      };
    }
    if (statusCode === 429) {
      return {
        status: 'warning',
        reason: 'Provider was reachable but rate limited the safe test.',
      };
    }
    return { status: 'fail', reason: `Provider returned HTTP ${statusCode}.` };
  }

  private classifyProbeStatus(statusCode: number): ProviderCompatibilityStatus {
    if (statusCode >= 200 && statusCode < 300) return 'pass';
    if (statusCode === 400 || statusCode === 405 || statusCode === 422 || statusCode === 429) {
      return 'warning';
    }
    return 'fail';
  }

  private probeReason(statusCode: number): string | null {
    if (statusCode >= 200 && statusCode < 300) return null;
    if (statusCode === 401 || statusCode === 403) {
      return 'Authentication failed during endpoint probe.';
    }
    if (statusCode === 404) {
      return 'Endpoint was not found during endpoint probe.';
    }
    if (statusCode === 400 || statusCode === 405 || statusCode === 422) {
      return `Endpoint/auth probe reached the provider but returned HTTP ${statusCode}; no generation was attempted.`;
    }
    if (statusCode === 429) {
      return 'Endpoint/auth probe reached the provider but was rate limited.';
    }
    return `Endpoint/auth probe returned HTTP ${statusCode}.`;
  }

  private classifyNetworkError(error: unknown): string {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const cause = (error as Record<string, unknown>)?.cause as
      | Record<string, unknown>
      | undefined;
    const causeMsg = (cause?.message as string) || '';
    const causeCode = (cause?.code as string) || '';
    const full = `${errMsg} ${causeMsg} ${causeCode}`.toLowerCase();
    if (full.includes('abort') || full.includes('timeout')) {
      return 'Connection timed out during compatibility test.';
    }
    if (full.includes('enotfound') || full.includes('getaddrinfo')) {
      return 'DNS resolution failed during compatibility test.';
    }
    if (full.includes('econnrefused')) {
      return 'Connection refused during compatibility test.';
    }
    if (full.includes('ssl') || full.includes('cert') || full.includes('tls')) {
      return 'SSL/TLS error during compatibility test.';
    }
    return `Connection error during compatibility test: ${this.sanitize(causeMsg || causeCode || errMsg)}`;
  }

  private isUnsafeHeader(key: string): boolean {
    return ['authorization', 'x-api-key', 'cookie', 'set-cookie', 'host', 'content-length'].includes(
      key.toLowerCase(),
    );
  }

  private sanitize(value: string): string {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/gw_sk_[A-Za-z0-9._~+/-]+/gi, 'gw_sk_[redacted]')
      .replace(/sk-[A-Za-z0-9._~+/-]+/gi, 'sk-[redacted]')
      .slice(0, 300);
  }
}
