# Docker Quickstart

This guide is the recommended path for self-hosted and open-source installs.

## 1. Prepare Local Files

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
mkdir -p data
```

Edit `.env` and add provider API keys for the nodes you enabled in
`gateway.config.yaml`. The gateway can start without real provider keys, but
upstream model requests will fail until the relevant provider key is set.

Gateway API keys are not stored in `.env`. Create them from the Dashboard after
startup.

If you are running from a source checkout with dependencies installed, validate
the config before starting Compose:

```bash
npm run validate:config -- --config gateway.config.yaml
```

## 2. Start

```bash
docker compose up -d --build
```

Open the Dashboard:

```text
http://localhost:2099
```

## 3. Verify Health

```bash
curl http://localhost:2099/health
docker compose ps
docker compose logs -f siftgate
```

The container should become `healthy`. SQLite data is persisted in `./data`, so
generated Gateway API keys and call logs survive container restarts.

## Automated Smoke Test

Maintainers can validate the Docker quickstart path with one command:

```bash
npm run smoke:docker
```

The smoke test builds the Docker image, starts an isolated Compose project with
a local mock upstream, creates a Dashboard-managed Gateway API key, verifies
`model: "auto"` and direct model routing, checks logs and per-key budgets by
`api_key_id`, restarts the gateway, and confirms SQLite persistence.

Useful options:

```bash
# Keep the generated compose workspace and containers for debugging
SIFTGATE_DOCKER_SMOKE_KEEP=1 npm run smoke:docker

# Use a prebuilt local image instead of building from Dockerfile
SIFTGATE_DOCKER_SMOKE_IMAGE=siftgate:local npm run smoke:docker

# Pin the host port instead of auto-selecting one
SIFTGATE_DOCKER_SMOKE_PORT=32199 npm run smoke:docker
```

The smoke workspace is created under `.docker-smoke/` inside the repository, not
under `/tmp`, so Docker Desktop/Rancher Desktop bind mounts use a host directory
that is normally shared with the Docker VM.

## Optional Redis State Backend

The default Compose stack runs the gateway with local memory state. To test the
v0.5 Redis shared state backend for multi-instance deployments, enable the Redis
profile and configure `state.backend: redis` in `gateway.config.yaml`:

```bash
printf '\nREDIS_URL=redis://redis:6379\n' >> .env
docker compose --profile redis up -d --build
```

Redis shares rate limits, prompt cache, circuit breaker state, and routing
momentum across gateway instances. See [Shared State Backend](STATE_BACKEND.md)
for `fail_open` and `fail_closed` behavior.

## Optional PostgreSQL Profile

SQLite is the default Docker quickstart database and persists in `./data`. For a
local production-like test, start the optional PostgreSQL service:

```bash
POSTGRES_PASSWORD=replace-me docker compose --profile postgres up -d postgres
```

Set `DATABASE_URL=postgresql://siftgate:replace-me@postgres:5432/siftgate` in
`.env`, change `gateway.config.yaml` to `database.type: postgres`, and set
`database.synchronize: false` after running the migration/bootstrap step. See
[Production Deployment](PRODUCTION.md) for the SQLite to PostgreSQL migration
workflow.

## Kubernetes Next Step

For Kubernetes deployments, use the OSS-only Helm chart or Kustomize base:

```bash
npm run validate:k8s
helm upgrade --install siftgate ./deploy/helm/siftgate --namespace siftgate --create-namespace
kubectl apply -k deploy/kubernetes/base
```

The Kubernetes defaults mirror this Docker quickstart: SQLite persistence,
memory state backend, no Cloud requirement, and no real provider secrets in the
repo. See [Kubernetes And Helm](KUBERNETES.md).

## 4. Create a Gateway API Key

In the Dashboard, open **API Keys**, create a key, and copy it once. Then call
the gateway:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer gw_sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}'
```

Direct routing works only when direct access is enabled for that Gateway API
key:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer gw_sk_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

## Volumes

The compose file mounts:

- `./gateway.config.yaml` to `/app/gateway.config.yaml`
- `./data` to `/app/data`

The config file is mounted writable so Dashboard edits and first-start dashboard
password hashing can persist. If you prefer read-only config in production,
pre-hash the dashboard password and manage config changes outside the Dashboard.

## Troubleshooting

### `env file .env not found`

Run:

```bash
cp .env.example .env
```

Compose expects a local `.env` file even if you have not filled provider keys
yet.

### Container is healthy, but model requests fail

Check that the provider key for the selected node is set in `.env` and that
`gateway.config.yaml` references the same variable name.

### Port 2099 is already in use

Change the host port in `docker-compose.yml`:

```yaml
ports:
  - "21099:2099"
```

Then open `http://localhost:21099`.

### Dashboard password was saved as plain text

On startup, the gateway hashes a plain-text dashboard password and writes it
back to `gateway.config.yaml`. Make sure the mounted config file is writable, or
pre-hash the password before mounting it read-only.

### Data disappears after restart

Make sure `./data:/app/data` is present in `docker-compose.yml` and that the
host `data` directory is writable by Docker.

Run Compose from the project directory, or use an absolute path under a host
directory shared with Docker. Some Docker Desktop/Rancher Desktop setups do not
share `/tmp` with the Docker VM, so a bind mount that points at `/tmp/.../data`
can appear to work while the container is actually writing to a VM-local path.
