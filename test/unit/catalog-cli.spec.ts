import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runCli } from '../../src/cli/siftgate';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/catalog', name);

async function makeTempDir(): Promise<string> {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-catalog-cli-'));
}

function makeIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      cwd,
      env: {},
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      runCommand: jest.fn(),
      now: () => new Date('2026-05-03T00:00:00.000Z'),
    },
    stdout,
    stderr,
  };
}

describe('siftgate catalog CLI', () => {
  it('lists built-in providers without requiring an override file', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'list'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('SiftGate provider catalog');
    expect(stdout.join('\n')).toContain('- openai');
    expect(stdout.join('\n')).toContain('- aws-bedrock');
    expect(stdout.join('\n')).toContain('- alibaba-qwen');
    expect(stdout.join('\n')).toContain('- huggingface');
    expect(stdout.join('\n')).toContain('- cloudflare-workers-ai');
    expect(stdout.join('\n')).toContain('- deepgram');
    expect(stdout.join('\n')).toContain('- xinference');
    expect(stdout.join('\n')).toContain('profiles=openai_compatible');
  });

  it('shows a provider from the merged catalog', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'show', 'openai'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Provider: openai');
    expect(stdout.join('\n')).toContain('Compatibility profiles: openai_compatible');
    expect(stdout.join('\n')).toContain('gpt-4o');
  });

  it('shows v1.4 catalog provider pricing source metadata', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'show', 'huggingface'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Provider: huggingface');
    expect(stdout.join('\n')).toContain('meta-llama/Llama-3.3-70B-Instruct');
    expect(stdout.join('\n')).toContain('provider-reference');
  });

  it('shows v1.4 pricing governance details when requested', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'show', 'openai', '--pricing'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Price source status');
    expect(stdout.join('\n')).toContain('source_type=docs_review');
    expect(stdout.join('\n')).toContain('used_from=builtin_catalog');
    expect(stdout.join('\n')).toContain('units=input:');
  });

  it('exports the merged catalog to a YAML file', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'export', '--out', 'catalog.yaml'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Exported merged catalog');
    const exported = yaml.load(fs.readFileSync(path.join(cwd, 'catalog.yaml'), 'utf8')) as any;
    expect(exported.providers.some((provider: any) => provider.id === 'openai')).toBe(true);
    expect(exported.providers[0].models[0].pricing).toHaveProperty('pricing_confidence');
  });

  it('accepts explicit pricing validation and export flags', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const validateExit = await runCli(['catalog', 'validate', '--pricing'], io);
    expect(validateExit).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Pricing source status: checked');

    stdout.length = 0;
    const exportExit = await runCli(
      ['catalog', 'export', '--include-pricing', '--out', 'catalog.yaml'],
      io,
    );
    expect(exportExit).toBe(0);
    const exported = yaml.load(fs.readFileSync(path.join(cwd, 'catalog.yaml'), 'utf8')) as any;
    const openAiModel = exported.providers
      .find((provider: any) => provider.id === 'openai')
      .models.find((model: any) => model.id === 'gpt-4o');
    expect(openAiModel.pricing).toMatchObject({
      currency: 'USD',
      stale_after_days: 90,
      pricing_confidence: 'low',
      source: 'builtin-reference',
      source_type: 'docs_review',
      input_per_1m_tokens: expect.any(Number),
      output_per_1m_tokens: expect.any(Number),
    });
  });

  it('lists catalog refresh sources', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'sources'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('openrouter');
    expect(stdout.join('\n')).toContain('zeroeval');
    expect(stdout.join('\n')).toContain('huggingface');
    expect(stdout.join('\n')).toContain('deepgram');
    expect(stdout.join('\n')).toContain('automatic=yes');
  });

  it('refreshes OpenRouter public catalog into an override file', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-test',
            name: 'OpenAI: GPT Test',
            context_length: 128000,
            architecture: {
              input_modalities: ['text', 'image'],
              output_modalities: ['text'],
            },
            pricing: {
              prompt: '0.000001',
              completion: '0.000002',
            },
            supported_parameters: ['tools', 'response_format'],
          },
        ],
      }),
    } as Response));

    try {
      const exitCode = await runCli(
        ['catalog', 'refresh', 'openrouter', '--out', 'catalog.override.yaml'],
        io,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toHaveLength(0);
      expect(stdout.join('\n')).toContain('Models: 1');
      expect(stdout.join('\n')).toContain('Canonical models: 1');
      const exported = yaml.load(fs.readFileSync(path.join(cwd, 'catalog.override.yaml'), 'utf8')) as any;
      const model = exported.providers.openrouter.models[0];
      expect(exported._siftgate_internal.canonical_registry).toMatchObject({
        primary_source: 'openrouter',
        model_count: 1,
        models: [
          {
            canonical_id: 'openai/gpt-test',
            source_model_id: 'openai/gpt-test',
            source_provider_slug: 'openai',
            pricing_reference: expect.objectContaining({
              input: 1,
              output: 2,
              manual_review_required: true,
              pricing_confidence: 'medium',
            }),
          },
        ],
      });
      expect(model).toMatchObject({
        id: 'openai/gpt-test',
        modalities: ['text', 'vision'],
        pricing: expect.objectContaining({
          input: 1,
          output: 2,
          source: 'openrouter-public-api',
          manual_review_required: false,
          pricing_confidence: 'high',
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('syncs OpenRouter public catalog into the local managed cache by default', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-sync',
            name: 'OpenAI: GPT Sync',
            context_length: 128000,
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            pricing: {
              prompt: '0.0000015',
              completion: '0.0000025',
            },
            supported_parameters: ['tools'],
          },
        ],
      }),
    } as Response));

    try {
      const exitCode = await runCli(['catalog', 'sync', 'openrouter'], io);

      expect(exitCode).toBe(0);
      expect(stderr).toHaveLength(0);
      expect(stdout.join('\n')).toContain('Output target: cache');
      expect(stdout.join('\n')).toContain('Canonical models: 1');
      const cachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
      expect(fs.existsSync(cachePath)).toBe(true);
      const exported = yaml.load(fs.readFileSync(cachePath, 'utf8')) as any;
      expect(exported._siftgate_internal.canonical_registry).toMatchObject({
        primary_source: 'openrouter',
        model_count: 1,
      });
      const model = exported.providers.openrouter.models[0];
      expect(model).toMatchObject({
        id: 'openai/gpt-sync',
        pricing: expect.objectContaining({
          input: 1.5,
          output: 2.5,
          source: 'openrouter-public-api',
          last_sync: '2026-05-03T00:00:00.000Z',
          pricing_confidence: 'high',
        }),
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('syncs ZeroEval canonical overlay into the local managed cache and records diagnostics', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);
    const cachePath = path.join(cwd, '.siftgate/catalog-sync-cache.yaml');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      [
        'version: 1',
        '_siftgate_internal:',
        '  canonical_registry:',
        '    version: 1',
        '    primary_source: openrouter',
        '    source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '    generated_at: 2026-05-02T00:00:00.000Z',
        '    models:',
        '      - canonical_id: openai/gpt-4o',
        '        source_model_id: openai/gpt-4o',
        '        source_provider_slug: openai',
        '        display_name: "OpenAI: GPT-4o"',
        '        canonical_slug: openai/gpt-4o',
        '        input_modalities: [text, image]',
        '        output_modalities: [text]',
        '        supported_parameters: [tools, response_format]',
        '        pricing_reference:',
        '          input: 5',
        '          output: 15',
        '          source: openrouter-public-api',
        '          source_type: aggregator_api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          last_updated: 2026-05-02',
        '          last_sync: 2026-05-02T00:00:00.000Z',
        '          retrieved_at: 2026-05-02T00:00:00.000Z',
        '          last_verified_at: 2026-05-02T00:00:00.000Z',
        '          manual_review_required: true',
        '          stale_after_days: 7',
        '          pricing_confidence: medium',
        '          currency: USD',
        '        source_metadata:',
        '          source: openrouter-public-api',
        '          source_url: https://openrouter.ai/api/v1/models?output_modalities=all',
        '          synced_at: 2026-05-02T00:00:00.000Z',
        '          dataset_role: canonical_primary',
        'providers: {}',
        '',
      ].join('\n'),
      'utf8',
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        {
          model_id: 'chatgpt-4o-latest',
          name: 'ChatGPT-4o Latest',
          organization: 'OpenAI',
          organization_id: 'openai',
          context: 128000,
          release_date: '2024-05-13',
          announcement_date: '2024-05-13',
          multimodal: true,
          input_price: 2.5,
          output_price: 10,
          throughput: 132,
          gpqa_score: 0.84,
        },
        {
          model_id: 'unknown-model',
          name: 'Unknown model',
          organization: 'OpenAI',
          organization_id: 'openai',
        },
        {
          model_id: 'mystery-model',
          name: 'Mystery',
          organization: 'Mystery Labs',
          organization_id: 'mystery',
        },
      ]),
    } as Response));

    try {
      const exitCode = await runCli(['catalog', 'sync', 'zeroeval'], io);

      expect(exitCode).toBe(0);
      expect(stderr).toHaveLength(0);
      expect(stdout.join('\n')).toContain('Provider: zeroeval');
      expect(stdout.join('\n')).toContain('Matched canonical models: 1');
      expect(stdout.join('\n')).toContain('Projected provider models: 1');
      expect(fs.existsSync(cachePath)).toBe(true);
      const exported = yaml.load(fs.readFileSync(cachePath, 'utf8')) as any;
      expect(Object.keys(exported.providers)).toEqual(['openai']);
      expect(exported.providers.openai.models[0]).toMatchObject({
        id: 'gpt-4o',
        display_name: 'ChatGPT-4o Latest',
        limits: { max_context_tokens: 128000 },
        pricing: expect.objectContaining({
          input: 5,
          output: 15,
          source: 'openrouter-public-api',
          manual_review_required: true,
          pricing_confidence: 'medium',
        }),
        enrichment: expect.objectContaining({
          source: 'zeroeval',
          match_strategy: 'explicit_alias',
          match_confidence: 'high',
          organization_id: 'openai',
          release_date: '2024-05-13',
          throughput: 132,
          secondary_pricing_reference: expect.objectContaining({
            input: 2.5,
            output: 10,
            source: 'zeroeval',
          }),
        }),
      });
      expect(exported._siftgate_internal.diagnostics.zeroeval_overlay).toMatchObject({
        matched_model_count: 1,
        projected_model_count: 1,
        high_confidence_match_count: 1,
        low_confidence_match_count: 0,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('fails ZeroEval refresh cleanly when no canonical registry exists yet', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ([]),
    } as Response));

    try {
      const exitCode = await runCli(['catalog', 'refresh', 'zeroeval'], io);

      expect(exitCode).toBe(1);
      expect(stdout).toHaveLength(0);
      expect(stderr.join('\n')).toContain(
        'catalog_refresh_zeroeval_missing_canonical_registry',
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('reports a custom sync cache path when catalog sync writes to --out', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'openai/gpt-sync-custom',
            name: 'OpenAI: GPT Sync Custom',
            context_length: 128000,
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
            pricing: {
              prompt: '0.000001',
              completion: '0.000002',
            },
            supported_parameters: [],
          },
        ],
      }),
    } as Response));

    try {
      const exitCode = await runCli(
        ['catalog', 'sync', 'openrouter', '--write-to', 'cache', '--out', 'custom/cache.yaml', '--json'],
        io,
      );

      expect(exitCode).toBe(0);
      expect(stderr).toHaveLength(0);
      const customCachePath = path.join(cwd, 'custom/cache.yaml');
      expect(fs.existsSync(customCachePath)).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.siftgate/catalog-sync-cache.yaml'))).toBe(false);
      const result = JSON.parse(stdout.join('\n'));
      expect(result.sync_status.cache_file).toBe(customCachePath);
      expect(result.sync_status.cache_found).toBe(true);
      expect(result.sync_status.providers.find((provider: any) => provider.provider === 'openrouter')).toMatchObject({
        last_sync: '2026-05-03T00:00:00.000Z',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('rejects catalog sync for providers without an explicit automatic adapter', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'sync', 'anthropic'], io);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr.join('\n')).toContain('catalog_sync_unsupported_provider');
  });

  it('imports and validates a local override file', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      ['catalog', 'import', '--file', fixture('catalog.override.yaml')],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Result: OK');
    expect(fs.existsSync(path.join(cwd, 'catalog.override.yaml'))).toBe(true);

    const validateExit = await runCli(['catalog', 'validate'], io);
    expect(validateExit).toBe(0);
  });

  it('refuses to overwrite an existing override without --force', async () => {
    const cwd = await makeTempDir();
    fs.writeFileSync(path.join(cwd, 'catalog.override.yaml'), 'version: 1\nproviders: {}\n', 'utf8');
    const { io, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      ['catalog', 'import', '--file', fixture('catalog.override.yaml')],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('already exists');
  });

  it('treats importing the active override file as a validation pass', async () => {
    const cwd = await makeTempDir();
    fs.copyFileSync(fixture('catalog.override.yaml'), path.join(cwd, 'catalog.override.yaml'));
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      ['catalog', 'import', '--file', './catalog.override.yaml'],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('override already active');
  });

  it('fails validation when an override contains secret-looking fields', async () => {
    const cwd = await makeTempDir();
    const { io, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      ['catalog', 'import', '--file', fixture('secret.catalog.override.yaml')],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('catalog_override_secret_field');
  });
});
