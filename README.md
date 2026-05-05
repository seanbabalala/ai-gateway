# SiftGate

SiftGate is a self-hosted AI traffic gateway for running multiple AI providers behind one local data plane. It gives applications OpenAI-compatible and provider-compatible ingress, then applies routing, fallback, budget, API key policy, observability, cache evidence, and Dashboard operations before forwarding traffic upstream.

Current release: **v1.3.2 Production Ready**.

## Why SiftGate

- One gateway for Chat Completions, Responses, Anthropic Messages, Embeddings, Rerank, Images, Audio, Video preview, Realtime preview, MCP preview, and Batch proxy.
- Explainable routing: every request can show why a node/model was selected or filtered.
- Local governance: Gateway API keys, namespaces, local teams, budgets, rate limits, allowed endpoints, allowed modalities, allowed nodes, and allowed models.
- Production defaults: single-node memory/SQLite works out of the box; Redis, PostgreSQL, Kubernetes, and Helm are optional.
- Privacy-first operations: call logs, route traces, shadow reports, guardrails findings, batch jobs, video jobs, semantic cache, and eval reports are metadata-only by default.
- Catalog-backed setup: Add Node Wizard and config validation use the Provider Catalog instead of hardcoded provider lists.

## Quick Start

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
npm run build
npm start
```

Open:

- Gateway: `http://localhost:2099`
- OpenAPI: `http://localhost:2099/docs`
- Dashboard: `http://localhost:2099/dashboard`

Add at least one upstream node in `gateway.config.yaml`, then point your app at SiftGate:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Explain this in one sentence."}]
  }'
```

You can also keep the OpenAI SDK and set `baseURL` to `http://localhost:2099/v1`.

## v1.3 Highlights

| Area | What changed |
| --- | --- |
| Virtual Key + Team | Local teams for grouping Gateway API keys with team-level budgets, rate limits, namespace policy, and endpoint/model/modality restrictions. |
| Semantic Cache Preview | Disabled-by-default semantic similarity metadata cache. It stores embedding/hash/metadata by default; replayable responses require explicit opt-in. |
| Evaluation Framework | Local metadata-only primary-vs-candidate experiment reports with LLM-as-judge calls routed through SiftGate. |
| Community Assets | Quickstart, production, security, SDK, playground, MCP, batch, caching, eval docs, issue templates, PR template, contribution guide, and docs checks. |

## Core Features

| Category | Capabilities |
| --- | --- |
| Protocols | `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/embeddings`, `/v1/rerank`, image/audio endpoints, async video preview, realtime preview, MCP preview, Batch proxy. |
| Routing | Complexity tiers, domain hints, multimodal capability filtering, cost/context optimization, cache-aware routing, reasoning-aware routing, fallback chains, circuit breakers. |
| Explainability | Route Decision Trace, Route Explanation page, candidate filtering reasons, capability evidence, compatibility profile evidence, cache evidence, cost/latency/context tradeoffs. |
| Governance | Local Gateway API keys, namespaces, teams, budgets, rate limits, allowed endpoints/models/nodes/modalities, audit events, config rollback. |
| Provider Ops | Provider Catalog, Add Node Wizard, provider compatibility profiles, provider compatibility matrix, catalog override CLI, OpenRouter pricing sync preview. |
| Safety | Secret references, guardrails plugin, metadata-only logs, sanitized route traces, privacy-safe shadow reports, secure defaults for cache/eval storage. |
| Deployment | Single-node memory/SQLite, Docker, Kubernetes manifests, Helm chart, optional Redis/PostgreSQL. |
| Developer UX | TypeScript client scaffold, Python SDK scaffold, Dashboard Playground, session trace view, agent framework examples. |

## Configuration

The default path is `gateway.config.yaml`. Start from `gateway.config.example.yaml` and keep real provider keys out of git.

Common settings:

- `nodes[]`: upstream providers, compatible proxies, local model servers, and model buckets.
- `routing`: tiers, fallback chains, load balancing, optimization mode.
- `auth.api_keys[]`: local Gateway API keys and permissions.
- `namespaces[]`: local isolation boundaries for teams/apps.
- `cache`: deterministic prompt response cache.
- `semantic_cache`: disabled-by-default semantic cache preview.
- `evaluation`: disabled-by-default local eval metadata and sample-storage controls.
- `state`: optional Redis shared runtime state.
- `database`: SQLite by default, PostgreSQL optional.

Validate config before deploying:

```bash
npm run validate:config
```

## Documentation

| Topic | Link |
| --- | --- |
| Quickstart | [docs/QUICKSTART.md](docs/QUICKSTART.md) |
| API reference | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) |
| Dashboard | [docs/DASHBOARD.md](docs/DASHBOARD.md) |
| Production | [docs/PRODUCTION.md](docs/PRODUCTION.md) |
| Kubernetes / Helm | [docs/KUBERNETES.md](docs/KUBERNETES.md) |
| Provider Catalog | [docs/PROVIDER_CATALOG.md](docs/PROVIDER_CATALOG.md) |
| Provider Compatibility | [docs/PROVIDER_COMPATIBILITY.md](docs/PROVIDER_COMPATIBILITY.md) |
| SDKs | [docs/SDKS.md](docs/SDKS.md) |
| Playground | [docs/PLAYGROUND.md](docs/PLAYGROUND.md) |
| MCP Gateway | [docs/MCP_GATEWAY.md](docs/MCP_GATEWAY.md) |
| Batch API | [docs/BATCH_API.md](docs/BATCH_API.md) |
| Caching | [docs/CACHING.md](docs/CACHING.md) |
| Evaluation Framework | [docs/EVALUATION_FRAMEWORK.md](docs/EVALUATION_FRAMEWORK.md) |
| Security | [docs/SECURITY.md](docs/SECURITY.md) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Roadmap | [docs/GATEWAY_ROADMAP.md](docs/GATEWAY_ROADMAP.md) |

## Development

```bash
npm run build
npm test -- --runInBand
npm run test:e2e
npm run validate:k8s
npm run docs:check
cd frontend && npm test && npm run build
```

Useful commands:

```bash
npm run catalog -- list
npm run validate:config
npm run benchmark:upstream
npm run test:python-sdk
```

## Community

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Issues: use the templates under [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE)

SiftGate is MIT licensed and designed so the open-source Data Plane remains useful on its own.
