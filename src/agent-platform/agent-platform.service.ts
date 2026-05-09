import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProfileService } from '../agent-profiles/agent-profile.service';
import type { AgentProfileSummary } from '../agent-profiles/agent-profile.service';
import { GatewayApiKeyService } from '../auth/gateway-api-key.service';
import type { GatewayApiKeySummary } from '../auth/gateway-api-key.service';
import { CallLog } from '../database/entities/call-log.entity';
import { McpGatewayService } from '../mcp/mcp-gateway.service';
import type { McpGatewayDashboardSummary, McpGatewayServerSummary } from '../mcp/mcp-gateway.service';
import { WorkspaceContextService } from '../workspaces/workspace-context.service';
import { normalizeWorkspaceId } from '../workspaces/workspace-scope';

export interface AgentPlatformResponse {
  version: 'v1';
  preview: true;
  workspace_id: string;
  generated_at: string;
  a2a_hub: AgentPlatformA2aHub;
  tool_registry: AgentPlatformToolRegistry;
  workflow_preview: AgentPlatformWorkflowPreview;
  memory_gateway: AgentPlatformMemoryGateway;
  traces: AgentPlatformTraces;
  privacy: AgentPlatformPrivacyContract;
  totals: {
    agents: number;
    active_agents: number;
    tools: number;
    permitted_tools: number;
    workflows: number;
    recent_spans: number;
  };
}

export interface AgentPlatformA2aHub {
  enabled: true;
  mode: 'workspace_registry';
  routing: {
    policy_enforced: true;
    backend_selection: 'agent_profile_gateway_key';
    bypasses_gateway_policy: false;
  };
  agents: AgentPlatformAgent[];
}

export interface AgentPlatformAgent {
  id: string;
  name: string;
  description: string | null;
  connector: string;
  status: string;
  workspace_id: string;
  api_key_id: string | null;
  api_key_name: string | null;
  api_key_status: string | null;
  namespace_id: string | null;
  namespace_name: string | null;
  default_model: string;
  smart_model_id: string;
  virtual_model_aliases: string[];
  routing_hint: Record<string, unknown> | null;
  mcp_server_ids: string[];
  tool_count: number;
  permitted_tool_count: number;
  route_policy: {
    allow_auto: boolean | null;
    allow_direct: boolean | null;
    allowed_models: string[];
    allowed_endpoints: string[];
  };
}

export interface AgentPlatformToolRegistry {
  enabled: boolean;
  mode: 'mcp_metadata_registry';
  injection: {
    metadata_only: true;
    auto_injection_available: true;
    stores_tool_payloads: false;
  };
  servers: AgentPlatformToolServer[];
}

export interface AgentPlatformToolServer {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  transport: string;
  endpoint: string;
  allowed_namespaces: string[];
  tags: string[];
  linked_profile_ids: string[];
  tools: AgentPlatformTool[];
}

export interface AgentPlatformTool {
  name: string;
  description: string | null;
  has_input_schema: boolean;
  permitted_profile_ids: string[];
  blocked_profile_ids: string[];
  permission: 'permitted' | 'blocked' | 'unlinked';
  policy_reasons: string[];
}

export interface AgentPlatformWorkflowPreview {
  preview: true;
  runtime_enabled: false;
  mode: 'metadata_only';
  promise: 'preview_contract_only';
  workflows: AgentPlatformWorkflow[];
}

export interface AgentPlatformWorkflow {
  id: string;
  name: string;
  description: string;
  status: 'preview';
  runtime_enabled: false;
  profile_ids: string[];
  steps: Array<{
    id: string;
    profile_id: string;
    profile_name: string;
    connector: string;
    order: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: 'ordered';
  }>;
}

export interface AgentPlatformMemoryGateway {
  preview: true;
  enabled: false;
  content_storage_enabled: false;
  metadata_state: {
    session_ids_observed: number;
    turn_ids_observed: number;
    repo_labels_observed: number;
    project_labels_observed: number;
  };
  retention: {
    mode: 'metadata_only';
    content_requires_explicit_opt_in: true;
    redaction_required: true;
  };
}

export interface AgentPlatformTraces {
  metadata_only: true;
  spans: AgentPlatformSpan[];
}

export interface AgentPlatformSpan {
  request_id: string;
  timestamp: string;
  connector: string | null;
  profile_id: string | null;
  profile_name: string | null;
  session_id: string | null;
  turn_id: string | null;
  repo: string | null;
  project: string | null;
  route_decision_id: string;
  fallback: boolean;
  retry_count: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost_usd: number;
  latency_ms: number;
  status_code: number;
}

export interface AgentPlatformPrivacyContract {
  metadata_only: true;
  stores_prompts: false;
  stores_responses: false;
  stores_source_code: false;
  stores_diffs: false;
  stores_tool_payloads: false;
  stores_raw_headers: false;
  stores_provider_keys: false;
  stores_gateway_key_plaintext: false;
  stores_media_bytes: false;
  stores_hidden_reasoning: false;
  stores_resolved_secrets: false;
}

@Injectable()
export class AgentPlatformService {
  constructor(
    private readonly agentProfiles: AgentProfileService,
    private readonly gatewayApiKeys: GatewayApiKeyService,
    private readonly mcp: McpGatewayService,
    private readonly workspaceContext: WorkspaceContextService,
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
  ) {}

  async getDashboardSummary(): Promise<AgentPlatformResponse> {
    const workspaceId = normalizeWorkspaceId(this.workspaceContext.currentWorkspaceId());
    const [profiles, apiKeys, mcpSummary, spans] = await Promise.all([
      this.agentProfiles.list(),
      this.gatewayApiKeys.list(),
      Promise.resolve(this.mcp.getDashboardSummary()),
      this.recentSpans(workspaceId),
    ]);
    const apiKeyById = new Map(apiKeys.map((key) => [key.id, key]));
    const tools = this.buildToolRegistry(profiles, apiKeyById, mcpSummary);
    const toolCounts = this.profileToolCounts(tools);
    const agents = profiles.map((profile) =>
      this.toAgent(profile, apiKeyById.get(profile.api_key_id || ''), toolCounts),
    );
    const permittedToolCount = tools.servers.reduce(
      (sum, server) =>
        sum + server.tools.filter((tool) => tool.permission === 'permitted').length,
      0,
    );

    return {
      version: 'v1',
      preview: true,
      workspace_id: workspaceId,
      generated_at: new Date().toISOString(),
      a2a_hub: {
        enabled: true,
        mode: 'workspace_registry',
        routing: {
          policy_enforced: true,
          backend_selection: 'agent_profile_gateway_key',
          bypasses_gateway_policy: false,
        },
        agents,
      },
      tool_registry: tools,
      workflow_preview: this.buildWorkflowPreview(profiles),
      memory_gateway: this.buildMemoryGateway(spans),
      traces: {
        metadata_only: true,
        spans,
      },
      privacy: this.privacyContract(),
      totals: {
        agents: agents.length,
        active_agents: agents.filter((agent) => agent.status === 'active').length,
        tools: tools.servers.reduce((sum, server) => sum + server.tools.length, 0),
        permitted_tools: permittedToolCount,
        workflows: profiles.length > 0 ? 1 : 0,
        recent_spans: spans.length,
      },
    };
  }

  private toAgent(
    profile: AgentProfileSummary,
    apiKey: GatewayApiKeySummary | undefined,
    toolCounts: Map<string, { total: number; permitted: number }>,
  ): AgentPlatformAgent {
    const counts = toolCounts.get(profile.id) || { total: 0, permitted: 0 };
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      connector: profile.connector,
      status: profile.status,
      workspace_id: profile.workspace_id,
      api_key_id: profile.api_key_id,
      api_key_name: apiKey?.name || profile.api_key?.name || null,
      api_key_status: apiKey?.status || profile.api_key?.status || null,
      namespace_id: profile.namespace_id,
      namespace_name: profile.namespace_name,
      default_model: profile.default_model,
      smart_model_id: profile.smart_model_id,
      virtual_model_aliases: profile.virtual_model_aliases,
      routing_hint: profile.routing_hint,
      mcp_server_ids: profile.mcp_server_ids,
      tool_count: counts.total,
      permitted_tool_count: counts.permitted,
      route_policy: {
        allow_auto: apiKey?.allow_auto ?? profile.api_key?.allow_auto ?? null,
        allow_direct: apiKey?.allow_direct ?? profile.api_key?.allow_direct ?? null,
        allowed_models: apiKey?.allowed_models ?? profile.api_key?.allowed_models ?? [],
        allowed_endpoints: apiKey?.allowed_endpoints ?? [],
      },
    };
  }

  private buildToolRegistry(
    profiles: AgentProfileSummary[],
    apiKeyById: Map<string, GatewayApiKeySummary>,
    mcpSummary: McpGatewayDashboardSummary,
  ): AgentPlatformToolRegistry {
    const servers = mcpSummary.servers.map((server) =>
      this.toToolServer(server, profiles, apiKeyById),
    );
    return {
      enabled: mcpSummary.enabled,
      mode: 'mcp_metadata_registry',
      injection: {
        metadata_only: true,
        auto_injection_available: true,
        stores_tool_payloads: false,
      },
      servers,
    };
  }

  private profileToolCounts(
    registry: AgentPlatformToolRegistry,
  ): Map<string, { total: number; permitted: number }> {
    const counts = new Map<string, { total: number; permitted: number }>();
    const ensure = (profileId: string) => {
      const current = counts.get(profileId);
      if (current) return current;
      const next = { total: 0, permitted: 0 };
      counts.set(profileId, next);
      return next;
    };
    for (const server of registry.servers) {
      for (const profileId of server.linked_profile_ids) {
        ensure(profileId).total += server.tools.length;
      }
      for (const tool of server.tools) {
        for (const profileId of tool.permitted_profile_ids) {
          ensure(profileId).permitted += 1;
        }
      }
    }
    return counts;
  }

  private toToolServer(
    server: McpGatewayServerSummary,
    profiles: AgentProfileSummary[],
    apiKeyById: Map<string, GatewayApiKeySummary>,
  ): AgentPlatformToolServer {
    const linkedProfiles = profiles.filter((profile) =>
      profile.mcp_server_ids.includes(server.id),
    );
    return {
      id: server.id,
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      transport: server.transport,
      endpoint: server.endpoint,
      allowed_namespaces: server.allowed_namespaces,
      tags: server.tags,
      linked_profile_ids: linkedProfiles.map((profile) => profile.id),
      tools: server.tools.map((tool) => {
        const permittedProfileIds: string[] = [];
        const blockedProfileIds: string[] = [];
        const reasons = new Set<string>();
        for (const profile of linkedProfiles) {
          const decision = this.toolPermission(profile, apiKeyById.get(profile.api_key_id || ''), server, tool.name);
          for (const reason of decision.reasons) {
            reasons.add(reason);
          }
          if (decision.allowed) {
            permittedProfileIds.push(profile.id);
          } else {
            blockedProfileIds.push(profile.id);
          }
        }
        return {
          name: tool.name,
          description: tool.description,
          has_input_schema: tool.has_input_schema,
          permitted_profile_ids: permittedProfileIds,
          blocked_profile_ids: blockedProfileIds,
          permission:
            linkedProfiles.length === 0
              ? 'unlinked'
              : permittedProfileIds.length > 0
                ? 'permitted'
                : 'blocked',
          policy_reasons: [...reasons],
        };
      }),
    };
  }

  private toolPermission(
    profile: AgentProfileSummary,
    apiKey: GatewayApiKeySummary | undefined,
    server: McpGatewayServerSummary,
    toolName: string,
  ): { allowed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (profile.status !== 'active') {
      reasons.push('profile_disabled');
      return { allowed: false, reasons };
    }
    if (!apiKey || apiKey.status !== 'active') {
      reasons.push('missing_or_inactive_gateway_key');
      return { allowed: false, reasons };
    }
    if (!server.enabled) {
      reasons.push('server_disabled');
      return { allowed: false, reasons };
    }

    const allowedEndpoints = apiKey.allowed_endpoints || [];
    const endpointAllowed =
      allowedEndpoints.length === 0 ||
      allowedEndpoints.includes('mcp') ||
      allowedEndpoints.includes(`mcp:${server.id}`) ||
      allowedEndpoints.includes(`mcp:${server.id}:${toolName}`);
    if (!endpointAllowed) {
      reasons.push('endpoint_policy_blocks_tool');
    }

    const namespaceAllowed =
      server.allowed_namespaces.length === 0 ||
      Boolean(apiKey.namespace_id && server.allowed_namespaces.includes(apiKey.namespace_id));
    if (!namespaceAllowed) {
      reasons.push(apiKey.namespace_id ? 'namespace_not_allowed' : 'namespace_required');
    }

    if (reasons.length === 0) {
      reasons.push('gateway_key_and_namespace_policy_allow');
    }
    return {
      allowed: endpointAllowed && namespaceAllowed,
      reasons,
    };
  }

  private buildWorkflowPreview(
    profiles: AgentProfileSummary[],
  ): AgentPlatformWorkflowPreview {
    const active = profiles.filter((profile) => profile.status === 'active').slice(0, 4);
    return {
      preview: true,
      runtime_enabled: false,
      mode: 'metadata_only',
      promise: 'preview_contract_only',
      workflows:
        active.length === 0
          ? []
          : [
              {
                id: 'engineering-pr-review-preview',
                name: 'Engineering PR Review Preview',
                description:
                  'Preview-only ordered metadata for coding suggestion, security audit, and summary agent steps.',
                status: 'preview',
                runtime_enabled: false,
                profile_ids: active.map((profile) => profile.id),
                steps: active.map((profile, index) => ({
                  id: `step-${index + 1}`,
                  profile_id: profile.id,
                  profile_name: profile.name,
                  connector: profile.connector,
                  order: index + 1,
                })),
                edges: active.slice(1).map((_profile, index) => ({
                  from: `step-${index + 1}`,
                  to: `step-${index + 2}`,
                  type: 'ordered',
                })),
              },
            ],
    };
  }

  private buildMemoryGateway(spans: AgentPlatformSpan[]): AgentPlatformMemoryGateway {
    return {
      preview: true,
      enabled: false,
      content_storage_enabled: false,
      metadata_state: {
        session_ids_observed: uniqueCount(spans.map((span) => span.session_id)),
        turn_ids_observed: uniqueCount(spans.map((span) => span.turn_id)),
        repo_labels_observed: uniqueCount(spans.map((span) => span.repo)),
        project_labels_observed: uniqueCount(spans.map((span) => span.project)),
      },
      retention: {
        mode: 'metadata_only',
        content_requires_explicit_opt_in: true,
        redaction_required: true,
      },
    };
  }

  private async recentSpans(workspaceId: string): Promise<AgentPlatformSpan[]> {
    const qb = this.callLogRepo
      .createQueryBuilder('log')
      .where(
        '(log.agent_profile_id IS NOT NULL OR log.agent_session_id IS NOT NULL OR log.agent_connector IS NOT NULL)',
      )
      .orderBy('log.timestamp', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .take(25);
    if (workspaceId === 'default-workspace') {
      qb.andWhere('(log.workspace_id = :workspaceId OR log.workspace_id IS NULL)', { workspaceId });
    } else {
      qb.andWhere('log.workspace_id = :workspaceId', { workspaceId });
    }
    const logs = await qb.getMany();
    return logs.map((log) => ({
      request_id: log.request_id,
      timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : String(log.timestamp),
      connector: log.agent_connector || null,
      profile_id: log.agent_profile_id || null,
      profile_name: log.agent_profile_name || null,
      session_id: log.agent_session_id || null,
      turn_id: log.agent_turn_id || null,
      repo: log.agent_repo || null,
      project: log.agent_project || null,
      route_decision_id: log.request_id,
      fallback: Boolean(log.is_fallback),
      retry_count: log.retry_count || 0,
      tokens: {
        input: log.input_tokens || 0,
        output: log.output_tokens || 0,
        total: (log.input_tokens || 0) + (log.output_tokens || 0),
      },
      cost_usd: Number(Number(log.cost_usd || 0).toFixed(6)),
      latency_ms: log.latency_ms || 0,
      status_code: log.status_code || 0,
    }));
  }

  private privacyContract(): AgentPlatformPrivacyContract {
    return {
      metadata_only: true,
      stores_prompts: false,
      stores_responses: false,
      stores_source_code: false,
      stores_diffs: false,
      stores_tool_payloads: false,
      stores_raw_headers: false,
      stores_provider_keys: false,
      stores_gateway_key_plaintext: false,
      stores_media_bytes: false,
      stores_hidden_reasoning: false,
      stores_resolved_secrets: false,
    };
  }
}

function uniqueCount(values: Array<string | null>): number {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}
