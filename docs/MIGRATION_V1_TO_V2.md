# v1.9 To v2 Migration Design

SiftGate v2 turns the OSS data plane from a single-tenant smart gateway into a
workspace-aware AI infrastructure platform. The migration path is deliberately
conservative: v1.9 operators should be able to understand the mapping before
and during the first schema change.

v1.9.2 shipped only a read-only dry run:

```bash
npm run build
node dist/cli/siftgate.js migrate-v2 --dry-run --config gateway.config.yaml
node dist/cli/siftgate.js migrate-v2 --dry-run --config gateway.config.yaml --json
node dist/cli/siftgate.js migrate-v2 --dry-run --config gateway.config.yaml --output ./reports/v2-migration-dry-run.json
```

For local TypeScript development, the same command can be run through ts-node:

```bash
npx ts-node src/cli/siftgate.ts migrate-v2 --dry-run --config gateway.config.yaml --json
```

The command does not write data, add columns, create tables, resolve provider
secrets, or connect to upstream providers.

v2.0.0-alpha.1 is the first mutating workspace foundation release. On startup,
the OSS data plane creates the default organization/workspace if needed, adds
nullable `workspace_id` ownership columns to local metadata tables, and
backfills existing rows to `default-workspace`. Existing Gateway API keys,
SQLite development startup, Docker quickstart behavior, and `/v1/*` ingress
compatibility are preserved.

## Target Mapping

v2 creates a default organization and workspace before assigning existing v1.x
single-tenant resources:

| v2 target | Default value |
| --- | --- |
| Organization id | `default-org` |
| Organization name | `Default Organization` |
| Workspace id | `default-workspace` |
| Workspace name | `Default Workspace` |
| Workspace slug | Derived from the workspace name, usually `default-workspace` |

Operators can preview alternate display names during dry run:

```bash
node dist/cli/siftgate.js migrate-v2 --dry-run \
  --organization-name "Acme AI" \
  --workspace-name "Platform Agents"
```

The ids stay stable in the dry-run report and in v2.0.0-alpha.1, so automation
can compare reports across environments.

## v2.0.0-alpha.1 Runtime Behavior

Fresh installs and upgraded v1.9.x installs now have:

- `organizations` with `default-org`
- `workspaces` with `default-workspace`
- nullable `workspace_id` columns on persisted gateway metadata
- default workspace backfill for existing rows that had no workspace owner
- workspace context resolution for Dashboard requests and Gateway API keys
- safe fallback to `default-workspace` for legacy API keys/config rows

Dashboard clients can read the active state:

```bash
curl http://localhost:2099/api/dashboard/workspaces
```

Dashboard clients can validate a workspace switch:

```bash
curl http://localhost:2099/api/dashboard/workspaces/switch \
  -H "content-type: application/json" \
  -d '{"workspace_id":"default-workspace"}'
```

The Dashboard stores the selected workspace client-side and sends
`x-siftgate-workspace-id` on local Dashboard API requests. Gateway traffic
authenticated by a Gateway API key uses that key's workspace; legacy keys with
no stored workspace id resolve to `default-workspace`.

v2.0.0-alpha.2 adds local Dashboard RBAC on top of the alpha.1 workspace
foundation. During startup, the migration bootstrap ensures the local
Dashboard identity `dashboard` is an active Admin in `default-workspace`.
Viewer and Operator memberships can then be managed through the local
Dashboard member APIs. SSO/OIDC, invitations, organization billing, and full
multi-workspace provisioning remain intentionally out of scope.

## Resource Assignment

The dry run reports how many existing resources would be assigned to the
default workspace. v2.0.0-alpha.1 applies that default workspace owner to local
metadata rows where the table exists.

| Resource | Source inspected |
| --- | --- |
| Gateway API keys | `gateway_api_keys` table when present, otherwise `auth.api_keys` |
| Local teams | `local_teams` table when present, otherwise legacy `local_teams` config when present |
| Namespaces | `namespaces[]` in config |
| Nodes | `nodes[]` in config |
| Budgets | `budget_rules` table when present, otherwise global/key/namespace/team config budgets |
| Routing policies | routing tiers plus retry, fallback, cache affinity, and domain preferences |
| Agent profiles | `agent_profiles` table |
| Call logs | `call_logs` table |
| Eval rows | `eval_datasets`, `eval_experiment_runs`, and `eval_sample_results` tables |
| MCP servers | `mcp.servers[]` in config |
| Batch jobs | `batch_jobs` table |
| Dashboard users | Derived from local Dashboard password configuration |

The report is metadata-only. It does not include prompts, responses, raw
provider headers, provider keys, media bytes, tool payloads, hidden reasoning
text, or resolved secrets.

alpha.1 uses the same privacy boundary. Workspace ownership is operational
metadata only; it does not create a prompt/response store.

## Report Format

The JSON report is the stable automation contract for v1.9.2:

```json
{
  "version": "siftgate.v2_migration_dry_run.v1",
  "dry_run": true,
  "mutates_data": false,
  "default_workspace": {
    "organization_id": "default-org",
    "workspace_id": "default-workspace"
  },
  "plan": {
    "gateway_api_keys": { "source": "database", "count": 2 }
  },
  "blockers": [],
  "warnings": [],
  "validation_commands": [
    "npm run validate:config",
    "npm run release:check",
    "npm run docs:check",
    "npm run build"
  ]
}
```

Human-readable output is available by omitting `--json`.

v2.0.0-rc.1 finalizes the dry-run export path. `--output`, `--report`, `--out`,
and `-o` write the stable JSON report to disk while keeping the command
read-only. Use that exported report as change-management evidence before
running mutating v2 startup or database migration steps.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Dry run completed without blockers |
| `1` | Invalid CLI usage, such as omitting `--dry-run` |
| `2` | Dry run completed but found blockers, such as a missing config file |

## Database Inspection

SQLite deployments are inspected in read-only mode. If the SQLite file is
missing, the dry run still reports config-backed counts and emits an
informational `sqlite_not_found` issue.

PostgreSQL deployments are intentionally not opened by the v1.9.2 dry run. The dry run
reports `postgres_not_inspected` so operators can use normal database-native
read-only queries or a copied SQLite export for row-count planning. This avoids
putting production credentials into a planning-only command before the v2
storage contract exists.

v2.0.0-alpha.1 can run the workspace bootstrap and backfill against SQLite or
PostgreSQL, but PostgreSQL production hardening is still scheduled for a later
v2.0 alpha. Operators should keep normal database backups before adopting an
alpha release.

## Backup Recommendation

Before running the future v2 migration, back up:

- `gateway.config.yaml`
- `catalog.override.yaml`
- `.env`
- the SQLite database file, if present
- the PostgreSQL database using your normal snapshot tooling, if applicable

Keep the dry-run JSON output with change-management records or release notes.
It is designed to answer what would be assigned before the first mutating v2
migration exists.

## Validation Commands

Run these commands before and after changing config or database paths:

```bash
npm run validate:config
npm run release:check
npm run docs:check
npm run build
```

v2.0.0-alpha.1 keeps the v1.9.2 dry-run contract working and uses this mapping
as the compatibility baseline for later RBAC and production-runtime prompts.
v2.0.0-alpha.2 keeps that mapping intact and adds only local membership
metadata; it does not migrate prompts, responses, raw provider headers,
provider keys, media bytes, tool payloads, hidden reasoning text, or resolved
secrets.

v2.0.0-alpha.3 includes `workspace_memberships` in the SQLite-to-PostgreSQL
production migration path. Existing alpha.2 local RBAC memberships therefore
move with the rest of the default organization/workspace metadata when
operators adopt PostgreSQL for production.

v2.0.0-rc.1 adds the `management_audit_events` table for platform management
audit evidence and includes it in the SQLite-to-PostgreSQL migration path.
Startup diagnostics and migration docs now treat the v1.9-to-v2 dry-run report,
database backups, and metadata-only audit table as the final Platform Trust
upgrade guardrails before v2.0.0 GA.
