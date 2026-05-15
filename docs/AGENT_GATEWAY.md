# Agent Gateway Profiles

SiftGate v2.1.0 upgrades Agent Gateway Profiles into workspace-scoped Coding
Agent Gateway profiles. The Dashboard can now render governed setup snippets
for Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, Generic
OpenAI-compatible coding agents, and Generic Anthropic-compatible coding agents.
Cherry Studio, Hermes, and OpenClaw remain supported as local agent/chatbot
connectors for compatibility.

For the v2.1 coding-agent walkthrough, safe headers, and North Star demo, see
[Coding Agent Gateway](CODING_AGENT_GATEWAY.md).

For a focused Codex/Claude Code + MiniMax MCP demo path and screenshot
storyboard, see [Agent + MCP Demo](AGENT_MCP_DEMO.md).

Profiles are part of the MIT open-source Data Plane. They use the OSS
workspace/RBAC boundary when enabled and do not require SiftGate Cloud, the
enterprise app, SSO, SCIM, or organization billing.

## What A Profile Does

An Agent Profile stores local metadata for one client connector:

- connector type
- profile name and status
- optional Gateway API key binding
- optional namespace binding
- default model
- smart model id
- base URL mode
- advisory routing hint JSON
- coding virtual model aliases
- optional MCP server ids

The profile can render connector-specific setup cards in the Dashboard. Rendered snippets use placeholders and masked key metadata. They never expose stored Gateway API key plaintext, provider API keys, raw auth headers, prompts, responses, MCP tool payloads, media bytes, or video bytes.

## Dashboard Flow

Open the Dashboard and go to **Agents**.

1. Create a profile.
2. Choose a connector: Cursor, Cline, Roo Code, Continue, Codex, Claude Code,
   OpenCode, Generic OpenAI, Generic Anthropic, Cherry Studio, Hermes, or
   OpenClaw.
3. Select a Dashboard-generated Gateway API key.
4. Optionally select a namespace and MCP servers.
5. Choose Smart router or Direct model.
6. Render the connector config and copy the redacted snippet into the agent or chatbot configuration.

The Dashboard copy intentionally mirrors the product UI:

- Gateway API key is for agents and chatbots.
- Provider API keys stay in Nodes, env vars, or secret references.
- Rendered configs do not expose stored secrets.
- Routing hints are advisory.
- Smart router uses `auto`, `claude-siftgate-auto`, or a coding-agent alias
  such as `coding-auto`.

## Required Gateway API Key

Agents and chatbots should use only a SiftGate Gateway API key:

```text
Authorization: Bearer <SIFTGATE_GATEWAY_API_KEY>
```

Provider API keys stay on SiftGate nodes, environment variables, or configured secret references. They are used only when SiftGate calls upstream providers.

Gateway API key policies still apply to Agent Profile traffic:

- `allow_auto` controls smart routing.
- `allow_direct` controls explicit direct model routing.
- namespace binding and namespace limits
- local team policy, when present
- daily token and cost budgets
- rate limits
- allowed endpoints
- allowed models
- allowed nodes
- allowed modalities

Routing hints in a profile or request are advisory. They never bypass policy, circuit breakers, budget checks, namespace boundaries, model capability filters, or fallback rules.

## Smart Routing And Direct Routing

Use Smart router when the agent should let SiftGate choose the upstream node/model:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
model=auto
```

For Anthropic/Claude-style clients:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
model=coding-auto
```

`claude-siftgate-auto` and the v2.1 coding aliases are not global provider
models. They are profile-scoped virtual models. When an active profile is bound
to the matching Gateway API key, SiftGate maps the request to internal smart
routing as `auto`.

The virtual model keeps agent-facing compatibility without forcing traffic into
a direct provider model route. SiftGate still applies normal `auto` routing
policy and stores metadata such as profile id, connector, virtual model,
requested model, optional coding-agent session id, optional turn id, optional
repo/project tags, cost, latency, and fallback state in route/call metadata.

Smart routing requires `allow_auto: true` on the Gateway API key. If
`allow_auto` is false, requests for `auto`, `coding-auto`,
`coding-fast`, `coding-deep`, `coding-security`, or a legacy profile smart
model such as `claude-siftgate-auto` are rejected.

Direct model routing sends an explicit model id:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
SIFTGATE_MODEL=gpt-4o
```

Direct routing requires `allow_direct: true` on the Gateway API key, and the requested model must pass allowed model/node/namespace/policy checks.

## Connector Matrix

| Connector | Protocol style | Recommended smart model | Base URL |
| --- | --- | --- | --- |
| Cursor | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Cline | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Roo Code | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Continue | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Codex | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Claude Code | Anthropic/Claude-style | `coding-auto` | `http://localhost:2099` |
| OpenCode | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Generic OpenAI | OpenAI-compatible | `coding-auto` | `http://localhost:2099/v1` |
| Generic Anthropic | Anthropic/Claude-style | `coding-auto` | `http://localhost:2099` |
| Cherry Studio | OpenAI-compatible or Anthropic-compatible | `auto` or `claude-siftgate-auto` | `http://localhost:2099/v1` or `http://localhost:2099` |
| Hermes | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |
| OpenClaw | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |

If a connector requires a `/v1` Anthropic base URL in your local version, use the rendered Dashboard card. The profile stores `base_url_mode` so the Dashboard can render the connector-safe form.

## Codex

Use an OpenAI-compatible config:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=coding-auto
```

Codex traffic can use Smart router with `auto` when the Gateway API key allows `allow_auto`.

## Cursor

Use the Dashboard-rendered Cursor card or an OpenAI-compatible config:

```json
{
  "openAIBaseUrl": "http://localhost:2099/v1",
  "openAIKey": "<SIFTGATE_GATEWAY_API_KEY>",
  "model": "coding-auto"
}
```

Use `coding-fast`, `coding-deep`, or `coding-security` when the workflow wants
a stronger latency, depth, or security-audit hint.

## Cline

Select OpenAI Compatible in Cline and point it at SiftGate:

```json
{
  "apiProvider": "openai-compatible",
  "baseUrl": "http://localhost:2099/v1",
  "apiKey": "<SIFTGATE_GATEWAY_API_KEY>",
  "modelId": "coding-auto"
}
```

Compatible clients may add SiftGate agent headers for session, turn, repo, and
project labels. SiftGate stores those labels as metadata only.

## Roo Code

Select OpenAI Compatible in Roo Code:

```json
{
  "provider": "openai-compatible",
  "baseUrl": "http://localhost:2099/v1",
  "apiKey": "<SIFTGATE_GATEWAY_API_KEY>",
  "model": "coding-auto"
}
```

Provider keys stay server-side in SiftGate nodes or secret references.

## Continue

Use the rendered Continue model config:

```json
{
  "models": [
    {
      "provider": "openai",
      "model": "coding-auto",
      "title": "SiftGate Coding Agent",
      "apiBase": "http://localhost:2099/v1",
      "apiKey": "<SIFTGATE_GATEWAY_API_KEY>"
    }
  ]
}
```

## OpenCode

Use an OpenAI-compatible OpenCode provider pointed at SiftGate:

```json
{
  "provider": {
    "siftgate": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "SiftGate",
      "options": {
        "baseURL": "http://localhost:2099/v1",
        "apiKey": "<SIFTGATE_GATEWAY_API_KEY>"
      },
      "models": {
        "coding-auto": {
          "name": "coding-auto"
        }
      }
    }
  }
}
```

## Claude Code

Use the Claude-style rendered profile:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
ANTHROPIC_MODEL=coding-auto
```

`coding-auto` is profile-scoped. It maps to internal `auto` routing only for
the matching active Agent Profile and Gateway API key.

Do not configure Claude Code with a provider Anthropic API key when using SiftGate. Use a SiftGate Gateway API key. The upstream Anthropic key, if any, belongs in the SiftGate node config or secret reference.

## Cherry Studio

Cherry Studio can usually be configured as OpenAI Compatible:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=auto
```

If using an Anthropic-compatible provider mode in Cherry Studio, use:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
ANTHROPIC_MODEL=claude-siftgate-auto
```

Use the Dashboard **Agents** render panel for the exact card that matches your Cherry Studio provider mode.

## Hermes

Use OpenAI-compatible settings:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=auto
```

Hermes can also use direct model routing if the Gateway API key allows `allow_direct` and the requested model is permitted.

## OpenClaw

Use OpenAI-compatible settings:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=auto
```

Keep provider keys out of OpenClaw when the traffic goes through SiftGate.

## Generic OpenAI

Any OpenAI-compatible client can use:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=coding-auto
```

For code:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:2099/v1",
  apiKey: process.env.SIFTGATE_GATEWAY_API_KEY,
});

const response = await client.chat.completions.create({
  model: "coding-auto",
  messages: [{ role: "user", content: "Hello from SiftGate." }],
});
```

## Generic Anthropic

Anthropic/Claude-style clients should use a profile-scoped smart model:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
ANTHROPIC_MODEL=coding-auto
```

SiftGate maps the profile virtual model to internal `auto` routing. This is different from direct routing to a Claude model id.

## MCP Access

Agent Profiles can record MCP server ids for rendered setup context, but MCP enforcement remains on the Gateway API key and MCP server configuration.

Gateway API keys can scope MCP access through `allowed_endpoints`:

- `mcp`: allow all configured MCP servers.
- `mcp:<serverId>`: allow one MCP server.
- `mcp:<serverId>:<toolName>`: allow one tool call on one MCP server.

If an MCP server declares `allowed_namespaces`, the Gateway API key must be bound to one of those Policy Namespaces.

MCP Tool Gateway audit metadata does not store tool arguments or tool results. See [MCP Tool Gateway](MCP_GATEWAY.md).

## Agent + MCP Demo Path

Use this path to demonstrate the difference between SiftGate and a plain model
proxy: the same Gateway API key governs the coding-agent model request and the
MCP tool calls.

1. Configure an MCP server such as `minimax-token-plan` in
   `gateway.config.yaml` with tools like `web_search` and `understand_image`.
2. Create a Gateway API Key for the agent and allow the model endpoint it uses:
   `chat_completions` for OpenAI-compatible clients or `messages` for
   Claude-style clients.
3. Add only the MCP permissions the demo needs, for example
   `mcp:minimax-token-plan:web_search` and
   `mcp:minimax-token-plan:understand_image`.
4. Create an Agent Profile for Codex, Claude Code, or another connector, bind
   the same Gateway API Key, choose `coding-auto`, and attach
   `mcp_server_ids: ["minimax-token-plan"]`.
5. Send one normal agent model request, then one MCP `tools/call` request
   through `POST /mcp/minimax-token-plan`.
6. Open Dashboard logs, Sessions, Agent Platform, and MCP Tool Gateway views.

The expected evidence is model route metadata for the agent request plus
metadata-only MCP audit rows for the tool calls. The Dashboard should show the
profile, connector, API key attribution, selected node/model, policy context,
MCP server id, MCP tool name, status, latency, and sanitized error type when a
tool fails. It should not expose provider keys, resolved MCP headers, prompts,
responses, image bytes, tool arguments, or tool results.

## Dashboard API

The local Dashboard API exposes Agent Profiles:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/agent-profiles` | List local Agent Gateway profiles |
| `POST` | `/api/dashboard/agent-profiles` | Create a profile |
| `PUT` | `/api/dashboard/agent-profiles/:id` | Update a profile |
| `DELETE` | `/api/dashboard/agent-profiles/:id` | Delete a profile |
| `POST` | `/api/dashboard/agent-profiles/:id/render` | Render redacted connector setup cards |

Create/update fields include `name`, `description`, `connector`, `status`, `api_key_id`, `namespace_id`, `default_model`, `smart_model_id`, `base_url_mode`, `routing_hint`, `mcp_server_ids`, and `metadata`.

Render responses include connector label, base URL, default/smart model ids,
coding virtual model aliases, masked Gateway API key metadata, redaction status,
routing hint metadata, MCP server ids, and one or more setup cards. They do not
include stored secret plaintext.

## Privacy Boundary

By default, Agent Gateway Profiles do not store prompts, responses, source
code, diffs, raw auth headers, raw repository content, provider keys, Gateway
API key plaintext, MCP tool payloads, media bytes, or video bytes.

They store local operational metadata needed to make agent setup repeatable and policy-safe. The data plane remains local-first in SQLite by default, with PostgreSQL optional.
