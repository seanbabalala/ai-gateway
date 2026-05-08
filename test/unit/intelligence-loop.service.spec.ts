import { IntelligenceLoopService } from '../../src/intelligence/intelligence-loop.service';
import { RouteDecisionTrace } from '../../src/routing/route-decision-trace';
import { makeCanonicalResponse, makeRequest, mockConfigService } from '../helpers';

function makeTrace(overrides: Partial<RouteDecisionTrace> = {}): RouteDecisionTrace {
  return {
    version: 1,
    mode: 'auto',
    tier: 'standard',
    score: 0.5,
    domain_hints: { domain: null, modalities: [] },
    scoring: { tier: 'standard', score: 0.5, momentum_adjusted: false },
    constraints: {
      estimated_input_tokens: null,
      estimated_output_tokens: null,
      estimated_context_tokens: null,
      requires_structured_output: false,
    },
    candidate_targets: [
      {
        node: 'premium',
        model: 'expensive',
        weight: null,
        position: 0,
        circuit_state: 'CLOSED',
        circuit_available: true,
        selected: true,
        fallback: false,
        filter_reasons: [],
        scores: { cost: null, latency: null, context: null },
        metrics: {
          estimated_cost_usd: null,
          avg_latency_ms: null,
          p95_latency_ms: null,
          max_context_tokens: 128000,
          context_fit: 'safe',
          structured_output: true,
        },
      },
      {
        node: 'budget',
        model: 'cheap',
        weight: null,
        position: 1,
        circuit_state: 'CLOSED',
        circuit_available: true,
        selected: false,
        fallback: true,
        filter_reasons: [],
        scores: { cost: null, latency: null, context: null },
        metrics: {
          estimated_cost_usd: null,
          avg_latency_ms: null,
          p95_latency_ms: null,
          max_context_tokens: 128000,
          context_fit: 'safe',
          structured_output: true,
        },
      },
    ],
    filters: [],
    load_balancing: {
      strategy: 'primary_fallback',
      source: 'primary_fallback',
      selected: { node: 'premium', model: 'expensive' },
      target_count: 2,
      reason: 'test',
    },
    fallback_chain: [{ node: 'budget', model: 'cheap' }],
    final_selection: {
      node: 'premium',
      model: 'expensive',
      reason: 'test',
      is_fallback: false,
      fallback_reason: null,
    },
    privacy: {
      prompt: false,
      response: false,
      raw_headers: false,
      provider_keys: false,
    },
    ...overrides,
  };
}

function objectOverride(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function makeService(overrides: Record<string, unknown> = {}) {
  const intelligence = {
    cost_optimizer: {
      enabled: true,
      action: 'evidence_only',
      objective: 'balanced',
      history_window_hours: 24,
      min_samples: 1,
      min_savings_ratio: 0.05,
      max_latency_penalty_ratio: 0.5,
      max_quality_penalty: 0.2,
      allow_quality_critical_downgrade: false,
    },
    token_prediction: {
      enabled: true,
      budget_policy: 'observe',
      near_limit_ratio: 0.9,
      allow_quality_critical_downgrade: false,
    },
    async_eval: {
      enabled: true,
      sample_rate: 1,
      dimensions: ['latency', 'toxicity', 'relevance', 'format'],
      metadata_only: true,
      max_recent_jobs: 2,
    },
    quality_gate: {
      enabled: true,
      rules: [],
    },
    ...(overrides.intelligence as Record<string, unknown> | undefined),
  };
  const config = mockConfigService({
    intelligence,
    getModelPricing: jest.fn((_model: string, node?: string) =>
      node === 'budget'
        ? { input: 0.1, output: 0.2 }
        : { input: 10, output: 20 },
    ),
    ...objectOverride(overrides.config),
  });
  const capabilityService = {
    resolveModelRoutingCapabilities: jest.fn((_node: string, _model: string) => ({
      modalities: ['text'],
      structured_output: true,
      supports_reasoning: false,
      quality_score: 0.9,
      read_cache: false,
      prompt_cache: false,
    })),
    ...objectOverride(overrides.capabilityService),
  };
  const budgetService = {
    getStatus: jest.fn().mockResolvedValue([
      {
        type: 'daily_cost',
        scope: 'workspace',
        limit: 1,
        current: 0.5,
      },
    ]),
    ...objectOverride(overrides.budgetService),
  };
  const adaptiveStats = {
    getWindow: jest.fn().mockResolvedValue({
      targets: [
        { key: 'premium:expensive', calls: 10, success_rate: 0.99, avg_latency_ms: 1000 },
        { key: 'budget:cheap', calls: 10, success_rate: 0.98, avg_latency_ms: 900 },
      ],
    }),
    ...objectOverride(overrides.adaptiveStats),
  };
  const alerts = {
    emit: jest.fn(),
    ...objectOverride(overrides.alerts),
  };
  const service = new IntelligenceLoopService(
    config,
    capabilityService as any,
    budgetService as any,
    adaptiveStats as any,
    alerts as any,
  );

  return { service, config, capabilityService, budgetService, adaptiveStats, alerts };
}

describe('IntelligenceLoopService', () => {
  it('records token prediction and cost optimizer evidence without changing routes by default', async () => {
    const { service } = makeService();
    const decision = await service.evaluateRoute({
      canonical: makeRequest('short request', { maxTokens: 100 }),
      tier: 'standard',
      score: 0.5,
      route: {
        primary: { node: 'premium', model: 'expensive' },
        fallbacks: [{ node: 'budget', model: 'cheap' }],
      },
      routeTrace: makeTrace(),
    });

    expect(decision.route.primary).toEqual({ node: 'premium', model: 'expensive' });
    expect(decision.fallbackReason).toBeNull();
    expect(decision.routeTrace.intelligence?.token_prediction).toEqual(
      expect.objectContaining({
        enabled: true,
        budget_policy: 'observe',
        risk: 'within_budget',
        action: 'observed',
      }),
    );
    expect(decision.routeTrace.intelligence?.optimizer).toEqual(
      expect.objectContaining({
        enabled: true,
        action: 'evidence_only',
        applied: false,
        quality_critical: false,
      }),
    );
    expect(decision.routeTrace.intelligence?.optimizer?.candidates).toHaveLength(2);
  });

  it('rejects pre-upstream calls when token prediction exceeds an explicit reject policy', async () => {
    const { service } = makeService({
      intelligence: {
        token_prediction: {
          enabled: true,
          budget_policy: 'reject',
          near_limit_ratio: 0.9,
          allow_quality_critical_downgrade: false,
        },
      },
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([
          {
            type: 'daily_cost',
            scope: 'workspace',
            limit: 1,
            current: 0.995,
          },
        ]),
      },
    });

    const decision = await service.evaluateRoute({
      canonical: makeRequest('expensive request', { maxTokens: 10_000 }),
      tier: 'standard',
      score: 0.5,
      route: {
        primary: { node: 'premium', model: 'expensive' },
        fallbacks: [{ node: 'budget', model: 'cheap' }],
      },
      routeTrace: makeTrace(),
    });

    expect(decision.rejected).toEqual(
      expect.objectContaining({
        statusCode: 429,
      }),
    );
    expect(decision.routeTrace.intelligence?.token_prediction).toEqual(
      expect.objectContaining({
        risk: 'over_limit',
        action: 'rejected',
      }),
    );
  });

  it('can apply cost optimizer routing only when optimize mode is explicit', async () => {
    const { service } = makeService({
      intelligence: {
        cost_optimizer: {
          enabled: true,
          action: 'optimize',
          objective: 'cost',
          history_window_hours: 24,
          min_samples: 1,
          min_savings_ratio: 0.05,
          max_latency_penalty_ratio: 0.5,
          max_quality_penalty: 0.2,
          allow_quality_critical_downgrade: true,
        },
      },
    });

    const decision = await service.evaluateRoute({
      canonical: makeRequest('optimize me', { maxTokens: 500 }),
      tier: 'standard',
      score: 0.5,
      route: {
        primary: { node: 'premium', model: 'expensive' },
        fallbacks: [{ node: 'budget', model: 'cheap' }],
      },
      routeTrace: makeTrace(),
    });

    expect(decision.route.primary).toEqual({ node: 'budget', model: 'cheap' });
    expect(decision.fallbackReason).toBe('cost_downgrade');
    expect(decision.routeTrace.final_selection).toEqual(
      expect.objectContaining({
        node: 'budget',
        model: 'cheap',
        fallback_reason: 'cost_downgrade',
      }),
    );
    expect(decision.routeTrace.intelligence?.optimizer).toEqual(
      expect.objectContaining({
        applied: true,
        reason: 'cost_optimizer_selected_lower_cost_candidate',
      }),
    );
  });

  it('honors explicit token-prediction downgrade policy without requiring optimizer mode', async () => {
    const { service } = makeService({
      intelligence: {
        cost_optimizer: {
          enabled: true,
          action: 'evidence_only',
          objective: 'balanced',
          history_window_hours: 24,
          min_samples: 1,
          min_savings_ratio: 0.05,
          max_latency_penalty_ratio: 0.5,
          max_quality_penalty: 0.2,
          allow_quality_critical_downgrade: false,
        },
        token_prediction: {
          enabled: true,
          budget_policy: 'downgrade',
          near_limit_ratio: 0.9,
          allow_quality_critical_downgrade: false,
        },
      },
      budgetService: {
        getStatus: jest.fn().mockResolvedValue([
          {
            type: 'daily_cost',
            scope: 'workspace',
            limit: 1,
            current: 0.995,
          },
        ]),
      },
    });

    const decision = await service.evaluateRoute({
      canonical: makeRequest('expensive request', { maxTokens: 10_000 }),
      tier: 'standard',
      score: 0.5,
      route: {
        primary: { node: 'premium', model: 'expensive' },
        fallbacks: [{ node: 'budget', model: 'cheap' }],
      },
      routeTrace: makeTrace(),
    });

    expect(decision.rejected).toBeUndefined();
    expect(decision.route.primary).toEqual({ node: 'budget', model: 'cheap' });
    expect(decision.fallbackReason).toBe('cost_downgrade');
    expect(decision.routeTrace.intelligence?.token_prediction).toEqual(
      expect.objectContaining({
        risk: 'over_limit',
        action: 'downgraded',
      }),
    );
    expect(decision.routeTrace.intelligence?.optimizer).toEqual(
      expect.objectContaining({
        action: 'evidence_only',
        applied: true,
        reason: 'token_prediction_budget_downgrade_selected_candidate',
      }),
    );
  });

  it('does not silently downgrade quality-critical coding requests', async () => {
    const { service } = makeService({
      intelligence: {
        cost_optimizer: {
          enabled: true,
          action: 'optimize',
          objective: 'cost',
          history_window_hours: 24,
          min_samples: 1,
          min_savings_ratio: 0.05,
          max_latency_penalty_ratio: 0.5,
          max_quality_penalty: 0.2,
          allow_quality_critical_downgrade: false,
        },
      },
    });
    const canonical = makeRequest('audit this change', { maxTokens: 500 });
    canonical.metadata.agent_virtual_model = 'coding-security';

    const decision = await service.evaluateRoute({
      canonical,
      tier: 'standard',
      score: 0.5,
      route: {
        primary: { node: 'premium', model: 'expensive' },
        fallbacks: [{ node: 'budget', model: 'cheap' }],
      },
      routeTrace: makeTrace(),
    });

    expect(decision.route.primary).toEqual({ node: 'premium', model: 'expensive' });
    expect(
      decision.routeTrace.intelligence?.optimizer?.candidates.find(
        (candidate) => candidate.node === 'budget',
      )?.rejected_reasons,
    ).toContain('quality_critical_downgrade_blocked');
  });

  it('evaluates opt-in quality gates and blocks post-start streaming retries', () => {
    const { service, alerts } = makeService({
      intelligence: {
        quality_gate: {
          enabled: true,
          rules: [
            {
              id: 'critical-text',
              enabled: true,
              tiers: ['standard'],
              require_text: true,
              min_output_tokens: 10,
              actions: ['fallback', 'retry', 'alert'],
            },
          ],
        },
      },
    });

    const result = service.evaluateQualityGate({
      canonical: makeRequest('answer', { maxTokens: 50 }),
      response: makeCanonicalResponse({
        content: [],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      target: { node: 'premium', model: 'expensive' },
      fallbacks: [{ node: 'budget', model: 'cheap' }],
      tier: 'standard',
      score: 0.5,
      streamStarted: false,
    });

    expect(result.shouldFallback).toBe(true);
    expect(result.traceEvidence).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: 'enforced',
        final_status: 'failed',
      }),
    );
    expect(result.failureReasons).toEqual(
      expect.arrayContaining(['min_output_tokens', 'empty_text']),
    );

    const streamingEvidence = service.qualityGateStreamingEvidence();
    expect(streamingEvidence).toEqual(
      expect.objectContaining({
        final_status: 'skipped',
        reason: 'streaming_no_post_start_retry',
      }),
    );

    service.emitQualityGateAlert(
      {
        canonical: makeRequest('answer', { maxTokens: 50 }),
        response: result.response,
        target: { node: 'premium', model: 'expensive' },
        fallbacks: [],
        tier: 'standard',
        score: 0.5,
        streamStarted: false,
      },
      result.traceEvidence,
      result.failureReasons,
    );
    expect(alerts.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quality_gate_failed',
        details: expect.objectContaining({
          metadata_only: true,
          failure_reasons: expect.arrayContaining(['empty_text']),
        }),
      }),
    );
  });

  it('queues async eval metadata without storing content by default', () => {
    const { service } = makeService();
    const evidence = service.enqueueAsyncEval({
      canonical: makeRequest('sample', { maxTokens: 10 }),
      response: makeCanonicalResponse(),
      target: { node: 'premium', model: 'expensive' },
      requestId: 'req_eval_1',
      statusCode: 200,
      latencyMs: 123,
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        enabled: true,
        queued: true,
        metadata_only: true,
        reason: 'metadata_eval_queued',
      }),
    );
    expect(evidence.job_id).toMatch(/^eval_/);
  });
});
