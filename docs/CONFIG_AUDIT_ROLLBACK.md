# Config Audit And Rollback

SiftGate v0.7 adds local config audit and rollback for the MIT Data Plane.
It is designed for self-hosted operators who edit `gateway.config.yaml`
through the Dashboard or reload config during deploys.

This feature does not require SiftGate Cloud, Redis, or PostgreSQL. SQLite
remains the default local backend.

## What Is Stored

SiftGate stores two local database tables:

| Table | Purpose |
| --- | --- |
| `config_versions` | Versioned YAML snapshots used for rollback |
| `config_audit_events` | Audit metadata for config reloads, node/routing mutations, and rollbacks |

The Dashboard APIs never return raw rollback YAML. Version detail responses
include a sanitized config object where provider API keys, Gateway API keys,
passwords, tokens, and secret-like fields are redacted. Environment references
such as `${OPENAI_API_KEY}` are preserved as references.

Rollback still needs the original YAML snapshot on the server side. If your
config contains literal provider keys, those literals are already present in
`gateway.config.yaml` and will also exist in the local SiftGate database. For
production, prefer environment variables or a local secret manager reference.

## Configuration

The feature is enabled by default with conservative local retention:

```yaml
config_audit:
  enabled: true
  max_versions: 50
  max_events: 100
  capture_startup_snapshot: true
```

Set `enabled: false` if your deployment manages config versions exclusively
outside SiftGate.

## Dashboard API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/audit-log` | List local config audit events |
| `GET` | `/api/dashboard/config/versions` | List stored config versions |
| `GET` | `/api/dashboard/config/versions/:id` | Fetch one version with sanitized config |
| `POST` | `/api/dashboard/config/rollback/:id` | Restore `gateway.config.yaml` to a stored version |

Rollback validates the target YAML before writing it to disk. If validation
fails, the current config and file remain unchanged.

Example rollback:

```bash
curl -X POST http://localhost:2099/api/dashboard/config/rollback/12 \
  -H "Content-Type: application/json" \
  -d '{"reason":"Restore last known good routing config"}'
```

## Multi-Instance Behavior

In single-node mode, rollback updates the local file and in-memory config only.
When v0.5 Redis cluster mode is enabled, a successful rollback emits the normal
config reload event. Peer instances then reload and validate their own local
`gateway.config.yaml`; Redis Pub/Sub does not carry provider keys or raw config
contents.

## Privacy Boundary

Config audit stores no prompts, responses, raw request headers, or provider
traffic. It stores config metadata plus local YAML snapshots for rollback.
Treat the SiftGate database with the same sensitivity as `gateway.config.yaml`.
