import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database = require("better-sqlite3");
import { runCli } from "../../src/cli/siftgate";
import {
  DbMigrationTableName,
  PostgresMigrationTarget,
  migrateSqliteToPostgres,
} from "../../src/cli/db-migrator";

const TABLES: DbMigrationTableName[] = [
  "gateway_api_keys",
  "budget_rules",
  "node_status",
  "call_logs",
  "route_decisions",
  "config_versions",
  "config_audit_events",
];

class MemoryPostgresTarget implements PostgresMigrationTarget {
  initialized = false;
  closed = false;
  sequencesReset = false;
  readonly rows = new Map<DbMigrationTableName, Record<string, unknown>[]>();

  constructor(
    initialRows: Partial<
      Record<DbMigrationTableName, Record<string, unknown>[]>
    > = {},
  ) {
    for (const table of TABLES) {
      this.rows.set(table, [...(initialRows[table] ?? [])]);
    }
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async countRows(table: DbMigrationTableName): Promise<number> {
    return this.rows.get(table)?.length ?? 0;
  }

  async insertRows(
    table: DbMigrationTableName,
    rows: Record<string, unknown>[],
  ): Promise<number> {
    this.rows.get(table)?.push(...rows);
    return rows.length;
  }

  async resetSequences(): Promise<void> {
    this.sequencesReset = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class LossyPostgresTarget extends MemoryPostgresTarget {
  async insertRows(
    _table: DbMigrationTableName,
    rows: Record<string, unknown>[],
  ): Promise<number> {
    return rows.length;
  }
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "siftgate-db-migrate-"));
}

function createSqliteFixture(dir: string): string {
  const dbPath = path.join(dir, "gateway.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE gateway_api_keys (
      id varchar PRIMARY KEY,
      name varchar,
      description text,
      key_hash varchar,
      key_prefix varchar,
      status varchar,
      allow_auto integer,
      allow_direct integer,
      allowed_nodes text,
      allowed_models text,
      daily_token_limit real,
      daily_cost_limit real,
      rate_limit_per_minute integer,
      last_used_at datetime,
      last_used_ip varchar,
      created_at datetime,
      updated_at datetime
    );

    CREATE TABLE budget_rules (
      id integer PRIMARY KEY AUTOINCREMENT,
      type varchar,
      limit_value real,
      alert_threshold real,
      current_value real,
      period_start datetime,
      is_active integer,
      api_key_name varchar,
      api_key_id varchar
    );

    CREATE TABLE node_status (
      node_id varchar PRIMARY KEY,
      is_healthy integer,
      last_check datetime,
      consecutive_failures integer,
      avg_latency_ms real,
      circuit_state varchar,
      circuit_opened_at integer
    );

    CREATE TABLE call_logs (
      id integer PRIMARY KEY AUTOINCREMENT,
      request_id varchar,
      timestamp datetime,
      source_format varchar,
      tier varchar,
      score real,
      node_id varchar,
      model varchar,
      input_tokens integer,
      output_tokens integer,
      cost_usd real,
      latency_ms integer,
      status_code integer,
      is_fallback integer,
      fallback_reason varchar,
      structured_output_requested integer,
      structured_output_type varchar,
      structured_output_strategy varchar,
      structured_output_supported integer,
      structured_output_schema_name varchar,
      session_key varchar,
      error text,
      api_key_name varchar,
      api_key_id varchar,
      retry_count integer,
      cache_creation_input_tokens integer,
      cache_read_input_tokens integer,
      experiment_group varchar
    );

    CREATE TABLE route_decisions (
      id integer PRIMARY KEY AUTOINCREMENT,
      request_id varchar,
      timestamp datetime,
      source_format varchar,
      tier varchar,
      score real,
      route_mode varchar,
      strategy varchar,
      selected_node_id varchar,
      selected_model varchar,
      domain_hint varchar,
      candidate_count integer,
      filtered_count integer,
      status_code integer,
      is_fallback integer,
      fallback_reason varchar,
      api_key_name varchar,
      api_key_id varchar,
      namespace_id varchar,
      trace_json text
    );

    CREATE TABLE config_versions (
      id integer PRIMARY KEY AUTOINCREMENT,
      created_at datetime,
      action varchar,
      actor_type varchar,
      actor_id varchar,
      reason varchar,
      checksum varchar,
      config_path varchar,
      runtime_version integer,
      node_count integer,
      node_ids_json text,
      route_tiers_json text,
      summary_json text,
      snapshot_yaml text
    );

    CREATE TABLE config_audit_events (
      id integer PRIMARY KEY AUTOINCREMENT,
      timestamp datetime,
      action varchar,
      target_type varchar,
      target_id varchar,
      success integer,
      actor_type varchar,
      actor_id varchar,
      source varchar,
      version_id integer,
      previous_version_id integer,
      message text,
      error text,
      metadata_json text
    );
  `);

  db.prepare(
    `
    INSERT INTO gateway_api_keys (
      id, name, description, key_hash, key_prefix, status, allow_auto,
      allow_direct, allowed_nodes, allowed_models, daily_token_limit,
      daily_cost_limit, rate_limit_per_minute, last_used_at, last_used_ip,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "key-1",
    "prod-key",
    "Production key",
    "hash",
    "gw_sk_live_1234",
    "active",
    1,
    0,
    JSON.stringify(["openai"]),
    JSON.stringify(["gpt-4o"]),
    1000,
    5.5,
    60,
    null,
    "127.0.0.1",
    "2026-05-01T00:00:00.000Z",
    "2026-05-01T00:00:00.000Z",
  );

  db.prepare(
    `
    INSERT INTO budget_rules (
      type, limit_value, alert_threshold, current_value, period_start,
      is_active, api_key_name, api_key_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "daily_cost",
    10,
    0.8,
    1.5,
    "2026-05-01T00:00:00.000Z",
    1,
    "prod-key",
    "key-1",
  );

  db.prepare(
    `
    INSERT INTO node_status (
      node_id, is_healthy, last_check, consecutive_failures, avg_latency_ms,
      circuit_state, circuit_opened_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run("openai", 1, "2026-05-01T00:00:00.000Z", 0, 123.4, "CLOSED", null);

  db.prepare(
    `
    INSERT INTO call_logs (
      request_id, timestamp, source_format, tier, score, node_id, model,
      input_tokens, output_tokens, cost_usd, latency_ms, status_code,
      is_fallback, fallback_reason, structured_output_requested,
      structured_output_type, structured_output_strategy,
      structured_output_supported, structured_output_schema_name,
      session_key, error, api_key_name, api_key_id, retry_count,
      cache_creation_input_tokens, cache_read_input_tokens, experiment_group
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "req-1",
    "2026-05-01T00:01:00.000Z",
    "chat_completions",
    "standard",
    42,
    "openai",
    "gpt-4o",
    10,
    20,
    0.01,
    456,
    200,
    0,
    null,
    1,
    "json_schema",
    "passthrough",
    1,
    "Answer",
    "session-1",
    null,
    "prod-key",
    "key-1",
    0,
    0,
    0,
    "control",
  );

  db.prepare(
    `
    INSERT INTO route_decisions (
      request_id, timestamp, source_format, tier, score, route_mode,
      strategy, selected_node_id, selected_model, domain_hint,
      candidate_count, filtered_count, status_code, is_fallback,
      fallback_reason, api_key_name, api_key_id, namespace_id, trace_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "req-1",
    "2026-05-01T00:01:00.000Z",
    "chat_completions",
    "standard",
    42,
    "auto",
    "balanced",
    "openai",
    "gpt-4o",
    "backend",
    2,
    1,
    200,
    0,
    null,
    "prod-key",
    "key-1",
    "team-alpha",
    JSON.stringify({ version: 1, privacy: { prompt: false, response: false } }),
  );

  db.prepare(
    `
    INSERT INTO config_versions (
      created_at, action, actor_type, actor_id, reason, checksum, config_path,
      runtime_version, node_count, node_ids_json, route_tiers_json,
      summary_json, snapshot_yaml
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "2026-05-01T00:02:00.000Z",
    "config.node.update",
    "dashboard",
    "dashboard",
    "fixture",
    "abc123",
    "/tmp/gateway.config.yaml",
    2,
    1,
    JSON.stringify(["openai"]),
    JSON.stringify(["standard"]),
    JSON.stringify({ node_count: 1 }),
    "server:\n  port: 2099\n",
  );

  db.prepare(
    `
    INSERT INTO config_audit_events (
      timestamp, action, target_type, target_id, success, actor_type,
      actor_id, source, version_id, previous_version_id, message, error,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "2026-05-01T00:03:00.000Z",
    "config.node.update",
    "node",
    "openai",
    1,
    "dashboard",
    "dashboard",
    "dashboard",
    1,
    null,
    "updated",
    null,
    JSON.stringify({ fields: ["name"] }),
  );

  db.close();
  return dbPath;
}

describe("SQLite to PostgreSQL migration", () => {
  it("dry-runs by inspecting SQLite without initializing the target", async () => {
    const dir = makeTempDir();
    const dbPath = createSqliteFixture(dir);
    const target = new MemoryPostgresTarget();

    const result = await migrateSqliteToPostgres({
      sqlitePath: dbPath,
      postgresUrl: "postgresql://siftgate:secret@localhost:5432/siftgate",
      dryRun: true,
      target,
      now: () => new Date("2026-05-02T00:00:00.000Z"),
    });

    expect(target.initialized).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.targetUrl).toBe(
      "postgresql://siftgate:***@localhost:5432/siftgate",
    );
    expect(result.totals.source_rows).toBe(7);
    expect(result.totals.imported_rows).toBe(0);
    expect(result.validation.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "dry_run_no_target_connection",
    );
  });

  it("backs up, imports, normalizes values, and validates row counts", async () => {
    const dir = makeTempDir();
    const dbPath = createSqliteFixture(dir);
    const target = new MemoryPostgresTarget();

    const result = await migrateSqliteToPostgres({
      sqlitePath: dbPath,
      postgresUrl: "postgresql://siftgate:secret@localhost:5432/siftgate",
      backup: true,
      target,
      now: () => new Date("2026-05-02T10:11:12.000Z"),
    });

    expect(result.validation.ok).toBe(true);
    expect(result.backupPath).toBe(`${dbPath}.backup-20260502T101112Z.db`);
    expect(fs.existsSync(result.backupPath!)).toBe(true);
    expect(target.sequencesReset).toBe(true);
    expect(target.closed).toBe(true);

    const apiKey = target.rows.get("gateway_api_keys")?.[0];
    expect(apiKey?.allow_auto).toBe(true);
    expect(apiKey?.allow_direct).toBe(false);
    expect(apiKey?.allowed_nodes).toEqual(["openai"]);
    expect(apiKey?.created_at).toBeInstanceOf(Date);

    const callLog = target.rows.get("call_logs")?.[0];
    expect(callLog?.is_fallback).toBe(false);
    expect(callLog?.structured_output_requested).toBe(true);
    expect(callLog?.structured_output_supported).toBe(true);
    expect(callLog?.timestamp).toBeInstanceOf(Date);

    const routeDecision = target.rows.get("route_decisions")?.[0];
    expect(routeDecision?.is_fallback).toBe(false);
    expect(routeDecision?.candidate_count).toBe(2);
    expect(routeDecision?.timestamp).toBeInstanceOf(Date);

    const configVersion = target.rows.get("config_versions")?.[0];
    expect(configVersion?.created_at).toBeInstanceOf(Date);
    expect(configVersion?.node_count).toBe(1);

    const auditEvent = target.rows.get("config_audit_events")?.[0];
    expect(auditEvent?.success).toBe(true);
    expect(auditEvent?.timestamp).toBeInstanceOf(Date);
  });

  it("refuses non-empty PostgreSQL targets unless force is explicit", async () => {
    const dir = makeTempDir();
    const dbPath = createSqliteFixture(dir);
    const target = new MemoryPostgresTarget({
      call_logs: [{ id: 1, request_id: "existing" }],
    });

    await expect(
      migrateSqliteToPostgres({
        sqlitePath: dbPath,
        postgresUrl: "postgresql://localhost/siftgate",
        target,
      }),
    ).rejects.toThrow("Target PostgreSQL tables are not empty");

    expect(target.closed).toBe(true);
  });

  it("reports validation failures when imported rows are missing", async () => {
    const dir = makeTempDir();
    const dbPath = createSqliteFixture(dir);

    const result = await migrateSqliteToPostgres({
      sqlitePath: dbPath,
      postgresUrl: "postgresql://localhost/siftgate",
      target: new LossyPostgresTarget(),
    });

    expect(result.validation.ok).toBe(false);
    expect(result.validation.mismatches).toHaveLength(7);
  });

  it("exposes migrate-db through the CLI with CI-safe exit codes", async () => {
    const dir = makeTempDir();
    const dbPath = createSqliteFixture(dir);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(
      [
        "migrate-db",
        "--from",
        "sqlite",
        "--to",
        "postgres",
        "--sqlite-path",
        dbPath,
        "--dry-run",
      ],
      {
        cwd: dir,
        env: {
          DATABASE_URL: "postgresql://siftgate:secret@localhost:5432/siftgate",
        },
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
    );

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("SiftGate database migration");
    expect(stdout.join("\n")).toContain(
      "postgresql://siftgate:***@localhost:5432/siftgate",
    );
  });
});
