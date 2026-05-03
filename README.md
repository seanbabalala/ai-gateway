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
  <a href="#kubernetes">Kubernetes</a> &bull;
  <a href="#connected-gateway">Connected Gateway</a> &bull;
  <a href="docs/API_REFERENCE.md">API Reference</a> &bull;
  <a href="docs/PRODUCT_ROADMAP.md">Roadmap</a> &bull;
  <a href="docs/ARCHITECTURE.md">Architecture</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## What is SiftGate?

Current open-source release: **v0.6.1**. This patch keeps the v0.6 Protocol + Explainability milestone intact and tightens Dashboard localization for the v0.2-v0.6 feature surfaces: structured-output logs, namespaces, shadow traffic, multimodal capability badges, adaptive routing recommendations, realtime status, and Route Explanation.

SiftGate is a **self-hosted AI traffic data plane** that sits between your applications and multiple AI providers (OpenAI, Anthropic, Google, local models, and compatible proxies). It accepts requests in major chat, responses, messages, embeddings, rerank, images, and audio formats and intelligently routes them to the best provider based on request complexity, cost, dimensions, and availability.

**The problem it solves:** Different AI providers use different API formats (`chat/completions`, `responses`, `messages`, `embeddings`, `rerank`, `images`, `audio`). If you use multiple providers, your code needs to handle each format separately. SiftGate gives you provider-compatible endpoints that normalize traffic internally and automatically pick the right provider.

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
- **OpenAI Embeddings** (`/v1/embeddings`) — batch embeddings with dimension-aware routing
- **Rerank** (`/v1/rerank`) — OpenAI/common compatible rerank ingress with cost-aware routing
- **OpenAI Images** (`/v1/images/generations`, `/v1/images/edits`) — image-capable node routing with JSON and multipart pass-through
- **OpenAI Audio** (`/v1/audio/transcriptions`, `/v1/audio/speech`) — transcription and speech routing with multipart input and binary audio output support
- **Experimental Realtime** (`/v1/realtime`) — disabled-by-default WebSocket pass-through for OpenAI Realtime-style providers
- **Structured output passthrough** — preserve Chat `response_format`, Responses `text.format`, and Anthropic Messages `output_config.format` intent across routing
- Full **streaming** support across supported generative protocols
- **Cross-protocol conversion** — send a request in any format, it gets routed to any provider regardless of their native API

### Smart Routing

- **Complexity scoring** — analyzes each request across 14 dimensions (keywords, structure, tools, etc.) to determine complexity tier (simple / standard / complex / reasoning)
- **Tier-based routing** — each complexity tier maps to a primary provider + fallback chain
- **Load balancing strategies** — route within a tier using `weighted`, `round_robin`, `least_latency`, or `random` targets
- **Cost/context-aware optimization** — optional `routing.optimization` can prefer cheaper, lower-latency, balanced, or quality-scored targets, while avoiding configured context windows that are too small
- **Multimodal capability filtering** — node/model metadata declares text, image/vision, audio, embedding, rerank, and realtime support so smart routing keeps only compatible candidates
- **Local namespace boundaries** — bind Gateway API keys to OSS-local namespaces with node/model, budget, and rate-limit policy limits
- **Domain-aware routing** — detects request domains (frontend, backend, math, etc.) and prefers providers that excel in those areas
- **Momentum routing** — tracks which provider is performing well and subtly favors it
- **Adaptive routing recommendations** — analyzes local call logs and suggests safer route changes without applying them automatically
- **Explainable routing trace** — records privacy-safe route decision evidence so operators can inspect why a `node:model` was selected
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
- **Shared runtime state** — optional Redis backend for circuit breakers, rate limits, prompt cache, and routing momentum
- **Optional Redis cluster mode** — register instances, publish heartbeats, and broadcast config reloads across a multi-instance deployment
- **Health monitoring** — real-time health, probe, and circuit breaker status for all configured nodes
- **Graceful degradation** — the system continues working even when some providers are down

### Real-Time Dashboard

- **Live metrics** — total calls, tokens, cost, latency at a glance
- **SSE log stream** — see requests flowing through the gateway in real time
- **Node health** — monitor provider status, active probes, circuit breaker state, current concurrency, and queue depth
- **Realtime status** — when the experimental realtime preview is enabled, node and health APIs show realtime capability, active connections, last close time, and sanitized errors
- **Routing visualization** — see tiers, scoring thresholds, fallback chains, load-balancing targets, weights, and recent selections
- **Read-only routing recommendations** — review local sliding-window success, p50/p95 latency, cost, fallback rate, confidence, savings, and risk notes
- **Route decision traces** — inspect per-request candidate targets, filter reasons, scores, circuit state, fallback chain, and final selection through Dashboard APIs and the Route Explanation page
- **Budget tracking** — ring gauges showing daily usage vs limits
- **Namespace filtering** — filter Dashboard stats, logs, cost, and budget views by local namespace
- **Shadow traffic results** — read-only view of sampled test-node mirror outcomes without applying changes
- **Seven-language operator UI** — English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Thai, and Spanish wording stays synchronized across new OSS Data Plane features, with product-aware labels instead of raw backend terms where possible
- **Light / Dark theme** — system-aware with manual toggle

### Developer Experience

- **Zero-config model routing** — just send `model: "auto"` and the gateway picks the best provider
- **Model aliases** — use friendly names like `"claude"` instead of `"claude-opus-4-6-v1"`
- **Node prefix routing** — send `"gpt/my-custom-model"` to force routing to a specific node
- **Model-family prefixes** — route future names like `"claude-sonnet-..."` through a stable upstream node
- **OpenAI-compatible `/v1/models`** endpoint — list all available models and aliases
- **OpenAPI/Swagger docs** — browse `http://localhost:2099/docs` or fetch `http://localhost:2099/openapi.json`
- **Config validation CLI** — run `siftgate validate` or `npm run validate:config` before deploys and in CI
- **Plugin manager CLI** — run `siftgate plugin install/list/remove` for local or `@siftgate/plugin-*` packages
- **LiteLLM migration CLI** — convert `litellm_config.yaml` into a SiftGate `gateway.config.yaml` with a compatibility report
- **Database migration CLI** — run `siftgate migrate-db` to move local SQLite runtime data into PostgreSQL
- **Hot reload** — reload `gateway.config.yaml` through the Dashboard API, `SIGHUP`, or an optional debounced file watcher with rollback on failure
- **Kubernetes deployment assets** — Helm chart and plain Kustomize base for the OSS Data Plane, with SQLite/memory defaults and opt-in Redis/PostgreSQL production paths
- **Official runtime plugins** — opt-in Redis cache, analytics sink, request transform, and guardrails skeleton plugins built into `dist-runtime-plugins`
- **TypeScript SDK scaffold** — use `@siftgate/client` for typed gateway calls, or keep the OpenAI SDK with a `baseURL` pointed at SiftGate
- **Shadow traffic** — asynchronously mirror sampled successful requests to a test node, disabled by default and privacy-safe by default

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

Plugin declarations may live in `plugins.config.yaml` so package installs do not rewrite `gateway.config.yaml`. The gateway loads both `gateway.config.yaml` `plugins:` entries and `plugins.config.yaml` entries at startup.

### LiteLLM Migration

Generate a SiftGate config from an existing LiteLLM YAML file:

```bash
npm run build
node dist/cli/siftgate.js migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
```

The migrator maps `model_list`, provider/model names, API key environment references, fallbacks, router retry settings, and known routing strategies. It writes a migration report with compatible, incompatible, and manual-review items. Existing `gateway.config.yaml` is never overwritten unless `--overwrite` is passed. See [LiteLLM Migration](docs/MIGRATION_LITELLM.md).

### Database Migration

SQLite remains the default for local development. For production, PostgreSQL is recommended for backups, retention, and multi-instance deployments:

```bash
npm run build
node dist/cli/siftgate.js migrate-db \
  --from sqlite \
  --to postgres \
  --sqlite-path ./data/gateway.db \
  --postgres-url "$DATABASE_URL" \
  --backup
```

Use `--dry-run` in CI or before a maintenance window to inspect source row counts without writing PostgreSQL. The CLI refuses to import into non-empty target tables unless `--force` is set, copies the SQLite file when `--backup` is used, resets imported numeric sequences, and validates row counts after import. See [Production Deployment](docs/PRODUCTION.md).

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
  # synchronize: true       # TypeORM schema sync; fine for local SQLite/dev
  # url: postgresql://...   # PostgreSQL connection URL (if type: postgres)
  # synchronize: false      # Recommended for production PostgreSQL after migration/bootstrap
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

Each Gateway API key can be configured with automatic routing access, direct model access, allowed nodes/models, rate limits, daily token/cost budgets, and an optional local namespace.

### Local Namespaces

Namespaces are OSS-local policy labels for Gateway API keys. They are not enterprise workspaces and do not enable SSO, SCIM, RBAC, or organization billing.

```yaml
namespaces:
  - id: team-a
    name: "Team A"
    allowed_nodes: [openai, anthropic]
    allowed_models: [gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514]
    budget:
      daily_token_limit: 1000000
      daily_cost_limit: 25.00
      alert_threshold: 0.8
    rate_limit:
      requests_per_minute: 120
```

Dashboard-managed keys can be assigned to a namespace when they are created or edited. YAML-defined keys can set `auth.api_keys[].namespace_id`.

Namespace restrictions are intersected with API-key restrictions, namespace budgets are enforced alongside global/key budgets, and namespace rate limits apply when a key does not have a key-specific limit. Call logs store `namespace_id`, and Dashboard stats, logs, cost, and budget views support namespace filters. See [Local Namespaces And Shadow Traffic](docs/NAMESPACES_AND_SHADOW.md).

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

### Shared State Backend

SiftGate defaults to local memory for all runtime state, so the open-source Data Plane stays single-node friendly and needs no extra services. For horizontally scaled deployments, enable Redis shared state:

```yaml
state:
  backend: redis # memory | redis
  unavailable_policy: fail_open # fail_open | fail_closed
  redis:
    url: ${REDIS_URL:-redis://localhost:6379}
    prefix: siftgate:state:
    timeout_ms: 500
    sync_interval_ms: 2000
```

Redis-backed state shares API key/IP rate limits, prompt-cache entries, circuit breaker status, and routing momentum across gateway instances. `fail_open` keeps traffic flowing when Redis is unavailable; `fail_closed` rejects rate-limited paths and treats circuits as unavailable until Redis recovers.

See [Shared State Backend](docs/STATE_BACKEND.md) for Docker and failure-policy details.

### Cluster Mode

SiftGate stays single-instance by default. For a multi-instance deployment behind a load balancer, enable Redis-backed cluster mode with `state.backend: redis` or `cluster.enabled: true`:

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

Cluster mode uses Redis Pub/Sub for instance registration, heartbeats, and config reload broadcasts. A successful local reload publishes a `config.reload` event; peers then run their own local validation and rollback-safe reload using their local `gateway.config.yaml`. There is no leader election, and every instance continues to handle requests independently.

`GET /cluster/status` is available only when `state.backend=redis` or `cluster.enabled=true`; in single-instance memory mode it returns `404`. See [Production Deployment](docs/PRODUCTION.md) for the Redis, load-balancer, and security notes.

### Plugins

SiftGate ships a lightweight MIT-licensed runtime plugin system for the open-source Data Plane. Official plugins live under `plugins/` and are compiled by `npm run build` into `dist-runtime-plugins`, which the production Docker image copies into `/app/dist-runtime-plugins`.

The first official batch is:

| Plugin                      | Purpose                               | Default behavior                                                         |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `plugins/redis-cache`       | Redis-backed response cache           | Disabled; only stores responses when `store_responses: true` is explicit |
| `plugins/analytics-sink`    | Sanitized call-log analytics webhook  | Disabled; safe metadata allow-list only                                  |
| `plugins/request-transform` | Local request rewrites before routing | Disabled; no-op until rules are configured                               |
| `plugins/guardrails`        | Local audit/block guardrails skeleton | Disabled; logs finding counts only                                       |

Example:

```yaml
plugins:
  - path: plugins/request-transform
    required: false
    config:
      enabled: true
      rules:
        - name: deterministic-tools
          when:
            has_tools: true
          set:
            temperature: 0
```

Official plugins do not send prompts, responses, provider keys, or raw headers to external systems by default. See [Official Plugins](docs/plugins/OFFICIAL_PLUGINS.md) and each plugin README under `plugins/*/README.md` for safety notes and example configs.

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
    embeddings_endpoint: "/v1/embeddings" # Optional embeddings endpoint path
    # rerank_endpoint: "/v1/rerank" # Optional rerank path for compatible upstreams/proxies
    realtime_endpoint: "/v1/realtime" # Optional experimental realtime WebSocket path or ws/wss URL
    images_generations_endpoint: "/v1/images/generations" # Optional image generation endpoint path
    images_edits_endpoint: "/v1/images/edits" # Optional image edit endpoint path
    audio_transcriptions_endpoint: "/v1/audio/transcriptions" # Optional transcription endpoint path
    audio_speech_endpoint: "/v1/audio/speech" # Optional text-to-speech endpoint path
    api_key: "${OPENAI_API_KEY}" # API key (use env vars!)
    auth_type: bearer # bearer (default) | x-api-key
    models: ["gpt-4o", "gpt-4o-mini"] # Supported model IDs
    embedding_models: ["text-embedding-3-small"] # Models eligible for /v1/embeddings
    # rerank_models: ["rerank-english-v3"] # Models eligible for /v1/rerank
    realtime_models: ["gpt-4o-realtime-preview"] # Models eligible for /v1/realtime when enabled
    image_models: ["gpt-image-1"] # Models eligible for /v1/images/*
    audio_models: ["gpt-4o-mini-transcribe", "tts-1"] # Models eligible for /v1/audio/*
    timeout_ms: 60000 # Request timeout
    max_concurrency: 50 # Optional max in-flight upstream calls for this node
    queue_timeout_ms: 10000 # Wait-policy queue timeout in milliseconds
    queue_policy: wait # wait (default) | fallback | reject
    connection: # Optional undici pool; omit to keep default fetch behavior
      enabled: true
      keep_alive: true
      pool_size: 10
      keep_alive_ms: 60000
      headers_timeout_ms: 30000
      body_timeout_ms: 300000
      http2: false # Experimental
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

`/v1/embeddings` is OpenAI-compatible and uses `nodes[].embedding_models`; chat models listed under `nodes[].models` are not selected for embedding requests. Images and audio endpoints use `nodes[].image_models` and `nodes[].audio_models` so media traffic can be permitted, priced, logged, and routed independently from chat traffic.

### Unified Model Capabilities

v0.6 adds one capability schema that covers chat/responses/messages/embeddings plus image, audio, rerank, and realtime routing without breaking old configs. Existing `nodes[].models`, `nodes[].embedding_models`, `max_context_tokens`, `structured_output`, and `pricing` remain valid.

```yaml
nodes:
  - id: openai
    models: ["gpt-4o", "gpt-4o-mini"]
    embedding_models: ["text-embedding-3-small"]
    modalities: ["text", "vision"] # legacy image-input alias; compatible with "image"
    endpoints:
      image: "/v1/images/generations"
      audio: "/v1/audio/transcriptions"
      rerank: "/v1/rerank"
      realtime: "wss://api.openai.com/v1/realtime"
    input_types: ["text", "image", "audio"]
    output_types: ["text", "image", "events"]
    max_file_size: 20000000
    supports_streaming: true
    supports_realtime: false
    supports_rerank: false
    model_capabilities:
      gpt-4o:
        modalities: ["text", "image", "audio"]
        input_types: ["text", "image", "audio"]
        output_types: ["text"]
        supports_streaming: true
        pricing: { input: 2.5, output: 10 }
      text-embedding-3-small:
        modalities: ["text", "embedding"]
        input_types: ["text"]
        output_types: ["embedding"]
        dimensions: [512, 1536]
        pricing: { input: 0.02, output: 0 }
```

Routing uses these declarations for smart-routing constraints. For example, a request containing images only considers targets whose model capability supports `vision` or `image`; incompatible targets are removed instead of silently kept at the end of the fallback list. The Dashboard Nodes and Routing pages show these model capabilities read-only so operators can see why a target is eligible.

See [Multimodal Capability Schema](docs/MULTIMODAL_CAPABILITIES.md) for the full field list and routing behavior.

`/v1/rerank` accepts OpenAI/common-compatible rerank requests and uses `nodes[].rerank_models`; chat and embedding models are not selected for rerank requests.

### Experimental Realtime Preview

Realtime is an experimental v0.6 WebSocket proxy preview. It is disabled by default and only performs safe pass-through: Gateway API key authentication, API key/namespace node-model permission checks, connection limits, idle/session timeouts, close cleanup, sanitized error summaries, and Dashboard/health connection state. It does not parse, transcode, inspect, or persist audio frames.

```yaml
nodes:
  - id: openai
    base_url: "https://api.openai.com"
    realtime_endpoint: "/v1/realtime"
    realtime_models: ["gpt-4o-realtime-preview"]

realtime:
  enabled: true
  path: /v1/realtime
  max_connections: 25
  max_connections_per_node: 25
  idle_timeout_ms: 300000
  upstream_connect_timeout_ms: 10000
  max_session_ms: 1800000
  default_node: openai
  default_model: gpt-4o-realtime-preview
```

Clients connect to `ws://localhost:2099/v1/realtime?model=gpt-4o-realtime-preview` with `Authorization: Bearer <gateway-api-key>`. SiftGate forwards upstream with the provider API key and `OpenAI-Beta: realtime=v1`. Browser clients that cannot set an `Authorization` header should use a trusted backend to mint or proxy the connection; the preview intentionally does not accept Gateway API keys in query strings.

### Upstream Connection Pooling

By default SiftGate keeps the existing `fetch` behavior. Add `nodes[].connection` when a high-throughput node should use an undici per-node pool:

```yaml
nodes:
  - id: openai-prod
    connection:
      enabled: true
      keep_alive: true
      pool_size: 20
      keep_alive_ms: 60000
      headers_timeout_ms: 30000
      body_timeout_ms: 300000
      http2: false
```

`pool_size` caps open sockets for that upstream node, `headers_timeout_ms` limits the wait for response headers, and `body_timeout_ms` limits idle time between body chunks for both streaming and non-streaming responses. `http2: true` enables undici HTTP/2 ALPN support as an experimental opt-in.

### Per-Node Concurrency Control

Set `max_concurrency` on a node to limit concurrent upstream requests across all models routed through that node. When the node is full, `queue_policy` controls overflow behavior:

| Policy     | Behavior                                                                          |
| ---------- | --------------------------------------------------------------------------------- |
| `wait`     | Queue until a slot opens, then fall back with `503` if `queue_timeout_ms` expires |
| `fallback` | Skip the saturated node immediately and try the next configured fallback          |
| `reject`   | Return `429` without trying fallbacks                                             |

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

For v0.3 cost and context-window aware routing, add model capability metadata and an optional optimization mode:

```yaml
nodes:
  - id: openai
    models: ["gpt-4o", "gpt-4o-mini"]
    embedding_models: ["text-embedding-3-small", "text-embedding-3-large"]
    max_context_tokens: 128000 # node-level default
    structured_output: true # node-level default
    model_capabilities:
      gpt-4o:
        max_context_tokens: 128000
        structured_output: true
        quality_score: 0.9
      gpt-4o-mini:
        max_context_tokens: 128000
        structured_output: true
        quality_score: 0.6
        pricing: { input: 0.15, output: 0.60 } # optional node/model override
      text-embedding-3-small:
        dimensions: [512, 1536]
        pricing: { input: 0.02, output: 0 }
      text-embedding-3-large:
        dimensions: [256, 1024, 3072]
        pricing: { input: 0.13, output: 0 }

routing:
  optimization: cost # cost | latency | balanced | quality
```

The gateway estimates request tokens from canonical messages, tools, and the requested output budget before automatic routing. Targets whose configured `max_context_tokens` cannot fit the estimate are removed; targets above 80% of their window are demoted behind longer-context alternatives. Direct model routing is not silently changed: if a direct model has a configured window and the estimate exceeds it, the gateway returns a clear 400 error instead of rerouting around the caller's choice. API key `allow_auto`, `allow_direct`, `allowed_nodes`, and `allowed_models` checks still run before a request reaches an upstream provider.

Optimization modes apply only within the already-eligible smart-routing target set:

- `cost` chooses the lowest estimated input/output cost using per-model `pricing` or `models_pricing`.
- `latency` chooses the lowest local sliding-window latency, with stable cold-start fallback.
- `balanced` combines normalized cost and latency.
- `quality` uses `quality_score` when configured, otherwise keeps the existing tier/strategy order.

Every accepted proxy request also writes a privacy-safe route decision trace. The trace explains the selected `node:model` with the request id, source format, tier, score, domain and modality hints, candidate targets, filtering reasons, cost/latency/context scores, circuit state, fallback chain, cost-downgrade state, and final selection. It intentionally records only routing metadata: prompts, responses, raw headers, and provider keys are not stored.

Use the Dashboard API to power an explainable routing page or inspect one request during incident response:

```bash
curl http://localhost:2099/api/dashboard/route-decisions \
  -H "Authorization: Bearer <dashboard_jwt>"

curl http://localhost:2099/api/dashboard/route-decisions/<request_id> \
  -H "Authorization: Bearer <dashboard_jwt>"
```

### Embeddings

`POST /v1/embeddings` accepts OpenAI-compatible requests with `model`, `input`, optional `dimensions`, `encoding_format`, and `user`. `input` may be a string, array of strings, token array, or array of token arrays.

For `model: "auto"`, SiftGate selects from configured `embedding_models`, filters by API key permissions and circuit state, prefers exact `dimensions` matches, and then ranks eligible targets by embedding input cost. Direct embedding requests use the same direct-routing permission checks as chat requests and return a clear 400 if the requested model is not listed under any node's `embedding_models`.

```bash
curl http://localhost:2099/v1/embeddings \
  -H "Authorization: Bearer <gateway_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "input": ["hello", "world"],
    "dimensions": 1536
  }'
```

### Structured Output

SiftGate preserves structured-output intent in the canonical request so routing, fallback, logs, and provider forwarding all see the same request contract. The v0.6 behavior covers:

- OpenAI Chat Completions `response_format` with `json_object` and `json_schema`
- OpenAI Responses `text.format` with `json_object` and `json_schema`
- Anthropic Messages `output_config.format` passthrough when the request and target are both Messages-compatible

Chat Completions example:

```json
{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Return whether deployment is safe." }],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "deployment_check",
      "schema": {
        "type": "object",
        "required": ["safe"],
        "properties": { "safe": { "type": "boolean" } },
        "additionalProperties": false
      },
      "strict": true
    }
  }
}
```

Responses example:

```json
{
  "model": "auto",
  "input": "Return a JSON object with ok=true.",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "answer",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": { "ok": { "type": "boolean" } }
      },
      "strict": true
    }
  }
}
```

Anthropic Messages example:

```json
{
  "model": "auto",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "Return a compact JSON result." }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "required": ["ok"],
        "properties": { "ok": { "type": "boolean" } }
      }
    }
  }
}
```

Forwarding strategies are explicit in call logs and Dashboard details:

- `passthrough` means the request and target provider use the same native structured-output field.
- `native` means SiftGate mapped the canonical intent to the target protocol's closest native field.
- `downgraded` means no safe mapping exists or the selected node/model declares `structured_output: false`; the request is still forwarded conservatively and the log records unsupported status.

When `routing.fallback_policy.structured_output.enabled` is true, non-streaming responses can fallback on JSON parse or schema validation failure. Streaming requests remain conservative: SiftGate will not change routes after SSE output has started.

### Rerank

`POST /v1/rerank` accepts OpenAI/common-compatible rerank requests with `model`, `query`, `documents`, optional `top_n`, and optional `return_documents`.

For `model: "auto"`, SiftGate selects from configured `rerank_models`, filters by Gateway API key permissions, local namespace restrictions, health/circuit state, and then ranks eligible targets by configured input cost. Direct rerank requests use the same direct-routing permission checks as chat and embeddings and return a clear 400 if the requested model is not listed under any node's `rerank_models`.

```bash
curl http://localhost:2099/v1/rerank \
  -H "Authorization: Bearer <gateway_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "query": "what is SiftGate?",
    "documents": [
      "SiftGate is a self-hosted AI traffic gateway.",
      "SQLite is the default local database."
    ],
    "top_n": 1
  }'
```

### Images and Audio

v0.6 adds minimal OpenAI-compatible media ingress for common provider/proxy APIs:

| Endpoint | Models selected from | Request body |
| --- | --- | --- |
| `POST /v1/images/generations` | `nodes[].image_models` | JSON; multipart is accepted as pass-through |
| `POST /v1/images/edits` | `nodes[].image_models` | JSON or `multipart/form-data` |
| `POST /v1/audio/transcriptions` | `nodes[].audio_models` | JSON or `multipart/form-data` |
| `POST /v1/audio/speech` | `nodes[].audio_models` | JSON; binary provider responses are returned unchanged |

For JSON bodies, SiftGate rewrites `model` to the selected upstream model and forwards the remaining fields. For multipart bodies, SiftGate stores only safe canonical metadata (`multipart`, byte size, model), rewrites or appends the `model` form field, and passes the original file bytes through without image/audio parsing, transcoding, resizing, or validation. Increase `server.body_limit` if your edit or transcription payloads exceed the default `1mb`.

```bash
curl http://localhost:2099/v1/images/generations \
  -H "Authorization: Bearer <gateway_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "prompt": "A clean product render of SiftGate as an AI gateway"
  }'
```

```bash
curl http://localhost:2099/v1/audio/transcriptions \
  -H "Authorization: Bearer <gateway_api_key>" \
  -F model=auto \
  -F file=@sample.wav
```

### Stream Cache and Embedding Batching

Both features are local OSS data-plane optimizations and are disabled by default.

Stream cache requires the normal prompt cache plus explicit stream opt-in:

```yaml
cache:
  enabled: true
  ttl_seconds: 300
  stream_cache:
    enabled: true
```

The first deterministic streaming request is forwarded normally while SiftGate buffers the completed response. Later hits are replayed as SSE in the caller's protocol. Interrupted, canceled, or partial streams are not stored. Cache keys include request content, source protocol, routing-relevant headers, and Gateway API key identity where available, so different tenants do not share stream cache entries.

Embedding batching collects small same-target `/v1/embeddings` requests for a short local window, sends one upstream batch, and splits the response back to each caller:

```yaml
embedding_batching:
  enabled: true
  window_ms: 10
  max_batch_size: 64
  max_input_items: 8
  max_queue: 1000
  timeout_ms: 10000
```

Batch groups are isolated by node, model, dimensions, encoding format, user, input shape, and Gateway API key identity. Batching can reduce provider round trips for many tiny embedding calls, but it intentionally adds up to `window_ms` of local wait time and should be tuned below your latency budget. See [Stream Cache and Embedding Batching](docs/STREAM_CACHE_BATCHING.md) for cancellation, timeout, partial failure, and cache safety notes.

### Fallback Policies

SiftGate still supports the normal primary/fallback chain, and v0.3 adds optional local policies for cases where waiting for retries is the wrong move:

```yaml
routing:
  fallback_policy:
    immediate_429: true
    timeout:
      enabled: true
      threshold_ms: 30000
      race_fallback: false
    structured_output:
      enabled: true
      fallback_on_parse_error: true
      fallback_on_schema_error: true
    cost_downgrade:
      enabled: true
      max_estimated_cost_usd: 0.05
```

- `immediate_429` skips same-node retries for rate limits and tries the next fallback.
- `timeout.threshold_ms` uses an upstream attempt timeout before moving on. `race_fallback` is off by default because it can create extra provider cost; when enabled it must have an explicit threshold.
- `structured_output` checks OpenAI Chat `response_format`, OpenAI Responses `text.format`, and Anthropic Messages `output_config.format` JSON output. Non-streaming responses can fallback on parse/schema failure; streaming responses stay conservative and never change routes after SSE starts.
- `cost_downgrade` estimates request cost from local token heuristics and `models_pricing`, then uses a cheaper fallback when the primary estimate exceeds the configured limit.
- Call logs, Dashboard log details/exports/SSE, OpenTelemetry, and optional connected-gateway telemetry include `fallback_reason`.

### Adaptive Routing Recommendations

SiftGate can generate local, read-only routing recommendations from recent `call_logs`. The recommendation engine uses a sliding window of observed node:model performance and reports:

- success rate
- p50 and p95 latency
- average cost and potential cost savings
- fallback rate
- reasons, confidence, and risk notes

The first version is recommendation-only. It never mutates `gateway.config.yaml`, never rewrites `routing.tiers`, and never applies a recommendation from the Dashboard. Operators can review the evidence on the Routing page and make manual config edits when they are comfortable with the tradeoff.

The Dashboard API is:

```bash
curl http://localhost:2099/api/dashboard/routing/recommendations \
  -H "Authorization: Bearer <dashboard-token>"
```

Optional query parameters:

- `window_hours` — observation window, default `24`
- `sample_limit` — max recent call logs to inspect, default `1000`

See [Routing Recommendations](docs/ROUTING_RECOMMENDATIONS.md) for response shape and behavior.

### Budget

```yaml
budget:
  daily_token_limit: 5000000 # Max tokens per day
  daily_cost_limit: 200.00 # Max cost per day (USD)
  alert_threshold: 0.8 # Alert at 80% usage

models_pricing: # Cost per 1M tokens (USD); used when node/model pricing is omitted
  gpt-4o: { input: 2.50, output: 10.00 }
  claude-opus-4: { input: 15.00, output: 75.00 }
  text-embedding-3-small: { input: 0.02, output: 0.00 }
```

### Shadow Traffic

Shadow traffic is disabled by default. When enabled, SiftGate mirrors a sampled copy of successful primary requests to a configured test node/model asynchronously. Shadow sends do not alter the primary route, do not block the caller, and do not count as primary call-log or budget usage.

```yaml
shadow:
  enabled: true
  sample_rate: 0.05
  target_node: openai-staging
  target_model: gpt-4o-mini
  timeout_ms: 30000
  max_recent_results: 100
  compare:
    store_prompts: false
    store_responses: false
```

By default, shadow results store metadata only: request id, namespace, primary/shadow node and model, status, latency, token usage, and error reason. Prompt/input samples and response samples are stored only when `compare.store_prompts` or `compare.store_responses` is explicitly set to `true`; config validation emits a warning when either is enabled. Raw headers and provider keys are never stored. The Dashboard Shadow page and `GET /api/dashboard/shadow` endpoint are read-only. See [Local Namespaces And Shadow Traffic](docs/NAMESPACES_AND_SHADOW.md).

### Webhook Alerts

Webhook alerting is disabled by default and runs entirely inside the open-source data plane. When enabled, delivery is queued asynchronously so webhook latency or failures do not block proxy requests.

```yaml
alerts:
  enabled: true
  channels:
    - type: webhook
      name: ops
      url: "${ALERT_WEBHOOK_URL}"
      headers:
        Authorization: "Bearer ${ALERT_WEBHOOK_TOKEN}"
      events:
        - budget_threshold
        - budget_exceeded
        - node_down
        - node_recovered
        - circuit_open
        - circuit_close
        - error_spike
        - latency_spike
      debounce_seconds: 300
      retry:
        attempts: 3
        backoff_ms: 1000
        timeout_ms: 5000
  error_spike:
    window_seconds: 300
    min_requests: 20
    error_rate: 0.1
  latency_spike:
    window_seconds: 300
    min_requests: 20
    p95_ms: 10000
```

Alert payloads include event metadata, severity, message, and sanitized details only. They do not include prompts, responses, provider API keys, or raw headers. The Dashboard shows configured webhook channels plus recent delivery status and failure reasons. See [docs/WEBHOOK_ALERTS.md](docs/WEBHOOK_ALERTS.md) for payload shape and event details.

### External Log Sinks

SiftGate always writes accepted request metadata to the local `call_logs` table. External sinks are optional, asynchronous exports for SIEM, data lake, or ops pipelines; they never replace SQLite/Postgres logging and do not block the request path.

```yaml
logging:
  enabled: true
  sinks:
    - type: file
      name: local-jsonl
      path: ./data/calls.jsonl
      batch_size: 100
      flush_interval_ms: 5000
      max_queue: 10000
      overflow: drop_oldest
    - type: webhook
      name: ops-pipeline
      url: "${LOG_SINK_WEBHOOK_URL}"
      headers:
        Authorization: "Bearer ${LOG_SINK_WEBHOOK_TOKEN}"
      fields:
        [
          request_id,
          timestamp,
          node_id,
          model,
          status_code,
          latency_ms,
          cost_usd,
        ]
      retry:
        attempts: 3
        backoff_ms: 1000
        timeout_ms: 5000
```

File sinks write JSONL, one sanitized call-log record per line. Webhook sinks send `siftgate.call_log_batch.v1` batches. S3 is currently a typed config placeholder, and Elasticsearch has a minimal `_bulk` exporter.

By default exports include only safe call-log metadata and exclude prompt text, response text, provider API keys, raw headers, authorization values, and other secret-bearing fields. Use `fields` as an allow-list or `exclude_fields` as a deny-list for additional filtering. See [docs/LOG_SINKS.md](docs/LOG_SINKS.md).

## TypeScript SDK

The v0.4 SDK scaffold lives in [packages/client](packages/client). It is a lightweight fetch-based wrapper for the open-source data plane with typed helpers for models, chat completions, responses, messages, embeddings, and advisory routing hints.

```ts
import { SiftGateClient } from '@siftgate/client';

const client = new SiftGateClient({
  baseUrl: 'http://localhost:2099',
  gatewayApiKey: process.env.SIFTGATE_API_KEY,
});

await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Return a concise answer.' }],
});
```

Existing OpenAI SDK users do not need to switch SDKs. Point the SDK at SiftGate and use a dashboard-generated Gateway API key:

```ts
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:2099/v1',
  apiKey: process.env.SIFTGATE_API_KEY,
});
```

See the [TypeScript SDK README](packages/client/README.md) for routing hints, raw streaming access, and the forward-compatible embeddings helper. The Python SDK is design-only for this milestone; see [docs/PYTHON_SDK_DESIGN.md](docs/PYTHON_SDK_DESIGN.md).

## API Endpoints

Live API docs are available when the gateway is running:

- Swagger UI: `http://localhost:2099/docs`
- OpenAPI JSON: `http://localhost:2099/openapi.json`
- Static reference: [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

### Proxy Endpoints (AI Requests)

| Method | Endpoint               | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions format                |
| `POST` | `/v1/responses`        | OpenAI Responses format                       |
| `POST` | `/v1/messages`         | Anthropic Messages format                     |
| `POST` | `/v1/embeddings`       | OpenAI Embeddings format                      |
| `POST` | `/v1/rerank`           | OpenAI/common-compatible rerank format        |
| `POST` | `/v1/images/generations` | OpenAI Images generation format             |
| `POST` | `/v1/images/edits`     | OpenAI Images edits format with multipart pass-through |
| `POST` | `/v1/audio/transcriptions` | OpenAI Audio transcription format         |
| `POST` | `/v1/audio/speech`     | OpenAI Audio speech format with binary responses |
| `WS`   | `/v1/realtime`         | Experimental OpenAI Realtime-style pass-through |
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
3. Check global budgets, the key's own budgets, and namespace budgets when the key is namespace-bound.
4. Resolve `auto` or direct routing according to the key's permissions.
5. Serve from gateway prompt cache or call the upstream provider.
6. Compute token usage and estimated cost from node/model `pricing` overrides or `models_pricing`.
7. Record usage against global budgets and, when present, the key budget and namespace budget.
8. Write a call log attributed to the same `api_key_id`.

Embedding, images, and audio requests follow the same auth, budget, concurrency, fallback, telemetry, and call-log path as chat requests. Embedding and media usage is recorded from upstream `usage` when present, with lightweight local input estimation as a fallback for cost/budget accounting.

The call log stores:

- Gateway API key id
- Gateway API key name
- Namespace id when the key is namespace-bound
- source protocol
- selected tier
- upstream node
- upstream model
- input and output tokens
- estimated cost from node/model `pricing` overrides or `models_pricing`
- status code and latency

That record powers the Dashboard, Logs, Analytics, Budget, and per-key billing views. Generated key budgets are reset by `budget_rule.id`, not by rule type, so global and per-key `daily_cost` rules cannot be confused.

Dashboard filters for generated Gateway API keys use the immutable `api_key_id`. The older `api_key` name filter is kept only for legacy YAML-defined keys.

Gateway prompt-cache hits are still logged and recorded against budgets using the cached response's usage and model pricing. They are marked as tier `cached` with node `cache`, so they remain attributable without making an upstream provider call.

Failed upstream requests are logged with their status/error and zero usage/cost. Streaming requests record budget usage after a successful final usage event. If a model has no pricing entry in either model capabilities or `models_pricing`, routing still works, token usage is still tracked, and cost may be `0` until pricing is configured.

When a budget is exceeded, the proxy returns `429` with `type: "budget_exceeded"` and structured details such as `scope`, `api_key_id`, `budget_type`, `current`, `limit`, and `reset_at`.

### Dashboard API

| Method | Endpoint                                 | Description                                                                                        |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/dashboard/stats`                   | Aggregated statistics; supports `api_key_id`, legacy `api_key`, and `namespace` filters            |
| `GET`  | `/api/dashboard/logs`                    | Paginated call logs; supports `api_key_id`, legacy `api_key`, and `namespace` filters              |
| `GET`  | `/api/dashboard/logs/sse`                | Real-time log stream (SSE)                                                                         |
| `GET`  | `/api/dashboard/route-decisions`         | Paginated explainable routing summaries with tier, node, source format, key, and namespace filters |
| `GET`  | `/api/dashboard/route-decisions/:requestId` | Full privacy-safe route decision trace for one request                                           |
| `GET`  | `/api/dashboard/analytics/cost`          | Cost analytics; supports `api_key_id`, legacy `api_key`, and `namespace` filters                   |
| `GET`  | `/api/dashboard/routing/recommendations` | Read-only adaptive routing recommendations from local sliding-window metrics                       |
| `GET`  | `/api/dashboard/alerts`                  | Local webhook alert channels and recent delivery status                                            |
| `GET`  | `/api/dashboard/namespaces`              | Local OSS namespace policies and budget summaries                                                  |
| `GET`  | `/api/dashboard/shadow`                  | Read-only shadow traffic status and recent sanitized results                                       |
| `GET`  | `/api/dashboard/config`                  | Sanitized config (API keys masked)                                                                 |
| `POST` | `/api/dashboard/config/reload`           | Atomically hot-reload config from disk; returns `400` and keeps the old config on failure          |
| `GET`  | `/api/dashboard/api-keys`                | List Gateway API keys                                                                              |
| `POST` | `/api/dashboard/api-keys`                | Create a Gateway API key                                                                           |
| `GET`  | `/api/dashboard/nodes`                   | Node health, active probe, circuit breaker, concurrency, and queue depth                           |
| `POST` | `/api/dashboard/nodes/:id/reset`         | Reset circuit breaker                                                                              |
| `GET`  | `/api/dashboard/budget`                  | Budget status; supports `api_key_id`, legacy `api_key`, and `namespace` filters                    |
| `POST` | `/api/dashboard/budget/:id/reset`        | Reset one budget rule by `budget_rule.id`                                                          |
| `GET`  | `/health`                                | Gateway, budget, node circuit, active probe, and concurrency health                                |
| `GET`  | `/cluster/status`                        | Redis-backed multi-instance inventory and reload broadcast status when cluster mode is enabled      |

## Dashboard

The built-in dashboard is available at the gateway's root URL (default: `http://localhost:2099`).

**Pages:**

- **Dashboard** — Real-time metrics, charts, and live request stream
- **Logs** — Searchable, filterable log table with pagination and SSE notifications
- **Route Explanation** — Read-only per-request explanation for why SiftGate selected a node/model, with deep links from log details
- **Shadow** — Read-only status and recent results for sampled test-node mirror traffic
- **Nodes** — Provider health status, models, tags, and circuit breaker controls
- **Routing** — Visual tier configuration, scoring thresholds, domain preferences, and read-only adaptive recommendations
- **Budget** — Ring gauges for daily usage, model pricing table, and budget rules
- **API Keys** — Client Gateway API key generation, namespace binding, permissions, budgets, rate limits, rotation, and disable/delete controls

## Plugins

SiftGate can load runtime plugins from the local `plugins/` directory, from `gateway.config.yaml`, or from the standalone `plugins.config.yaml` declaration file. The plugin manager writes `plugins.config.yaml` by default, leaving `gateway.config.yaml` under operator control.

```bash
# Local directory or file
node dist/cli/siftgate.js plugin install ./plugins/pii-filter

# npm registry package from the initial official scope
node dist/cli/siftgate.js plugin install @siftgate/plugin-guardrails

node dist/cli/siftgate.js plugin list
node dist/cli/siftgate.js plugin remove @siftgate/plugin-guardrails
```

For npm packages, the CLI currently accepts the `@siftgate/plugin-*` scope, reads package metadata with `npm view`, checks the plugin's declared SiftGate compatibility range, then runs `npm install --save` and records the declaration. Local plugins are checked against a nearby `package.json` when one is present. See [Plugin Manager](docs/PLUGINS.md) for declaration format and compatibility metadata.

## Observability

SiftGate uses the existing OpenTelemetry SDK and Prometheus exporter. When `telemetry.enabled: true`, the exporter serves Prometheus metrics from `http://localhost:9464/metrics` by default, configurable with `telemetry.metrics.prometheus_port`.

Business metrics include:

- `siftgate_requests_total{tier,node,model,status}`
- `siftgate_request_duration_seconds{tier,node,model,status}`
- `siftgate_tokens_total{node,model,direction}`
- `siftgate_cost_total{node,model}`
- `siftgate_fallback_total{tier,node,model}`
- `siftgate_cache_hits_total`
- `siftgate_cache_misses_total`
- `siftgate_budget_usage_ratio{scope,budget_type}`
- `siftgate_concurrent_requests{node}`
- `siftgate_circuit_breaker_state{node,model}`

Metric labels are intentionally bounded: status is recorded as a status class such as `2xx`, dynamic model labels are reduced to configured model IDs, `node:prefix*`, or `unlisted`, and API key names/IDs, prompts, responses, provider keys, and raw headers are never used as metric labels.

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

To try the optional Redis state backend locally, uncomment the `state` block in `gateway.config.yaml`, set `REDIS_URL=redis://redis:6379` in `.env`, and start Compose with the Redis profile:

```bash
docker compose --profile redis up -d --build
```

### Using Dockerfile directly

```bash
docker build -t siftgate .
docker run -p 2099:2099 \
  -v $(pwd)/gateway.config.yaml:/app/gateway.config.yaml \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  siftgate
```

## Kubernetes

SiftGate includes deployment assets for Kubernetes without requiring SiftGate Cloud:

- Helm chart: `deploy/helm/siftgate`
- Plain Kustomize base: `deploy/kubernetes/base`

Both default to one replica, SQLite on a PVC, memory state, and no Redis/PostgreSQL dependency. Production operators can opt into PostgreSQL, Redis, Ingress, HPA, ServiceMonitor, and PDB through chart values or Kustomize overlays.

```bash
helm upgrade --install siftgate ./deploy/helm/siftgate \
  --namespace siftgate \
  --create-namespace \
  --set secrets.env.OPENAI_API_KEY="$OPENAI_API_KEY"

kubectl -n siftgate port-forward svc/siftgate 2099:2099
```

ConfigMap mounts are read-only, so use a bcrypt `DASHBOARD_PASSWORD_HASH` instead of a plaintext Dashboard password. See [Kubernetes And Helm](docs/KUBERNETES.md) for PostgreSQL, Redis, and GitOps notes.

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
│   Controller    │  ← chat, responses, messages, embeddings, rerank, images, audio, realtime WS
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

- **Normalizers / Denormalizers** — Bidirectional converters between OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, embeddings, rerank request/response shapes, and safe media pass-through metadata
- **Scoring Engine** — Evaluates request complexity across keyword, structural, and tool dimensions
- **Router** — Tier-based node selection with circuit breaker, momentum, and domain-aware reordering
- **Provider Client** — HTTP forwarder with streaming support (SSE parsing for each protocol)
- **Budget Service** — Token/cost tracking with daily limits and alerts

**Tech stack:**

- **Backend:** NestJS 11, TypeORM, SQLite (default) / PostgreSQL
- **Frontend:** React 19, Vite, Tailwind CSS v4, TanStack Query, Recharts
- **Protocols:** Full support for streaming and non-streaming chat traffic across the three generative API formats, plus OpenAI-compatible embeddings, rerank, images, and audio ingress

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
