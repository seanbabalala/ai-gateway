# SiftGate Helm Chart

This chart installs the MIT open-source SiftGate Data Plane. It does not deploy
SiftGate Cloud and does not require any enterprise/private dependency.

## Default Mode

The default values run one gateway pod with:

- local memory state
- SQLite at `/app/data/gateway.db`
- a PVC for `/app/data`
- one OpenAI-compatible node using `OPENAI_API_KEY`
- Dashboard auth disabled unless `DASHBOARD_PASSWORD_HASH` is supplied

ConfigMap volumes are read-only in Kubernetes, so use a bcrypt dashboard
password hash instead of a plaintext password. A plaintext password would cause
the gateway to try writing the generated hash back to `gateway.config.yaml`.

## Install

```bash
helm upgrade --install siftgate ./deploy/helm/siftgate \
  --namespace siftgate \
  --create-namespace \
  --set secrets.env.OPENAI_API_KEY="$OPENAI_API_KEY" \
  --set secrets.env.DASHBOARD_PASSWORD_HASH="$DASHBOARD_PASSWORD_HASH"
```

Open the Dashboard locally:

```bash
kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

## PostgreSQL

Set `database.type: postgres` in `config.data` and pass a secret containing
`DATABASE_URL`:

```yaml
postgres:
  enabled: true
  databaseUrlSecret:
    name: siftgate-postgres
    key: DATABASE_URL
```

Production PostgreSQL deployments should run the SQLite-to-PostgreSQL migration
or schema bootstrap before setting `database.synchronize: false`.

## Redis

Set `state.backend: redis` in `config.data` and pass a secret containing
`REDIS_URL`:

```yaml
redis:
  enabled: true
  urlSecret:
    name: siftgate-redis
    key: REDIS_URL
```

Redis enables shared rate limits, circuit breakers, prompt cache state, routing
momentum, and cluster status across replicas. If Redis is not configured, the
gateway remains fully usable in single-instance memory mode.

## Existing ConfigMap Or Secret

Use `config.existingConfigMap` when your GitOps system owns the full
`gateway.config.yaml`, and `secrets.existingSecret` when another secret manager
syncs provider credentials into Kubernetes.

The Dashboard page remains local to the open-source data plane. This chart does
not expose provider keys, raw request headers, prompts, or responses.
