import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runCli } from '../../src/cli/siftgate';
import {
  migrateLiteLlmConfig,
  migrateLiteLlmConfigFile,
} from '../../src/cli/litellm-migrator';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures/litellm');

describe('LiteLLM migration', () => {
  it('maps LiteLLM models, API key env refs, fallbacks, and router settings', () => {
    const sourcePath = path.join(FIXTURES, 'basic.litellm.yaml');
    const source = yaml.load(fs.readFileSync(sourcePath, 'utf8'));
    const result = migrateLiteLlmConfig(source, sourcePath);

    expect(result.config.nodes).toHaveLength(3);
    expect(result.config.nodes[0]).toMatchObject({
      id: 'openai-gpt-4o-public-1',
      protocol: 'chat_completions',
      base_url: 'https://api.openai.com',
      endpoint: '/v1/chat/completions',
      api_key: '${OPENAI_API_KEY}',
      models: ['gpt-4o'],
      model_aliases: { 'gpt-4o-public': 'gpt-4o' },
      max_context_tokens: 128000,
      timeout_ms: 30000,
    });
    expect(result.config.nodes[1]).toMatchObject({
      protocol: 'messages',
      api_key: '${ANTHROPIC_API_KEY}',
      auth_type: 'x-api-key',
      headers: { 'anthropic-version': '2023-06-01' },
    });
    expect(result.config.nodes[2]).toMatchObject({
      protocol: 'chat_completions',
      base_url: 'https://example-resource.openai.azure.com',
      auth_type: 'x-api-key',
      api_key: '${AZURE_OPENAI_API_KEY}',
      endpoint: '/openai/deployments/prod-gpt-4o/chat/completions?api-version=2024-02-01',
    });

    expect(result.config.routing.optimization).toBe('latency');
    expect(result.config.routing.retry).toMatchObject({ max_retries: 2 });
    expect(result.config.routing.tiers.standard.primary).toEqual({
      node: 'openai-gpt-4o-public-1',
      model: 'gpt-4o',
    });
    expect(result.config.routing.tiers.standard.fallbacks).toEqual([
      {
        node: 'anthropic-claude-sonnet-2',
        model: 'claude-sonnet-4-20250514',
      },
    ]);
    expect(result.config.routing.tiers.standard.strategy).toBe('least_latency');
    expect(result.config.models_pricing['gpt-4o']).toEqual({
      input: 2.5,
      output: 10,
    });
    expect(result.report.incompatible).toHaveLength(0);
    expect(result.report.manual.some((item) => item.path === 'litellm_settings')).toBe(true);
    expect(result.yaml).toContain('Migration report summary');
  });

  it('reports unsupported providers and avoids copying literal API keys', () => {
    const sourcePath = path.join(FIXTURES, 'unsupported.litellm.yaml');
    const result = migrateLiteLlmConfig(
      yaml.load(fs.readFileSync(sourcePath, 'utf8')),
      sourcePath,
    );

    expect(result.config.nodes[0].base_url).toBe('https://unknown_provider.example.invalid');
    expect(result.config.nodes[0].api_key).toBe('${UNKNOWN_PROVIDER_PRIVATE_MODEL_API_KEY}');
    expect(result.yaml).not.toContain('literal-secret-value');
    expect(result.report.incompatible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'model_list[0].litellm_params.api_base',
        }),
      ]),
    );
    expect(result.report.manual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'model_list[0].litellm_params.api_key',
        }),
      ]),
    );
  });

  it('writes migrated config and refuses to overwrite by default', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-litellm-'));
    const outPath = path.join(tempDir, 'gateway.generated.yaml');
    const sourcePath = path.join(FIXTURES, 'basic.litellm.yaml');

    const first = migrateLiteLlmConfigFile({
      configPath: sourcePath,
      outputPath: outPath,
    });
    expect(fs.existsSync(outPath)).toBe(true);
    expect(first.outputPath).toBe(outPath);

    expect(() =>
      migrateLiteLlmConfigFile({
        configPath: sourcePath,
        outputPath: outPath,
      }),
    ).toThrow('Refusing to overwrite existing');
  });

  it('CLI migrate writes output and prints a human report', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-litellm-cli-'));
    const outPath = path.join(tempDir, 'gateway.config.yaml');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(
      [
        'migrate',
        '--from',
        'litellm',
        '--config',
        path.join(FIXTURES, 'basic.litellm.yaml'),
        '--out',
        outPath,
      ],
      {
        cwd: process.cwd(),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('\n')).toContain('SiftGate LiteLLM migration');
    expect(fs.readFileSync(outPath, 'utf8')).toContain('gpt-4o-public');
  });

  it('CLI migrate refuses unsupported sources and existing default output', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-litellm-cli-'));
    fs.writeFileSync(path.join(tempDir, 'gateway.config.yaml'), 'existing: true\n');
    const stderr: string[] = [];

    const unsupportedCode = await runCli(
      ['migrate', '--from', 'other', '--config', path.join(FIXTURES, 'basic.litellm.yaml')],
      {
        cwd: tempDir,
        stdout: jest.fn(),
        stderr: (message) => stderr.push(message),
      },
    );
    expect(unsupportedCode).toBe(1);
    expect(stderr.join('\n')).toContain('Only --from litellm is supported');

    stderr.length = 0;
    const overwriteCode = await runCli(
      ['migrate', '--from', 'litellm', '--config', path.join(FIXTURES, 'basic.litellm.yaml')],
      {
        cwd: tempDir,
        stdout: jest.fn(),
        stderr: (message) => stderr.push(message),
      },
    );
    expect(overwriteCode).toBe(1);
    expect(stderr.join('\n')).toContain('Refusing to overwrite existing');
  });
});
