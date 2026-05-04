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
  "provider_compatibility_results",
  "video_jobs",
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
      version_id varchar,
      created_at datetime,
      created_by varchar,
      source varchar,
      checksum varchar,
      config_path varchar,
      runtime_version integer,
      node_count integer,
      node_ids_json text,
      route_tiers_json text,
      sanitized_summary_json text,
      config_yaml text
    );

    CREATE TABLE config_audit_events (
      id integer PRIMARY KEY AUTOINCREMENT,
      event_id varchar,
      timestamp datetime,
      actor varchar,
      action varchar,
      target varchar,
      before_summary_json text,
      after_summary_json text,
      result varchar,
      failure_reason text,
      source varchar,
      version_id varchar,
      previous_version_id varchar,
      metadata_json text
    );

    CREATE TABLE provider_compatibility_results (
      id integer PRIMARY KEY AUTOINCREMENT,
      node_id varchar,
      capability varchar,
      configured integer,
      tested integer,
      last_status varchar,
      last_checked_at datetime,
      latency_ms integer,
      status_code integer,
      failure_reason text,
      test_mode varchar,
      created_at datetime,
      updated_at datetime
    );

    CREATE TABLE video_jobs (
      id integer PRIMARY KEY AUTOINCREMENT,
      request_id varchar,
      provider_job_id varchar,
      node_id varchar,
      model varchar,
      api_key_id varchar,
      api_key_name varchar,
      namespace_id varchar,
      namespace_name varchar,
      status varchar,
      error text,
      expires_at text,
      created_at datetime,
      updated_at datetime
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
      version_id, created_at, created_by, source, checksum, config_path,
      runtime_version, node_count, node_ids_json, route_tiers_json,
      sanitized_summary_json, config_yaml
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "cfgv_1",
    "2026-05-01T00:01:30.000Z",
    "dashboard:dashboard",
    "dashboard",
    "abc123",
    "/etc/siftgate/gateway.config.yaml",
    4,
    1,
    JSON.stringify(["openai"]),
    JSON.stringify(["standard"]),
    JSON.stringify({ node_count: 1, node_ids: ["openai"] }),
    "nodes:\n  - id: openai\n    api_key: ${OPENAI_API_KEY}\n",
  );

  db.prepare(
    `
    INSERT INTO config_audit_events (
      event_id, timestamp, actor, action, target, before_summary_json,
      after_summary_json, result, failure_reason, source, version_id,
      previous_version_id, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "cfge_1",
    "2026-05-01T00:01:31.000Z",
    "dashboard:dashboard",
    "config.node.create",
    "node:openai",
    JSON.stringify({ node_count: 0 }),
    JSON.stringify({ node_count: 1 }),
    "success",
    null,
    "dashboard",
    "cfgv_1",
    null,
    JSON.stringify({ fields: ["nodes"] }),
  );

  db.prepare(
    `
    INSERT INTO provider_compatibility_results (
      node_id, capability, configured, tested, last_status, last_checked_at,
      latency_ms, status_code, failure_reason, test_mode, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "openai",
    "video",
    1,
    1,
    "ok",
    "2026-05-01T00:02:00.000Z",
    42,
    200,
    null,
    "probe",
    "2026-05-01T00:02:00.000Z",
    "2026-05-01T00:02:00.000Z",
  );

  db.prepare(
    `
    INSERT INTO video_jobs (
      request_id, provider_job_id, node_id, model, api_key_id, api_key_name,
      namespace_id, namespace_name, status, error, expires_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    "req-video-1",
    "vid-job-1",
    "openai",
    "veo-3-preview",
    "key-1",
    "prod-key",
    "team-alpha",
    "Team Alpha",
    "queued",
    null,
    "2026-05-02T00:00:00.000Z",
    "2026-05-01T00:03:00.000Z",
    "2026-05-01T00:03:00.000Z",
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
    expect(result.totals.source_rows).toBe(9);
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
    expect(configVersion?.version_id).toBe("cfgv_1");
    expect(configVersion?.created_at).toBeInstanceOf(Date);
    expect(configVersion?.runtime_version).toBe(4);
    expect(configVersion?.node_count).toBe(1);

    const auditEvent = target.rows.get("config_audit_events")?.[0];
    expect(auditEvent?.event_id).toBe("cfge_1");
    expect(auditEvent?.timestamp).toBeInstanceOf(Date);
    expect(auditEvent?.action).toBe("config.node.create");

    const compatibility = target.rows.get("provider_compatibility_results")?.[0];
    expect(compatibility?.configured).toBe(true);
    expect(compatibility?.tested).toBe(true);
    expect(compatibility?.last_checked_at).toBe("2026-05-01T00:02:00.000Z");
    expect(compatibility?.created_at).toBeInstanceOf(Date);

    const videoJob = target.rows.get("video_jobs")?.[0];
    expect(videoJob?.request_id).toBe("req-video-1");
    expect(videoJob?.api_key_id).toBe("key-1");
    expect(videoJob?.namespace_id).toBe("team-alpha");
    expect(videoJob?.status).toBe("queued");
    expect(videoJob?.created_at).toBeInstanceOf(Date);
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
    expect(result.validation.mismatches).toHaveLength(9);
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
