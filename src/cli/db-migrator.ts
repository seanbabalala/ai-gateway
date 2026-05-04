import * as fs from "fs";
import * as path from "path";
import Database = require("better-sqlite3");
import { DataSource, EntityTarget } from "typeorm";
import {
  BudgetRule,
  CallLog,
  ConfigAuditEvent,
  ConfigVersion,
  GatewayApiKey,
  NodeStatus,
  BatchJob,
  ProviderCompatibilityResult,
  RouteDecisionLog,
  ShadowTrafficResult,
  VideoJob,
} from "../database/entities";

export type DbMigrationTableName =
  | "gateway_api_keys"
  | "budget_rules"
  | "node_status"
  | "call_logs"
  | "route_decisions"
  | "shadow_traffic_results"
  | "config_versions"
  | "config_audit_events"
  | "provider_compatibility_results"
  | "batch_jobs"
  | "video_jobs";

interface MigrationTableDefinition {
  table: DbMigrationTableName;
  entity: EntityTarget<object>;
  generatedSequenceColumn?: string;
}

const MIGRATION_TABLES: MigrationTableDefinition[] = [
  { table: "gateway_api_keys", entity: GatewayApiKey },
  { table: "budget_rules", entity: BudgetRule, generatedSequenceColumn: "id" },
  { table: "node_status", entity: NodeStatus },
  { table: "call_logs", entity: CallLog, generatedSequenceColumn: "id" },
  { table: "route_decisions", entity: RouteDecisionLog, generatedSequenceColumn: "id" },
  { table: "shadow_traffic_results", entity: ShadowTrafficResult, generatedSequenceColumn: "id" },
  { table: "config_versions", entity: ConfigVersion, generatedSequenceColumn: "id" },
  { table: "config_audit_events", entity: ConfigAuditEvent, generatedSequenceColumn: "id" },
  {
    table: "provider_compatibility_results",
    entity: ProviderCompatibilityResult,
    generatedSequenceColumn: "id",
  },
  {
    table: "batch_jobs",
    entity: BatchJob,
    generatedSequenceColumn: "id",
  },
  {
    table: "video_jobs",
    entity: VideoJob,
    generatedSequenceColumn: "id",
  },
];

export interface DbMigrationWarning {
  code: string;
  message: string;
  table?: DbMigrationTableName;
}

export interface DbMigrationValidationMismatch {
  table: DbMigrationTableName;
  source_rows: number;
  target_rows_after: number;
  message: string;
}

export interface DbMigrationTableSummary {
  table: DbMigrationTableName;
  source_rows: number;
  target_rows_before?: number;
  imported_rows: number;
  target_rows_after?: number;
}

export interface DbMigrationValidationResult {
  ok: boolean;
  checked_at: string;
  mismatches: DbMigrationValidationMismatch[];
}

export interface DbMigrationResult {
  from: "sqlite";
  to: "postgres";
  sourcePath: string;
  targetUrl: string;
  dryRun: boolean;
  backupPath?: string;
  force: boolean;
  tables: DbMigrationTableSummary[];
  totals: {
    source_rows: number;
    imported_rows: number;
  };
  validation: DbMigrationValidationResult;
  warnings: DbMigrationWarning[];
}

export interface SqliteMigrationSource {
  hasTable(table: DbMigrationTableName): Promise<boolean>;
  countRows(table: DbMigrationTableName): Promise<number>;
  getRows(table: DbMigrationTableName): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export interface PostgresMigrationTarget {
  initialize(): Promise<void>;
  countRows(table: DbMigrationTableName): Promise<number>;
  insertRows(
    table: DbMigrationTableName,
    rows: Record<string, unknown>[],
  ): Promise<number>;
  resetSequences?(): Promise<void>;
  close(): Promise<void>;
}

export interface MigrateSqliteToPostgresOptions {
  sqlitePath: string;
  postgresUrl: string;
  cwd?: string;
  dryRun?: boolean;
  backup?: boolean;
  backupPath?: string;
  force?: boolean;
  batchSize?: number;
  now?: () => Date;
  source?: SqliteMigrationSource;
  target?: PostgresMigrationTarget;
}

export class BetterSqliteMigrationSource implements SqliteMigrationSource {
  private readonly db: Database.Database;

  constructor(private readonly sqlitePath: string) {
    this.db = new Database(sqlitePath, {
      readonly: true,
      fileMustExist: true,
    });
  }

  async hasTable(table: DbMigrationTableName): Promise<boolean> {
    const row = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table) as { name?: string } | undefined;
    return row?.name === table;
  }

  async countRows(table: DbMigrationTableName): Promise<number> {
    if (!(await this.hasTable(table))) return 0;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(table)}`)
      .get() as { count: number };
    return Number(row.count) || 0;
  }

  async getRows(
    table: DbMigrationTableName,
  ): Promise<Record<string, unknown>[]> {
    if (!(await this.hasTable(table))) return [];
    return this.db
      .prepare(`SELECT * FROM ${quoteSqliteIdentifier(table)}`)
      .all() as Record<string, unknown>[];
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export class TypeOrmPostgresMigrationTarget implements PostgresMigrationTarget {
  private dataSource?: DataSource;

  constructor(
    private readonly postgresUrl: string,
    private readonly batchSize = 500,
  ) {}

  async initialize(): Promise<void> {
    this.dataSource = new DataSource({
      type: "postgres",
      url: this.postgresUrl,
      entities: [
        CallLog,
        BudgetRule,
        NodeStatus,
        GatewayApiKey,
        RouteDecisionLog,
        ShadowTrafficResult,
        ConfigVersion,
        ConfigAuditEvent,
        ProviderCompatibilityResult,
        BatchJob,
        VideoJob,
      ],
      synchronize: false,
      logging: false,
    });
    await this.dataSource.initialize();
    await this.dataSource.synchronize(false);
  }

  async countRows(table: DbMigrationTableName): Promise<number> {
    return this.repositoryFor(table).count();
  }

  async insertRows(
    table: DbMigrationTableName,
    rows: Record<string, unknown>[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const repository = this.repositoryFor(table);
    await repository.save(rows, { chunk: this.batchSize });
    return rows.length;
  }

  async resetSequences(): Promise<void> {
    if (!this.dataSource) return;
    for (const definition of MIGRATION_TABLES) {
      if (!definition.generatedSequenceColumn) continue;
      await resetPostgresSequence(
        this.dataSource,
        definition.table,
        definition.generatedSequenceColumn,
      );
    }
  }

  async close(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  private repositoryFor(table: DbMigrationTableName) {
    if (!this.dataSource) {
      throw new Error("PostgreSQL migration target is not initialized.");
    }
    const definition = tableDefinition(table);
    return this.dataSource.getRepository(definition.entity);
  }
}

export async function migrateSqliteToPostgres(
  options: MigrateSqliteToPostgresOptions,
): Promise<DbMigrationResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const sqlitePath = resolvePath(cwd, options.sqlitePath);
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const warnings: DbMigrationWarning[] = [];

  validateMigrationInput(sqlitePath, options.postgresUrl);

  const source = options.source ?? new BetterSqliteMigrationSource(sqlitePath);
  const target =
    options.target ??
    (dryRun
      ? undefined
      : new TypeOrmPostgresMigrationTarget(
          options.postgresUrl,
          options.batchSize,
        ));

  let targetInitialized = false;

  try {
    const tables = await inspectSourceTables(source, warnings);
    const backupPath =
      options.backup && !dryRun
        ? createSqliteBackup(sqlitePath, cwd, now, options.backupPath)
        : undefined;

    if (dryRun) {
      warnings.push({
        code: "dry_run_no_target_connection",
        message:
          "Dry run inspected SQLite only; PostgreSQL schema creation and import were skipped.",
      });
      return buildResult({
        sqlitePath,
        postgresUrl: options.postgresUrl,
        dryRun,
        force,
        backupPath,
        tables,
        warnings,
        now,
      });
    }

    if (!target) {
      throw new Error("PostgreSQL migration target is required.");
    }

    await target.initialize();
    targetInitialized = true;

    const nonEmptyTargets: string[] = [];
    for (const summary of tables) {
      summary.target_rows_before = await target.countRows(summary.table);
      if (summary.target_rows_before > 0) {
        nonEmptyTargets.push(
          `${summary.table} (${summary.target_rows_before})`,
        );
      }
    }

    if (nonEmptyTargets.length > 0 && !force) {
      throw new Error(
        `Target PostgreSQL tables are not empty: ${nonEmptyTargets.join(
          ", ",
        )}. Re-run with --force only when appending/updating existing rows is intentional.`,
      );
    }

    for (const summary of tables) {
      const rows = await source.getRows(summary.table);
      const normalized = rows.map((row) => normalizeRow(summary.table, row));
      summary.imported_rows = await target.insertRows(
        summary.table,
        normalized,
      );
      summary.target_rows_after = await target.countRows(summary.table);
    }

    await target.resetSequences?.();

    return buildResult({
      sqlitePath,
      postgresUrl: options.postgresUrl,
      dryRun,
      force,
      backupPath,
      tables,
      warnings,
      now,
    });
  } finally {
    await source.close();
    if (targetInitialized) {
      await target?.close();
    }
  }
}

export function formatDbMigrationReport(result: DbMigrationResult): string {
  const lines = [
    "SiftGate database migration",
    `Source: SQLite ${result.sourcePath}`,
    `Target: PostgreSQL ${result.targetUrl}`,
    `Mode: ${result.dryRun ? "dry-run" : "import"}`,
    `Backup: ${result.backupPath ?? "not created"}`,
    `Force: ${result.force ? "yes" : "no"}`,
    "",
    "Tables:",
    ...result.tables.map((table) =>
      [
        `  - ${table.table}`,
        `source=${table.source_rows}`,
        table.target_rows_before === undefined
          ? undefined
          : `target_before=${table.target_rows_before}`,
        `imported=${table.imported_rows}`,
        table.target_rows_after === undefined
          ? undefined
          : `target_after=${table.target_rows_after}`,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    "",
    `Validation: ${result.validation.ok ? "OK" : "FAILED"}`,
  ];

  if (result.validation.mismatches.length > 0) {
    lines.push(
      ...result.validation.mismatches.map(
        (mismatch) => `  - ${mismatch.table}: ${mismatch.message}`,
      ),
    );
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    lines.push(
      ...result.warnings.map((warning) =>
        warning.table
          ? `  - [${warning.code}] ${warning.table}: ${warning.message}`
          : `  - [${warning.code}] ${warning.message}`,
      ),
    );
  }

  lines.push(
    "",
    result.validation.ok ? "Result: OK" : "Result: VALIDATION FAILED",
  );
  return lines.join("\n");
}

export function redactPostgresUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return rawUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
  }
}

function validateMigrationInput(sqlitePath: string, postgresUrl: string): void {
  if (!sqlitePath) {
    throw new Error("--sqlite-path is required.");
  }
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database file not found: ${sqlitePath}`);
  }
  const stat = fs.statSync(sqlitePath);
  if (!stat.isFile()) {
    throw new Error(`SQLite database path is not a file: ${sqlitePath}`);
  }
  if (!postgresUrl) {
    throw new Error("--postgres-url is required.");
  }
  const parsed = new URL(postgresUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "--postgres-url must use a postgres:// or postgresql:// URL.",
    );
  }
}

async function inspectSourceTables(
  source: SqliteMigrationSource,
  warnings: DbMigrationWarning[],
): Promise<DbMigrationTableSummary[]> {
  const summaries: DbMigrationTableSummary[] = [];
  for (const definition of MIGRATION_TABLES) {
    const exists = await source.hasTable(definition.table);
    if (!exists) {
      warnings.push({
        code: "source_table_missing",
        table: definition.table,
        message:
          "Source SQLite database does not contain this table; it will be treated as empty.",
      });
    }
    summaries.push({
      table: definition.table,
      source_rows: exists ? await source.countRows(definition.table) : 0,
      imported_rows: 0,
    });
  }
  return summaries;
}

function buildResult(input: {
  sqlitePath: string;
  postgresUrl: string;
  dryRun: boolean;
  force: boolean;
  backupPath?: string;
  tables: DbMigrationTableSummary[];
  warnings: DbMigrationWarning[];
  now: () => Date;
}): DbMigrationResult {
  const validation = validateImportedCounts(
    input.tables,
    input.dryRun,
    input.now,
  );
  return {
    from: "sqlite",
    to: "postgres",
    sourcePath: input.sqlitePath,
    targetUrl: redactPostgresUrl(input.postgresUrl),
    dryRun: input.dryRun,
    backupPath: input.backupPath,
    force: input.force,
    tables: input.tables,
    totals: {
      source_rows: input.tables.reduce(
        (sum, table) => sum + table.source_rows,
        0,
      ),
      imported_rows: input.tables.reduce(
        (sum, table) => sum + table.imported_rows,
        0,
      ),
    },
    validation,
    warnings: input.warnings,
  };
}

function validateImportedCounts(
  tables: DbMigrationTableSummary[],
  dryRun: boolean,
  now: () => Date,
): DbMigrationValidationResult {
  const mismatches: DbMigrationValidationMismatch[] = [];
  if (!dryRun) {
    for (const table of tables) {
      const before = table.target_rows_before ?? 0;
      const after = table.target_rows_after ?? 0;
      const expectedMinimum = before + table.imported_rows;
      if (after < expectedMinimum) {
        mismatches.push({
          table: table.table,
          source_rows: table.source_rows,
          target_rows_after: after,
          message: `target has ${after} row(s), expected at least ${expectedMinimum} after importing ${table.imported_rows}`,
        });
      }
    }
  }
  return {
    ok: mismatches.length === 0,
    checked_at: now().toISOString(),
    mismatches,
  };
}

function normalizeRow(
  table: DbMigrationTableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (table === "gateway_api_keys") {
    return normalizeFields(row, {
      allow_auto: toBoolean,
      allow_direct: toBoolean,
      allowed_nodes: toJsonArrayOrNull,
      allowed_models: toJsonArrayOrNull,
      allowed_endpoints: toJsonArrayOrNull,
      allowed_modalities: toJsonArrayOrNull,
      daily_token_limit: toNullableNumber,
      daily_cost_limit: toNullableNumber,
      rate_limit_per_minute: toNullableNumber,
      last_used_at: toNullableDate,
      created_at: toDateOrNow,
      updated_at: toDateOrNow,
    });
  }

  if (table === "budget_rules") {
    return normalizeFields(row, {
      id: toNumber,
      limit_value: toNumber,
      alert_threshold: toNumber,
      current_value: toNumber,
      period_start: toDateOrNow,
      is_active: toBoolean,
    });
  }

  if (table === "node_status") {
    return normalizeFields(row, {
      is_healthy: toBoolean,
      last_check: toDateOrNow,
      consecutive_failures: toNumber,
      avg_latency_ms: toNumber,
      circuit_opened_at: toNullableNumber,
    });
  }

  if (table === "route_decisions") {
    return normalizeFields(row, {
      id: toNumber,
      timestamp: toDateOrNow,
      score: toNumber,
      candidate_count: toNumber,
      filtered_count: toNumber,
      status_code: toNumber,
      is_fallback: toBoolean,
    });
  }

  if (table === "provider_compatibility_results") {
    return normalizeFields(row, {
      id: toNumber,
      configured: toBoolean,
      tested: toBoolean,
      latency_ms: toNullableNumber,
      status_code: toNullableNumber,
      created_at: toDateOrNow,
      updated_at: toDateOrNow,
    });
  }

  if (table === "shadow_traffic_results") {
    return normalizeFields(row, {
      id: toNumber,
      timestamp: toDateOrNow,
      latency_ms: toNullableNumber,
      status_code: toNullableNumber,
      input_tokens: toNumber,
      output_tokens: toNumber,
    });
  }

  if (table === "config_versions") {
    return normalizeFields(row, {
      id: toNumber,
      created_at: toDateOrNow,
      runtime_version: toNumber,
      node_count: toNumber,
    });
  }

  if (table === "config_audit_events") {
    return normalizeFields(row, {
      id: toNumber,
      timestamp: toDateOrNow,
    });
  }

  if (table === "batch_jobs") {
    return normalizeFields(row, {
      id: toNumber,
      request_counts_total: toNumber,
      request_counts_completed: toNumber,
      request_counts_failed: toNumber,
      created_at: toDateOrNow,
      updated_at: toDateOrNow,
    });
  }

  if (table === "video_jobs") {
    return normalizeFields(row, {
      id: toNumber,
      created_at: toDateOrNow,
      updated_at: toDateOrNow,
    });
  }

  return normalizeFields(row, {
    id: toNumber,
    timestamp: toDateOrNow,
    score: toNumber,
    input_tokens: toNumber,
    output_tokens: toNumber,
    cost_usd: toNumber,
    latency_ms: toNumber,
    status_code: toNumber,
    is_fallback: toBoolean,
    structured_output_requested: toBoolean,
    structured_output_supported: toNullableBoolean,
    reasoning_requested: toBoolean,
    reasoning_supported: toNullableBoolean,
    reasoning_budget_tokens: toNullableNumber,
    retry_count: toNumber,
    cache_creation_input_tokens: toNumber,
    cache_read_input_tokens: toNumber,
  });
}

function normalizeFields(
  row: Record<string, unknown>,
  normalizers: Record<string, (value: unknown) => unknown>,
): Record<string, unknown> {
  const normalized = { ...row };
  for (const [field, normalizer] of Object.entries(normalizers)) {
    if (field in normalized) {
      normalized[field] = normalizer(normalized[field]);
    }
  }
  return normalized;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  return toBoolean(value);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return toNumber(value);
}

function toDateOrNow(value: unknown): Date {
  const parsed = toNullableDate(value);
  return parsed ?? new Date();
}

function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toJsonArrayOrNull(value: unknown): string[] | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : null;
  } catch {
    return null;
  }
}

function createSqliteBackup(
  sqlitePath: string,
  cwd: string,
  now: () => Date,
  requestedPath?: string,
): string {
  const backupPath = requestedPath
    ? resolvePath(cwd, requestedPath)
    : `${sqlitePath}.backup-${formatTimestamp(now())}.db`;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sqlitePath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function resolvePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableDefinition(
  table: DbMigrationTableName,
): MigrationTableDefinition {
  const definition = MIGRATION_TABLES.find((item) => item.table === table);
  if (!definition) {
    throw new Error(`Unsupported migration table: ${table}`);
  }
  return definition;
}

async function resetPostgresSequence(
  dataSource: DataSource,
  table: DbMigrationTableName,
  column: string,
): Promise<void> {
  const sequenceRows = (await dataSource.query(
    "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
    [table, column],
  )) as Array<{ sequence_name: string | null }>;
  const sequenceName = sequenceRows[0]?.sequence_name;
  if (!sequenceName) return;

  await dataSource.query(
    `SELECT setval($1, COALESCE((SELECT MAX("${column}") FROM "${table}"), 1), (SELECT COUNT(*) > 0 FROM "${table}"))`,
    [sequenceName],
  );
}
