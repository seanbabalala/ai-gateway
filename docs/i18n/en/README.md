# SiftGate Documentation

[Documentation home](../../README.md) · [Project README](../../../README.md)

Current release: **v2.11.3**.

SiftGate is the self-hosted AI traffic data plane for teams that have outgrown
direct provider keys, one-off proxy configs, and opaque model routing. It gives
operators one local control point for apps, coding agents, MCP tools, provider
credentials, routing policy, budgets, cache evidence, and production
operations.

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## What Is New In The Product Story

| SiftGate strength | Why it matters |
| --- | --- |
| AI traffic data plane | Policy, routing, credential selection, budgets, cost, cache, audit, and evidence run in one self-hosted request path. |
| Agent and MCP governance | Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, generic OpenAI/Anthropic agents, and MCP tools can share one governed ingress. |
| Cache-aware credential pools | Multiple upstream provider keys can live inside one node with `cache_aware`, least-in-flight, weighted rotation, sticky affinity, cooldown, and retry failover. |
| Route explanation | Operators can inspect why SiftGate selected, skipped, retried, downgraded, or rejected a model/provider without storing prompt or response bodies by default. |
| Metadata-only default | SiftGate does not store prompts, responses, raw headers, provider keys, tool payloads, media, source, diffs, hidden reasoning, or resolved secrets by default. |
| Production path | Start with SQLite and memory state, then move to PostgreSQL, optional Redis, Docker, Kubernetes, Helm, OIDC, secret references, log sinks, and OpenTelemetry. |

## 30-Second Pitch

Most gateways stop at "route this request to a model." SiftGate turns AI
traffic into a governed, explainable control loop:

1. Authenticate a Gateway API key and resolve workspace/team/namespace policy.
2. Check endpoint, modality, model, node, budget, and rate-limit permissions.
3. Route by compatibility, cost, latency, health, cache evidence, and fallback rules.
4. Select the right upstream provider credential, including cache-aware affinity.
5. Return a provider-compatible response and store export-safe operational evidence.

## Provider Credential Pools

Provider nodes can use one `api_key` or a first-class `credentials[]` pool.
Pools rotate and retry upstream keys inside the same logical node before
node-level fallback runs.

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

Use `cache_aware` when coding-plan or agent workloads have several upstream
keys for the same provider account/model surface. SiftGate keeps cache-creating
or cache-reading traffic on the same provider key when it can, and still moves
away from keys that return 429/5xx/timeouts.

## Competitive Positioning

SiftGate is not only a cheap model router and not only an API resale panel. It
is a self-hosted AI traffic data plane for BYOK governance, route evidence,
agent/MCP control, cache-aware key pooling, and production operations.

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

See [Comparison](../../COMPARISON.md) for the detailed public positioning.

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

Open `http://localhost:2099/dashboard`, add one Provider Node, create a Gateway
API Key, then send a request to `http://localhost:2099/v1/chat/completions`.

## First-Run Path

1. Confirm or create the active Workspace.
2. Add one Provider Node.
3. Create a Dashboard-managed Gateway API Key.
4. Optionally bind the key to a Policy Namespace or Team.
5. Review the daily Budget scope and source of truth.
6. Send a first request from Playground, SDK, or an OpenAI-compatible client.
7. Inspect Logs, Sessions, and Route Explanation.
8. Configure Semantic Controls, Traffic Experiments, Evals, Shadow Traffic, or MCP Tool Gateway only when needed.

## Docs Map

| Area | Entry points |
| --- | --- |
| Local evaluation | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md) |
| Containers and production | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md) |
| Providers and models | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md) |
| Routing and governance | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md) |
| Agent and tool traffic | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| Advanced controls | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md) |
| Development | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
