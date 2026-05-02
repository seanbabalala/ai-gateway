import * as path from 'path';
import {
  validateConfigFile,
  validateConfigObject,
} from '../../src/config/config-validator';
import { runCli } from '../../src/cli/siftgate';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/config-validator', name);

const codes = (issues: { code: string }[]) => issues.map((item) => item.code);

describe('config validator', () => {
  it('accepts a valid standalone data-plane config', () => {
    const result = validateConfigFile({
      configPath: fixture('valid.gateway.yaml'),
      env: {},
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(codes(result.info)).toEqual(
      expect.arrayContaining(['control_plane_disabled', 'config_summary']),
    );
  });

  it('reports YAML parser failures as errors', () => {
    const result = validateConfigFile({
      configPath: fixture('invalid-yaml.gateway.yaml'),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('yaml_parse_error');
  });

  it('reports structural, routing, env, and control-plane issues', () => {
    const result = validateConfigFile({
      configPath: fixture('invalid.gateway.yaml'),
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'duplicate_node_id',
        'malformed_env_reference',
        'invalid_split_weight_total',
        'route_references_unknown_node',
        'route_references_unknown_model',
        'domain_preference_unknown_node',
      ]),
    );
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining([
        'duplicate_model_id',
        'missing_model_pricing',
        'literal_provider_api_key',
        'literal_control_plane_token',
        'insecure_control_plane_url',
        'control_plane_prompt_upload_enabled',
        'control_plane_response_upload_enabled',
      ]),
    );
  });

  it('reuses shared node/model diagnostics for pricing and ambiguous names', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai-a',
            name: 'OpenAI A',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            timeout_ms: 60000,
          },
          {
            id: 'openai-b',
            name: 'OpenAI B',
            protocol: 'responses',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/responses',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai-a', model: 'gpt-4o' },
              fallbacks: [{ node: 'openai-b', model: 'gpt-4o' }],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {},
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining(['duplicate_model_id', 'missing_model_pricing']),
    );
  });

  it('accepts targets-only load balancing tiers without legacy primary/fallbacks', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai-a',
            name: 'OpenAI A',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o', 'gpt-4o-mini'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              strategy: 'weighted',
              targets: [
                { node: 'openai-a', model: 'gpt-4o', weight: 70 },
                { node: 'openai-a', model: 'gpt-4o-mini', weight: 30 },
              ],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {
          'gpt-4o': { input: 5, output: 15 },
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts v0.3 routing optimization and model capability metadata', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            timeout_ms: 60000,
            max_context_tokens: 128000,
            structured_output: true,
            model_capabilities: {
              'gpt-4o-mini': {
                max_context_tokens: 128000,
                structured_output: true,
                pricing: { input: 0.15, output: 0.6 },
                quality_score: 0.7,
              },
            },
          },
        ],
        routing: {
          optimization: 'cost',
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o-mini' }],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {},
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).toHaveLength(0);
    expect(codes(result.warnings)).not.toContain('missing_model_pricing');
  });

  it('rejects invalid v0.3 routing optimization and capability metadata', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            timeout_ms: 60000,
            max_context_tokens: -1,
            structured_output: 'yes',
            model_capabilities: {
              'gpt-4o-mini': {
                max_context_tokens: 0,
                structured_output: 'yes',
                pricing: { input: -1, output: 0.6 },
              },
            },
          },
        ],
        routing: {
          optimization: 'magic',
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o-mini' }],
              fallbacks: [],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {},
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_max_context_tokens',
        'invalid_structured_output_flag',
        'invalid_pricing_entry',
        'invalid_routing_optimization',
      ]),
    );
  });

  it('validates fallback policy shape and cost/race safety requirements', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'gpt-4o' },
              fallbacks: [],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
          fallback_policy: {
            immediate_429: 'yes',
            timeout: { enabled: true, race_fallback: true },
            structured_output: { enabled: 'yes' },
            cost_downgrade: { enabled: true },
          },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {
          'gpt-4o': { input: 2.5, output: 10 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_fallback_policy',
        'fallback_race_requires_threshold',
        'invalid_structured_output_fallback_policy',
        'cost_downgrade_requires_limit',
      ]),
    );
  });

  it('validates webhook alert channels and spike rules', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai-a',
            name: 'OpenAI A',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai-a', model: 'gpt-4o' },
              fallbacks: [],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        alerts: {
          enabled: true,
          channels: [
            {
              type: 'webhook',
              url: 'ftp://hooks.example.test',
              events: ['node_down', 'unknown_event'],
              debounce_seconds: -1,
              retry: { attempts: 0, backoff_ms: -1, timeout_ms: 0 },
            },
          ],
          error_spike: { enabled: true, error_rate: 2 },
          latency_spike: { p95_ms: 0 },
        },
        models_pricing: { 'gpt-4o': { input: 5, output: 15 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_alert_webhook_url',
        'invalid_alert_channel_event',
        'invalid_alert_channel',
        'invalid_alert_channel_retry',
        'invalid_alert_spike_rule',
      ]),
    );
  });

  it('validates external log sink configuration', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai-a',
            name: 'OpenAI A',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai-a', model: 'gpt-4o' },
              fallbacks: [],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        logging: {
          enabled: true,
          sinks: [
            {
              type: 'webhook',
              url: 'ftp://hooks.example.test',
              fields: ['request_id', 'prompt'],
              batch_size: 0,
              retry: { attempts: 0, backoff_ms: -1, timeout_ms: 0 },
            },
            {
              type: 's3',
              bucket: 'archive',
            },
          ],
        },
        models_pricing: { 'gpt-4o': { input: 5, output: 15 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_log_sink_url',
        'invalid_log_sink_batching',
        'invalid_log_sink_retry',
      ]),
    );
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining([
        'log_sink_sensitive_field_ignored',
        'log_sink_interface_only',
      ]),
    );
  });
});

describe('siftgate validate CLI', () => {
  it('prints text output and returns zero for a valid config', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      ['validate', '--config', fixture('valid.gateway.yaml')],
      {
        env: {},
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Result: OK');
  });

  it('prints JSON output and returns non-zero for invalid configs', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runCli(
      ['validate', '--config', fixture('invalid.gateway.yaml'), '--json'],
      {
        env: {},
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toHaveLength(0);
    const parsed = JSON.parse(stdout.join('\n'));
    expect(parsed.ok).toBe(false);
    expect(codes(parsed.errors)).toContain('route_references_unknown_node');
  });
});
