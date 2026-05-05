# Production Deployment

This guide covers the open-source SiftGate Data Plane only. SiftGate Cloud is
an optional control plane; a self-hosted gateway remains fully usable with
local config, local provider credentials, SQLite for development, PostgreSQL
for production, and optional Redis-backed shared state.

v1.0.0 keeps that deployment shape while adding the Extension Ecosystem layer
on top of the v0.9.3 Operations + Trust foundation: Provider Catalog coverage
for 30+ providers, reasoning/thinking intent across protocols, metadata-only
guardrails webhook findings with more local rules, and a fuller OSS Dashboard
API Key management surface. Structured output, rerank, images, audio, video,
Batch API metadata, secret resolution, audit metadata, benchmark summaries, provider catalog
metadata, and API key policy stay in the open-source Data Plane. Keep the
guardrails webhook sink disabled until the receiver, queue limits, retry
policy, and downstream retention policy have been reviewed.
Realtime, video, and Batch result download proxying should only be enabled for
production after upstream provider behavior, connection limits, job/file
retention, and load balancer paths have been tested in your environment.

Provider pricing sync remains an operator-controlled metadata workflow. Leave
`catalog.sync.enabled` off unless the deployment is allowed to make outbound
requests to a supported public catalog. In v1.2 only OpenRouter has an
automatic adapter; the recommended target is the local sync cache so reviewed
`catalog.override.yaml`, node `model_capabilities[].pricing`, and
`models_pricing` stay authoritative.

## Baseline Topology

- Run one SiftGate instance for small deployments, or two or more instances
  behind an HTTP load balancer for higher availability.
- Put `gateway.config.yaml` on every instance through the same deployment
  process.
- Keep provider credentials out of committed config. Use legacy `${VAR}` env
  interpolation for simple deployments or v0.9 `${env:VAR}` runtime secret
  references when you want SecretReferenceResolver caching and consistent
  Dashboard redaction.
- Use PostgreSQL for durable call logs and generated Gateway API key records
  when SQLite is not enough for production traffic.
- Manage client credentials from the OSS Dashboard API Keys page. It supports local namespace binding, endpoint/modality/node/model restrictions, per-key budgets, per-key rate limits, disable/delete/rotate, masked display, one-time copy on create/rotate, and audit events without requiring Cloud workspace/RBAC.
- Use Redis only for features that need shared state or multi-instance
  coordination.
- Keep `/health` on the load balancer health check path.

## Kubernetes / Helm

v0.9 adds OSS-only deployment assets for Kubernetes:

- Helm chart: `deploy/helm/siftgate`
- Kustomize/plain manifests: `deploy/kubernetes/base`
- local validation: `npm run validate:k8s`

The defaults stay conservative: one replica, SQLite on a PVC, memory state
backend, `cluster.enabled=false`, `realtime.enabled=false`, no Ingress, no
autoscaling, no SiftGate Cloud, no enterprise image, and no real secrets in the
repository. Redis, PostgreSQL, Ingress, HPA, PodDisruptionBudget,
ServiceMonitor, existing Secrets/ConfigMaps, resource requests/limits, and
persistence controls are opt-in through Helm values.

See [Kubernetes And Helm](KUBERNETES.md) before using these assets in a
production cluster.

## Database Recommendation

SQLite is the default because it keeps local development and small self-hosted
installs simple:

```yaml
database:
  type: sqlite
  path: ./data/gateway.db
```

For production, use PostgreSQL so call logs, Dashboard-managed Gateway API
keys, local teams, budgets, and node status can be backed up and operated
independently from one container filesystem:

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

- Reads `gateway_api_keys`, `budget_rules`, `node_status`, `call_logs`,
  `route_decisions`, `config_versions`, `config_audit_events`,
  `provider_compatibility_results`, `batch_jobs`, and `video_jobs`.
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

## MCP Gateway Preview

The v1.2 MCP Gateway preview is disabled by default. Enable it only for MCP
servers you operate or explicitly trust:

```yaml
mcp:
  enabled: true
  servers:
    - id: local-docs
      url: "http://localhost:8787/mcp"
      allowed_namespaces: [team-a]
      headers:
        Authorization: "Bearer ${env:LOCAL_DOCS_MCP_TOKEN}"
```

Use Gateway API key `allowed_endpoints` to scope access to `mcp`,
`mcp:<serverId>`, or `mcp:<serverId>:<toolName>`. Keep upstream credentials in
environment or secret references, avoid secrets in MCP URLs, and prefer
namespace allow-lists for team-scoped tool servers. The preview audit buffer is
metadata-only and in-memory; it is useful for recent operational visibility but
is not a durable compliance event store.

## Config Audit And Rollback

The v0.9 OSS Data Plane keeps local config audit history in the same database
used for runtime metadata. SQLite remains the default; PostgreSQL is recommended
when config history should survive container replacement and be backed up with
the rest of production metadata.

```yaml
config_audit:
  enabled: true
  max_versions: 50
  max_events: 200
  capture_startup_snapshot: false
```

Operational guidance:

- Keep provider keys as environment references such as `${OPENAI_API_KEY}`
  wherever possible.
- Snapshots redact literal secrets before storage. Rollback rehydrates redacted
  fields from the current local config only when the path or array `id` matches.
- Rollback validates the target config before writing the file. Failed rollback
  attempts keep the current config active and write a failure audit event.
- In multi-instance deployments, rollback is local to one instance. Roll config
  changes through your deployment system so every instance converges.
- Include `config_versions` and `config_audit_events` in PostgreSQL backups and
  restore tests if you rely on Dashboard rollback during incident response.

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

## Secret References

The default production recommendation remains simple: store provider keys and
tokens in environment variables and reference them from `gateway.config.yaml`.

```yaml
nodes:
  - id: openai
    api_key: "${env:OPENAI_API_KEY}"

control_plane:
  enabled: false
  registration_token: "${env:SIFTGATE_CONTROL_TOKEN}"
```

Vault, AWS Secrets Manager, and GCP Secret Manager are optional SDK-less HTTP
adapters and stay disabled until configured:

```yaml
secret_manager:
  cache_ttl_seconds: 300
  failure_policy: fail_closed
  backends:
    env:
      enabled: true
    vault:
      enabled: true
      address: "${env:VAULT_ADDR}"
      token: "${env:VAULT_TOKEN}"
```

Use external managers when your deployment platform already manages those
systems. Resolved values are used only at the outbound edge and are redacted
from Dashboard config, compatibility results, call logs, route traces, and
telemetry summaries. See [SECRET_MANAGEMENT.md](SECRET_MANAGEMENT.md) for
backend-specific syntax.

## Redis Shared State And Cluster Mode

Cluster mode is disabled in the default memory configuration. Enable it with either `state.backend: redis` or `cluster.enabled: true`:

```yaml
state:
  backend: redis
  unavailable_policy: fail_open
  redis:
    url: ${REDIS_URL:-redis://127.0.0.1:6379}
    prefix: siftgate:state:
    timeout_ms: 500
    sync_interval_ms: 2000

cluster:
  enabled: true
  instance_id: ${SIFTGATE_INSTANCE_ID:-}
  heartbeat_interval_seconds: 10
  heartbeat_ttl_seconds: 30
  reload_broadcast: true
```

Redis shared state can coordinate API key/IP rate limits, prompt-cache entries,
circuit breaker status, and routing momentum across instances. `fail_open`
keeps request traffic flowing when Redis is unavailable; `fail_closed` rejects
rate-limited paths and treats circuits as unavailable until Redis recovers.

When cluster mode is enabled, each instance writes a heartbeat record under the
configured Redis prefix and publishes lifecycle events through Redis Pub/Sub.
`GET /cluster/status` reports the local instance, peer inventory, Redis status,
heartbeat timing, and reload broadcast metadata. In default single-instance
memory mode, the endpoint returns `404`.

There is no leader election. Every instance independently handles requests and should have the same local configuration, provider credentials, and plugin declarations.

## Config Reload Broadcasts

A successful local reload from the Dashboard API, `SIGHUP`, or file watcher publishes a Redis `config.reload` event when `cluster.reload_broadcast` is enabled. Peer instances respond by running their own `ConfigService.reload({ source: "cluster" })`, which means each peer parses and validates its local file and keeps its previous snapshot if reload fails.

Redis Pub/Sub does not carry provider keys, prompts, responses, raw headers, or full config contents. It carries metadata such as instance id, timestamps, and config version.

## Redis Operations

- Prefer `rediss://` or private network Redis; do not expose Redis publicly.
- Use a dedicated prefix such as `siftgate:prod:` when Redis is shared with other workloads.
- Set `heartbeat_ttl_seconds` higher than `heartbeat_interval_seconds`; the example uses a 3x TTL.
- Redis outages are logged and shown in `/cluster/status`, but they do not block the main AI request path.
- The first implementation uses Redis `KEYS` for the small cluster inventory namespace; keep the prefix narrow.

## Security Notes

- Provider API keys should stay in environment variables or a local secret manager referenced from `gateway.config.yaml`.
- Dashboard-generated Gateway API keys are the only keys clients should use against `/v1/*`. Operators should scope them with local teams, endpoint/modalities, allowed nodes/models, namespace, daily budgets, and rate limits instead of sharing one global client key.
- Local teams are OSS-only shared policy groups. They help manage multiple keys locally, but they are not enterprise SSO, SCIM, workspaces, RBAC, or org billing.
- Gateway API key list/update/delete responses only expose masked prefixes. Create and rotate responses show the full key once; config audit events store redacted summaries and do not persist that one-time secret.
- The open-source Data Plane does not require SiftGate Cloud. If `control_plane` is enabled, it is an outbound optional integration and AI traffic still flows from the gateway to the configured providers.
