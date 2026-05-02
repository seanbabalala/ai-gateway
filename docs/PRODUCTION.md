# Production Deployment

This guide covers the open-source SiftGate Data Plane only. The hosted/cloud
control plane is optional; a single self-hosted gateway remains fully usable
with local config, SQLite for development, and PostgreSQL for production.

## Database Recommendation

SQLite is the default because it keeps local development and small self-hosted
installs simple:

```yaml
database:
  type: sqlite
  path: ./data/gateway.db
```

For production, use PostgreSQL so call logs, Dashboard-managed Gateway API
keys, budgets, and node status can be backed up and operated independently from
one container filesystem:

```yaml
database:
  type: postgres
  url: "${DATABASE_URL}"
  synchronize: false
  log_retention_days: 30
```

`database.synchronize` defaults to `true` for backwards-compatible local
development. Production PostgreSQL deployments should bootstrap or migrate the
schema during a maintenance step, then run the gateway with
`database.synchronize: false`.

## SQLite To PostgreSQL Migration

Build the gateway so the `siftgate` executable exists, then run a dry run:

```bash
npm run build
node dist/cli/siftgate.js migrate-db \
  --from sqlite \
  --to postgres \
  --sqlite-path ./data/gateway.db \
  --postgres-url "$DATABASE_URL" \
  --dry-run
```

When the dry run looks correct, stop writes to the gateway and import:

```bash
node dist/cli/siftgate.js migrate-db \
  --from sqlite \
  --to postgres \
  --sqlite-path ./data/gateway.db \
  --postgres-url "$DATABASE_URL" \
  --backup
```

The migrator:

- Reads `gateway_api_keys`, `budget_rules`, `node_status`, and `call_logs`.
- Creates a timestamped SQLite backup when `--backup` is set.
- Creates/updates the PostgreSQL schema through the OSS TypeORM entities before
  import.
- Refuses to import into non-empty target tables unless `--force` is provided.
- Normalizes SQLite booleans, dates, numbers, and JSON fields for PostgreSQL.
- Resets imported numeric sequences and validates row counts after import.

Useful flags:

```bash
--backup-path ./backups/gateway.pre-postgres.db
--force
--json
--batch-size 1000
```

Use `--force` only when you intentionally want to append/update rows in an
existing PostgreSQL database. Keep the SQLite backup until the PostgreSQL
deployment has served real traffic and backups have been verified.

## TypeORM Migration Strategy

Today the open-source runtime uses TypeORM entities as the schema source of
truth. The `migrate-db` command is the supported one-time bootstrap path from a
SQLite development database to a PostgreSQL production database.

Recommended production process:

1. Run `siftgate validate --config gateway.config.yaml`.
2. Run `siftgate migrate-db --dry-run`.
3. Stop gateway writes or enter a maintenance window.
4. Run `siftgate migrate-db --backup`.
5. Switch `gateway.config.yaml` to PostgreSQL with `synchronize: false`.
6. Restart SiftGate and verify `/health`, Dashboard API keys, budgets, and call
   logs.

Future releases that change persistent schema should ship explicit TypeORM
migration files. Production operators should run those release migrations as a
deployment step instead of leaving runtime schema synchronization enabled.

## Docker Compose PostgreSQL Profile

The default Compose path still starts only the gateway with SQLite. To run the
optional local PostgreSQL service for testing:

```bash
POSTGRES_PASSWORD=replace-me docker compose --profile postgres up -d postgres
```

Then set `DATABASE_URL` in `.env` and update `gateway.config.yaml`:

```env
DATABASE_URL=postgresql://siftgate:replace-me@postgres:5432/siftgate
```

```yaml
database:
  type: postgres
  url: "${DATABASE_URL}"
  synchronize: false
```

For real production, use managed PostgreSQL or a hardened database deployment
with backups, TLS/network controls, secret management, and regular restore
tests.
