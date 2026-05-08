import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database = require('better-sqlite3');
import {
  buildV2MigrationDryRunReport,
  formatV2MigrationDryRunReport,
} from '../../src/cli/v2-migration-dry-run';
import { runCli } from '../../src/cli/siftgate';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/migration', name);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-v2-dry-run-'));
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
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    },
    stdout,
    stderr,
  };
}

function createSqliteFixture(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE gateway_api_keys (id varchar PRIMARY KEY, name varchar);
      CREATE TABLE local_teams (id varchar PRIMARY KEY, name varchar);
      CREATE TABLE budget_rules (id integer PRIMARY KEY AUTOINCREMENT, type varchar);
      CREATE TABLE agent_profiles (id varchar PRIMARY KEY, name varchar);
      CREATE TABLE call_logs (id integer PRIMARY KEY AUTOINCREMENT, request_id varchar);
      CREATE TABLE eval_datasets (id varchar PRIMARY KEY, name varchar);
      CREATE TABLE eval_experiment_runs (id varchar PRIMARY KEY, dataset_id varchar);
      CREATE TABLE eval_sample_results (id varchar PRIMARY KEY, run_id varchar);
      CREATE TABLE batch_jobs (id varchar PRIMARY KEY, status varchar);

      INSERT INTO gateway_api_keys (id, name) VALUES ('key_1', 'Engineering'), ('key_2', 'Support');
      INSERT INTO local_teams (id, name) VALUES ('team_1', 'Platform');
      INSERT INTO budget_rules (type) VALUES ('daily_cost'), ('daily_tokens'), ('team_daily_cost');
      INSERT INTO agent_profiles (id, name) VALUES ('agent_1', 'Code Review'), ('agent_2', 'Docs');
      INSERT INTO call_logs (request_id) VALUES ('req_1'), ('req_2'), ('req_3');
      INSERT INTO eval_datasets (id, name) VALUES ('dataset_1', 'Smoke');
      INSERT INTO eval_experiment_runs (id, dataset_id) VALUES ('run_1', 'dataset_1');
      INSERT INTO eval_sample_results (id, run_id) VALUES ('sample_1', 'run_1'), ('sample_2', 'run_1');
      INSERT INTO batch_jobs (id, status) VALUES ('batch_1', 'completed');
    `);
  } finally {
    db.close();
  }
}

describe('v1 to v2 migration dry run', () => {
  it('builds a stable metadata-only report for a normal v1.9 config and SQLite database', () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    const dbPath = path.join(cwd, 'data', 'gateway.db');
    fs.copyFileSync(fixture('siftgate.v1.9.gateway.yaml'), configPath);
    createSqliteFixture(dbPath);
    const before = fs.readFileSync(dbPath);

    const report = buildV2MigrationDryRunReport({
      cwd,
      configPath,
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    });

    expect(report).toMatchObject({
      version: 'siftgate.v2_migration_dry_run.v1',
      dry_run: true,
      mutates_data: false,
      config_found: true,
      database: {
        type: 'sqlite',
        path: dbPath,
        sqlite_found: true,
        inspected: true,
      },
      default_workspace: {
        organization_id: 'default-org',
        organization_name: 'Default Organization',
        workspace_id: 'default-workspace',
        workspace_name: 'Default Workspace',
        workspace_slug: 'default-workspace',
      },
    });
    expect(report.plan.gateway_api_keys).toMatchObject({ source: 'database', table: 'gateway_api_keys', count: 2 });
    expect(report.plan.local_teams).toMatchObject({ source: 'database', table: 'local_teams', count: 1 });
    expect(report.plan.budgets).toMatchObject({ source: 'database', table: 'budget_rules', count: 3 });
    expect(report.plan.namespaces.count).toBe(2);
    expect(report.plan.nodes.count).toBe(2);
    expect(report.plan.routing_policies.count).toBe(6);
    expect(report.plan.agent_profiles.count).toBe(2);
    expect(report.plan.call_logs.count).toBe(3);
    expect(report.plan.eval_rows.count).toBe(4);
    expect(report.plan.mcp_servers.count).toBe(1);
    expect(report.plan.batch_jobs.count).toBe(1);
    expect(report.plan.dashboard_users.count).toBe(1);
    expect(report.totals).toMatchObject({
      assignable_resources: 28,
      database_rows: 16,
      blockers: 0,
      warnings: 0,
    });
    expect(report.assignment_strategy).toContain('without copying prompts');
    expect(report.backup_recommendation).toContain('back up gateway.config.yaml');
    expect(report.validation_commands).toContain('npm run validate:config');
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('reports zero database-backed rows for an empty local SQLite database without mutating it', () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    const dbPath = path.join(cwd, 'data', 'gateway.db');
    fs.copyFileSync(fixture('siftgate.v1.9.gateway.yaml'), configPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.close();
    const before = fs.readFileSync(dbPath);

    const report = buildV2MigrationDryRunReport({ cwd, configPath });

    expect(report.database.inspected).toBe(true);
    expect(report.plan.gateway_api_keys).toMatchObject({ source: 'config', count: 2 });
    expect(report.plan.local_teams).toMatchObject({ source: 'config', count: 1 });
    expect(report.plan.budgets).toMatchObject({ source: 'config', count: 4 });
    expect(report.plan.call_logs.count).toBe(0);
    expect(report.plan.eval_rows.count).toBe(0);
    expect(report.info.filter((issue) => issue.code === 'table_missing')).toHaveLength(9);
    expect(fs.readFileSync(dbPath).equals(before)).toBe(true);
  });

  it('handles partially configured local dev when SQLite is absent', () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    fs.copyFileSync(fixture('siftgate.v1.9.gateway.yaml'), configPath);

    const report = buildV2MigrationDryRunReport({
      cwd,
      configPath,
      organizationName: 'Acme AI',
      workspaceName: 'Agents Lab',
    });

    expect(report.database).toMatchObject({
      type: 'sqlite',
      path: path.join(cwd, 'data', 'gateway.db'),
      sqlite_found: false,
      inspected: false,
      reason: 'sqlite_not_found',
    });
    expect(report.default_workspace).toMatchObject({
      organization_name: 'Acme AI',
      workspace_name: 'Agents Lab',
      workspace_slug: 'agents-lab',
    });
    expect(report.blockers).toHaveLength(0);
    expect(report.info.map((issue) => issue.code)).toContain('sqlite_not_found');
  });

  it('does not connect to PostgreSQL during dry run and emits a warning', () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    fs.writeFileSync(
      configPath,
      [
        'server: { port: 2099, host: 0.0.0.0 }',
        'database: { type: postgres, url: postgresql://example.invalid/siftgate }',
        'auth: { api_keys: [] }',
        'nodes: []',
        'routing: { tiers: {} }',
        'budget: { daily_cost_limit: 10 }',
        'models_pricing: {}',
      ].join('\n'),
      'utf8',
    );

    const report = buildV2MigrationDryRunReport({ cwd, configPath });

    expect(report.database).toMatchObject({
      type: 'postgres',
      url_configured: true,
      inspected: false,
      reason: 'postgres_not_inspected',
    });
    expect(report.warnings).toEqual([
      expect.objectContaining({ code: 'postgres_not_inspected' }),
    ]);
  });

  it('returns a blocker for a missing config', () => {
    const cwd = makeTempDir();

    const report = buildV2MigrationDryRunReport({
      cwd,
      configPath: 'missing.gateway.yaml',
      now: () => new Date('2026-05-08T00:00:00.000Z'),
    });

    expect(report.config_found).toBe(false);
    expect(report.blockers).toEqual([
      expect.objectContaining({ code: 'config_not_found' }),
    ]);
    expect(report.totals.blockers).toBe(1);
  });

  it('exposes migrate-v2 through the CLI with stable JSON and dry-run enforcement', async () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    const dbPath = path.join(cwd, 'data', 'gateway.db');
    fs.copyFileSync(fixture('siftgate.v1.9.gateway.yaml'), configPath);
    createSqliteFixture(dbPath);
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(
      [
        'migrate-v2',
        '--dry-run',
        '--config',
        configPath,
        '--sqlite-path',
        dbPath,
        '--organization-name',
        'Acme',
        '--workspace-name',
        'AI Platform',
        '--json',
      ],
      io,
    );

    expect(exitCode).toBe(0);
    expect(stderr).toHaveLength(0);
    const report = JSON.parse(stdout.join('\n'));
    expect(report.version).toBe('siftgate.v2_migration_dry_run.v1');
    expect(report.dry_run).toBe(true);
    expect(report.mutates_data).toBe(false);
    expect(report.default_workspace.workspace_slug).toBe('ai-platform');
    expect(report.plan.gateway_api_keys.count).toBe(2);

    stdout.length = 0;
    stderr.length = 0;
    const missingDryRunCode = await runCli(['migrate-v2', '--config', configPath], io);
    expect(missingDryRunCode).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr.join('\n')).toContain('only supports migrate-v2 --dry-run');
  });

  it('uses exit code 2 for CLI blockers and formats a human-readable report', async () => {
    const cwd = makeTempDir();
    const { io, stdout, stderr } = makeIo(cwd);

    const exitCode = await runCli(['migrate-v2', '--dry-run', '--config', 'missing.yaml'], io);

    expect(exitCode).toBe(2);
    expect(stderr).toHaveLength(0);
    const output = stdout.join('\n');
    expect(output).toContain('SiftGate v1 to v2 migration dry run');
    expect(output).toContain('Result: BLOCKED');
    expect(output).toContain('config_not_found');
  });

  it('formats reports with resource counts and validation commands', () => {
    const cwd = makeTempDir();
    const configPath = path.join(cwd, 'gateway.config.yaml');
    fs.copyFileSync(fixture('siftgate.v1.9.gateway.yaml'), configPath);

    const output = formatV2MigrationDryRunReport(
      buildV2MigrationDryRunReport({
        cwd,
        configPath,
        now: () => new Date('2026-05-08T00:00:00.000Z'),
      }),
    );

    expect(output).toContain('Default v2 target:');
    expect(output).toContain('- gateway_api_keys: 2');
    expect(output).toContain('npm run build');
    expect(output).toContain('Result: OK (dry-run only)');
  });
});
