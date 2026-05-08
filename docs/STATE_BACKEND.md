# Shared State Backend

SiftGate keeps runtime state in local memory by default. This remains the safest
single-node setup: no Redis is required, and existing open-source deployments
continue to work unchanged.

For multi-instance deployments, configure Redis as a shared state backend:

```yaml
state:
  backend: redis
  unavailable_policy: fail_open # fail_open | fail_closed default
  redis:
    url: ${REDIS_URL:-redis://localhost:6379}
    prefix: siftgate:state:
    timeout_ms: 500
    sync_interval_ms: 2000
  categories:
    rate_limit:        { ttl_seconds: 60 }
    circuit_breaker:   { ttl_seconds: 3600 }
    cache_affinity:    { ttl_seconds: 1800 }
    momentum:          { ttl_seconds: 1800 }
    prompt_cache:      { ttl_seconds: 300 }
    concurrency:       { ttl_seconds: 120 }
    health_probe:      { ttl_seconds: 120 }
    realtime_session:  { ttl_seconds: 1800 }
```

Redis is not a database replacement. v2.0.0-alpha.3 documents PostgreSQL as
the production metadata database for durable workspace/RBAC/API-key/budget/log
state, while Redis remains the optional shared runtime state backend for
multi-instance coordination.

## What Uses Shared State

| Category | Memory Default | Redis Mode | Default TTL |
| --- | --- | --- | --- |
| `rate_limit` | Local fixed/sliding windows | Redis `INCR` + `PEXPIRE` fixed window | 60s |
| `circuit_breaker` | Local `Map` | Redis hash plus local mirror refresh | 3600s |
| `cache_affinity` | Local session affinity | Redis JSON state scoped by workspace/session | 1800s |
| `momentum` | Local session window | Redis sorted set plus local mirror | 1800s |
| `prompt_cache` | Local LRU map | Redis String + TTL when prompt cache is enabled | 300s |
| `concurrency` | Local active/queued counters | Metadata-only local node summaries | 120s |
| `health_probe` | Local probe result cache | Metadata-only active probe summaries | 120s |
| `realtime_session` | Local WebSocket map | Metadata-only connection summaries | 1800s |

Circuit breaker and momentum still keep a local mirror so the existing routing
path stays fast and synchronous. Redis writes happen on state changes, and
`sync_interval_ms` controls periodic mirror refresh.

## Failure Policy

`unavailable_policy: fail_open` keeps traffic moving if Redis is unavailable.
Rate limits allow requests, cache operations become misses/skips, and local
memory remains available for best-effort state.

`unavailable_policy: fail_closed` is stricter. Rate-limited paths reject while
Redis is unavailable, and circuit checks treat targets as unavailable until
state recovers.

You can override policy and TTL per category:

```yaml
state:
  backend: redis
  unavailable_policy: fail_open
  categories:
    rate_limit:
      unavailable_policy: fail_closed
      ttl_seconds: 60
    concurrency:
      unavailable_policy: fail_closed
      ttl_seconds: 120
```

Affinity, cache, health probe, and realtime metadata default to fail-open
because losing that state should not stop AI traffic.

## Cluster Status

Cluster mode starts when `cluster.enabled=true` or `state.backend=redis`.
`GET /cluster/status` is the operator endpoint for enabled multi-instance
mode and returns `404` in default single-instance mode.

Dashboard uses `GET /api/dashboard/cluster`, which always returns privacy-safe
local status for authenticated viewers. It includes:

- local node id and instance count,
- Redis connection status and sanitized URL,
- shared-state backend and configured key prefix,
- per-category TTL/policy/share status,
- recent Redis state errors.

Neither endpoint returns prompts, responses, provider keys, raw headers, media
bytes, tool payloads, hidden reasoning text, or resolved secrets.

## Docker Compose

The default Compose stack does not start Redis. To test Redis state locally:

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
printf '\nREDIS_URL=redis://redis:6379\n' >> .env
docker compose --profile redis up -d --build
```

Then enable the `state` block in `gateway.config.yaml` with
`backend: redis`.

## Safety

Redis keys use the configured prefix. Prompt-cache keys are SHA-256 hashes of
canonical request semantics; raw provider keys and authorization headers are not
used as keys. Prompt-cache response bodies are stored only when the gateway
cache is explicitly enabled, matching existing cache behavior.

All Redis runtime keys are also scoped by workspace:

```text
<prefix>ws:<workspace-id>:<category>:<key>
```

This keeps default-workspace upgrades compatible while preventing shared Redis
state from crossing workspace boundaries as v2 platform isolation expands.
