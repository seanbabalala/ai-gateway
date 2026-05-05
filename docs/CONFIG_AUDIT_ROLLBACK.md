# Config Audit And Rollback

SiftGate v0.9 adds local configuration audit and rollback for the MIT open-source Data Plane. It is designed for single-node SQLite installs first, and the same entities are compatible with PostgreSQL when you move production metadata there.

The feature is local-only. It does not require any external control plane, Redis, PostgreSQL, or private package.

## What It Records

Config versions are stored in `config_versions` with:

- `version_id`
- `created_at`
- `created_by`
- `source`
- `checksum`
- `config_path`
- runtime summary fields such as node count and route tiers
- sanitized configuration YAML

Audit events are stored in `config_audit_events` with:

- `event_id`
- `timestamp`
- `actor`
- `action`
- `target`
- before/after summaries
- `result`
- `failure_reason`
- related version ids

Tracked Dashboard actions include config reload, node create/update/delete, routing edits, API key create/update/rotate/delete, and rollback attempts.

## Secret Safety

Snapshots are intentionally safe storage, not raw secret archives.

SiftGate redacts literal sensitive values before storing rollback snapshots:

- provider `api_key`
- dashboard password hash
- raw auth headers such as `authorization` and `x-api-key`
- secret, token, credential, and password-like fields
- dashboard-managed API key hashes

Environment references such as `${OPENAI_API_KEY}` are preserved because they do not expose the resolved value.

Rollback rehydrates redacted secret fields from the current local config when there is an exact matching object path or matching `id` inside arrays such as `nodes`. If a redacted value cannot be safely rehydrated, rollback fails before writing the file and the current config remains active.

## Configuration

The feature is enabled by default with conservative retention:

```yaml
config_audit:
  enabled: true
  max_versions: 50
  max_events: 200
  capture_startup_snapshot: false
```

`capture_startup_snapshot` is disabled by default so existing deployments do not create a new row on every boot unless the operator wants that baseline.

## Dashboard API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/config/versions` | List local config versions |
| `GET` | `/api/dashboard/config/versions/:id` | Read one sanitized version snapshot |
| `POST` | `/api/dashboard/config/versions/:id/rollback` | Validate and restore a version |
| `GET` | `/api/dashboard/config/audit-events` | List local audit events |

Rollback request body:

```json
{
  "reason": "Restore last known good routing config"
}
```

Rollback validates YAML parsing, environment resolution, and config shape before writing `gateway.config.yaml`. On failure, the old in-memory config and on-disk config are retained.

## Dashboard Page

The Dashboard includes a read-only Config Audit page:

- version list with source, checksum, node count, and affected node ids
- sanitized version detail
- rollback confirmation dialog
- audit event table with actor, action, target, result, and failure reason

The page cannot directly edit routing, nodes, API keys, or YAML. It only reads local metadata and can call the rollback endpoint after confirmation.

## SQLite To PostgreSQL

`siftgate migrate-db` includes `config_versions` and `config_audit_events` alongside existing runtime tables. Run a dry run before moving production metadata:

```bash
node dist/cli/siftgate.js migrate-db \
  --from sqlite \
  --to postgres \
  --sqlite-path ./data/gateway.db \
  --postgres-url "$DATABASE_URL" \
  --dry-run
```

## Operational Notes

- Keep `gateway.config.yaml` writable if you want Dashboard node edits or rollback to persist.
- Prefer environment references for provider keys so snapshots can retain stable placeholders without storing raw secrets.
- Store backups of `gateway.config.yaml` through your normal deployment process; SiftGate rollback is an operational convenience, not a replacement for GitOps or infrastructure backups.
- In multi-instance deployments, each instance rolls back its own local file. Use your deployment process to keep instances consistent.
