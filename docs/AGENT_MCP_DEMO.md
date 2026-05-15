# Agent + MCP Demo

This demo shows one governed path for coding-agent model traffic and MCP tool
traffic. The same SiftGate Gateway API key can call an agent model endpoint and
specific MiniMax Token Plan MCP tools while provider keys and MCP secrets stay
server-side.

![SiftGate Agent and MCP demo](assets/demo/agent-mcp-demo.svg)

## What The Demo Proves

| Evidence | Expected Result |
| --- | --- |
| Agent Profile | Connector is Codex or Claude Code, smart model is `coding-auto`, and `mcp_server_ids` includes `minimax-token-plan`. |
| Gateway API Key | Key allows `chat_completions` or `messages` plus only the required MCP tools. |
| Model request | Route Explanation shows selected node/model, policy context, fallback state, cost/latency metadata, and compatibility evidence. |
| MCP tool request | MCP Tool Gateway shows metadata-only rows for `web_search` and `understand_image`. |
| Privacy boundary | Dashboard does not expose provider keys, resolved MCP headers, prompts, responses, image bytes, tool arguments, or tool results. |

## Minimal Config Shape

```yaml
mcp:
  enabled: true
  servers:
    - id: minimax-token-plan
      name: "MiniMax Token Plan MCP"
      transport: stdio
      command: uvx
      args: ["minimax-coding-plan-mcp"]
      env:
        MINIMAX_API_KEY: "${env:MINIMAX_TOKEN_PLAN_KEY}"
        MINIMAX_API_HOST: "https://api.minimaxi.com"
      tools:
        - name: web_search
        - name: understand_image
```

Gateway API key endpoint policy:

```yaml
allowed_endpoints:
  - chat_completions
  - mcp:minimax-token-plan:web_search
  - mcp:minimax-token-plan:understand_image
allow_auto: true
allow_direct: false
```

Agent Profile shape:

```yaml
connector: codex
smart_model_id: coding-auto
mcp_server_ids:
  - minimax-token-plan
```

## Demo Flow

1. Start SiftGate and open the Dashboard.
2. Create or select one Provider Node for model traffic.
3. Create a Gateway API Key with the model endpoint and tool-level MCP
   permissions above.
4. Create a Codex or Claude Code Agent Profile, choose `coding-auto`, and
   attach `minimax-token-plan`.
5. Send one model request through the agent.
6. Send a `tools/call` request for `web_search`, then another for
   `understand_image`, through `POST /mcp/minimax-token-plan`.
7. Inspect Route Explanation, Logs/Sessions, Agent Platform, and MCP Tool
   Gateway.

## Tool Call Smoke Examples

```bash
curl http://localhost:2099/mcp/minimax-token-plan \
  -H "Authorization: Bearer ${SIFTGATE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "web_search",
      "arguments": { "query": "SiftGate provider smoke matrix" }
    }
  }'
```

```bash
curl http://localhost:2099/mcp/minimax-token-plan \
  -H "Authorization: Bearer ${SIFTGATE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "understand_image",
      "arguments": { "image_url": "https://example.com/demo.png" }
    }
  }'
```

The recent MCP audit buffer should show server id, method, tool name, API key
metadata, namespace metadata when present, status, latency, request byte size,
and sanitized error type. It should not store the tool arguments or tool
results.

## Screenshot Boundary

The SVG asset in this doc is a product-style demo screenshot storyboard. It is
safe for the README because it uses placeholders and metadata-only examples.
When adding real Dashboard screenshots later, mask Gateway API keys, provider
keys, provider account ids, image payloads, prompts, responses, and local file
paths before committing.
