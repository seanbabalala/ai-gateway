# Kubernetes And Helm

SiftGate v0.7 adds deployment assets for the MIT open-source Data Plane:

- Helm chart: `deploy/helm/siftgate`
- Plain Kubernetes/Kustomize base: `deploy/kubernetes/base`

These assets deploy only the local data plane. They do not deploy SiftGate Cloud,
do not require a control plane, and do not include enterprise-only dashboard or
private dependencies.

## Helm Quickstart

Build or publish a SiftGate image, then install the chart:

```bash
helm upgrade --install siftgate ./deploy/helm/siftgate \
  --namespace siftgate \
  --create-namespace \
  --set image.repository=ghcr.io/seanbabalala/ai-gateway \
  --set image.tag=0.6.1 \
  --set secrets.env.OPENAI_API_KEY="$OPENAI_API_KEY"
```

Open the Dashboard locally:

```bash
kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

## Plain Kubernetes Quickstart

```bash
kubectl apply -k deploy/kubernetes/base
kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

Replace `deploy/kubernetes/base/secret.example.yaml` with a real Secret before
using the manifests beyond local testing.

## Defaults

The chart and base manifests intentionally mirror the single-host default:

- one SiftGate replica
- SQLite on a PVC at `/app/data/gateway.db`
- memory state backend
- `cluster.enabled: false`
- no Ingress
- no autoscaling
- no Redis or PostgreSQL dependency

That keeps a Kubernetes install useful without Redis, PostgreSQL, or SiftGate
Cloud. Production clusters can opt into each backend explicitly.

## Dashboard Passwords

Kubernetes ConfigMap mounts are read-only. SiftGate hashes plaintext Dashboard
passwords on startup and writes the hash back to `gateway.config.yaml`, which is
not appropriate for a read-only ConfigMap mount.

Use a bcrypt hash in a Secret and reference it from config:

```yaml
dashboard:
  password: "${DASHBOARD_PASSWORD_HASH:-}"
```

Leave `DASHBOARD_PASSWORD_HASH` unset only for a private test cluster where an
open Dashboard is acceptable.

## PostgreSQL

For production, prefer PostgreSQL for call logs, Dashboard-managed Gateway API
keys, budgets, node status, and route decisions:

```yaml
postgres:
  enabled: true
  databaseUrlSecret:
    name: siftgate-postgres
    key: DATABASE_URL
```

Then update `config.data`:

```yaml
database:
  type: postgres
  url: "${DATABASE_URL}"
  synchronize: false
```

Run the SQLite-to-PostgreSQL migration or schema bootstrap before switching a
live deployment to `synchronize: false`. See `docs/PRODUCTION.md`.

## Redis And Cluster Mode

Redis is optional. Enable it only when you need shared rate limits, circuit
breakers, prompt cache state, routing momentum, or cluster inventory:

```yaml
redis:
  enabled: true
  urlSecret:
    name: siftgate-redis
    key: REDIS_URL
```

Then update `config.data`:

```yaml
state:
  backend: redis
  redis:
    url: "${REDIS_URL}"
    prefix: siftgate:state:

cluster:
  enabled: true
  reload_broadcast: true
```

There is no leader election. Every pod handles traffic independently and should
mount the same validated config.

## Operations Checklist

- Run `npm run validate:k8s` after editing deployment assets.
- Run `siftgate validate --config gateway.config.yaml` against the rendered
  config before rollout.
- Keep provider keys in Kubernetes Secrets or an external secret controller.
- Keep `gateway.config.yaml` out of container images when it contains real
  provider or webhook values.
- Use `/health` for readiness/liveness probes.
- Keep `realtime.enabled=false` unless your Ingress/controller supports
  WebSocket upgrades and idle timeouts for your workload.
