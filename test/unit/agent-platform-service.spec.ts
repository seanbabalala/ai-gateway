import { AgentPlatformService } from '../../src/agent-platform/agent-platform.service';
import { CallLog } from '../../src/database/entities/call-log.entity';

function makeCallLogRepo(logs: Partial<CallLog>[] = []) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(logs),
  };
  return {
    qb,
    repo: {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    },
  };
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    workspace_id: 'default-workspace',
    name: 'Code Review Agent',
    description: 'Review PRs',
    connector: 'codex',
    status: 'active',
    api_key_id: 'key-1',
    api_key: {
      id: 'key-1',
      name: 'agent-key',
      key_prefix: 'gw_sk_redacted...1234',
      status: 'active',
      allow_auto: true,
      allow_direct: false,
      allowed_models: [],
      namespace_id: 'team-a',
      namespace_name: 'Team A',
    },
    namespace_id: 'team-a',
    namespace_name: 'Team A',
    default_model: 'auto',
    smart_model_id: 'coding-auto',
    virtual_model_aliases: ['coding-auto', 'coding-security'],
    base_url_mode: 'openai_v1',
    routing_hint: { task: 'code_review' },
    mcp_server_ids: ['local-tools'],
    metadata: { owner: 'eng' },
    last_generated_at: null,
    created_at: new Date('2026-05-09T00:00:00.000Z'),
    updated_at: new Date('2026-05-09T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService({
  profiles = [makeProfile()],
  keys = [
    {
      id: 'key-1',
      name: 'agent-key',
      description: null,
      key_prefix: 'gw_sk_redacted...1234',
      status: 'active',
      workspace_id: 'default-workspace',
      allow_auto: true,
      allow_direct: false,
      allowed_nodes: [],
      allowed_models: [],
      allowed_endpoints: ['mcp:local-tools:search_docs'],
      allowed_modalities: [],
      namespace_id: 'team-a',
      namespace_name: 'Team A',
      team_id: null,
      team_name: null,
      daily_token_limit: null,
      daily_cost_limit: null,
      rate_limit_per_minute: null,
      created_at: new Date('2026-05-09T00:00:00.000Z'),
      updated_at: new Date('2026-05-09T00:00:00.000Z'),
      last_used_at: null,
      last_used_ip: null,
      today: {
        calls: 0,
        errors: 0,
        error_rate: 0,
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  ],
  mcpSummary = {
    enabled: true,
    path: '/mcp',
    metadata_only: true,
    servers: [
      {
        id: 'local-tools',
        name: 'Local Tools',
        description: 'Local tool registry',
        enabled: true,
        transport: 'http_json_rpc',
        endpoint: 'http://mcp.local/rpc',
        allowed_namespaces: ['team-a'],
        stdio_env_policy: null,
        tools: [
          {
            name: 'search_docs',
            description: 'Search docs',
            has_input_schema: true,
          },
          {
            name: 'delete_repo',
            description: 'Delete repo',
            has_input_schema: true,
          },
        ],
        tags: ['code'],
        recent_calls: 0,
        recent_errors: 0,
        last_called_at: null,
      },
    ],
    recent_calls: [],
    error_summary: [],
    denial_summary: [],
    totals: {
      servers: 1,
      enabled_servers: 1,
      tools: 2,
      recent_calls: 0,
      recent_errors: 0,
    },
  },
  logs = [],
  workspaceId = 'default-workspace',
}: {
  profiles?: any[];
  keys?: any[];
  mcpSummary?: any;
  logs?: Partial<CallLog>[];
  workspaceId?: string;
} = {}) {
  const { repo, qb } = makeCallLogRepo(logs);
  const service = new AgentPlatformService(
    { list: jest.fn().mockResolvedValue(profiles) } as any,
    { list: jest.fn().mockResolvedValue(keys) } as any,
    { getDashboardSummary: jest.fn().mockReturnValue(mcpSummary) } as any,
    { currentWorkspaceId: jest.fn(() => workspaceId) } as any,
    repo as any,
  );
  return { service, qb };
}

describe('AgentPlatformService', () => {
  it('builds workspace-scoped A2A registry and MCP tool permissions from existing profiles', async () => {
    const { service } = makeService();

    const summary = await service.getDashboardSummary();

    expect(summary.preview).toBe(true);
    expect(summary.workspace_id).toBe('default-workspace');
    expect(summary.a2a_hub.routing).toEqual({
      policy_enforced: true,
      backend_selection: 'agent_profile_gateway_key',
      bypasses_gateway_policy: false,
    });
    expect(summary.a2a_hub.agents[0]).toMatchObject({
      id: 'profile-1',
      tool_count: 2,
      permitted_tool_count: 1,
      route_policy: {
        allow_auto: true,
        allow_direct: false,
        allowed_endpoints: ['mcp:local-tools:search_docs'],
      },
    });
    expect(summary.tool_registry.servers[0].tools).toEqual([
      expect.objectContaining({
        name: 'search_docs',
        permission: 'permitted',
        permitted_profile_ids: ['profile-1'],
      }),
      expect.objectContaining({
        name: 'delete_repo',
        permission: 'blocked',
        blocked_profile_ids: ['profile-1'],
        policy_reasons: ['endpoint_policy_blocks_tool'],
      }),
    ]);
  });

  it('marks workflow and memory features as preview-only with content storage disabled', async () => {
    const { service } = makeService();

    const summary = await service.getDashboardSummary();

    expect(summary.workflow_preview).toMatchObject({
      preview: true,
      runtime_enabled: false,
      mode: 'metadata_only',
      promise: 'preview_contract_only',
    });
    expect(summary.workflow_preview.workflows[0]).toMatchObject({
      id: 'engineering-pr-review-preview',
      status: 'preview',
      runtime_enabled: false,
      profile_ids: ['profile-1'],
    });
    expect(summary.memory_gateway).toMatchObject({
      preview: true,
      enabled: false,
      content_storage_enabled: false,
      retention: {
        mode: 'metadata_only',
        content_requires_explicit_opt_in: true,
        redaction_required: true,
      },
    });
  });

  it('returns metadata-only trace spans and does not expose prompts, responses, source, or tool payloads', async () => {
    const { service } = makeService({
      logs: [
        {
          request_id: 'req-1',
          timestamp: new Date('2026-05-09T00:00:00.000Z'),
          workspace_id: 'default-workspace',
          agent_connector: 'codex',
          agent_profile_id: 'profile-1',
          agent_profile_name: 'Code Review Agent',
          agent_session_id: 'sess-1',
          agent_turn_id: 'turn-1',
          agent_repo: 'api',
          agent_project: 'gateway',
          input_tokens: 10,
          output_tokens: 5,
          cost_usd: 0.00123456,
          latency_ms: 123,
          status_code: 200,
          is_fallback: true,
          retry_count: 1,
          error: 'prompt secret and tool payload must not leak',
        },
      ],
    });

    const summary = await service.getDashboardSummary();
    const serialized = JSON.stringify(summary);

    expect(summary.traces.spans[0]).toMatchObject({
      request_id: 'req-1',
      connector: 'codex',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      repo: 'api',
      project: 'gateway',
      fallback: true,
      retry_count: 1,
      tokens: { input: 10, output: 5, total: 15 },
      cost_usd: 0.001235,
    });
    expect(summary.privacy).toMatchObject({
      metadata_only: true,
      stores_prompts: false,
      stores_responses: false,
      stores_source_code: false,
      stores_diffs: false,
      stores_tool_payloads: false,
      stores_raw_headers: false,
      stores_provider_keys: false,
      stores_gateway_key_plaintext: false,
    });
    expect(serialized).not.toContain('prompt secret');
    expect(serialized).not.toContain('tool payload must not leak');
  });

  it('scopes recent span queries to the active workspace', async () => {
    const { service, qb } = makeService({ workspaceId: 'workspace-b' });

    await service.getDashboardSummary();

    expect(qb.andWhere).toHaveBeenCalledWith('log.workspace_id = :workspaceId', {
      workspaceId: 'workspace-b',
    });
  });
});
