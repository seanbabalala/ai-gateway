/**
 * Shared test utilities — factories + mock helpers.
 * Follows existing project patterns: direct instantiation, `as any`, `{} as never`.
 */

import { CanonicalRequest, CanonicalResponse, Tier } from '../src/canonical/canonical.types';

// ── Request Factory ──────────────────────────────────────────

export function makeRequest(
  userMessage: string,
  opts: {
    systemMessage?: string;
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
    messages?: CanonicalRequest['messages'];
    maxTokens?: number;
    temperature?: number;
    sessionKey?: string;
    originalModel?: string;
  } = {},
): CanonicalRequest {
  const messages: CanonicalRequest['messages'] = [];

  if (opts.messages) {
    messages.push(...opts.messages);
  } else {
    if (opts.systemMessage) {
      messages.push({ role: 'system', content: opts.systemMessage });
    }
    messages.push({ role: 'user', content: userMessage });
  }

  return {
    messages,
    tools: opts.tools,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    stream: false,
    metadata: {
      source_format: 'chat_completions',
      original_model: opts.originalModel,
      raw_headers: {},
      session_key: opts.sessionKey,
    },
  };
}

// ── Response Factory ─────────────────────────────────────────

export function makeCanonicalResponse(
  overrides: Partial<CanonicalResponse> = {},
): CanonicalResponse {
  return {
    id: 'test_resp_001',
    content: [{ type: 'text', text: 'Hello there!' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
    model: 'gpt-4',
    routing: {
      tier: 'simple' as Tier,
      node: 'test-node',
      latency_ms: 100,
      score: 0.1,
      is_fallback: false,
    },
    ...overrides,
  };
}

// ── ConfigService Mock ───────────────────────────────────────

export function mockConfigService(overrides: Record<string, unknown> = {}): any {
  const config: any = {
    database: { type: 'sqlite', path: ':memory:' },
    auth: { api_keys: [], rate_limit: undefined },
    dashboardPasswordHash: undefined,
    setDashboardPasswordHash: jest.fn(),
    nodes: [],
    routing: { tiers: {}, scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 } },
    fallbackPolicy: {
      immediate_429: false,
      timeout: { enabled: false, threshold_ms: undefined, race_fallback: false },
      structured_output: {
        enabled: false,
        fallback_on_parse_error: true,
        fallback_on_schema_error: true,
      },
      cost_downgrade: { enabled: false, max_estimated_cost_usd: undefined },
    },
    budget: { daily_token_limit: 1_000_000, daily_cost_limit: 10, alert_threshold: 0.8 },
    alerts: {
      enabled: false,
      channels: [],
      history_size: 50,
      error_spike: { enabled: true, window_seconds: 300, min_requests: 20, error_rate: 0.1 },
      latency_spike: { enabled: true, window_seconds: 300, min_requests: 20, p95_ms: 10_000 },
    },
    cache: {
      enabled: true,
      ttl_seconds: 300,
      max_entries: 1000,
      exclude_tool_use: true,
    },
    controlPlane: {
      enabled: false,
      url: '',
      gateway_id: '',
      registration_token: '',
      telemetry: {
        upload_interval_seconds: 30,
        include_prompt: false,
        include_response: false,
      },
    },
    logSinks: {
      enabled: false,
      sinks: [],
    },
    namespaces: [],
    shadowTraffic: {
      enabled: false,
      sample_rate: 0,
      target_node: undefined,
      target_model: undefined,
      timeout_ms: 0,
      max_recent_results: 100,
      compare: { store_prompts: false, store_responses: false },
    },
    getNode: jest.fn().mockReturnValue(undefined),
    getNamespace: jest.fn((namespaceId?: string | null) =>
      namespaceId ? config.namespaces.find((namespace: { id: string }) => namespace.id === namespaceId) : undefined,
    ),
    getModelPricing: jest.fn().mockReturnValue(undefined),
    getFullConfig: jest.fn(),
    getNodeModelDiagnostics: jest.fn().mockReturnValue([]),
    reload: jest.fn(),
    onReload: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    onReloadSuccess: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    onReloadFailed: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    ...overrides,
  };
  return config;
}
