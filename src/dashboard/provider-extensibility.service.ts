import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '../config/config.service';
import type { AuthType, ModelPricing, NodeConfig, NodeProtocol } from '../config/gateway.config';
import type { Modality } from '../config/modality';
import { ActiveHealthProbeService } from '../routing/active-health-probe.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '../routing/circuit-breaker.service';
import { CallLog } from '../database/entities';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { applyWorkspaceQueryScope } from '../workspaces/workspace-scope';
import { assessCatalogPricing } from '../catalog/catalog.service';
import type { CatalogPricing } from '../catalog/catalog.types';
import type {
  CustomProviderTemplatePreviewDto,
  ProviderSdkGeneratorDto,
  ProviderTemplatePricingRowDto,
} from './dto/provider-extensibility.dto';

type ProviderExtensibilityIssueSeverity = 'error' | 'warning' | 'info';
type ProviderHealthWindow = '1h' | '24h' | '7d';

export interface ProviderExtensibilityIssue {
  severity: ProviderExtensibilityIssueSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface ProviderHealthMetrics {
  calls: number;
  success: number;
  errors: number;
  error_rate: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_seen_at: string | null;
}

@Injectable()
export class ProviderExtensibilityService {
  constructor(
    private readonly config: ConfigService,
    private readonly activeHealth: ActiveHealthProbeService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly workspaceContext: WorkspaceContextService,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  previewCustomProviderTemplate(dto: CustomProviderTemplatePreviewDto) {
    const issues = this.validateTemplate(dto);
    const providerId = normalizeId(dto.provider_id);
    const providerName = dto.provider_name?.trim() || providerId;
    const protocol = dto.protocol || 'chat_completions';
    const endpoint = this.primaryEndpoint(dto, protocol);
    const modelIds = unique(dto.models || []);
    const pricingRows = this.pricingRows(dto.pricing, modelIds);
    const authType = (dto.auth_type || defaultAuthType(protocol)) as AuthType | 'none';
    const compatibilityProfiles = unique(dto.compatibility_profiles || []);
    const capabilities = unique(dto.capabilities || []);
    const tags = unique(['custom', ...(dto.tags || [])]);
    const manifestEndpoints = this.sanitizedEndpoints(dto.endpoints, protocol);
    const now = new Date().toISOString();

    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      beta: true,
      issues,
      node_preview: {
        id: providerId,
        name: providerName,
        protocol,
        base_url: safeBaseUrl(dto.base_url),
        endpoint,
        auth_type: authType === 'none' ? undefined : authType,
        auth_header_name:
          authType === 'custom-header' ? dto.auth_header_name?.trim() || null : null,
        auth_header_prefix:
          authType === 'custom-header' ? dto.auth_header_prefix?.trim() || null : null,
        api_key: '${env:PROVIDER_API_KEY}',
        models: modelIds,
        endpoints: manifestEndpoints,
        embeddings_endpoint: manifestEndpoints.embeddings,
        rerank_endpoint: manifestEndpoints.rerank,
        images_generations_endpoint: manifestEndpoints.image_generations,
        images_edits_endpoint: manifestEndpoints.image_edits,
        images_variations_endpoint: manifestEndpoints.image_variations,
        audio_transcriptions_endpoint: manifestEndpoints.audio_transcriptions,
        audio_speech_endpoint: manifestEndpoints.audio_speech,
        video_generations_endpoint: manifestEndpoints.video_generations,
        video_status_endpoint: manifestEndpoints.video_status,
        realtime_endpoint: manifestEndpoints.realtime,
        compatibility_profile: compatibilityProfiles,
        capabilities,
        tags,
        model_capabilities: Object.fromEntries(
          pricingRows.map((row) => [
            row.model,
            {
              modalities: this.modalitiesForProtocol(protocol),
              endpoints: { [protocol]: endpoint },
              pricing: this.modelPricing(row),
            },
          ]),
        ),
        health_check: this.healthCheckPreview(dto),
      },
      catalog_manifest_preview: {
        version: 1,
        providers: {
          [providerId]: {
            name: providerName,
            status: 'custom',
            provider_type: 'direct',
            family: 'custom',
            base_url: safeBaseUrl(dto.base_url),
            auth_type: authType,
            endpoints: manifestEndpoints,
            compatibility_profiles: compatibilityProfiles,
            capabilities,
            tags,
            pricing: {
              source: 'operator_override',
              source_type: 'operator_override',
              last_updated: now.slice(0, 10),
              manual_review_required: true,
              pricing_confidence: 'unknown',
            },
            models: modelIds.map((model) => ({
              id: model,
              modalities: this.modalitiesForProtocol(protocol),
              endpoints: { [protocol]: endpoint },
              capabilities,
              pricing: this.catalogPricingForModel(
                pricingRows.find((row) => row.model === model),
                now,
              ),
            })),
          },
        },
      },
      privacy: providerExtensibilityPrivacy(),
    };
  }

  generateProviderSdk(dto: ProviderSdkGeneratorDto) {
    const preview = this.previewCustomProviderTemplate(dto);
    const providerId = normalizeId(dto.provider_id);
    const className = `${toPascalCase(providerId)}ProviderAdapter`;
    const manifest = JSON.stringify(preview.catalog_manifest_preview, null, 2);
    const adapter = [
      `export class ${className} {`,
      `  readonly providerId = '${providerId}';`,
      '',
      '  constructor(private readonly baseUrl: string) {}',
      '',
      '  buildChatRequest(model: string, messages: unknown[]) {',
      '    return {',
      `      url: this.baseUrl.replace(/\\/+$/, '') + '${preview.node_preview.endpoint}',`,
      "      method: 'POST' as const,",
      '      body: { model, messages, stream: false },',
      '    };',
      '  }',
      '}',
      '',
    ].join('\n');
    const test = [
      `import { ${className} } from './adapter';`,
      '',
      `describe('${className}', () => {`,
      '  it(\'maps a basic chat request without provider secrets\', () => {',
      `    const adapter = new ${className}('https://provider.example');`,
      "    const request = adapter.buildChatRequest('test-model', [{ role: 'user', content: 'hi' }]);",
      `    expect(request.url).toContain('${preview.node_preview.endpoint}');`,
      "    expect(JSON.stringify(request)).not.toContain('provider-secret');",
      '  });',
      '});',
      '',
    ].join('\n');
    const readme = [
      `# ${preview.node_preview.name} Provider Adapter`,
      '',
      'Generated by SiftGate Provider SDK Generator beta.',
      '',
      'Manual review is required before this adapter is merged or trusted in production.',
      'Verify endpoint mapping, auth behavior, usage schema, pricing source, streaming behavior, and compatibility profile evidence.',
      '',
      'Do not commit provider keys, resolved secrets, raw request headers, prompts, responses, media bytes, or tool payloads.',
      '',
    ].join('\n');

    return {
      beta: true,
      manual_review_required: true,
      provider_id: providerId,
      language: dto.language || 'typescript',
      issues: preview.issues,
      files: [
        { path: `${providerId}/manifest.json`, language: 'json', content: manifest },
        { path: `${providerId}/adapter.ts`, language: 'typescript', content: adapter },
        { path: `${providerId}/adapter.spec.ts`, language: 'typescript', content: test },
        { path: `${providerId}/README.md`, language: 'markdown', content: readme },
      ],
      review_checklist: [
        'Confirm compatibility profile evidence with a mocked request/response test.',
        'Verify pricing from provider docs or account-specific billing before enabling cost routing.',
        'Add usage schema coverage if the provider uses non-standard token fields.',
        'Run generated tests plus the provider compatibility matrix before submitting a registry PR.',
      ],
      privacy: providerExtensibilityPrivacy(),
    };
  }

  async providerHealthSummary(period: string = '24h') {
    const normalizedPeriod = normalizePeriod(period);
    const since = new Date(Date.now() - periodToMs(normalizedPeriod));
    const rows = await this.loadRecentLogs(since);
    const byNode = new Map<string, CallLog[]>();
    for (const row of rows) {
      if (!byNode.has(row.node_id)) byNode.set(row.node_id, []);
      byNode.get(row.node_id)!.push(row);
    }

    const nodes = this.config.nodes.map((node) => {
      const activeProbe = this.activeHealth.getNodeStatus(node.id);
      const circuit = this.circuitBreaker.getNodeStatus(node.id);
      const metrics = summarizeHealthMetrics(byNode.get(node.id) || []);
      const pricingWarnings = this.pricingWarnings(node);
      const status = this.nodeAvailabilityStatus(
        activeProbe.status,
        circuit.state,
        metrics,
      );
      return {
        node_id: node.id,
        provider_name: node.name,
        base_url_host: hostFromUrl(node.base_url),
        protocol: node.protocol,
        availability_status: status,
        health_probe: activeProbe,
        circuit: {
          state: circuit.state,
          consecutive_failures: circuit.consecutiveFailures,
          last_failure_at: circuit.lastFailureAt
            ? new Date(circuit.lastFailureAt).toISOString()
            : null,
        },
        metrics,
        compatibility_profiles: node.compatibility_profile
          ? Array.isArray(node.compatibility_profile)
            ? node.compatibility_profile
            : [node.compatibility_profile]
          : [],
        pricing_warnings: pricingWarnings,
        auth: {
          type: node.auth_type || defaultAuthType(node.protocol),
          custom_header_name:
            node.auth_type === 'custom-header' ? node.auth_header_name || null : null,
          provider_key_returned: false,
        },
      };
    });

    const totals = nodes.reduce(
      (acc, node) => {
        acc.calls += node.metrics.calls;
        acc.errors += node.metrics.errors;
        if (node.availability_status === 'healthy') acc.healthy_nodes += 1;
        if (node.availability_status === 'degraded') acc.degraded_nodes += 1;
        if (node.availability_status === 'unhealthy') acc.unhealthy_nodes += 1;
        acc.pricing_warning_count += node.pricing_warnings.length;
        return acc;
      },
      {
        nodes: nodes.length,
        healthy_nodes: 0,
        degraded_nodes: 0,
        unhealthy_nodes: 0,
        calls: 0,
        errors: 0,
        pricing_warning_count: 0,
      },
    );

    return {
      period: normalizedPeriod,
      generated_at: new Date().toISOString(),
      workspace_id: this.workspaceContext.currentWorkspaceId(),
      totals: {
        ...totals,
        error_rate: totals.calls > 0 ? round((totals.errors / totals.calls) * 100, 1) : 0,
      },
      nodes,
      privacy: providerExtensibilityPrivacy(),
    };
  }

  private async loadRecentLogs(since: Date): Promise<CallLog[]> {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where('log.timestamp >= :since', { since })
      .orderBy('log.timestamp', 'DESC')
      .take(5000);
    applyWorkspaceQueryScope(qb, 'log', this.workspaceContext.currentWorkspaceId());
    return qb.getMany();
  }

  private validateTemplate(dto: CustomProviderTemplatePreviewDto): ProviderExtensibilityIssue[] {
    const issues: ProviderExtensibilityIssue[] = [];
    const providerId = normalizeId(dto.provider_id);
    if (!providerId) {
      issues.push(issue('error', 'provider_id_required', 'Provider id is required.', 'provider_id'));
    } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(providerId)) {
      issues.push(
        issue(
          'error',
          'provider_id_invalid',
          'Provider id must use letters, numbers, dot, underscore, or dash.',
          'provider_id',
        ),
      );
    }
    if (!dto.provider_name?.trim()) {
      issues.push(issue('error', 'provider_name_required', 'Provider name is required.', 'provider_name'));
    }
    try {
      const parsed = new URL(dto.base_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        issues.push(issue('error', 'base_url_protocol_invalid', 'Base URL must use http or https.', 'base_url'));
      }
    } catch {
      issues.push(issue('error', 'base_url_invalid', 'Base URL must be an absolute URL.', 'base_url'));
    }
    const authType = dto.auth_type || defaultAuthType(dto.protocol);
    if (authType === 'custom-header' && !dto.auth_header_name?.trim()) {
      issues.push(
        issue(
          'error',
          'custom_auth_header_required',
          'Custom header auth requires a header name.',
          'auth_header_name',
        ),
      );
    }
    if (authType !== 'custom-header' && (dto.auth_header_name || dto.auth_header_prefix)) {
      issues.push(
        issue(
          'warning',
          'custom_auth_header_ignored',
          'Custom auth header fields are used only when auth_type is custom-header.',
          'auth_header_name',
        ),
      );
    }
    if (unique(dto.models || []).length === 0) {
      issues.push(issue('error', 'models_required', 'At least one model id is required.', 'models'));
    }
    for (const [key, value] of Object.entries(dto.endpoints || {})) {
      if (!value || typeof value !== 'string' || !value.startsWith('/')) {
        issues.push(
          issue(
            'error',
            'endpoint_path_invalid',
            `Endpoint "${key}" must be a path beginning with "/".`,
            `endpoints.${key}`,
          ),
        );
      }
    }
    for (const row of dto.pricing || []) {
      if (!row.model?.trim()) {
        issues.push(issue('warning', 'pricing_model_missing', 'Pricing row without a model is ignored.', 'pricing'));
      }
      if (!row.source_url) {
        issues.push(
          issue(
            'warning',
            'pricing_source_missing',
            `Pricing for "${row.model || 'unknown'}" has no source URL and must be reviewed.`,
            'pricing',
          ),
        );
      }
    }
    issues.push(
      issue(
        'info',
        'manual_review_required',
        'Custom provider templates and generated adapters are beta artifacts that require manual review.',
      ),
    );
    return issues;
  }

  private primaryEndpoint(
    dto: CustomProviderTemplatePreviewDto,
    protocol: NodeProtocol,
  ): string {
    return (
      dto.endpoints?.[protocol] ||
      (protocol === 'responses'
        ? '/v1/responses'
        : protocol === 'messages'
          ? '/v1/messages'
          : '/v1/chat/completions')
    );
  }

  private sanitizedEndpoints(
    endpoints: Record<string, string> | undefined,
    protocol: NodeProtocol,
  ): Record<string, string> {
    const values = Object.fromEntries(
      Object.entries(endpoints || {})
        .map(([key, value]) => [key.trim(), value.trim()] as const)
        .filter(([key, value]) => key && value.startsWith('/')),
    );
    values[protocol] = values[protocol] || this.primaryEndpoint({ endpoints } as any, protocol);
    return values;
  }

  private pricingRows(
    rows: ProviderTemplatePricingRowDto[] | undefined,
    allowedModels: string[],
  ): ProviderTemplatePricingRowDto[] {
    const allowed = new Set(allowedModels);
    return (rows || [])
      .filter((row) => row.model?.trim() && allowed.has(row.model.trim()))
      .map((row) => ({ ...row, model: row.model.trim() }));
  }

  private modelPricing(row: ProviderTemplatePricingRowDto): Partial<ModelPricing> {
    return {
      input: row.input_per_1m_tokens ?? 0,
      output: row.output_per_1m_tokens ?? 0,
      input_per_1m_tokens: row.input_per_1m_tokens,
      output_per_1m_tokens: row.output_per_1m_tokens,
      source: row.source || 'operator_override',
      source_url: row.source_url,
      currency: 'USD',
      manual_review_required: true,
      pricing_confidence: 'unknown',
    };
  }

  private catalogPricingForModel(
    row: ProviderTemplatePricingRowDto | undefined,
    now: string,
  ): CatalogPricing {
    return {
      input: row?.input_per_1m_tokens,
      output: row?.output_per_1m_tokens,
      input_per_1m_tokens: row?.input_per_1m_tokens,
      output_per_1m_tokens: row?.output_per_1m_tokens,
      unit: '1m_tokens',
      currency: 'USD',
      source: row?.source || 'operator_override',
      source_type: 'operator_override',
      source_url: row?.source_url,
      last_updated: now.slice(0, 10),
      manual_review_required: true,
      pricing_confidence: 'unknown',
      stale_after_days: 30,
    };
  }

  private healthCheckPreview(dto: CustomProviderTemplatePreviewDto) {
    if (!dto.health_probe?.enabled) return undefined;
    const method = dto.health_probe.method || 'HEAD';
    return {
      enabled: true,
      method,
      path: dto.health_probe.path || '/health',
      lightweight_model: dto.health_probe.lightweight_model,
    };
  }

  private modalitiesForProtocol(protocol: NodeProtocol): Modality[] {
    if (protocol === 'messages' || protocol === 'responses') return ['text'];
    return ['text'];
  }

  private pricingWarnings(node: NodeConfig): string[] {
    const warnings: string[] = [];
    const models = unique([
      ...node.models,
      ...(node.embedding_models || []),
      ...(node.rerank_models || []),
      ...(node.image_models || []),
      ...(node.audio_models || []),
      ...(node.video_models || []),
      ...(node.realtime_models || []),
    ]);
    for (const model of models) {
      const pricing = this.config.getModelPricing(model, node.id) as
        | (ModelPricing & { pricing_confidence?: string; manual_review_required?: boolean })
        | undefined;
      if (!pricing) {
        warnings.push(`${model}: missing pricing`);
        continue;
      }
      const hygiene = assessCatalogPricing(pricing as CatalogPricing, ['text']);
      if (pricing.manual_review_required || hygiene.manual_review_required) {
        warnings.push(`${model}: manual pricing review required`);
      } else if (hygiene.stale) {
        warnings.push(`${model}: pricing source may be stale`);
      } else if (pricing.pricing_confidence === 'low' || pricing.pricing_confidence === 'unknown') {
        warnings.push(`${model}: low-confidence pricing source`);
      }
    }
    return unique(warnings).slice(0, 8);
  }

  private nodeAvailabilityStatus(
    probeStatus: string,
    circuitState: CircuitState,
    metrics: ProviderHealthMetrics,
  ): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
    if (probeStatus === 'unhealthy' || circuitState === CircuitState.OPEN) return 'unhealthy';
    if (circuitState === CircuitState.HALF_OPEN || metrics.error_rate >= 25) return 'degraded';
    if (probeStatus === 'healthy' || metrics.calls > 0) return 'healthy';
    return 'unknown';
  }
}

function summarizeHealthMetrics(rows: CallLog[]): ProviderHealthMetrics {
  const calls = rows.length;
  const errors = rows.filter((row) => row.status_code >= 400).length;
  const success = calls - errors;
  const latencies = rows
    .map((row) => row.latency_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  return {
    calls,
    success,
    errors,
    error_rate: calls > 0 ? round((errors / calls) * 100, 1) : 0,
    avg_latency_ms:
      latencies.length > 0
        ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
        : null,
    p95_latency_ms: percentile(latencies, 0.95),
    last_seen_at:
      rows
        .map((row) => row.timestamp?.toISOString?.() || String(row.timestamp))
        .filter(Boolean)
        .sort()
        .pop() || null,
  };
}

function normalizePeriod(period: string): ProviderHealthWindow {
  if (period === '1h' || period === '7d') return period;
  return '24h';
}

function periodToMs(period: ProviderHealthWindow): number {
  if (period === '1h') return 60 * 60 * 1000;
  if (period === '7d') return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.ceil(values.length * p) - 1);
  return values[index];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeId(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function safeBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value;
  }
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function defaultAuthType(protocol: NodeProtocol): AuthType {
  return protocol === 'messages' ? 'x-api-key' : 'bearer';
}

function issue(
  severity: ProviderExtensibilityIssueSeverity,
  code: string,
  message: string,
  path?: string,
): ProviderExtensibilityIssue {
  return { severity, code, message, path };
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'Custom';
}

function providerExtensibilityPrivacy() {
  return {
    prompt: false,
    response: false,
    raw_headers: false,
    provider_keys: false,
    media_bytes: false,
    source_code: false,
    diffs: false,
    tool_payloads: false,
    hidden_reasoning: false,
    storage: 'metadata_only',
  };
}
