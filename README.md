<p align="center">
  <h1 align="center">AI Gateway</h1>
  <p align="center">
    A local, multi-protocol AI gateway with smart routing, automatic fallback, and a real-time dashboard.
  </p>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-endpoints">API Endpoints</a> &bull;
  <a href="#dashboard">Dashboard</a> &bull;
  <a href="#docker">Docker</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## What is AI Gateway?

AI Gateway is a **self-hosted proxy** that sits between your applications and multiple AI providers (OpenAI, Anthropic, Google, etc.). It accepts requests in **any** of the three major API formats and intelligently routes them to the best provider based on request complexity, cost, and availability.

**The problem it solves:** Different AI providers use different API formats (`chat/completions`, `responses`, `messages`). If you use multiple providers, your code needs to handle each format separately. AI Gateway gives you a **single endpoint** that speaks all three formats and automatically picks the right provider.

```
Your App ──▶ AI Gateway ──▶ OpenAI (GPT)
         (any format)   ├──▶ Anthropic (Claude)
                        ├──▶ Google (Gemini)
                        └──▶ Any OpenAI-compatible API
```

## Features

### Multi-Protocol Support
- **OpenAI Chat Completions** (`/v1/chat/completions`) — the most common format
- **OpenAI Responses** (`/v1/responses`) — OpenAI's newer API format
- **Anthropic Messages** (`/v1/messages`) — Claude's native format
- Full **streaming** support across all three protocols
- **Cross-protocol conversion** — send a request in any format, it gets routed to any provider regardless of their native API

### Smart Routing
- **Complexity scoring** — analyzes each request across 12 dimensions (keywords, structure, tools, etc.) to determine complexity tier (simple / standard / complex / reasoning)
- **Tier-based routing** — each complexity tier maps to a primary provider + fallback chain
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
- **Health monitoring** — real-time health status for all configured nodes
- **Graceful degradation** — the system continues working even when some providers are down

### Real-Time Dashboard
- **Live metrics** — total calls, tokens, cost, latency at a glance
- **SSE log stream** — see requests flowing through the gateway in real time
- **Node health** — monitor provider status and circuit breaker state
- **Routing visualization** — see how tiers, scoring thresholds, and fallback chains are configured
- **Budget tracking** — ring gauges showing daily usage vs limits
- **Light / Dark theme** — system-aware with manual toggle

### Developer Experience
- **Zero-config model routing** — just send `model: "auto"` and the gateway picks the best provider
- **Model aliases** — use friendly names like `"claude"` instead of `"claude-opus-4-6-v1"`
- **Node prefix routing** — send `"gpt/my-custom-model"` to force routing to a specific node
- **OpenAI-compatible `/v1/models`** endpoint — list all available models and aliases
- **Hot reload** — update `gateway.config.yaml` and reload without restarting

## Quick Start

### Prerequisites
- **Node.js** 20+ (LTS recommended)
- **npm** 10+

### 1. Clone & Install

```bash
git clone https://github.com/your-username/ai-gateway.git
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

Edit `gateway.config.yaml` to add your AI provider nodes. At minimum, you need one node:

```yaml
nodes:
  - id: openai
    name: "GPT-4o"
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

Set your API key in `.env`:

```bash
OPENAI_API_KEY=sk-...
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

### 4. Test It

```bash
# Send a request using OpenAI chat completions format
curl http://localhost:2099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_sk_dev_default" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Open `http://localhost:2099` in your browser to access the dashboard.

## Configuration

All configuration lives in `gateway.config.yaml`. Environment variables can be referenced as `${VAR}` or `${VAR:-default}`.

### Server

```yaml
server:
  port: 2099        # HTTP port
  host: 0.0.0.0     # Bind address
```

### Database

```yaml
database:
  type: sqlite                  # sqlite or postgres
  path: ./data/gateway.db       # SQLite file path
  # url: postgresql://...       # PostgreSQL connection URL (if type: postgres)
```

### Authentication

```yaml
auth:
  api_keys:
    - key: "${GATEWAY_API_KEY}"   # Clients must send this as Bearer token
      name: "default"
```

### Nodes (AI Providers)

Each node represents an AI provider endpoint:

```yaml
nodes:
  - id: openai                          # Unique identifier
    name: "GPT-4o"                      # Display name
    protocol: chat_completions          # chat_completions | responses | messages
    base_url: "https://api.openai.com"  # Provider base URL
    endpoint: "/v1/chat/completions"    # API endpoint path
    api_key: "${OPENAI_API_KEY}"        # API key (use env vars!)
    auth_type: bearer                   # bearer (default) | x-api-key
    models: ["gpt-4o", "gpt-4o-mini"]  # Supported model IDs
    timeout_ms: 60000                   # Request timeout
    tags: ["code", "reasoning"]         # Capability tags for domain routing
    model_aliases:                      # User-friendly shortcuts
      gpt4: gpt-4o
    headers:                            # Extra headers (optional)
      anthropic-version: "2023-06-01"
```

**Supported protocols:**
| Protocol | Format | Providers |
|----------|--------|-----------|
| `chat_completions` | OpenAI Chat Completions | OpenAI, Azure OpenAI, Google Gemini, any OpenAI-compatible API |
| `responses` | OpenAI Responses | OpenAI (newer API) |
| `messages` | Anthropic Messages | Anthropic Claude |

### Routing

```yaml
routing:
  tiers:
    simple:                                          # Low-complexity requests
      primary: { node: cheap-model, model: ... }
      fallbacks:
        - { node: backup-model, model: ... }
    standard:                                        # Normal requests
      primary: { node: mid-model, model: ... }
      fallbacks: [...]
    complex:                                         # Complex requests
      primary: { node: strong-model, model: ... }
      fallbacks: [...]
    reasoning:                                       # Reasoning-heavy requests
      primary: { node: best-model, model: ... }
      fallbacks: [...]

  scoring:
    simple_max: -0.1      # Score ≤ this → simple
    standard_max: 0.08    # Score ≤ this → standard
    complex_max: 0.35     # Score ≤ this → complex
                          # Score > this → reasoning

  domain_preferences:
    frontend: [gemini, gpt]   # Prefer these nodes for frontend questions
    backend: [claude, gpt]    # Prefer these nodes for backend questions
```

### Budget

```yaml
budget:
  daily_token_limit: 5000000     # Max tokens per day
  daily_cost_limit: 200.00       # Max cost per day (USD)
  alert_threshold: 0.8           # Alert at 80% usage

models_pricing:                   # Cost per 1M tokens (USD)
  gpt-4o: { input: 2.50, output: 10.00 }
  claude-opus-4: { input: 15.00, output: 75.00 }
```

## API Endpoints

### Proxy Endpoints (AI Requests)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions format |
| `POST` | `/v1/responses` | OpenAI Responses format |
| `POST` | `/v1/messages` | Anthropic Messages format |
| `GET` | `/v1/models` | List all available models (OpenAI-compatible) |

All proxy endpoints require `Authorization: Bearer <api_key>` header.

### Model Resolution

When sending a request, the `model` field is resolved in this order:

1. **`"auto"`** — Smart routing based on complexity scoring
2. **Exact model ID** — e.g., `"gpt-4o"` → routes to the node that has this model
3. **Alias** — e.g., `"claude"` → resolved via `model_aliases`
4. **Node ID** — e.g., `"openai"` → routes to that node's first model
5. **Node prefix** — e.g., `"openai/my-fine-tuned"` → routes to node, passes model name through

### Dashboard API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/stats` | Aggregated statistics |
| `GET` | `/api/dashboard/logs` | Paginated call logs |
| `GET` | `/api/dashboard/logs/sse` | Real-time log stream (SSE) |
| `GET` | `/api/dashboard/config` | Sanitized config (API keys masked) |
| `POST` | `/api/dashboard/config/reload` | Hot-reload config from disk |
| `GET` | `/api/dashboard/nodes` | Node health + circuit breaker status |
| `POST` | `/api/dashboard/nodes/:id/reset` | Reset circuit breaker |
| `GET` | `/api/dashboard/budget` | Budget status |
| `POST` | `/api/dashboard/budget/:type/reset` | Reset budget counter |
| `GET` | `/health` | Health check |

## Dashboard

The built-in dashboard is available at the gateway's root URL (default: `http://localhost:2099`).

**Pages:**
- **Dashboard** — Real-time metrics, charts, and live request stream
- **Logs** — Searchable, filterable log table with pagination and SSE notifications
- **Nodes** — Provider health status, models, tags, and circuit breaker controls
- **Routing** — Visual tier configuration, scoring thresholds, and domain preferences
- **Budget** — Ring gauges for daily usage, model pricing table, and budget rules

## Docker

### Using Docker Compose (recommended)

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
# Edit gateway.config.yaml and .env with your settings

docker compose up -d
```

### Using Dockerfile directly

```bash
docker build -t ai-gateway .
docker run -p 2099:2099 \
  -v $(pwd)/gateway.config.yaml:/app/gateway.config.yaml \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  ai-gateway
```

## Architecture

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
│   Scorer        │  ← Analyze complexity (12 dimensions → tier)
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

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
