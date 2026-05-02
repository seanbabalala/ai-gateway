<p align="center">
  <h1 align="center">SiftGate</h1>
  <p align="center">
    Self-hosted AI traffic gateway for teams. Run it in your infrastructure. Keep prompts, responses, and provider keys local.
    <br />
    Multi-protocol routing, fallback, budgets, API keys, dashboard, and observability.
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#core-concepts">Core Concepts</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-endpoints">API Endpoints</a> &bull;
  <a href="#dashboard">Dashboard</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#connected-gateway">Connected Gateway</a> &bull;
  <a href="docs/PRODUCT_ROADMAP.md">Roadmap</a> &bull;
  <a href="docs/ARCHITECTURE.md">Architecture</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## What is SiftGate?

SiftGate is a **self-hosted AI traffic data plane** that sits between your applications and multiple AI providers (OpenAI, Anthropic, Google, local models, and compatible proxies). It accepts requests in **any** of the three major API formats and intelligently routes them to the best provider based on request complexity, cost, and availability.

**The problem it solves:** Different AI providers use different API formats (`chat/completions`, `responses`, `messages`). If you use multiple providers, your code needs to handle each format separately. SiftGate gives you a **single endpoint** that speaks all three formats and automatically picks the right provider.

```
Your App ──▶ SiftGate ──▶ OpenAI (GPT)
         (any format)   ├──▶ Anthropic (Claude)
                        ├──▶ Google (Gemini)
                        └──▶ Any OpenAI-compatible API
```

Long term, SiftGate is becoming an **AI traffic control plane**: open-source gateways run in customer infrastructure, while an optional hosted control plane can manage fleet health, policies, audit metadata, and router recommendations without proxying AI content.

## Repository Boundary

This repository is the **open-source SiftGate Data Plane**:

- GitHub: `https://github.com/seanbabalala/ai-gateway`
- License: MIT
- Scope: self-hosted gateway runtime, local dashboard, routing engine, plugin SDK, observability, Docker, tests, and the public connected-gateway contract/client.

The enterprise product lives in a separate repository:

- GitHub: `https://github.com/seanbabalala/siftgate-cloud`
- Scope: Cloud Control Plane API, enterprise fleet dashboard, public website, multi-tenant workspace/RBAC/audit/policy workflows, deployment configuration, and commercial product surfaces.

The open-source gateway must remain useful on its own. SiftGate Cloud is an optional control plane that connects through explicit outbound registration, heartbeat, telemetry, and policy-sync APIs. The open-source repo should not depend on private Cloud packages, and the Cloud repo should consume the public Data Plane contract rather than copying runtime internals.

## Features

### Multi-Protocol Support

- **OpenAI Chat Completions** (`/v1/chat/completions`) — the most common format
- **OpenAI Responses** (`/v1/responses`) — OpenAI's newer API format
- **Anthropic Messages** (`/v1/messages`) — Claude's native format
- Full **streaming** support across all three protocols
- **Cross-protocol conversion** — send a request in any format, it gets routed to any provider regardless of their native API

### Smart Routing

- **Complexity scoring** — analyzes each request across 14 dimensions (keywords, structure, tools, etc.) to determine complexity tier (simple / standard / complex / reasoning)
- **Tier-based routing** — each complexity tier maps to a primary provider + fallback chain
- **Load balancing strategies** — route within a tier using `weighted`, `round_robin`, `least_latency`, or `random` targets
- **Domain-aware routing** — detects request domains (frontend, backend, math, etc.) and prefers providers that excel in those areas
- **Momentum routing** — tracks which provider is performing well and subtly favors it
- **Automatic fallback** — if the primary provider fails, instantly retries with the next provider in the chain

### Cost & Budget Control

- **Per-model pricing** — tracks cost per request based on actual token usage
- **Daily budget limits** — set daily token and cost limits
- **Alert thresholds** — get warnings before hitting limits
- **Budget enforcement** — requests are rejected (429) when limits are exceeded

### Reliability

- **Circuit breaker** — automatically stops sending requests to failing providers
- **Per-node concurrency limits** — cap in-flight upstream requests and choose whether overflow waits, falls back, or returns 429
- **Active health probing** — optional per-node probes catch upstream outages before user traffic hits them
- **Health monitoring** — real-time health, probe, and circuit breaker status for all configured nodes
- **Graceful degradation** — the system continues working even when some providers are down

### Real-Time Dashboard

- **Live metrics** — total calls, tokens, cost, latency at a glance
- **SSE log stream** — see requests flowing through the gateway in real time
- **Node health** — monitor provider status, active probes, circuit breaker state, current concurrency, and queue depth
- **Routing visualization** — see tiers, scoring thresholds, fallback chains, load-balancing targets, weights, and recent selections
- **Budget tracking** — ring gauges showing daily usage vs limits
- **Light / Dark theme** — system-aware with manual toggle

### Developer Experience

- **Zero-config model routing** — just send `model: "auto"` and the gateway picks the best provider
- **Model aliases** — use friendly names like `"claude"` instead of `"claude-opus-4-6-v1"`
- **Node prefix routing** — send `"gpt/my-custom-model"` to force routing to a specific node
- **Model-family prefixes** — route future names like `"claude-sonnet-..."` through a stable upstream node
- **OpenAI-compatible `/v1/models`** endpoint — list all available models and aliases
- **Config validation CLI** — run `siftgate validate` or `npm run validate:config` before deploys and in CI
- **Hot reload** — reload `gateway.config.yaml` through the Dashboard API, `SIGHUP`, or an optional debounced file watcher with rollback on failure

## Quick Start

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **npm** 10+

### 1. Clone & Install

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
```

### 2. Configure

```bash
# Copy the example config
cp gateway.config.example.yaml gateway.config.yaml

# Copy the example env file
cp .env.example .env
```

Edit `gateway.config.yaml` to add your upstream provider nodes. A node is a provider account, deployment, proxy route, or API endpoint; models live under `nodes[].models`. At minimum, you need one node:

```yaml
nodes:
  - id: openai
    name: "OpenAI"
    protocol: chat_completions
    base_url: "https://api.openai.com"
    endpoint: "/v1/chat/completions"
    api_key: "${OPENAI_API_KEY}"
    models: ["gpt-4o"]
    timeout_ms: 60000

routing:
  tiers:
    simple:
      primary: { node: openai, model: gpt-4o }
      fallbacks: []
    standard:
      primary: { node: openai, model: gpt-4o }
      fallbacks: []
    complex:
      primary: { node: openai, model: gpt-4o }
      fallbacks: []
    reasoning:
      primary: { node: openai, model: gpt-4o }
      fallbacks: []
```

Set your provider API key in `.env`:

```bash
OPENAI_API_KEY=sk-...
```

Validate the file before starting the gateway:

```bash
npm run validate:config -- --config gateway.config.yaml
```

### 3. Build & Run

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Start the gateway
npm run build
npm run start:prod

# Or for development with hot reload:
npm run start:dev
```

The gateway will start on `http://localhost:2099`.

### 4. Create a Gateway API Key

Open `http://localhost:2099` in your browser, go to **API Keys**, and create a client key.

There are two different kinds of keys:

- **Provider API keys** live in `.env` / `nodes[].api_key` and let the gateway call OpenAI, Anthropic, Google, or another upstream provider.
- **Gateway API keys** are generated in the dashboard and let your apps call this gateway.

The full Gateway API key is shown only once when it is created.

### 5. Test It

```bash
# Send a request using OpenAI chat completions format
curl http://localhost:2099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_sk_live_..." \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Core Concepts

### Provider Keys vs Gateway Keys

SiftGate uses two different kinds of secrets:

| Key type         | Where it lives              | Who uses it       | Purpose                                                                                            |
| ---------------- | --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| Provider API key | `.env` or `nodes[].api_key` | SiftGate          | Lets the gateway call upstream providers such as OpenAI, Anthropic, Gemini, Azure, or a proxy      |
| Gateway API key  | Dashboard → API Keys        | Your applications | Lets clients call SiftGate and enables attribution, permissions, budgets, rate limits, and billing |

Client applications should never use provider API keys. They call the gateway with:

```bash
Authorization: Bearer gw_sk_live_...
```

The gateway then chooses an upstream route, calls the provider with the provider key, logs usage, computes cost, and attributes the request to the Gateway API key.

### Node vs Model vs Alias

SiftGate is designed around one rule: **routing targets a `node + model` pair**.

| Concept      | Meaning                                                    | Good examples                                                  | Avoid                                  |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Node         | Upstream account, deployment, proxy route, or API endpoint | `openai`, `anthropic`, `azure-prod`, `tokenflux`, `local-vllm` | `gpt-4o`, `claude-3-opus`              |
| Model        | Model ID exposed by that node                              | `gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-20250514`            | Provider account names                 |
| Alias        | Gateway shortcut for clients                               | `fast`, `strong`, `writer`                                     | A real model ID from another node      |
| Model prefix | Pass-through model family owned by a node                  | `claude`, `gpt`, `gemini`                                      | A prefix already owned by another node |

Example:

```yaml
nodes:
  - id: openai
    name: "OpenAI Main Account"
    models:
      - gpt-4o
      - gpt-4o-mini
    model_aliases:
      fast: gpt-4o-mini
    model_prefixes:
      - gpt

  - id: tokenflux
    name: "TokenFlux Proxy"
    models:
      - gpt-5.4
```

In this example, `openai` and `tokenflux` are upstream nodes. `gpt-4o`, `gpt-4o-mini`, and `gpt-5.4` are models. `fast` is an alias. `gpt` is a model-family prefix, so future `gpt-*` names can direct-route through the `openai` node without renaming the node to `gpt`.

### Direct Model Resolution

When a caller sends a non-`auto` model value, the gateway resolves it in this order:

1. Exact model ID: `"gpt-4o"` routes to the first node that lists `gpt-4o`.
2. Alias: `"fast"` resolves through `model_aliases`.
3. Node ID shortcut: `"openai"` routes to the first model on the `openai` node.
4. Node prefix: `"openai/my-fine-tuned-model"` routes to `openai` and passes `my-fine-tuned-model` upstream.
5. Model-family prefix: `"claude-haiku-..."` routes through the node whose `model_prefixes` includes `claude`.
6. Unknown model: falls back to automatic routing.

Because exact model IDs win before aliases, avoid aliases that reuse a real model ID from any upstream. The Dashboard shows naming diagnostics when a config is ambiguous.

### Renaming Existing Nodes Safely

If an existing config uses model-like node names, migrate it deliberately:

1. Pick upstream/channel names such as `openai-main`, `anthropic-prod`, `tokenflux`, or `local-vllm`.
2. Update every `routing.tiers.*.primary.node`, fallback node, split node, and `domain_preferences` reference.
3. Add `model_prefixes` for model families clients still type directly, such as `claude`, `gpt`, or `gemini`.
4. Review Gateway API keys with `allowed_nodes`; update those lists if they reference renamed nodes.
5. Keep model IDs unchanged unless the upstream provider changed them.
6. Reload config from the Dashboard or restart the gateway.

Do not silently rename a live node ID without checking routing rules, API key permissions, historical logs, and dashboards that may reference it.

## Configuration

All configuration lives in `gateway.config.yaml`. Environment variables can be referenced as `${VAR}` or `${VAR:-default}`.

Validate changes before restart or CI deploys:

```bash
npm run validate:config -- --config gateway.config.yaml

# After building, the executable entrypoint is also available:
npm run build
node dist/cli/siftgate.js validate --config gateway.config.yaml
```

The validator checks YAML parsing, required sections, node/model naming conflicts, routing/fallback/split/targets references, pricing coverage warnings, environment-reference format, provider key hygiene, and optional `control_plane` safety. Errors return a non-zero exit code; warnings and info are printed without failing the command. See [Config Validation](docs/CONFIG_VALIDATION.md) for CI examples and the issue taxonomy.

### Server

```yaml
server:
  port: 2099 # HTTP port
  host: 0.0.0.0 # Bind address
```

### Database

```yaml
database:
  type: sqlite # sqlite or postgres
  path: ./data/gateway.db # SQLite file path
  # url: postgresql://...       # PostgreSQL connection URL (if type: postgres)
```

### Authentication

```yaml
auth:
  # Client Gateway API keys are generated and managed in the Dashboard.
  api_keys: []
```

Client applications call the proxy endpoints with a dashboard-generated Gateway API key:

```bash
Authorization: Bearer gw_sk_live_...
```

Each Gateway API key can be configured with automatic routing access, direct model access, allowed nodes/models, rate limits, and daily token/cost budgets.

### Hot Reload

Configuration reloads are atomic: SiftGate parses and validates a fresh snapshot first, then swaps it into memory only after the new config is valid. If reload fails, the previous config stays active and the Dashboard API returns a clear error.

Reload options:

```bash
# Dashboard API
curl -X POST http://localhost:2099/api/dashboard/config/reload

# Process signal
kill -HUP <siftgate-pid>
```

Optional file watching is disabled by default. Enable it only when you want local config edits to reload automatically:

```yaml
hot_reload:
  watch: false
  debounce_ms: 500
```

Successful and failed reloads emit `config.reload.success` and `config.reload.failed` events on the in-process EventBus. Routing, node lookup, capabilities, budgets, and optional control-plane services read from the latest committed snapshot after a successful reload.

### Nodes (Upstream Providers)

Each node represents one upstream provider account, deployment, proxy route, or API endpoint. A node can expose one or more models, and routing always targets a `node + model` pair.

Use node IDs/names for the upstream channel, not for a single model. Prefer `openai`, `azure-prod`, `anthropic`, or `local-vllm` over names like `gpt-4o`.

```yaml
nodes:
  - id: openai # Unique upstream/channel identifier
    name: "OpenAI" # Display name for the provider/channel
    protocol: chat_completions # chat_completions | responses | messages
    base_url: "https://api.openai.com" # Provider base URL
    endpoint: "/v1/chat/completions" # API endpoint path
    api_key: "${OPENAI_API_KEY}" # API key (use env vars!)
    auth_type: bearer # bearer (default) | x-api-key
    models: ["gpt-4o", "gpt-4o-mini"] # Supported model IDs
    timeout_ms: 60000 # Request timeout
    max_concurrency: 50 # Optional max in-flight upstream calls for this node
    queue_timeout_ms: 10000 # Wait-policy queue timeout in milliseconds
    queue_policy: wait # wait (default) | fallback | reject
    health_check: # Optional active probe, disabled by default
      enabled: false
      interval_seconds: 30
      timeout_ms: 5000
      method: HEAD # HEAD | GET | POST
      path: /healthz # Or omit and use endpoint
      # lightweight_model: gpt-4o-mini # For synthetic 1-token POST probes
    tags: ["code", "reasoning"] # Capability tags for domain routing
    model_aliases: # User-friendly shortcuts
      gpt4: gpt-4o
    headers: # Extra headers (optional)
      anthropic-version: "2023-06-01"
```

**Supported protocols:**
| Protocol | Format | Providers |
|----------|--------|-----------|
| `chat_completions` | OpenAI Chat Completions | OpenAI, Azure OpenAI, Google Gemini, any OpenAI-compatible API |
| `responses` | OpenAI Responses | OpenAI (newer API) |
| `messages` | Anthropic Messages | Anthropic Claude |

### Per-Node Concurrency Control

Set `max_concurrency` on a node to limit concurrent upstream requests across all models routed through that node. When the node is full, `queue_policy` controls overflow behavior:

| Policy | Behavior |
| ------ | -------- |
| `wait` | Queue until a slot opens, then fall back with `503` if `queue_timeout_ms` expires |
| `fallback` | Skip the saturated node immediately and try the next configured fallback |
| `reject` | Return `429` without trying fallbacks |

Slots are released after successful responses, provider errors, stream completion, or stream interruption. `/health`, `/api/dashboard/nodes`, and OpenTelemetry gauges expose `active` concurrency and queued depth per node.

### Active Health Probing

Active health probes are configured per node and are disabled by default. A probe never sends real user content; `POST` probes use a tiny synthetic `"health check"` prompt and `max_tokens`/`max_output_tokens: 1`.

When a probe fails or times out, SiftGate immediately opens that node's model circuits so routing can avoid it. A later successful probe records recovery and closes the circuits again. `/health` and `/api/dashboard/nodes` include `active_probe.status`, `last_checked_at`, and `failure_reason`.

Use `HEAD`/`GET` against a cheap readiness endpoint when your provider or proxy exposes one:

```yaml
health_check:
  enabled: true
  interval_seconds: 30
  timeout_ms: 5000
  method: HEAD
  path: /healthz
```

For providers without a readiness endpoint, set a cheap `lightweight_model` for synthetic `POST` probes:

```yaml
health_check:
  enabled: true
  interval_seconds: 60
  timeout_ms: 5000
  lightweight_model: gpt-4o-mini
```

### Routing

Legacy `primary` + `fallbacks` routing remains supported:

```yaml
routing:
  tiers:
    simple: # Low-complexity requests
      primary: { node: cheap-provider, model: ... }
      fallbacks:
        - { node: backup-provider, model: ... }
    standard: # Normal requests
      primary: { node: balanced-provider, model: ... }
      fallbacks: [...]
    complex: # Complex requests
      primary: { node: strong-provider, model: ... }
      fallbacks: [...]
    reasoning: # Reasoning-heavy requests
      primary: { node: reasoning-provider, model: ... }
      fallbacks: [...]

  scoring:
    simple_max: -0.1 # Score ≤ this → simple
    standard_max: 0.08 # Score ≤ this → standard
    complex_max:
      0.35 # Score ≤ this → complex
      # Score > this → reasoning

  domain_preferences:
    frontend: [openai, gemini] # Prefer these upstream nodes for frontend questions
    backend: [anthropic, openai] # Prefer these upstream nodes for backend questions
```

For v0.2 load balancing, a tier can use the unified `targets + strategy` schema:

```yaml
routing:
  tiers:
    standard:
      strategy: weighted # weighted | round_robin | least_latency | random
      targets:
        - { node: openai, model: gpt-4o, weight: 70 }
        - { node: anthropic, model: claude-sonnet-4-20250514, weight: 30 }
```

Compatibility rules:

- `primary` + `fallbacks` is treated as the legacy `primary_fallback` strategy when `targets` is omitted.
- `targets` takes over tier selection when present; `weight` defaults to `1`.
- `split` remains experiment mode and overrides `targets` while configured, so existing A/B tests keep their sticky behavior.
- `least_latency` uses an in-memory sliding window of recent successful upstream latencies and falls back to stable config order while targets are cold.
- The Dashboard routing page is read/write for config and read-only for live selection metrics such as samples, average latency, p95 latency, and the most recent target choice.

### Budget

```yaml
budget:
  daily_token_limit: 5000000 # Max tokens per day
  daily_cost_limit: 200.00 # Max cost per day (USD)
  alert_threshold: 0.8 # Alert at 80% usage

models_pricing: # Cost per 1M tokens (USD)
  gpt-4o: { input: 2.50, output: 10.00 }
  claude-opus-4: { input: 15.00, output: 75.00 }
```

## API Endpoints

### Proxy Endpoints (AI Requests)

| Method | Endpoint               | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions format                |
| `POST` | `/v1/responses`        | OpenAI Responses format                       |
| `POST` | `/v1/messages`         | Anthropic Messages format                     |
| `GET`  | `/v1/models`           | List all available models (OpenAI-compatible) |

All proxy endpoints require a dashboard-generated `Authorization: Bearer <gateway_api_key>` header.

### Model Resolution

When sending a request, the `model` field is resolved in this order, subject to the caller key's permissions:

1. **`"auto"`** — Smart routing based on complexity scoring
2. **Exact model ID** — e.g., `"gpt-4o"` → routes to the node that has this model
3. **Alias** — e.g., `"claude"` → resolved via `model_aliases`
4. **Node ID** — e.g., `"openai"` → routes to that node's first model
5. **Node prefix** — e.g., `"openai/my-fine-tuned"` → routes to node, passes model name through

By default, newly-created Gateway API keys allow `model: "auto"` and do not allow direct model routing until direct access is enabled for that key.

### Billing Flow

Every proxy request is authenticated with a Gateway API key. Billing identity is based on the generated key's immutable `api_key_id`; the key name is a display label and legacy YAML fallback.

For each accepted request, the gateway applies the same accounting path:

1. Authenticate the Gateway API key.
2. Rate-limit by `api_key_id` when available.
3. Check both global budgets and the key's own budgets.
4. Resolve `auto` or direct routing according to the key's permissions.
5. Serve from gateway prompt cache or call the upstream provider.
6. Compute token usage and estimated cost from `models_pricing`.
7. Record usage against global budgets and, when present, the key budget.
8. Write a call log attributed to the same `api_key_id`.

The call log stores:

- Gateway API key id
- Gateway API key name
- source protocol
- selected tier
- upstream node
- upstream model
- input and output tokens
- estimated cost from `models_pricing`
- status code and latency

That record powers the Dashboard, Logs, Analytics, Budget, and per-key billing views. Generated key budgets are reset by `budget_rule.id`, not by rule type, so global and per-key `daily_cost` rules cannot be confused.

Dashboard filters for generated Gateway API keys use the immutable `api_key_id`. The older `api_key` name filter is kept only for legacy YAML-defined keys.

Gateway prompt-cache hits are still logged and recorded against budgets using the cached response's usage and model pricing. They are marked as tier `cached` with node `cache`, so they remain attributable without making an upstream provider call.

Failed upstream requests are logged with their status/error and zero usage/cost. Streaming requests record budget usage after a successful final usage event. If a model has no pricing entry, routing still works, token usage is still tracked, and cost may be `0` until pricing is configured.

When a budget is exceeded, the proxy returns `429` with `type: "budget_exceeded"` and structured details such as `scope`, `api_key_id`, `budget_type`, `current`, `limit`, and `reset_at`.

### Dashboard API

| Method | Endpoint                          | Description                                                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/dashboard/stats`            | Aggregated statistics; supports `api_key_id` for generated keys and `api_key` for legacy YAML keys |
| `GET`  | `/api/dashboard/logs`             | Paginated call logs; supports `api_key_id` for generated keys and `api_key` for legacy YAML keys   |
| `GET`  | `/api/dashboard/logs/sse`         | Real-time log stream (SSE)                                                                         |
| `GET`  | `/api/dashboard/analytics/cost`   | Cost analytics; supports `api_key_id` for generated keys and `api_key` for legacy YAML keys        |
| `GET`  | `/api/dashboard/config`           | Sanitized config (API keys masked)                                                                 |
| `POST` | `/api/dashboard/config/reload`    | Atomically hot-reload config from disk; returns `400` and keeps the old config on failure          |
| `GET`  | `/api/dashboard/api-keys`         | List Gateway API keys                                                                              |
| `POST` | `/api/dashboard/api-keys`         | Create a Gateway API key                                                                           |
| `GET`  | `/api/dashboard/nodes`            | Node health, active probe, circuit breaker, concurrency, and queue depth                           |
| `POST` | `/api/dashboard/nodes/:id/reset`  | Reset circuit breaker                                                                              |
| `GET`  | `/api/dashboard/budget`           | Budget status; supports `api_key_id` for generated keys and `api_key` for legacy YAML keys         |
| `POST` | `/api/dashboard/budget/:id/reset` | Reset one budget rule by `budget_rule.id`                                                          |
| `GET`  | `/health`                         | Gateway, budget, node circuit, active probe, and concurrency health                                |

## Dashboard

The built-in dashboard is available at the gateway's root URL (default: `http://localhost:2099`).

**Pages:**

- **Dashboard** — Real-time metrics, charts, and live request stream
- **Logs** — Searchable, filterable log table with pagination and SSE notifications
- **Nodes** — Provider health status, models, tags, and circuit breaker controls
- **Routing** — Visual tier configuration, scoring thresholds, and domain preferences
- **Budget** — Ring gauges for daily usage, model pricing table, and budget rules
- **API Keys** — Client Gateway API key generation, permissions, budgets, rate limits, rotation, and disable/delete controls

## Docker

### Using Docker Compose (recommended)

This is the recommended path for self-hosted and open-source users:

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
mkdir -p data

# Add provider keys to .env, then review nodes/routing in gateway.config.yaml
docker compose up -d --build

# Check health
curl http://localhost:2099/health
docker compose ps
```

Open `http://localhost:2099`, create a Gateway API key in the Dashboard, then send your first request using that key.

The compose setup mounts:

- `./gateway.config.yaml` into the container as writable configuration, so Dashboard edits and first-start password hashing persist
- `./data` for persistent SQLite data and generated Gateway API key records

If `docker compose up` says `.env` is missing, run `cp .env.example .env` first. The app can start without real provider keys, but model requests need the relevant upstream provider key.

See [Docker Quickstart](docs/DOCKER_QUICKSTART.md) for troubleshooting port conflicts, healthcheck status, provider keys, and production read-only config notes.

Maintainers can run the full Docker quickstart smoke test locally:

```bash
npm run smoke:docker
```

It builds the image, starts a mock upstream, creates a Dashboard-managed Gateway API key, verifies `auto` and direct routing, checks billing attribution by `api_key_id`, and confirms SQLite persistence after restart.

### Using Dockerfile directly

```bash
docker build -t siftgate .
docker run -p 2099:2099 \
  -v $(pwd)/gateway.config.yaml:/app/gateway.config.yaml \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  siftgate
```

## Connected Gateway

SiftGate can optionally connect to SiftGate Cloud. This is disabled by default and is designed for the paid control-plane product, not for routing AI traffic through our servers.

When enabled, the local gateway:

- registers itself with a hosted control plane using a gateway registration token
- sends heartbeat and fleet-health metadata
- uploads privacy-preserving call metadata derived from `call_logs`
- pulls the latest policy bundle for recommendations or future managed routing

It does **not** upload prompts, responses, tool payloads, raw authorization headers, or provider API keys by default.

```yaml
control_plane:
  enabled: true
  url: "http://localhost:3100"
  gateway_id: "gw_local_dev"
  registration_token: "${GATEWAY_REGISTRATION_TOKEN}"
  telemetry:
    upload_interval_seconds: 30
    include_prompt: false
    include_response: false
```

Use `http://localhost:3100` for the local private Cloud API and `https://api.siftgate.dev` as the production placeholder. On boot, the Data Plane automatically registers, receives a gateway access token, sends heartbeat every 30 seconds, uploads telemetry metadata every 30 seconds by default, and polls policy bundles every 60 seconds.

The intended architecture is:

```text
User App -> Customer SiftGate Data Plane -> Provider APIs
                     |
                     | heartbeat / telemetry / policy sync
                     v
              SiftGate Cloud Control Plane
```

See [Connected Gateway Control Plane](docs/CONTROL_PLANE.md), [Product Roadmap](docs/PRODUCT_ROADMAP.md), [Open Core](docs/OPEN_CORE.md), and [Comparison](docs/COMPARISON.md) for the product boundary and positioning.

## Cloud Control Plane Coming Later

The open-source gateway is ready to run on its own today. The future Cloud Control Plane will add workspace governance, gateway fleet health, policy bundles, audit metadata, router recommendations, and optional Autopilot without making customer AI traffic flow through our servers by default.

Join the project now if you want the self-hosted data plane; follow the roadmap if you want fleet governance for teams and enterprises.

## Architecture

For a deeper contributor-level view, see [Architecture](docs/ARCHITECTURE.md).

```
Client Request (any format)
         │
         ▼
┌─────────────────┐
│   Controller    │  ← /v1/chat/completions, /v1/responses, /v1/messages
└────────┬────────┘
         ▼
┌─────────────────┐
│   Normalizer    │  ← Convert any format → Canonical internal format
└────────┬────────┘
         ▼
┌─────────────────┐
│   Scorer        │  ← Analyze complexity (14 dimensions → tier)
└────────┬────────┘
         ▼
┌─────────────────┐
│   Router        │  ← Select provider based on tier + domain + momentum
└────────┬────────┘
         ▼
┌─────────────────┐
│  Denormalizer   │  ← Convert Canonical → target provider's format
└────────┬────────┘
         ▼
┌─────────────────┐
│  Provider HTTP  │  ← Forward to upstream AI provider
└────────┬────────┘
         │
    ┌────┴────┐
    │ Success │──▶ Re-normalize response → Log → Return to client
    └────┬────┘
    │ Failure │──▶ Circuit breaker update → Try next fallback
    └─────────┘
```

**Key components:**

- **Normalizers / Denormalizers** — Bidirectional converters between OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages formats
- **Scoring Engine** — Evaluates request complexity across keyword, structural, and tool dimensions
- **Router** — Tier-based node selection with circuit breaker, momentum, and domain-aware reordering
- **Provider Client** — HTTP forwarder with streaming support (SSE parsing for each protocol)
- **Budget Service** — Token/cost tracking with daily limits and alerts

**Tech stack:**

- **Backend:** NestJS 11, TypeORM, SQLite (default) / PostgreSQL
- **Frontend:** React 19, Vite, Tailwind CSS v4, TanStack Query, Recharts
- **Protocols:** Full support for streaming and non-streaming across all three API formats

## Troubleshooting

### Test And Build Warnings

- `npm test -- --runInBand` should exit cleanly. If Jest reports open handles, run `npm test -- --runInBand --detectOpenHandles` and fix the source rather than ignoring it.
- `cd frontend && npm run build` should complete without Vite chunk-size warnings. Dashboard pages are route-split; if a future page adds a large dependency, keep it inside that page or add another lazy chunk.

### Billing filters

For dashboard-generated Gateway API keys, use `api_key_id` when filtering logs, stats, analytics, and budgets. The `api_key` query parameter is kept for older YAML-defined keys where no immutable database id exists.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
