import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Database = require('better-sqlite3');
import type { GatewayConfig } from '../config/gateway.config';

export type V2MigrationSeverity = 'error' | 'warning' | 'info';

export interface V2MigrationIssue {
  severity: V2MigrationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface V2MigrationCount {
  source: 'config' | 'database' | 'derived';
  count: number;
  table?: string;
  note?: string;
}

export interface V2MigrationDefaultWorkspace {
  organization_id: string;
  organization_name: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
}

export interface V2MigrationPlan {
  gateway_api_keys: V2MigrationCount;
  local_teams: V2MigrationCount;
  namespaces: V2MigrationCount;
  nodes: V2MigrationCount;
  budgets: V2MigrationCount;
  routing_policies: V2MigrationCount;
  agent_profiles: V2MigrationCount;
  call_logs: V2MigrationCount;
  eval_rows: V2MigrationCount;
  mcp_servers: V2MigrationCount;
  batch_jobs: V2MigrationCount;
  dashboard_users: V2MigrationCount;
}

export interface V2MigrationDryRunReport {
  version: 'siftgate.v2_migration_dry_run.v1';
  generated_at: string;
  dry_run: true;
  mutates_data: false;
  config_path: string;
  config_found: boolean;
  database: {
    type: 'sqlite' | 'postgres' | 'unknown';
    path?: string;
    url_configured?: boolean;
    sqlite_found?: boolean;
    inspected: boolean;
    reason?: string;
  };
  default_workspace: V2MigrationDefaultWorkspace;
  assignment_strategy: string;
  plan: V2MigrationPlan;
  totals: {
    assignable_resources: number;
    database_rows: number;
    blockers: number;
    warnings: number;
  };
  blockers: V2MigrationIssue[];
  warnings: V2MigrationIssue[];
  info: V2MigrationIssue[];
  backup_recommendation: string;
  validation_commands: string[];
  next_steps: string[];
}

export interface BuildV2MigrationDryRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  sqlitePath?: string;
  organizationName?: string;
  workspaceName?: string;
  now?: () => Date;
}

const DEFAULT_ORGANIZATION_NAME = 'Default Organization';
const DEFAULT_WORKSPACE_NAME = 'Default Workspace';

const SQLITE_TABLES = [
  'gateway_api_keys',
  'local_teams',
  'budget_rules',
  'agent_profiles',
  'call_logs',
  'eval_datasets',
  'eval_experiment_runs',
  'eval_sample_results',
  'batch_jobs',
] as const;

type SqliteTable = (typeof SQLITE_TABLES)[number];

export function buildV2MigrationDryRunReport(
  options: BuildV2MigrationDryRunOptions = {},
): V2MigrationDryRunReport {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const configPath = resolvePath(
    cwd,
    options.configPath ?? env.GATEWAY_CONFIG_PATH ?? 'gateway.config.yaml',
  );
  const generatedAt = now().toISOString();
  const organizationName = options.organizationName ?? DEFAULT_ORGANIZATION_NAME;
  const workspaceName = options.workspaceName ?? DEFAULT_WORKSPACE_NAME;

  const issues: V2MigrationIssue[] = [];
  const config = loadConfig(configPath, issues);
  const db = inspectDatabase({ cwd, config, sqlitePath: options.sqlitePath, issues });
  const tableCounts = db.sqlitePath ? inspectSqliteTables(db.sqlitePath, issues) : new Map<SqliteTable, number>();

  const defaultWorkspace: V2MigrationDefaultWorkspace = {
    organization_id: 'default-org',
    organization_name: organizationName,
    workspace_id: 'default-workspace',
    workspace_name: workspaceName,
    workspace_slug: slugify(workspaceName) || 'default-workspace',
  };

  const plan = buildPlan(config, tableCounts);
  const blockers = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const info = issues.filter((issue) => issue.severity === 'info');

  const databaseRows = Object.values(plan)
    .filter((entry) => entry.source === 'database')
    .reduce((total, entry) => total + entry.count, 0);

  return {
    version: 'siftgate.v2_migration_dry_run.v1',
    generated_at: generatedAt,
    dry_run: true,
    mutates_data: false,
    config_path: configPath,
    config_found: !!config,
    database: {
      type: config?.database?.type ?? 'unknown',
      path: db.sqlitePath,
      url_configured: config?.database?.type === 'postgres' ? !!config.database.url : undefined,
      sqlite_found: db.sqlitePath ? fs.existsSync(db.sqlitePath) : undefined,
      inspected: db.inspected,
      reason: db.reason,
    },
    default_workspace: defaultWorkspace,
    assignment_strategy:
      'v2.0 will create the default organization/workspace first, then assign all v1.x single-tenant config resources and inspected local runtime rows to that workspace without copying prompts, responses, raw headers, provider keys, media bytes, or tool payloads.',
    plan,
    totals: {
      assignable_resources: Object.values(plan).reduce((total, entry) => total + entry.count, 0),
      database_rows: databaseRows,
      blockers: blockers.length,
      warnings: warnings.length,
    },
    blockers,
    warnings,
    info,
    backup_recommendation:
      'Before running the future v2 migration, back up gateway.config.yaml, catalog.override.yaml, .env, and the SQLite database file if present; for PostgreSQL deployments, take a database snapshot with your normal PostgreSQL backup tooling.',
    validation_commands: [
      'npm run validate:config',
      'npm run release:check',
      'npm run docs:check',
      'npm run build',
    ],
    next_steps: [
      'Review blockers and warnings before attempting a v2 migration.',
      'Keep this dry-run report with release notes or change-management records.',
      'Run this command again after changing gateway.config.yaml or database location.',
    ],
  };
}

export function formatV2MigrationDryRunReport(report: V2MigrationDryRunReport): string {
  const lines = [
    'SiftGate v1 to v2 migration dry run',
    `Generated: ${report.generated_at}`,
    `Config: ${report.config_path} (${report.config_found ? 'found' : 'missing'})`,
    `Database: ${formatDatabaseSummary(report)}`,
    `Mode: dry-run (mutates_data=${report.mutates_data ? 'yes' : 'no'})`,
    '',
    'Default v2 target:',
    `  Organization: ${report.default_workspace.organization_name} (${report.default_workspace.organization_id})`,
    `  Workspace: ${report.default_workspace.workspace_name} (${report.default_workspace.workspace_id})`,
    `  Workspace slug: ${report.default_workspace.workspace_slug}`,
    '',
    'Resources assigned to the default workspace:',
    ...Object.entries(report.plan).map(([key, value]) =>
      `  - ${key}: ${value.count} (${value.source}${value.table ? `:${value.table}` : ''}${value.note ? `, ${value.note}` : ''})`,
    ),
    '',
    `Totals: assignable_resources=${report.totals.assignable_resources} database_rows=${report.totals.database_rows}`,
    '',
    formatIssueGroup('Blockers', report.blockers),
    '',
    formatIssueGroup('Warnings', report.warnings),
    '',
    formatIssueGroup('Info', report.info),
    '',
    'Backup recommendation:',
    `  ${report.backup_recommendation}`,
    '',
    'Validation commands:',
    ...report.validation_commands.map((command) => `  - ${command}`),
    '',
    report.blockers.length === 0 ? 'Result: OK (dry-run only)' : 'Result: BLOCKED (dry-run only)',
  ];
  return lines.join('\n');
}

function buildPlan(
  config: GatewayConfig | null,
  tableCounts: Map<SqliteTable, number>,
): V2MigrationPlan {
  const configApiKeys = config?.auth?.api_keys?.length ?? 0;
  const dbApiKeys = tableCounts.get('gateway_api_keys') ?? 0;
  const configLocalTeams = countConfigLocalTeams(config);
  const dbLocalTeams = tableCounts.get('local_teams') ?? 0;
  const configBudgets = countBudgetPolicies(config);
  const dbBudgets = tableCounts.get('budget_rules') ?? 0;

  return {
    gateway_api_keys: preferDatabaseCount(dbApiKeys, configApiKeys, 'gateway_api_keys', 'config auth.api_keys fallback'),
    local_teams: preferDatabaseCount(dbLocalTeams, configLocalTeams, 'local_teams', 'config local_teams fallback when present'),
    namespaces: { source: 'config', count: config?.namespaces?.length ?? 0 },
    nodes: { source: 'config', count: config?.nodes?.length ?? 0 },
    budgets: preferDatabaseCount(dbBudgets, configBudgets, 'budget_rules', 'config budget fallback'),
    routing_policies: { source: 'config', count: countRoutingPolicies(config) },
    agent_profiles: { source: 'database', table: 'agent_profiles', count: tableCounts.get('agent_profiles') ?? 0 },
    call_logs: { source: 'database', table: 'call_logs', count: tableCounts.get('call_logs') ?? 0 },
    eval_rows: {
      source: 'database',
      count:
        (tableCounts.get('eval_datasets') ?? 0) +
        (tableCounts.get('eval_experiment_runs') ?? 0) +
        (tableCounts.get('eval_sample_results') ?? 0),
      note: 'eval_datasets + eval_experiment_runs + eval_sample_results',
    },
    mcp_servers: { source: 'config', count: config?.mcp?.servers?.length ?? 0 },
    batch_jobs: { source: 'database', table: 'batch_jobs', count: tableCounts.get('batch_jobs') ?? 0 },
    dashboard_users: {
      source: 'derived',
      count: config?.dashboard?.password ? 1 : 0,
      note: config?.dashboard?.password ? 'local dashboard admin derived from configured password' : 'dashboard auth disabled/open',
    },
  };
}

function preferDatabaseCount(
  databaseCount: number,
  configCount: number,
  table: string,
  note: string,
): V2MigrationCount {
  if (databaseCount > 0) {
    return { source: 'database', table, count: databaseCount, note };
  }
  return { source: 'config', count: configCount };
}

function countBudgetPolicies(config: GatewayConfig | null): number {
  if (!config) return 0;
  let count = config.budget ? 1 : 0;
  count += config.auth?.api_keys?.filter((key) => !!key.budget).length ?? 0;
  count += config.namespaces?.filter((namespace) => !!namespace.budget).length ?? 0;
  count += countConfigLocalTeams(config);
  return count;
}

function countRoutingPolicies(config: GatewayConfig | null): number {
  if (!config?.routing) return 0;
  let count = Object.keys(config.routing.tiers ?? {}).length;
  if (config.routing.domain_preferences && Object.keys(config.routing.domain_preferences).length > 0) count += 1;
  if (config.routing.retry) count += 1;
  if (config.routing.fallback_policy) count += 1;
  if (config.routing.cache_affinity) count += 1;
  return count;
}

function countConfigLocalTeams(config: GatewayConfig | null): number {
  const maybeTeams = (config as unknown as { local_teams?: unknown[] } | null)?.local_teams;
  return Array.isArray(maybeTeams) ? maybeTeams.length : 0;
}

function inspectDatabase(args: {
  cwd: string;
  config: GatewayConfig | null;
  sqlitePath?: string;
  issues: V2MigrationIssue[];
}): { sqlitePath?: string; inspected: boolean; reason?: string } {
  const { cwd, config, sqlitePath, issues } = args;
  if (!config) {
    issues.push({
      severity: 'warning',
      code: 'config_missing_database_unknown',
      message: 'Config was not loaded, so database runtime rows could not be inspected.',
    });
    return { inspected: false, reason: 'config_missing' };
  }

  if (config.database?.type === 'postgres') {
    issues.push({
      severity: 'warning',
      code: 'postgres_not_inspected',
      path: 'database',
      message:
        'PostgreSQL row counting is intentionally not opened by the v1.9.2 dry run. Use database-native read-only queries or run against a copied SQLite export for row-count planning.',
    });
    return { inspected: false, reason: 'postgres_not_inspected' };
  }

  const resolvedSqlitePath = resolvePath(cwd, sqlitePath ?? config.database?.path ?? './data/gateway.db');
  if (!fs.existsSync(resolvedSqlitePath)) {
    issues.push({
      severity: 'info',
      code: 'sqlite_not_found',
      path: 'database.path',
      message: `SQLite database file was not found at ${resolvedSqlitePath}; database-backed counts are reported as zero.`,
    });
    return { sqlitePath: resolvedSqlitePath, inspected: false, reason: 'sqlite_not_found' };
  }

  return { sqlitePath: resolvedSqlitePath, inspected: true };
}

function inspectSqliteTables(sqlitePath: string, issues: V2MigrationIssue[]): Map<SqliteTable, number> {
  const counts = new Map<SqliteTable, number>();
  if (!fs.existsSync(sqlitePath)) return counts;
  let db: Database.Database | undefined;
  try {
    db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    for (const table of SQLITE_TABLES) {
      if (!hasTable(db, table)) {
        counts.set(table, 0);
        issues.push({
          severity: 'info',
          code: 'table_missing',
          path: `database.${table}`,
          message: `Table ${table} is not present; its v2 assignment count is zero.`,
        });
        continue;
      }
      counts.set(table, countRows(db, table));
    }
  } catch (error) {
    issues.push({
      severity: 'warning',
      code: 'sqlite_inspection_failed',
      path: 'database.path',
      message: error instanceof Error ? error.message : 'SQLite inspection failed.',
    });
  } finally {
    db?.close();
  }
  return counts;
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', table) as { name?: string } | undefined;
  return row?.name === table;
}

function countRows(db: Database.Database, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
    .get() as { count: number };
  return Number(row.count) || 0;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function loadConfig(configPath: string, issues: V2MigrationIssue[]): GatewayConfig | null {
  if (!fs.existsSync(configPath)) {
    issues.push({
      severity: 'error',
      code: 'config_not_found',
      path: 'config',
      message: `Config file was not found: ${configPath}`,
    });
    return null;
  }

  try {
    const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as GatewayConfig;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Config did not parse to an object.');
    }
    return parsed;
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'config_parse_failed',
      path: 'config',
      message: error instanceof Error ? error.message : 'Config parsing failed.',
    });
    return null;
  }
}

function resolvePath(cwd: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDatabaseSummary(report: V2MigrationDryRunReport): string {
  const db = report.database;
  if (db.type === 'sqlite') {
    return `SQLite ${db.path ?? '<unknown>'} (${db.inspected ? 'inspected' : db.reason ?? 'not inspected'})`;
  }
  if (db.type === 'postgres') {
    return `PostgreSQL (${db.url_configured ? 'url configured' : 'url missing'}, ${db.reason ?? 'not inspected'})`;
  }
  return `unknown (${db.reason ?? 'not inspected'})`;
}

function formatIssueGroup(label: string, issues: V2MigrationIssue[]): string {
  if (issues.length === 0) return `${label}: none`;
  return [
    `${label} (${issues.length})`,
    ...issues.map((issue) => {
      const location = issue.path ? `${issue.path}: ` : '';
      return `  - [${issue.code}] ${location}${issue.message}`;
    }),
  ].join('\n');
}
