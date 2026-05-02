# Production Deployment

SiftGate Data Plane is useful as a single MIT-licensed gateway, and SiftGate Cloud remains an optional control plane. Production deployments should keep provider keys local, run the gateway behind a load balancer, and choose explicit state/database backends for the reliability level they need.

## Baseline Topology

- Run two or more SiftGate instances behind an HTTP load balancer.
- Put `gateway.config.yaml` on every instance through the same deployment process.
- Use PostgreSQL for durable call logs and generated Gateway API key records when SQLite is not enough for your production traffic.
- Use Redis only for features that need shared state or multi-instance coordination.
- Keep `/health` on the load balancer health check path.

SQLite remains the default development experience. PostgreSQL is recommended for production because it avoids local-disk coupling and makes rolling instance replacement simpler.

## Redis Cluster Mode

Cluster mode is disabled in the default memory configuration. Enable it with either `state.backend: redis` or `cluster.enabled: true`:

```yaml
state:
  backend: redis
  redis:
    url: ${REDIS_URL:-redis://127.0.0.1:6379}
    prefix: siftgate:

cluster:
  enabled: true
  instance_id: ${SIFTGATE_INSTANCE_ID:-}
  heartbeat_interval_seconds: 10
  heartbeat_ttl_seconds: 30
  reload_broadcast: true
```

When enabled, each instance writes a heartbeat record under the configured Redis prefix and publishes lifecycle events through Redis Pub/Sub. `GET /cluster/status` reports the local instance, peer inventory, Redis status, heartbeat timing, and reload broadcast metadata. In default single-instance mode, the endpoint returns `404`.

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
- Dashboard-generated Gateway API keys are the only keys clients should use against `/v1/*`.
- The open-source Data Plane does not require SiftGate Cloud. If `control_plane` is enabled, it is an outbound optional integration and AI traffic still flows from the gateway to the configured providers.
