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
  return {
    database: { type: 'sqlite', path: ':memory:' },
    auth: { api_keys: [], rate_limit: undefined },
    dashboardPasswordHash: undefined,
    setDashboardPasswordHash: jest.fn(),
    nodes: [],
    routing: { tiers: {}, scoring: { simple_max: 0.3, standard_max: 0.6, complex_max: 0.85 } },
    budget: { daily_token_limit: 1_000_000, daily_cost_limit: 10, alert_threshold: 0.8 },
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
    getNode: jest.fn().mockReturnValue(undefined),
    getModelPricing: jest.fn().mockReturnValue(undefined),
    getFullConfig: jest.fn(),
    getNodeModelDiagnostics: jest.fn().mockReturnValue([]),
    reload: jest.fn(),
    ...overrides,
  };
}
