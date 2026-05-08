# Agent Gateway Profiles

SiftGate v1.9.0 adds Agent Gateway Profiles: local, Dashboard-managed connection profiles for agents and chatbot clients. They give tools such as Codex, Claude Code, Cherry Studio, Hermes, OpenClaw, Generic OpenAI-compatible clients, and Generic Anthropic-compatible clients a clear entry point without putting provider keys in the agent runtime.

Profiles are part of the MIT open-source Data Plane. They do not require SiftGate Cloud, enterprise workspace/RBAC, SSO, SCIM, or organization billing.

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
- optional MCP server ids

The profile can render connector-specific setup cards in the Dashboard. Rendered snippets use placeholders and masked key metadata. They never expose stored Gateway API key plaintext, provider API keys, raw auth headers, prompts, responses, MCP tool payloads, media bytes, or video bytes.

## Dashboard Flow

Open the Dashboard and go to **Agents**.

1. Create a profile.
2. Choose a connector: Codex, Claude Code, Cherry Studio, Hermes, OpenClaw, Generic OpenAI, or Generic Anthropic.
3. Select a Dashboard-generated Gateway API key.
4. Optionally select a namespace and MCP servers.
5. Choose Smart router or Direct model.
6. Render the connector config and copy the redacted snippet into the agent or chatbot configuration.

The Dashboard copy intentionally mirrors the product UI:

- Gateway API key is for agents and chatbots.
- Provider API keys stay in Nodes, env vars, or secret references.
- Rendered configs do not expose stored secrets.
- Routing hints are advisory.
- Smart router uses `auto` or a connector-safe virtual model.

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
model=claude-siftgate-auto
```

`claude-siftgate-auto` is not a global model. It is a profile-scoped virtual model. When an active profile is bound to the matching Gateway API key, and that profile exposes `claude-siftgate-auto`, SiftGate maps the request to internal smart routing as `auto`.

The virtual model keeps agent-facing compatibility for Claude-style clients without forcing traffic into a direct Claude model route. SiftGate still applies normal `auto` routing policy and stores metadata such as profile id, connector, virtual model, and requested model in route/call metadata.

Smart routing requires `allow_auto: true` on the Gateway API key. If `allow_auto` is false, requests for `auto` or a profile smart model such as `claude-siftgate-auto` are rejected.

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
| Codex | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |
| Cherry Studio | OpenAI-compatible or Anthropic-compatible | `auto` or `claude-siftgate-auto` | `http://localhost:2099/v1` or `http://localhost:2099` |
| Hermes | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |
| OpenClaw | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |
| Generic OpenAI | OpenAI-compatible | `auto` | `http://localhost:2099/v1` |
| Claude Code | Anthropic/Claude-style | `claude-siftgate-auto` | `http://localhost:2099` |
| Generic Anthropic | Anthropic/Claude-style | `claude-siftgate-auto` | `http://localhost:2099` |

If a connector requires a `/v1` Anthropic base URL in your local version, use the rendered Dashboard card. The profile stores `base_url_mode` so the Dashboard can render the connector-safe form.

## Codex

Use an OpenAI-compatible config:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
OPENAI_MODEL=auto
```

Codex traffic can use Smart router with `auto` when the Gateway API key allows `allow_auto`.

## Claude Code

Use the Claude-style rendered profile:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
ANTHROPIC_MODEL=claude-siftgate-auto
```

`claude-siftgate-auto` is profile-scoped. It maps to internal `auto` routing only for the matching active Agent Profile and Gateway API key.

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
OPENAI_MODEL=auto
```

For code:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:2099/v1",
  apiKey: process.env.SIFTGATE_GATEWAY_API_KEY,
});

const response = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello from SiftGate." }],
});
```

## Generic Anthropic

Anthropic/Claude-style clients should use a profile-scoped smart model:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
ANTHROPIC_MODEL=claude-siftgate-auto
```

SiftGate maps the profile virtual model to internal `auto` routing. This is different from direct routing to a Claude model id.

## MCP Access

Agent Profiles can record MCP server ids for rendered setup context, but MCP enforcement remains on the Gateway API key and MCP server configuration.

Gateway API keys can scope MCP access through `allowed_endpoints`:

- `mcp`: allow all configured MCP servers.
- `mcp:<serverId>`: allow one MCP server.
- `mcp:<serverId>:<toolName>`: allow one tool call on one MCP server.

If an MCP server declares `allowed_namespaces`, the Gateway API key must be bound to one of those namespaces.

MCP Gateway audit metadata does not store tool arguments or tool results. See [MCP Gateway](MCP_GATEWAY.md).

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

Render responses include connector label, base URL, default/smart model ids, masked Gateway API key metadata, redaction status, routing hint metadata, MCP server ids, and one or more setup cards. They do not include stored secret plaintext.

## Privacy Boundary

By default, Agent Gateway Profiles do not store prompts, responses, raw auth headers, provider keys, Gateway API key plaintext, MCP tool payloads, media bytes, or video bytes.

They store local operational metadata needed to make agent setup repeatable and policy-safe. The data plane remains local-first in SQLite by default, with PostgreSQL optional.
