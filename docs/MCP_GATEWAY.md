# MCP Tool Gateway Preview

MCP Tool Gateway is an OSS-local preview for the MIT open-source Data Plane.
It proxies locally registered MCP servers through SiftGate so agent/tool traffic
can reuse Gateway API keys, endpoint permissions, Policy Namespace boundaries,
rate limits, and Dashboard metadata visibility.

MCP Tool Gateway is a tool-call proxy and governance surface. It is not model
routing and it does not choose upstream LLM providers.

The Dashboard **Setup state and tool proxy boundary** panel shows whether the
gateway is enabled, which MCP path clients should call, and whether audit is in
metadata-only mode. It also renders a copyable YAML example that combines
`mcp.servers[]`, runtime secret references, `allowed_namespaces`, and Gateway
API key `allowed_endpoints`.

The v2.8 first-run setup path lists MCP Tool Gateway under advanced setup, not
the required model-routing path. A basic gateway only needs a Workspace,
Provider Node, Gateway API Key, Budget review, first request, and evidence
review. Add MCP Tool Gateway when agent/tool clients need governed tool-call
proxying through `/mcp/:serverId`.

It is intentionally local-only. It does not include an enterprise MCP
marketplace, remote workspace registry, SSO/RBAC policy, or SiftGate Cloud
dependency.

Clients always call SiftGate over HTTP at `POST /mcp/:serverId`. SiftGate then
forwards the JSON-RPC request through the server's configured upstream
transport.

## Configuration

```yaml
mcp:
  enabled: true
  path: /mcp
  max_recent_calls: 100
  servers:
    - id: local-docs
      name: "Local Docs MCP"
      url: "http://localhost:8787/mcp"
      transport: http_json_rpc
      timeout_ms: 30000
      max_request_bytes: 1000000
      allowed_namespaces: [team-a]
      headers:
        Authorization: "Bearer ${env:LOCAL_DOCS_MCP_TOKEN}"
      tools:
        - name: search_docs
          description: "Search local product docs"
          input_schema:
            type: object
```

`headers` may use runtime secret references. Resolved values are used only for
the upstream request and are not returned by Dashboard APIs.

MCP servers can use:

- `transport: http_json_rpc` for simple HTTP JSON-RPC POST forwarding.
- `transport: streamable_http` for current MCP Streamable HTTP servers. SiftGate
  forwards the JSON-RPC POST and collects either JSON responses or
  `text/event-stream` JSON-RPC responses.
- `transport: sse` for legacy HTTP+SSE MCP servers. `url` points at the SSE
  endpoint; `message_url` can be set explicitly, or SiftGate waits for the
  upstream `endpoint` SSE event.
- `transport: stdio` for local MCP processes with `command`, optional `args`,
  optional `env`, and optional `cwd`.

```yaml
mcp:
  enabled: true
  servers:
    - id: remote-tools
      name: "Remote Streamable MCP"
      url: "https://mcp.example.com/mcp"
      transport: streamable_http
      tools:
        - name: web_search
          description: "Search the web"
          input_schema:
            type: object
    - id: legacy-tools
      name: "Legacy SSE MCP"
      url: "https://legacy-mcp.example.com/sse"
      transport: sse
      message_url: "https://legacy-mcp.example.com/messages"
      tools:
        - name: search_docs
          description: "Search legacy docs"
          input_schema:
            type: object
    - id: minimax-token-plan
      name: "MiniMax Token Plan MCP"
      description: "MiniMax MCP tools for web search and image understanding"
      transport: stdio
      command: uvx
      args: ["minimax-coding-plan-mcp"]
      timeout_ms: 30000
      max_request_bytes: 1000000
      env:
        MINIMAX_API_KEY: "${env:MINIMAX_TOKEN_PLAN_KEY}"
        MINIMAX_API_HOST: "https://api.minimaxi.com"
      tools:
        - name: web_search
          description: "Search the web through MiniMax Token Plan"
          input_schema:
            type: object
        - name: understand_image
          description: "Analyze image content through MiniMax Token Plan"
          input_schema:
            type: object
```

For stdio servers, SiftGate starts the configured command for the proxied call,
performs the MCP `initialize` handshake when the client request is not already
an initialize request, forwards the JSON-RPC message, and returns the matching
JSON-RPC response. For legacy SSE servers, SiftGate opens the SSE stream,
discovers or uses the configured message endpoint, posts the JSON-RPC request,
and returns the matching SSE JSON-RPC response.

## Proxy Endpoint

Clients call:

```bash
curl http://localhost:2099/mcp/local-docs \
  -H "Authorization: Bearer $SIFTGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The preview forwards JSON-RPC requests or batches over HTTP `POST`.

## Agent Profiles

Agent Gateway Profiles can include `mcp_server_ids` so the Dashboard **Agents**
render panel can show which local MCP servers belong with a Codex, Claude Code,
Cherry Studio, Hermes, OpenClaw, Generic OpenAI, or Generic Anthropic setup.

Those ids are setup metadata only. Runtime MCP authorization still comes from
the Gateway API key and the MCP server config. A rendered agent snippet never
receives stored provider keys, resolved MCP secret headers, Gateway API key
plaintext, tool arguments, or tool results from SiftGate.

## Permissions

Gateway API keys can restrict MCP access with `allowed_endpoints`:

- `mcp`: allow all configured MCP servers.
- `mcp:<serverId>`: allow one MCP server.
- `mcp:<serverId>:<toolName>`: allow one tool call on one MCP server.

For the MiniMax Token Plan example above, use
`mcp:minimax-token-plan:web_search` or
`mcp:minimax-token-plan:understand_image` for tool-level access.

If `mcp.servers[].allowed_namespaces` is set, the Gateway API key must be bound
to one of those Policy Namespaces.

## Agent Demo Checklist

For a Claude Code, Codex, or generic coding-agent demo, pair MCP Tool Gateway
with an Agent Profile:

1. Register the MCP server in `mcp.servers[]`.
2. Create a Gateway API Key with a model endpoint permission such as
   `messages` or `chat_completions`.
3. Add tool-level MCP permissions such as
   `mcp:minimax-token-plan:web_search` and
   `mcp:minimax-token-plan:understand_image`.
4. Attach the MCP server id to the Agent Profile through `mcp_server_ids`.
5. Use the rendered Agent Profile setup for the connector and keep provider
   keys in SiftGate nodes or secret references.
6. Verify the model request in Route Explanation and the MCP call in the
   metadata-only MCP audit buffer.

This demo proves a single client key can cover coding-agent model traffic and
tool access while still applying endpoint, model, node, namespace, budget, and
MCP tool restrictions independently. It also keeps tool arguments, tool
results, media bytes, raw headers, and resolved secret values out of the
Dashboard.

## Privacy

The recent MCP audit buffer stores metadata only:

- server id/name
- JSON-RPC method
- tool name when method is `tools/call`
- API key id/name
- Policy Namespace id
- status code
- latency
- request byte size
- sanitized error type

It does not store tool input, tool output, raw headers, provider keys, resolved
secret values, media bytes, or marketplace metadata.

## Dashboard

The Dashboard MCP Tool Gateway page reads `GET /api/dashboard/mcp` and shows:

- configured MCP servers
- static tool metadata
- recent metadata-only calls
- error summaries

The page is read-only and cannot modify MCP server configuration or apply
routing changes.

## Agent Platform Integration

v2.5 also surfaces MCP servers through the Dashboard Agent Platform preview at
`GET /api/dashboard/agent-platform`. That view links MCP server/tool metadata to
Agent Profiles through `mcp_server_ids` and shows whether the bound Gateway API
key and MCP Policy Namespace policy permit each tool.

The Agent Platform page is still read-only. It does not call tools from the
browser, and it does not store tool arguments or tool results.
