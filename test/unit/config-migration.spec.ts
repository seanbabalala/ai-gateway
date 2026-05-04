import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runCli } from '../../src/cli/siftgate';
import {
  migrateConfig,
  migrateConfigFile,
} from '../../src/cli/config-migrator';

const FIXTURES = path.resolve(process.cwd(), 'test/fixtures/migration');

function loadFixture(name: string): unknown {
  return yaml.load(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

describe('compat config migration', () => {
  it('maps New API channel exports into SiftGate nodes and v0.8 model buckets', () => {
    const sourcePath = path.join(FIXTURES, 'newapi.channels.yaml');
    const result = migrateConfig(loadFixture('newapi.channels.yaml'), {
      from: 'newapi',
      to: 'siftgate',
      sourcePath,
    });

    expect(result.config?.nodes).toHaveLength(3);
    expect(result.config?.nodes[0]).toMatchObject({
      id: 'newapi-openai-prod-1',
      protocol: 'chat_completions',
      base_url: 'https://api.openai.com',
      api_key: '${OPENAI_API_KEY}',
      models: ['gpt-4o', 'gpt-4o-mini'],
      embedding_models: ['text-embedding-3-small'],
      image_models: ['gpt-image-1'],
      audio_models: ['tts-1'],
      realtime_models: ['gpt-4o-realtime-preview'],
      model_aliases: { gpt4: 'gpt-4o' },
    });
    expect(result.config?.nodes[1]).toMatchObject({
      protocol: 'messages',
      auth_type: 'x-api-key',
      api_key: '${ANTHROPIC_CHANNEL_2_API_KEY}',
      headers: { 'anthropic-version': '2023-06-01' },
    });
    expect(result.config?.nodes[2]).toMatchObject({
      video_models: ['veo-3.1-generate-preview'],
      video_endpoint: '/v1/videos/generations',
    });
    expect(result.yaml).toContain('generated from New API');
    expect(result.yaml).not.toContain('literal-claude-secret');
    expect(result.report.unsupported).toHaveLength(0);
    expect(result.report.manual_actions.some((item) => item.path === 'channels[0]')).toBe(true);
    expect(result.report.mapping_notes.length).toBeGreaterThan(0);
  });

  it('maps One API numeric channel types, JSON mappings, and rerank buckets', () => {
    const result = migrateConfig(loadFixture('oneapi.channels.yaml'), {
      from: 'oneapi',
      to: 'siftgate',
      sourcePath: path.join(FIXTURES, 'oneapi.channels.yaml'),
    });

    expect(result.config?.nodes[0]).toMatchObject({
      id: 'oneapi-one-api-openai-channel-1',
      protocol: 'chat_completions',
      api_key: '${OPENAI_API_KEY}',
      models: ['gpt-4o-mini'],
      embedding_models: ['text-embedding-3-small'],
      model_aliases: { mini: 'gpt-4o-mini' },
    });
    expect(result.config?.nodes[1]).toMatchObject({
      protocol: 'messages',
      api_key: '${ANTHROPIC_API_KEY}',
      models: ['claude-sonnet-4-20250514'],
    });
    expect(result.config?.nodes[2]).toMatchObject({
      rerank_models: ['rerank-english-v3.0'],
      rerank_endpoint: '/v2/rerank',
    });
  });

  it('exports SiftGate v0.8 config to LiteLLM and New API scaffolds without provider secrets', () => {
    const source = loadFixture('siftgate.v0.8.gateway.yaml');
    const litellm = migrateConfig(source, {
      from: 'siftgate',
      to: 'litellm',
      sourcePath: path.join(FIXTURES, 'siftgate.v0.8.gateway.yaml'),
    });
    const litellmOutput = litellm.output as any;

    expect(litellmOutput.model_list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_name: 'gpt4',
          litellm_params: expect.objectContaining({
            model: 'openai/gpt-4o',
            api_key: '${OPENAI_API_KEY}',
            api_base: 'https://api.openai.com',
          }),
        }),
        expect.objectContaining({
          model_name: 'text-embedding-3-small',
          model_info: expect.objectContaining({ mode: 'embedding' }),
        }),
        expect.objectContaining({
          model_name: 'veo-3.1-generate-preview',
          model_info: expect.objectContaining({ mode: 'video' }),
        }),
      ]),
    );
    expect(litellm.yaml).not.toContain('literal-secret-not-exported');
    expect(litellm.yaml).toContain('${CLAUDE_PROD_API_KEY}');
    expect(litellm.report.partially_supported.length).toBeGreaterThan(0);

    const newapi = migrateConfig(source, {
      from: 'siftgate',
      to: 'newapi',
      sourcePath: path.join(FIXTURES, 'siftgate.v0.8.gateway.yaml'),
    });
    const newapiOutput = newapi.output as any;
    expect(newapiOutput.channels).toHaveLength(3);
    expect(newapiOutput.channels[0]).toMatchObject({
      name: 'OpenAI Production',
      type: 1,
      key: '${OPENAI_API_KEY}',
      models: 'gpt-4o,gpt-4o-mini,text-embedding-3-small,gpt-image-1,tts-1,gpt-4o-realtime-preview',
      siftgate_model_buckets: expect.objectContaining({
        image: ['gpt-image-1'],
        realtime: ['gpt-4o-realtime-preview'],
      }),
    });
    expect(newapi.yaml).not.toContain('literal-secret-not-exported');
  });

  it('generic CLI migrate writes New API imports and dry-runs SiftGate exports', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-config-migrate-'));
    const outPath = path.join(tempDir, 'gateway.generated.yaml');
    const stdout: string[] = [];
    const stderr: string[] = [];

    const importCode = await runCli(
      [
        'migrate',
        '--from',
        'newapi',
        '--config',
        path.join(FIXTURES, 'newapi.channels.yaml'),
        '--out',
        outPath,
      ],
      {
        cwd: process.cwd(),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(importCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(fs.readFileSync(outPath, 'utf8')).toContain('generated from New API');

    stdout.length = 0;
    const exportCode = await runCli(
      [
        'migrate',
        '--to',
        'oneapi',
        '--config',
        path.join(FIXTURES, 'siftgate.v0.8.gateway.yaml'),
        '--dry-run',
      ],
      {
        cwd: tempDir,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(exportCode).toBe(0);
    expect(stdout.join('\n')).toContain('Target: One API');
    expect(stdout.join('\n')).toContain('channels:');
    expect(fs.existsSync(path.join(tempDir, 'oneapi.generated.yaml'))).toBe(false);
  });

  it('generic file migrator refuses to overwrite existing target outputs unless forced', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-config-migrate-'));
    const outPath = path.join(tempDir, 'gateway.generated.yaml');
    fs.writeFileSync(outPath, 'existing: true\n');

    expect(() =>
      migrateConfigFile({
        from: 'oneapi',
        configPath: path.join(FIXTURES, 'oneapi.channels.yaml'),
        outputPath: outPath,
      }),
    ).toThrow('Refusing to overwrite existing');

    const result = migrateConfigFile({
      from: 'oneapi',
      configPath: path.join(FIXTURES, 'oneapi.channels.yaml'),
      outputPath: outPath,
      force: true,
    });
    expect(result.outputPath).toBe(outPath);
    expect(fs.readFileSync(outPath, 'utf8')).toContain('generated from One API');
  });
});
