# Agent Platform Preview

SiftGate v2.5.0 adds a metadata-first Agent Platform preview on top of the
existing Coding Agent Gateway and MCP Tool Gateway foundations. The goal is to help
operators see agent registry, tool access, workflow shape, memory metadata, and
trace spans in one workspace-scoped control plane without turning SiftGate into
a full app builder.

## Scope

- **A2A hub v1**: workspace-scoped Agent Profiles are exposed as the local agent
  registry. Route policy still comes from the bound Gateway API key, workspace,
  namespace, model, endpoint, budget, and routing configuration.
- **Tool Registry v1**: MCP Tool Gateway servers and static tool metadata are
  summarized by `GET /api/dashboard/agent-platform`. Tool permission evidence is
  derived from profile `mcp_server_ids`, Gateway API key `allowed_endpoints`,
  MCP server `allowed_namespaces`, and profile/key status.
- **Workflow preview**: SiftGate emits preview-only ordered metadata for a
  North Star Engineering PR Review flow. `runtime_enabled` is always `false` in
  v2.5.0; SiftGate does not run a general workflow engine.
- **Conversation Memory Gateway preview**: SiftGate reports observed session,
  turn, repo, and project metadata from agent traces. Content storage is
  disabled by default and requires future explicit opt-in plus redaction and
  retention controls.
- **Agent trace spans**: recent coding-agent call logs are summarized as spans
  with connector, profile, session, turn, repo/project label, route decision id,
  fallback/retry, tokens, cost, latency, and status.

## Dashboard API

```http
GET /api/dashboard/agent-platform
Authorization: Bearer <dashboard_jwt>
```

The endpoint is read-only and requires the Dashboard `viewer` role or higher.
It returns:

- `a2a_hub.agents[]`
- `tool_registry.servers[].tools[]`
- `workflow_preview.workflows[]`
- `memory_gateway`
- `traces.spans[]`
- `privacy`
- `totals`

The response is metadata-only. It does not execute tools, modify MCP server
configuration, create workflows, replay agent calls, or store conversation
content.

## Privacy Boundary

SiftGate does not store prompts, responses, source code, diffs, tool inputs,
tool outputs, raw provider headers, provider keys, Gateway API key plaintext,
media bytes, hidden reasoning text, or resolved secrets by default.

The Agent Platform preview only reads existing metadata surfaces:

- Agent Profiles
- Gateway API key summaries
- MCP server registry metadata
- MCP metadata-only audit summaries
- call-log agent span metadata

Runtime MCP tool calls continue to use `POST /mcp/:serverId`, `ApiKeyGuard`,
`RateLimitGuard`, Gateway API key endpoint permissions, and MCP namespace
allow-lists. The Dashboard Agent Platform page cannot call tools from the
browser.

## Non-Goals

v2.5.0 does not add:

- a LangGraph/Dify-style workflow builder,
- a general-purpose DAG runtime,
- a hosted marketplace,
- automatic tool execution,
- default prompt/response/tool payload storage,
- a cloud dependency,
- bypasses around Gateway API key or workspace policy.

## Suggested Demo

Use one workspace with three active Coding Agent Gateway profiles:

1. `coding-auto` profile for implementation suggestions.
2. `coding-security` profile for security review.
3. `coding-deep` profile for final summary and reasoning-heavy checks.

Attach one MCP server, such as `local-docs`, to the profiles through
`mcp_server_ids`, and restrict the Gateway API key with
`allowed_endpoints: ["mcp:local-docs:search_docs"]`.

The Agent Platform page then shows:

- the A2A registry rows,
- tool permission evidence,
- preview-only PR review workflow metadata,
- memory metadata counts,
- recent trace spans and route decision ids,
- the privacy contract.
