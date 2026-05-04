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
  });

  it('shows a provider from the merged catalog', async () => {
    const cwd = await makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['catalog', 'show', 'openai'], io);

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('Provider: openai');
    expect(stdout.join('\n')).toContain('gpt-4o');
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
    expect(stdout.join('\n')).toContain('Pricing hygiene: checked');

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
    });
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
