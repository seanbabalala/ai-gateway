import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { runCli } from '../../src/cli/siftgate';
import type { CommandRunner } from '../../src/cli/plugin-manager';

const fixturePlugin = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'plugins',
  'local-compatible',
);

async function makeTempDir(): Promise<string> {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-plugin-cli-'));
}

function readPluginsConfig(cwd: string, filename = 'plugins.config.yaml'): any {
  const raw = fs.readFileSync(path.join(cwd, filename), 'utf8');
  return yaml.load(raw);
}

function makeIo(cwd: string, runner?: CommandRunner) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      cwd,
      env: {},
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
      runCommand: runner || jest.fn(),
      now: () => new Date('2026-05-02T00:00:00.000Z'),
    },
    stdout,
    stderr,
  };
}

describe('siftgate plugin CLI', () => {
  it('installs a local plugin declaration without touching gateway.config.yaml', async () => {
    const cwd = await makeTempDir();
    fs.writeFileSync(path.join(cwd, 'gateway.config.yaml'), 'nodes: []\n', 'utf8');
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      ['plugin', 'install', fixturePlugin, '--config', 'plugins.config.yaml'],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('local-compatible-plugin');

    const config = readPluginsConfig(cwd);
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]).toMatchObject({
      name: 'local-compatible-plugin',
      source: 'local',
      version: '1.2.3',
      required: true,
      gateway: {
        required: '>=0.6.0 <0.7.0',
        checked_with: '0.6.0',
      },
    });
    expect(fs.readFileSync(path.join(cwd, 'gateway.config.yaml'), 'utf8')).toBe('nodes: []\n');
  });

  it('installs an npm scoped plugin after metadata compatibility check', async () => {
    const cwd = await makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: CommandRunner = jest.fn(async (command, args) => {
      calls.push({ command, args });
      if (args[0] === 'view') {
        return {
          stdout: JSON.stringify({
            name: '@siftgate/plugin-guardrails',
            version: '2.0.0',
            peerDependencies: { siftgate: '^0.6.0' },
          }),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const { io, stderr } = makeIo(cwd, runner);

    const exitCode = await runCli(
      ['plugin', 'install', '@siftgate/plugin-guardrails'],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(calls).toEqual([
      { command: 'npm', args: ['view', '@siftgate/plugin-guardrails', '--json'] },
      { command: 'npm', args: ['install', '@siftgate/plugin-guardrails', '--save'] },
    ]);
    expect(readPluginsConfig(cwd).plugins[0]).toMatchObject({
      name: '@siftgate/plugin-guardrails',
      source: 'npm',
      package: '@siftgate/plugin-guardrails',
      path: '@siftgate/plugin-guardrails',
      version: '2.0.0',
    });
  });

  it('lists and removes declared plugins', async () => {
    const cwd = await makeTempDir();
    fs.writeFileSync(
      path.join(cwd, 'plugins.config.yaml'),
      yaml.dump({
        plugins: [
          {
            name: '@siftgate/plugin-redis-cache',
            source: 'npm',
            package: '@siftgate/plugin-redis-cache',
            path: '@siftgate/plugin-redis-cache',
            version: '1.0.0',
          },
        ],
      }),
      'utf8',
    );
    const { io, stdout, stderr } = makeIo(cwd);

    const listExit = await runCli(['plugin', 'list'], io);
    const removeExit = await runCli(
      ['plugin', 'remove', '@siftgate/plugin-redis-cache'],
      io,
    );

    expect(listExit).toBe(0);
    expect(removeExit).toBe(0);
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('@siftgate/plugin-redis-cache');
    expect(readPluginsConfig(cwd).plugins).toEqual([]);
  });

  it('refuses duplicate installs unless force is explicit', async () => {
    const cwd = await makeTempDir();
    const { io, stderr } = makeIo(cwd);

    const first = await runCli(['plugin', 'install', fixturePlugin], io);
    const second = await runCli(['plugin', 'install', fixturePlugin], io);

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(stderr.join('\n')).toContain('already declared');
  });

  it('rejects non-SiftGate npm package names', async () => {
    const cwd = await makeTempDir();
    const runner = jest.fn();
    const { io, stderr } = makeIo(cwd, runner);

    const exitCode = await runCli(['plugin', 'install', 'left-pad'], io);

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('Only @siftgate/plugin-* packages');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects plugins with incompatible gateway ranges', async () => {
    const cwd = await makeTempDir();
    const runner: CommandRunner = jest.fn(async () => ({
      stdout: JSON.stringify({
        name: '@siftgate/plugin-future',
        version: '9.0.0',
        peerDependencies: { siftgate: '>=0.7.0' },
      }),
      stderr: '',
    }));
    const { io, stderr } = makeIo(cwd, runner);

    const exitCode = await runCli(
      ['plugin', 'install', '@siftgate/plugin-future'],
      io,
    );

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('requires SiftGate >=0.7.0');
  });
});
