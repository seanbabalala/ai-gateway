# Quickstart

This guide starts the open-source SiftGate Data Plane on one machine with memory state and SQLite.

## 1. Install

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
```

## 2. Configure

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
```

SiftGate loads `.env` automatically for local startup. Edit `gateway.config.yaml`
and add or verify one upstream node. Prefer runtime secret references such as
`${env:OPENAI_API_KEY}` instead of committing secrets. Legacy
`${OPENAI_API_KEY}` startup interpolation still works, but it is required at
startup and reload time; use `${OPENAI_API_KEY:-dummy}` only when you
intentionally want a fallback value.

## 3. Build And Run

```bash
npm run build
npm start
```

Open:

- Dashboard: `http://localhost:2099/dashboard`
- API docs: `http://localhost:2099/docs`
- Health: `http://localhost:2099/health`

## 4. Finish The First-Run Path

The v2.8 Dashboard opens with a first-run setup path:

1. Confirm or create the active Workspace.
2. Add or verify one Provider Node.
3. Create a Gateway API Key for client apps.
4. Optionally add a Policy Namespace when keys or Teams need shared node, model, budget, or rate-limit policy.
5. Review daily Budget scopes for Global, Policy Namespace, Team, and API Key.
6. Send a first request from Playground or an OpenAI-compatible client.
7. Open logs, route evidence, and cost metadata.
8. Explore advanced setup for Semantic Controls, Traffic Experiments, Eval Reports, Shadow Traffic, and MCP Tool Gateway only when you need those features.

Policy Namespace and advanced setup are optional. The required path is
Workspace, Provider Node, Gateway API Key, Budget review, first request, and
evidence review.

This checklist is metadata-only. It does not store prompts, responses, raw
headers, provider keys, media bytes, tool payloads, hidden reasoning, or
resolved secrets.

## 5. Send A Request

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Say hello from SiftGate."}]
  }'
```

## 6. Validate Before Production

```bash
npm run validate:config
npm run docs:check
npm test -- --runInBand
```

Next reads:

- [Production](PRODUCTION.md)
- [Provider Catalog](PROVIDER_CATALOG.md)
- [OSS Concepts](OSS_CONCEPTS.md)
- [Dashboard](DASHBOARD.md)
- [Policy Namespaces And Shadow Traffic](NAMESPACES_AND_SHADOW.md)
- [MCP Tool Gateway](MCP_GATEWAY.md)
- [Security](SECURITY.md)
