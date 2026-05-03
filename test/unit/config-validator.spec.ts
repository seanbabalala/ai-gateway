import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  validateConfigFile,
  validateConfigObject,
} from '../../src/config/config-validator';
import { runCli } from '../../src/cli/siftgate';
import { loadMergedCatalog } from '../../src/catalog/catalog.service';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/config-validator', name);
const catalogFixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/catalog', name);

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

  it('warns when PostgreSQL schema synchronization is left enabled', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: {
          type: 'postgres',
          url: 'postgresql://siftgate:secret@localhost:5432/siftgate',
        },
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o': { input: 2.5, output: 10 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('postgres_synchronize_enabled');
  });

  it('validates upstream connection pool settings', () => {
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
            connection: {
              enabled: true,
              keep_alive: true,
              pool_size: 10,
              keep_alive_ms: 60000,
              headers_timeout_ms: 5000,
              body_timeout_ms: 0,
              http2: true,
            },
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o': { input: 2.5, output: 10 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).not.toContain('invalid_node_connection_value');
    expect(codes(result.warnings)).toContain('experimental_http2_connection_pool');
  });

  it('validates stream cache and embedding batching controls', () => {
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
            embeddings_endpoint: '/v1/embeddings',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            embedding_models: ['text-embedding-3-small'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'gpt-4o-mini' },
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
        cache: {
          enabled: true,
          ttl_seconds: 300,
          max_entries: 1000,
          exclude_tool_use: true,
          stream_cache: { enabled: true },
        },
        embedding_batching: {
          enabled: true,
          window_ms: 10,
          max_batch_size: 64,
          max_input_items: 4,
          max_queue: 1000,
          timeout_ms: 10000,
        },
        models_pricing: {
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
          'text-embedding-3-small': { input: 0.02, output: 0 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates image/audio models, endpoints, namespace references, and pricing warnings', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        namespaces: [
          {
            id: 'media-team',
            allowed_models: ['gpt-image-1', 'gpt-4o-mini-transcribe', 'veo-3-preview'],
          },
        ],
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            images_generations_endpoint: '/v1/images/generations',
            images_edits_endpoint: '/v1/images/edits',
            images_variations_endpoint: '/v1/images/variations',
            audio_transcriptions_endpoint: '/v1/audio/transcriptions',
            audio_translations_endpoint: '/v1/audio/translations',
            audio_speech_endpoint: '/v1/audio/speech',
            video_endpoint: '/v1/videos/generations',
            video_status_endpoint: '/v1/videos/:id',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            image_models: ['gpt-image-1'],
            audio_models: ['gpt-4o-mini-transcribe'],
            video_models: ['veo-3-preview'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'gpt-4o-mini' },
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
        models_pricing: {
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
          'gpt-image-1': { input: 5, output: 0 },
          'veo-3-preview': { input: 20, output: 0 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(codes(result.warnings)).toContain('missing_model_pricing');
  });

  it('adds provider catalog warnings for unknown known-provider models', () => {
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
            models: ['gpt-4o', 'not-a-known-openai-model'],
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: {
          'gpt-4o': { input: 2.5, output: 10 },
          'not-a-known-openai-model': { input: 1, output: 2 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('catalog_unknown_model');
  });

  it('adds provider catalog warnings for modality/endpoint mismatches and placeholder pricing', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            protocol: 'messages',
            base_url: 'https://api.anthropic.com',
            endpoint: '/v1/messages',
            api_key: '${ANTHROPIC_API_KEY:-test}',
            models: ['claude-sonnet-4-20250514'],
            image_models: ['claude-sonnet-4-20250514'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'anthropic', model: 'claude-sonnet-4-20250514' },
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

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toEqual(
      expect.arrayContaining([
        'catalog_endpoint_modality_mismatch',
        'catalog_pricing_manual_review',
      ]),
    );
  });

  it('rejects invalid media endpoint paths and model arrays', () => {
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
            images_generations_endpoint: 'v1/images/generations',
            images_variations_endpoint: 'v1/images/variations',
            audio_translations_endpoint: 'audio/translations',
            audio_speech_endpoint: '',
            video_generations_endpoint: 'v1/videos/generations',
            video_endpoint: 'v1/videos/generations',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            image_models: ['gpt-image-1', 'gpt-image-1'],
            audio_models: 'tts-1',
            video_models: ['veo-3.1-generate-preview', 'veo-3.1-generate-preview'],
            model_capabilities: {
              'gpt-image-1': {
                max_file_size: 0,
                pricing: { input: -1, output: 0 },
              },
            },
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'gpt-4o-mini' },
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
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_node_endpoint',
        'duplicate_model_id_in_node',
        'invalid_audio_models',
        'invalid_max_file_size',
        'invalid_pricing_entry',
      ]),
    );
  });

  it('accepts specialized-only catalog nodes when models is an empty array', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'voyage',
            name: 'Voyage AI',
            protocol: 'chat_completions',
            base_url: 'https://api.voyageai.com',
            endpoint: '/v1/chat/completions',
            embeddings_endpoint: '/v1/embeddings',
            rerank_endpoint: '/v1/rerank',
            api_key: '${VOYAGE_API_KEY:-test}',
            models: [],
            embedding_models: ['voyage-3-large'],
            rerank_models: ['rerank-2'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'voyage', model: 'voyage-3-large' },
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
        models_pricing: {
          'voyage-3-large': { input: 0.12, output: 0 },
          'rerank-2': { input: 0.05, output: 0 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).not.toContain('missing_required_field');
  });

  it('validates experimental realtime preview controls', () => {
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
            realtime_endpoint: '/v1/realtime',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o'],
            realtime_models: ['gpt-4o-realtime-preview'],
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        realtime: {
          enabled: true,
          path: '/v1/realtime',
          max_connections: 10,
          max_connections_per_node: 5,
          idle_timeout_ms: 300000,
          upstream_connect_timeout_ms: 10000,
          max_session_ms: 1800000,
          default_node: 'openai',
          default_model: 'gpt-4o-realtime-preview',
        },
        models_pricing: {
          'gpt-4o': { input: 2.5, output: 10 },
          'gpt-4o-realtime-preview': { input: 5, output: 20 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(codes(result.info)).toContain('realtime_experimental');
  });

  it('rejects realtime enabled without realtime models', () => {
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        realtime: { enabled: true },
        models_pricing: { 'gpt-4o': { input: 2.5, output: 10 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('realtime_no_models');
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

  it('warns when node models are missing from the merged provider catalog', () => {
    const catalogLoad = loadMergedCatalog({
      cwd: os.tmpdir(),
      overridePath: path.join(os.tmpdir(), 'missing-catalog.override.yaml'),
      env: {},
    });
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
            models: ['custom-chat-latest'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'custom-chat-latest' },
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
        models_pricing: { 'custom-chat-latest': { input: 0.25, output: 0.75 } },
      },
      { env: {}, catalog: catalogLoad.catalog, catalogIssues: catalogLoad.issues },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('catalog_unknown_model');
  });

  it('uses catalog overrides to recognize custom provider models', () => {
    const catalogLoad = loadMergedCatalog({
      cwd: path.dirname(catalogFixture('catalog.override.yaml')),
      overridePath: catalogFixture('catalog.override.yaml'),
      env: {},
    });
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI Proxy',
            protocol: 'chat_completions',
            base_url: 'https://proxy.example/openai',
            endpoint: '/v1/chat/completions',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['custom-chat-latest'],
            timeout_ms: 60000,
          },
        ],
        routing: {
          tiers: {
            standard: {
              primary: { node: 'openai', model: 'custom-chat-latest' },
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
        models_pricing: { 'custom-chat-latest': { input: 0.25, output: 0.75 } },
      },
      { env: {}, catalog: catalogLoad.catalog, catalogIssues: catalogLoad.issues },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).not.toContain('catalog_unknown_model');
  });

  it('warns when configured endpoints differ from the catalog provider preset', () => {
    const catalogLoad = loadMergedCatalog({
      cwd: os.tmpdir(),
      overridePath: path.join(os.tmpdir(), 'missing-catalog.override.yaml'),
      env: {},
    });
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
            endpoint: '/v1/custom/chat',
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
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o': { input: 2.5, output: 10 } },
      },
      { env: {}, catalog: catalogLoad.catalog, catalogIssues: catalogLoad.issues },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain('catalog_endpoint_mismatch');
  });

  it('surfaces catalog override secret diagnostics through config validation', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-config-catalog-'));
    const configPath = path.join(cwd, 'gateway.config.yaml');
    fs.writeFileSync(
      configPath,
      [
        'server: { port: 2099, host: 0.0.0.0 }',
        'database: { type: sqlite, path: ":memory:" }',
        'auth: { api_keys: [] }',
        `catalog: { override_file: ${catalogFixture('secret.catalog.override.yaml')} }`,
        'nodes:',
        '  - id: openai',
        '    name: OpenAI',
        '    protocol: chat_completions',
        '    base_url: https://api.openai.com',
        '    endpoint: /v1/chat/completions',
        '    api_key: ${OPENAI_API_KEY:-test}',
        '    models: [gpt-4o]',
        'routing:',
        '  tiers:',
        '    standard:',
        '      primary: { node: openai, model: gpt-4o }',
        '      fallbacks: []',
        '  scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 }',
        'budget: { daily_token_limit: 1000000, daily_cost_limit: 25, alert_threshold: 0.8 }',
        'models_pricing: { gpt-4o: { input: 2.5, output: 10 } }',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = validateConfigFile({ configPath, cwd, env: {} });

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain('catalog_override_secret_field');
    expect(codes(result.warnings)).toContain('catalog_override_secret_value');
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

  it('accepts embedding models with dimensions and pricing metadata', () => {
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
            embeddings_endpoint: '/v1/embeddings',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            embedding_models: ['text-embedding-3-small'],
            timeout_ms: 60000,
            model_capabilities: {
              'text-embedding-3-small': {
                dimensions: [512, 1536],
                pricing: { input: 0.02, output: 0 },
              },
            },
          },
        ],
        routing: {
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
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).toHaveLength(0);
    expect(codes(result.warnings)).not.toContain('missing_model_pricing');
  });

  it('accepts v0.6 multimodal capability schema on nodes and models', () => {
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
            models: ['gpt-4o', 'dall-e-3', 'rerank-v1', 'realtime-model'],
            timeout_ms: 60000,
            modalities: ['text', 'image'],
            endpoints: {
              image: '/v1/images/generations',
              audio: '/v1/audio/transcriptions',
              rerank: '/v1/rerank',
              realtime: 'wss://api.openai.com/v1/realtime',
            },
            input_types: ['text', 'image', 'audio', 'documents'],
            output_types: ['text', 'image', 'ranked_documents', 'events'],
            max_file_size: 20_000_000,
            supports_streaming: true,
            supports_realtime: false,
            supports_rerank: false,
            model_capabilities: {
              'gpt-4o': {
                modalities: ['text', 'image', 'audio'],
                supports_streaming: true,
                pricing: { input: 2.5, output: 10 },
              },
              'dall-e-3': {
                modalities: ['image'],
                output_types: ['image'],
                max_file_size: 10_000_000,
                pricing: { input: 0.04, output: 0 },
              },
              'rerank-v1': {
                modalities: ['rerank'],
                supports_rerank: true,
                endpoints: { rerank: '/v1/rerank' },
                input_types: ['documents'],
                output_types: ['ranked_documents'],
                pricing: { input: 0.01, output: 0 },
              },
              'realtime-model': {
                modalities: ['realtime', 'audio', 'text'],
                supports_realtime: true,
                endpoints: { realtime: 'wss://api.openai.com/v1/realtime' },
                output_types: ['events'],
                pricing: { input: 1, output: 2 },
              },
            },
          },
        ],
        routing: {
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o' }],
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

  it('accepts rerank models, endpoint, pricing metadata, and namespace references', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        namespaces: [
          {
            id: 'search',
            allowed_nodes: ['openai'],
            allowed_models: ['rerank-english-v3'],
          },
        ],
        nodes: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'chat_completions',
            base_url: 'https://api.openai.com',
            endpoint: '/v1/chat/completions',
            rerank_endpoint: '/v1/rerank',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            rerank_models: ['rerank-english-v3'],
            timeout_ms: 60000,
            model_capabilities: {
              'rerank-english-v3': {
                pricing: { input: 0.01, output: 0 },
              },
            },
          },
        ],
        routing: {
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
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).toHaveLength(0);
    expect(codes(result.warnings)).not.toContain('missing_model_pricing');
  });

  it('rejects invalid v0.6 capability schema fields', () => {
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
            modalities: ['telepathy'],
            endpoints: { image: 'v1/images', unknown: '/v1/custom' },
            input_types: ['text', ''],
            output_types: 'json',
            max_file_size: 0,
            supports_streaming: 'yes',
            model_capabilities: {
              'gpt-4o': {
                modalities: [],
                endpoints: { realtime: 'ftp://example.com/realtime' },
                input_types: ['text', 'telepathy'],
                supports_realtime: 'true',
              },
            },
          },
        ],
        routing: {
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o' }],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_capability_modalities',
        'invalid_capability_endpoints',
        'invalid_capability_io_types',
        'invalid_max_file_size',
        'invalid_capability_support_flag',
      ]),
    );
  });

  it('rejects invalid rerank model config', () => {
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
            rerank_endpoint: 'v1/rerank',
            api_key: '${OPENAI_API_KEY:-test}',
            models: ['gpt-4o-mini'],
            rerank_models: ['rerank-english-v3', 'rerank-english-v3', ''],
            timeout_ms: 60000,
          },
        ],
        routing: {
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
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_node_endpoint',
        'duplicate_model_id_in_node',
        'invalid_model_id',
      ]),
    );
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
                dimensions: [0],
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
        'invalid_embedding_dimensions',
        'invalid_pricing_entry',
        'invalid_routing_optimization',
      ]),
    );
  });

  it('accepts Redis state and cluster mode config', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        state: {
          backend: 'redis',
          redis: {
            url: '${REDIS_URL:-redis://127.0.0.1:6379}',
            prefix: 'siftgate:',
          },
        },
        cluster: {
          enabled: true,
          instance_id: 'gateway-a',
          heartbeat_interval_seconds: 10,
          heartbeat_ttl_seconds: 30,
          reload_broadcast: true,
        },
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
          },
        ],
        routing: {
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
        models_pricing: {
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).toHaveLength(0);
  });

  it('rejects invalid Redis state and cluster mode settings', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: { api_keys: [] },
        state: {
          backend: 'shared',
          redis: { url: 'http://localhost:6379', prefix: '' },
        },
        cluster: {
          enabled: 'yes',
          instance_id: '',
          redis: { url: 'not-a-url' },
          heartbeat_interval_seconds: 10,
          heartbeat_ttl_seconds: 5,
          reload_broadcast: 'yes',
        },
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
          },
        ],
        routing: {
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
        models_pricing: {
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
        },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_state_backend',
        'invalid_redis_url',
        'invalid_state_redis_prefix',
        'invalid_cluster_config',
      ]),
    );
    expect(codes(result.warnings)).toContain('cluster_heartbeat_ttl_short');
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

  it('validates Redis shared state backend configuration', () => {
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
        state: {
          backend: 'redis',
          unavailable_policy: 'fail_closed',
          redis: {
            url: 'http://redis.example.test',
            prefix: 'bad prefix',
            timeout_ms: 0,
          },
        },
        models_pricing: { 'gpt-4o': { input: 5, output: 15 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'invalid_state_redis_url',
        'invalid_state_redis_prefix',
        'invalid_state_redis_number',
      ]),
    );
  });

  it('validates local namespaces, API key bindings, and shadow traffic config', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: {
          api_keys: [
            { key: 'gw_sk_dev_test', name: 'dev', namespace_id: 'team-alpha' },
          ],
        },
        namespaces: [
          {
            id: 'team-alpha',
            allowed_nodes: ['openai'],
            allowed_models: ['gpt-4o-mini'],
            budget: { daily_token_limit: 10000, daily_cost_limit: 2 },
            rate_limit: { requests_per_minute: 60 },
          },
        ],
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
          },
        ],
        routing: {
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o-mini' }],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        shadow: {
          enabled: true,
          sample_rate: 0.25,
          target_node: 'openai',
          target_model: 'gpt-4o-mini',
          compare: { store_prompts: false, store_responses: false },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).toHaveLength(0);
  });

  it('rejects invalid namespace references and unsafe shadow settings', () => {
    const result = validateConfigObject(
      {
        server: { port: 2099, host: '0.0.0.0' },
        database: { type: 'sqlite', path: ':memory:' },
        auth: {
          api_keys: [
            { key: 'gw_sk_dev_test', name: 'dev', namespace_id: 'missing' },
          ],
        },
        namespaces: [
          {
            id: 'team-alpha',
            allowed_nodes: ['missing-node'],
            budget: { daily_token_limit: -1 },
          },
        ],
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
          },
        ],
        routing: {
          tiers: {
            standard: {
              targets: [{ node: 'openai', model: 'gpt-4o-mini' }],
            },
          },
          scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
        },
        shadow: {
          enabled: true,
          sample_rate: 2,
          compare: { store_prompts: true },
        },
        budget: {
          daily_token_limit: 1000000,
          daily_cost_limit: 25,
          alert_threshold: 0.8,
        },
        models_pricing: { 'gpt-4o-mini': { input: 0.15, output: 0.6 } },
      },
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toEqual(
      expect.arrayContaining([
        'unknown_namespace_reference',
        'unknown_namespace_node',
        'invalid_namespace_budget',
        'invalid_shadow_config',
        'missing_shadow_target',
      ]),
    );
    expect(codes(result.warnings)).toContain('shadow_compare_storage_enabled');
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
