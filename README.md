# SiftGate

SiftGate is a self-hosted AI traffic gateway for running multiple AI providers behind one local data plane. It gives applications OpenAI-compatible and provider-compatible ingress, then applies routing, fallback, budget, API key policy, observability, cache evidence, and Dashboard operations before forwarding traffic upstream.

Current release: **v1.7.0 Catalog Enrichment + Fresh Model Defaults**.

Current development focus after v1.7.0: keep the MIT Data Plane local-first while making provider/model metadata fresher, pricing references more operator-reviewable, and Dashboard node setup less likely to default to stale models without turning external enrichment into a runtime dependency or billing authority.

## Why SiftGate

- One gateway for Chat Completions, Responses, Anthropic Messages, Embeddings, Rerank, Images, Audio, Video preview, Realtime preview, MCP preview, and Batch proxy.
- Explainable routing: every request can show why a node/model was selected or filtered.
- Local governance: Gateway API keys, namespaces, local teams, budgets, rate limits, allowed endpoints, allowed modalities, allowed nodes, and allowed models.
- Production defaults: single-node memory/SQLite works out of the box; Redis, PostgreSQL, Kubernetes, and Helm are optional.
- Privacy-first operations: call logs, route traces, shadow reports, guardrails findings, batch jobs, video jobs, semantic cache, and eval reports are metadata-only by default.
- Catalog-backed setup: Add Node Wizard and config validation use the Provider Catalog instead of hardcoded provider lists, and v1.7 adds fresh default model recommendations from merged catalog metadata.
- Price source governance: cost-aware routing, benchmarks, Route Explanation, config validation, and catalog override workflows share one resolver with explicit user config taking priority over sync cache and built-in references.

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

## v1.7 Highlights

- ZeroEval-backed catalog enrichment: the local catalog sync framework can now ingest reference model metadata from ZeroEval and merge lifecycle, context, throughput, multimodal, and reviewed-reference pricing fields into the existing catalog pipeline without creating a second catalog.
- Fresh model defaults for Add Node: Dashboard provider rows now expose `recommended_model_buckets`, `latest_model_hints`, and `recommended_models` so new nodes default to newer, stable, priced models instead of alphabetically early snapshots or stale dated variants.
- Default pricing prefill via merged catalog: Add Node pricing editors now prefill from recommended models and merged catalog pricing metadata, while explicit node pricing, `models_pricing`, `catalog.override.yaml`, and sync-cache precedence remain unchanged.
- Catalog enrichment metadata: merged catalog and Dashboard APIs now preserve model lifecycle, specs, source metadata, and selected benchmark snippets so Provider Catalog detail and future model governance surfaces can reuse one shared source of truth.

## v1.6 Highlights

- Usage schema registry: compatibility profiles now declare official usage/cache field paths so non-streaming and streaming extraction can normalize provider cache tokens across OpenAI-compatible, Responses-compatible, Anthropic Messages, Gemini, DeepSeek, Cohere, and local runtime surfaces.
- Provider cache-aware cost accounting: built-in pricing and canonical usage handling now preserve normal input, cache read, and cache creation token distinctions so actual cost and no-cache baseline cost stay comparable.
- Cache Savings Dashboard: overview KPIs, Analytics, Logs, and Budget views now show provider-cache hit rate, savings, cost split, and no-cache baselines without exposing prompts, responses, raw headers, or provider keys.
- Cache Session Affinity routing: when a session has recent confirmed provider cache hits on the same node/model, routing can bias toward that target within a safe TTL window and explain the decision in Route Explanation.

## v1.5 Highlights

- Required env fail-fast: legacy `${VAR}` references are now enforced during startup and config reload. `${VAR:-default}` still works for local defaults and CI-safe placeholders, while `${env:VAR}` and external secret backends stay runtime-resolved.
- Runtime-safe reloads: dashboard reload, watcher reload, rollback restore, and `SIGHUP` now reject invalid configs atomically and keep the last known-good config in memory.
- Public error contract hardening: gateway-generated public errors now go through one mapping layer so `message`, `type`, `request_id`, `x-siftgate-request-id`, and protocol-compatible OpenAI / Anthropic / Batch / MCP / Video envelopes stay aligned.

## v1.4 Highlights

| Area | What changed |
| --- | --- |
| Provider Catalog 50+ | Built-in providers now cover foundation models, aggregators, cloud platforms, China providers, self-hosted/local runtimes, media, speech/audio, embedding, and rerank providers. |
| Pricing Source Governance | Routing, benchmarks, config validation, CLI, and Dashboard views share one pricing resolver with source, freshness, confidence, and review-required evidence. |
| Catalog Dashboard UX | Provider Catalog is now a filterable explorer with family/type/modality/compatibility/price-source filters, grouped rows, detail panels, and catalog-backed Add Node search. |
| Compatibility Profiles | Providers and nodes can expose protocol/endpoint/streaming/multipart/async-job strategies, with routing and Route Explanation evidence for supported, downgraded, and unsupported fields. |

## Core Features

| Category | Capabilities |
| --- | --- |
| Protocols | `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/embeddings`, `/v1/rerank`, image/audio endpoints, async video preview, realtime preview, MCP preview, Batch proxy. |
| Routing | Complexity tiers, domain hints, multimodal capability filtering, cost/context optimization, cache-aware routing, reasoning-aware routing, fallback chains, circuit breakers. |
| Explainability | Route Decision Trace, Route Explanation page, candidate filtering reasons, capability evidence, compatibility profile evidence, cache evidence, cost/latency/context tradeoffs. |
| Governance | Local Gateway API keys, namespaces, teams, budgets, rate limits, allowed endpoints/models/nodes/modalities, audit events, config rollback. |
| Provider Ops | Provider Catalog with 50+ built-in providers, Add Node Wizard, provider compatibility profiles and matrix, pricing source governance, catalog override CLI, OpenRouter pricing sync preview. |
| Safety | Secret references, guardrails plugin, metadata-only logs, sanitized route traces, privacy-safe shadow reports, secure defaults for cache/eval storage. |
| Deployment | Single-node memory/SQLite, Docker, Kubernetes manifests, Helm chart, optional Redis/PostgreSQL. |
| Developer UX | TypeScript client scaffold, Python SDK scaffold, Dashboard Playground, session trace view, agent framework examples. |

## After v1.7 Priorities

- Deepen catalog freshness without adding runtime coupling: more safe enrichment adapters are possible, but they must stay cache/override based and preserve operator-reviewed pricing governance.
- Reduce Provider Catalog maintenance cost by continuing toward one catalog source with generated compatibility/API projections and less duplicate provider/model curation.
- Add richer operator workflows around reviewed pricing imports, override authoring, and diff visibility so reference enrichment is easier to adopt safely in production.
- Continue optional Redis semantic-cache backend and future Prompt Registry / Template work without regressing single-node memory/SQLite defaults.

## Configuration

The default path is `gateway.config.yaml`. Start from `gateway.config.example.yaml` and keep real provider keys out of git.

In v1.5, legacy `${VAR}` references are treated as required config inputs: startup and reload fail fast if the variable is missing. Use `${VAR:-default}` when you intentionally want a local default, or `${env:VAR}` / Vault / AWS / GCP references when you want request-time secret resolution.

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
| Adding Providers | [docs/ADDING_PROVIDERS.md](docs/ADDING_PROVIDERS.md) |
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
npm run catalog -- sync zeroeval
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
