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
