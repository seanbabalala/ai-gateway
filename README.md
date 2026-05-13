<p align="center">
  <img src="docs/assets/brand/siftgate-logo.svg" alt="SiftGate" width="420" />
</p>

<h3 align="center">Self-hosted AI traffic infrastructure for teams, agents, and multi-provider apps.</h3>

<p align="center">
  <a href="https://github.com/seanbabalala/ai-gateway/releases"><img alt="Release" src="https://img.shields.io/github/v/release/seanbabalala/ai-gateway?label=release"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-062f25"></a>
  <a href="docs/SECURITY.md"><img alt="Privacy default" src="https://img.shields.io/badge/privacy-metadata--only%20by%20default-22d7a8"></a>
  <a href="docs/README.md"><img alt="Docs" src="https://img.shields.io/badge/docs-7%20languages-062f25"></a>
</p>

<p align="center">
  <a href="docs/i18n/en/README.md">English</a>
  · <a href="docs/i18n/zh/README.md">简体中文</a>
  · <a href="docs/i18n/zh-TW/README.md">繁體中文</a>
  · <a href="docs/i18n/ja/README.md">日本語</a>
  · <a href="docs/i18n/ko/README.md">한국어</a>
  · <a href="docs/i18n/th/README.md">ไทย</a>
  · <a href="docs/i18n/es/README.md">Español</a>
</p>

# SiftGate

Current release: **v2.8.3**.

SiftGate is an MIT open-source gateway that sits between your applications,
agents, and upstream AI providers. It gives teams one governed ingress for
OpenAI-compatible, Anthropic-compatible, Batch, Realtime preview, media, and MCP
tool traffic while keeping runtime policy and sensitive data inside the
self-hosted environment by default.

## Why Teams Use It

- **One ingress for many providers:** route Chat Completions, Responses,
  Messages, Embeddings, Rerank, Images, Audio, Video preview, Batch, Realtime
  preview, and MCP Tool Gateway traffic through one local service.
- **Explainable routing:** inspect why a node or model was selected, filtered,
  retried, or skipped without storing prompt or response bodies by default.
- **Local governance:** manage Workspaces, Gateway API keys, Policy Namespaces,
  teams, budgets, rate limits, allowed endpoints, allowed modalities, allowed
  nodes, and allowed models.
- **Provider setup without guesswork:** use Provider Catalog, Add Node Wizard,
  transport-only visibility, provider health, pricing source status, and config
  validation from one product surface.
- **Agent-ready operations:** generate safe connector profiles for Cursor, Cline,
  Roo Code, Continue, Codex, Claude Code, OpenCode, Cherry Studio, Hermes,
  OpenClaw, and OpenAI/Anthropic-compatible clients.
- **Production path when you need it:** start with memory state and SQLite, then
  opt into Redis, PostgreSQL, Docker, Kubernetes, Helm, OIDC, log sinks, and
  secret references.

## What It Is Not

SiftGate is not an API resale platform, billing wallet, hosted prompt store,
workflow engine, or mandatory SaaS control plane. Provider keys stay in your
local config, environment variables, or secret references. Prompts, responses,
raw provider headers, provider keys, tool payloads, media bytes, hidden
reasoning, and resolved secrets are not stored by default.

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

SiftGate loads `.env` automatically for local startup. The example provider
nodes use runtime secret references such as `${env:OPENAI_API_KEY}`, so the
Dashboard can start before provider keys are filled in.

Open:

- Dashboard: `http://localhost:2099/dashboard`
- OpenAPI: `http://localhost:2099/docs`
- Gateway: `http://localhost:2099`

Add or verify one upstream node in `gateway.config.yaml`, create a
Dashboard-managed Gateway API key, then send a request:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Explain SiftGate in one sentence."}]
  }'
```

For a container-first path, use [Docker Quickstart](docs/DOCKER_QUICKSTART.md).

## First-Run Checklist

The Dashboard starts with the shortest supported OSS path:

1. Confirm or create the active Workspace.
2. Add one Provider Node.
3. Create a Gateway API Key for your client app or agent.
4. Optionally bind the key to a Policy Namespace.
5. Review daily Budget scope and source of truth.
6. Send a first request from Playground or an SDK.
7. Inspect Logs and Route Explanation evidence.
8. Configure Semantic Controls, Traffic Experiments, Evals, Shadow Traffic, or
   MCP Tool Gateway only when you need those advanced surfaces.

## Core Concepts

| Concept | What it means |
| --- | --- |
| Workspace | Local operational boundary for Dashboard metadata, members, logs, keys, budgets, and audit events. |
| Provider Node | A configured upstream account, deployment, proxy, or local model endpoint. |
| Provider | Catalog metadata that helps users configure nodes. Active catalog rows are separate from transport-only presets. |
| Gateway API Key | Client-facing key generated by SiftGate. It is different from provider API keys. |
| Policy Namespace | Config-backed local policy label for allowed nodes/models, budgets, rate limits, API keys, teams, MCP allow-lists, and filters. |
| Team | Local grouping for shared policy, budget, and usage attribution inside a Workspace. |
| Budget Scope | Global, Policy Namespace, Team, or API Key daily limits with inherited or direct source-of-truth state. |
| MCP Tool Gateway | Tool-call governance and proxying for MCP servers. It is not model routing. |

Read the full glossary in [OSS Concepts](docs/OSS_CONCEPTS.md).

## Architecture

```text
Apps, agents, SDKs
        |
        v
SiftGate gateway and Dashboard
        |
        +-- policy, routing, budgets, audit, logs, route evidence
        |
        v
Configured upstream providers, proxies, and local runtimes
```

Default local storage uses memory state and SQLite. PostgreSQL, Redis, secret
managers, log sinks, Kubernetes, Helm, and external control-plane integrations
are optional.

## Documentation

Start here:

- [Documentation Home](docs/README.md)
- [Quickstart](docs/QUICKSTART.md)
- [Docker Quickstart](docs/DOCKER_QUICKSTART.md)
- [Dashboard Guide](docs/DASHBOARD.md)
- [Provider Catalog](docs/PROVIDER_CATALOG.md)
- [OSS Concepts](docs/OSS_CONCEPTS.md)
- [API Reference](docs/API_REFERENCE.md)
- [Production Guide](docs/PRODUCTION.md)
- [Security](docs/SECURITY.md)

Localized documentation entrypoints:

| Language | Link |
| --- | --- |
| English | [docs/i18n/en/README.md](docs/i18n/en/README.md) |
| 简体中文 | [docs/i18n/zh/README.md](docs/i18n/zh/README.md) |
| 繁體中文 | [docs/i18n/zh-TW/README.md](docs/i18n/zh-TW/README.md) |
| 日本語 | [docs/i18n/ja/README.md](docs/i18n/ja/README.md) |
| 한국어 | [docs/i18n/ko/README.md](docs/i18n/ko/README.md) |
| ไทย | [docs/i18n/th/README.md](docs/i18n/th/README.md) |
| Español | [docs/i18n/es/README.md](docs/i18n/es/README.md) |

## Public Repository Hygiene

The public repository tracks source, examples, docs, tests, and deployment
manifests only. It intentionally ignores local runtime config, local databases,
catalog sync cache, local agent notes, and private development prompts.

Before opening a PR, run:

```bash
npm run docs:check
npm run build
cd frontend && npm test && npm run build
```

Release branches should also run the broader test matrix listed in
[Release Checklist](docs/RELEASE_CHECKLIST.md).

## Community

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- License: [MIT](LICENSE)
