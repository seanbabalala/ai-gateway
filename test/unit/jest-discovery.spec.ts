import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

const projectRoot = resolve(__dirname, '../..');
const unitConfig = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')).jest;
const e2eConfig = JSON.parse(readFileSync(join(projectRoot, 'test/jest-e2e.json'), 'utf8'));

describe('Jest discovery boundaries', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'siftgate-jest-discovery-')));
    for (const file of [
      'src/example.spec.ts',
      'test/unit/example.spec.ts',
      'test/e2e/example.e2e-spec.ts',
      'packages/client/test/example.spec.ts',
      'output/old-worktree/test/unit/example.spec.ts',
      'output/old-worktree/test/e2e/example.e2e-spec.ts',
      '.local-dev/foreign-project/example.spec.ts',
      '.local-dev/foreign-project/example.e2e-spec.ts',
    ]) {
      const target = join(fixtureRoot, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'throw new Error("Discovery must not execute tests");\n');
    }
    // Duplicate packages outside the allowlist must not enter the haste map.
    for (const folder of ['output/old-worktree', '.local-dev/foreign-project']) {
      writeFileSync(join(fixtureRoot, folder, 'package.json'), '{"name":"duplicate-fixture"}');
    }
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  function discover(config: Record<string, unknown>): string[] {
    const result = spawnSync(process.execPath, [
      require.resolve('jest/bin/jest'),
      '--config', JSON.stringify({ ...config, rootDir: fixtureRoot, transform: {}, cache: false }),
      '--listTests', '--json', '--runInBand',
    ], { encoding: 'utf8', timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.stderr).not.toContain('Haste module naming collision');
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as string[])
      .map((file) => file.slice(fixtureRoot.length + 1))
      .sort();
  }

  it('discovers backend and SDK unit tests, but not historical worktrees or local caches', () => {
    expect(discover(unitConfig)).toEqual([
      'packages/client/test/example.spec.ts',
      'src/example.spec.ts',
      'test/unit/example.spec.ts',
    ]);
  });

  it('discovers only the maintained end-to-end directory', () => {
    expect(discover(e2eConfig)).toEqual(['test/e2e/example.e2e-spec.ts']);
  });

  it('preserves the dedicated SDK test command', () => {
    expect(discover({ ...unitConfig, testRegex: 'packages/client/test/.*\\.spec\\.ts$' }))
      .toEqual(['packages/client/test/example.spec.ts']);
  });
});
