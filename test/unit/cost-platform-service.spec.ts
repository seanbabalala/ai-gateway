import { CostPlatformService } from '../../src/cost-platform/cost-platform.service';
import type {
  CallLog,
  RouteDecisionLog,
  RouteFeedback,
} from '../../src/database/entities';

function makeQueryBuilder<T>(rows: T[], one: T | null = rows[0] || null) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getOne: jest.fn().mockResolvedValue(one),
  };
}

function makeRepo<T>(rows: T[] = [], one: T | null = rows[0] || null) {
  const qb = makeQueryBuilder(rows, one);
  return {
    qb,
    repo: {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    },
  };
}

function makeCallLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 1,
    request_id: 'req-1',
    timestamp: new Date(),
    source_format: 'chat_completions',
    tier: 'standard',
    score: 0.5,
    node_id: 'node-a',
    model: 'gpt-4o-mini',
    input_tokens: 100,
    output_tokens: 50,
    cost_usd: 0.01,
    cost_without_cache_usd: 0.012,
    latency_ms: 250,
    stream: false,
    status_code: 200,
    is_fallback: false,
    fallback_reason: null,
    structured_output_requested: false,
    structured_output_type: null,
    structured_output_strategy: null,
    structured_output_supported: null,
    structured_output_schema_name: null,
    reasoning_requested: false,
    reasoning_effort: null,
    reasoning_strategy: null,
    reasoning_supported: null,
    reasoning_budget_tokens: null,
    reasoning_source: null,
    reasoning_reason: null,
    media_type: null,
    media_operation: null,
    media_multipart: null,
    media_file_count: null,
    media_byte_size: null,
    media_requested_format: null,
    media_response_format: null,
    media_provider_response_type: null,
    session_id: null,
    session_key: null,
    trace_id: null,
    error: null,
    workspace_id: 'default-workspace',
    api_key_name: 'prod-key',
    api_key_id: 'key-prod',
    namespace_id: null,
    team_id: 'team-platform',
    agent_connector: 'codex',
    agent_profile_id: 'agent-1',
    agent_profile_name: 'Code Review',
    agent_virtual_model: 'coding-auto',
    agent_requested_model: 'coding-auto',
    agent_session_id: 'session-1',
    agent_turn_id: 'turn-1',
    agent_repo: null,
    agent_project: 'gateway',
    retry_count: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    semantic_cache_hit: false,
    semantic_cache_score: null,
    experiment_group: null,
    intelligence_optimizer_applied: false,
    intelligence_estimated_cost_usd: null,
    intelligence_estimated_savings_usd: null,
    token_prediction_risk: null,
    quality_gate_status: null,
    async_eval_queued: false,
    ...overrides,
  } as CallLog;
}

function makeDecision(overrides: Partial<RouteDecisionLog> = {}): RouteDecisionLog {
  return {
    id: 1,
    request_id: 'req-feedback',
    timestamp: new Date(),
    source_format: 'chat_completions',
    tier: 'standard',
    score: 0.5,
    route_mode: 'auto',
    strategy: 'balanced',
    selected_node_id: 'node-a',
    selected_model: 'gpt-4o-mini',
    domain_hint: null,
    candidate_count: 2,
    filtered_count: 0,
    status_code: 200,
    is_fallback: false,
    fallback_reason: null,
    session_id: null,
    trace_id: null,
    workspace_id: 'default-workspace',
    api_key_name: 'prod-key',
    api_key_id: 'key-prod',
    namespace_id: null,
    agent_connector: 'codex',
    agent_profile_id: 'agent-1',
    agent_profile_name: 'Code Review',
    agent_virtual_model: 'coding-auto',
    agent_requested_model: 'coding-auto',
    agent_session_id: 'session-1',
    agent_turn_id: 'turn-1',
    agent_repo: null,
    agent_project: 'gateway',
    intelligence_optimizer_applied: true,
    token_prediction_risk: null,
    quality_gate_status: null,
    async_eval_queued: false,
    trace_json: JSON.stringify({
      mode: 'auto',
      candidate_targets: [
        { node: 'node-a', model: 'gpt-4o-mini', selected: true, weight: 0.8, scores: { cost: 0.9 } },
        { node: 'node-b', model: 'gpt-4o', selected: false, weight: 0.4 },
      ],
      intelligence: {
        optimizer: {
          applied: true,
          objective: 'balanced',
          reason: 'lower cost at comparable quality',
        },
      },
    }),
    ...overrides,
  } as RouteDecisionLog;
}

function makeFeedback(overrides: Partial<RouteFeedback> = {}): RouteFeedback {
  return {
    id: 'fb-1',
    workspace_id: 'default-workspace',
    request_id: 'req-feedback',
    route_decision_id: 'req-feedback',
    api_key_id: 'key-prod',
    api_key_name: 'prod-key',
    team_id: 'team-platform',
    value: 'up',
    reason_code: 'helpful',
    source: 'gateway_api',
    route_weight_evidence_json: null,
    created_at: new Date(),
    ...overrides,
  } as RouteFeedback;
}

function makeService({
  logs = [],
  decisions = [],
  feedbackRows = [],
}: {
  logs?: CallLog[];
  decisions?: RouteDecisionLog[];
  feedbackRows?: RouteFeedback[];
} = {}) {
  const callLog = makeRepo<CallLog>(logs);
  const decision = makeRepo<RouteDecisionLog>(decisions, decisions[0] || null);
  const feedback = makeRepo<RouteFeedback>(feedbackRows);
  const alerts = { emit: jest.fn() };
  const service = new CostPlatformService(
    callLog.repo as any,
    decision.repo as any,
    feedback.repo as any,
    {
      budget: { daily_cost_limit: 10, alert_threshold: 0.8 },
      nodes: [
        {
          id: 'node-a',
          models: ['gpt-4o-mini'],
        },
      ],
      getModelPricing: jest.fn(() => ({
        input: 0.15,
        output: 0.6,
        source: 'operator_rate_card',
        source_url: 'https://internal.example/rates',
        pricing_used_from: 'gateway_config',
        manual_review_required: false,
        pricing_confidence: 'high',
      })),
    } as any,
    { currentWorkspaceId: jest.fn(() => 'default-workspace') } as any,
    {
      load: jest.fn(() => ({ catalog: { providers: [] } })),
    } as any,
    {
      getStatus: jest.fn(() => ({
        enabled: true,
        scheduled: true,
        write_to: 'cache',
        supported_adapters: ['openrouter', 'zeroeval'],
        enabled_adapters: ['openrouter'],
        providers: [],
      })),
    } as any,
    alerts as any,
  );
  return { service, callLog, decision, feedback, alerts };
}

describe('CostPlatformService', () => {
  it('aggregates internal chargeback by team, project, model, and invoice summary', async () => {
    const { service } = makeService({
      logs: [
        makeCallLog({ request_id: 'req-1', team_id: 'team-a', agent_project: 'gateway', cost_usd: 1.25, input_tokens: 100, output_tokens: 40 }),
        makeCallLog({ request_id: 'req-2', team_id: 'team-a', agent_project: 'gateway', cost_usd: 0.75, input_tokens: 50, output_tokens: 10, intelligence_estimated_savings_usd: 0.2 }),
        makeCallLog({ request_id: 'req-3', team_id: 'team-b', agent_project: 'docs', cost_usd: 0.5, status_code: 500 }),
      ],
    });

    const byTeam = await service.getDashboardSummary({ period: '30d', group_by: 'team' });
    expect(byTeam.chargeback.summary).toMatchObject({
      requests: 3,
      successful_requests: 2,
      failed_requests: 1,
      total_tokens: 350,
      cost_usd: 2.5,
      estimated_savings_usd: 0.2,
    });
    expect(byTeam.chargeback.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_value: 'team-a', cost_usd: 2 }),
        expect.objectContaining({ group_value: 'team-b', cost_usd: 0.5 }),
      ]),
    );
    expect(byTeam.chargeback.invoice_summary).toMatchObject({
      currency: 'USD',
      line_items: expect.any(Array),
      disclaimer: expect.stringContaining('Internal chargeback summary only'),
    });
    expect(byTeam.boundaries).toMatchObject({
      payments: false,
      recharge_balances: false,
      reseller_marketplace: false,
      public_api_marketplace: false,
    });

    const byProject = await service.getDashboardSummary({ period: '30d', group_by: 'project' });
    expect(byProject.chargeback.groups[0]).toMatchObject({
      group_by: 'project',
      group_value: 'gateway',
    });
  });

  it('detects rate-of-change cost anomalies and emits metadata-only alerts', async () => {
    const now = Date.now();
    const { service, alerts } = makeService({
      logs: [
        makeCallLog({ request_id: 'old', timestamp: new Date(now - 20 * 86_400_000), cost_usd: 0.2, team_id: 'team-a' }),
        makeCallLog({ request_id: 'new', timestamp: new Date(now - 2 * 86_400_000), cost_usd: 8, team_id: 'team-a' }),
      ],
    });

    const summary = await service.getDashboardSummary({ period: '30d', group_by: 'team' });

    expect(summary.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'team',
          key: 'team-a',
          rule: 'rate_of_change',
          severity: 'critical',
          recommended_policy: expect.objectContaining({
            action: 'optional_downgrade',
            automatic: false,
          }),
        }),
      ]),
    );
    expect(alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cost_anomaly',
        severity: 'critical',
        details: expect.objectContaining({
          workspace_id: 'default-workspace',
          scope: expect.any(String),
        }),
      }),
    );
  });

  it('surfaces provider price sync guardrails without auto-trusting synced prices', async () => {
    const { service } = makeService();

    const summary = await service.getDashboardSummary({ period: '7d' });

    expect(summary.price_sync).toMatchObject({
      enabled: true,
      scheduled: true,
      supported_sources: ['openrouter', 'zeroeval'],
      enabled_sources: ['openrouter'],
      guardrails: {
        explicit_sources_only: true,
        never_overwrite_operator_overrides_silently: true,
        automatic_price_trust: false,
      },
    });
    expect(summary.price_sync.configured_model_warnings).toEqual([]);
  });

  it('records thumbs feedback as metadata only and attaches route weight evidence', async () => {
    const decision = makeDecision();
    const { service, feedback } = makeService({
      logs: [
        makeCallLog({ request_id: 'req-feedback', api_key_id: 'key-prod', api_key_name: 'prod-key', team_id: 'team-a' }),
      ],
      decisions: [decision],
    });

    const result = await service.recordFeedback({
      request_id: 'req-feedback',
      value: 'thumbs_up',
      reason_code: 'helpful',
      api_key_id: 'key-prod',
      api_key_name: 'prod-key',
      workspace_id: 'default-workspace',
    });

    expect(result).toMatchObject({
      success: true,
      request_id: 'req-feedback',
      value: 'up',
      metadata_only: true,
      route_weight_evidence: {
        metadata_only: true,
        selected_node: 'node-a',
        selected_model: 'gpt-4o-mini',
        selected_weight: 0.8,
        optimizer: {
          applied: true,
          objective: 'balanced',
        },
      },
      privacy: {
        stores_prompts: false,
        stores_responses: false,
        stores_source_code: false,
        stores_diffs: false,
        stores_tool_payloads: false,
        stores_raw_headers: false,
        stores_provider_keys: false,
        exports_content: false,
      },
    });
    expect(feedback.repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-feedback',
        value: 'up',
        reason_code: 'helpful',
        source: 'gateway_api',
        route_weight_evidence_json: expect.stringContaining('selected_node'),
      }),
    );
  });

  it('scopes feedback route aggregation to the active workspace', async () => {
    const { service, decision } = makeService({
      decisions: [makeDecision()],
      feedbackRows: [makeFeedback()],
    });

    await service.getDashboardSummary({ period: '30d', group_by: 'team' });

    expect(decision.qb.andWhere).toHaveBeenCalledWith(
      '(decision.workspace_id = :workspaceId OR decision.workspace_id IS NULL)',
      { workspaceId: 'default-workspace' },
    );
  });
});
