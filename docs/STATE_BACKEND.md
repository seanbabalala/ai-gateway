# Shared State Backend

SiftGate keeps runtime state in local memory by default. This remains the safest
single-node setup: no Redis is required, and existing open-source deployments
continue to work unchanged.

For multi-instance deployments, configure Redis as a shared state backend:

```yaml
state:
  backend: redis
  unavailable_policy: fail_open # fail_open | fail_closed
  redis:
    url: ${REDIS_URL:-redis://localhost:6379}
    prefix: siftgate:state:
    timeout_ms: 500
    sync_interval_ms: 2000
```

Redis is not a database replacement. v2.0.0-alpha.3 documents PostgreSQL as
the production metadata database for durable workspace/RBAC/API-key/budget/log
state, while Redis remains the optional shared runtime state backend for
multi-instance coordination.

## What Uses Shared State

| Component | Memory Default | Redis Mode |
| --- | --- | --- |
| Circuit breaker | Local `Map` | Redis hash plus local mirror refresh |
| Rate limiter | Local sliding window | Redis `INCR` + `PEXPIRE` fixed window |
| Prompt cache | Local LRU map | Redis String + TTL |
| Momentum routing | Local session window | Redis sorted set plus local mirror |

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
cache is enabled, matching existing cache behavior.
