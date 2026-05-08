# v1.9 To v2 Migration Design

SiftGate v2 turns the OSS data plane from a single-tenant smart gateway into a
workspace-aware AI infrastructure platform. The migration path is deliberately
conservative: v1.9 operators should be able to understand the future mapping
before any schema change is introduced.

v1.9.2 ships only a read-only dry run:

```bash
npm run build
node dist/cli/siftgate.js migrate-v2 --dry-run --config gateway.config.yaml
node dist/cli/siftgate.js migrate-v2 --dry-run --config gateway.config.yaml --json
```

For local TypeScript development, the same command can be run through ts-node:

```bash
npx ts-node src/cli/siftgate.ts migrate-v2 --dry-run --config gateway.config.yaml --json
```

The command does not write data, add columns, create tables, resolve provider
secrets, or connect to upstream providers.

## Target Mapping

v2 will create a default organization and workspace before assigning existing
v1.x single-tenant resources:

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

The ids stay stable in the dry-run report so automation can compare reports
across environments.

## Resource Assignment

The dry run reports how many existing resources would be assigned to the
default workspace.

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

PostgreSQL deployments are intentionally not opened in v1.9.2. The dry run
reports `postgres_not_inspected` so operators can use normal database-native
read-only queries or a copied SQLite export for row-count planning. This avoids
putting production credentials into a planning-only command before the v2
storage contract exists.

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

When v2 introduces the mutating migration, its prompt must keep the v1.9.2
dry-run contract working and use this mapping as the compatibility baseline.
