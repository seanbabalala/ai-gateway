# Agent Framework Integrations

SiftGate can sit between agent frameworks and upstream model providers as an OpenAI-compatible or Anthropic-compatible gateway. The framework keeps its normal client shape, while SiftGate handles local Gateway API key auth, namespace policy, routing, fallback, budgets, logs, route explanations, and cost evidence.

The runnable examples live in [examples/agents](../examples/agents).

For v1.9 Dashboard-managed connector profiles, see [Agent Gateway Profiles](AGENT_GATEWAY.md).

## Agent Gateway Profiles

Agent Gateway Profiles are the first-class Dashboard entry for agents and chatbot clients. The **Agents** page can render redacted setup cards for:

- Codex
- Claude Code
- Cherry Studio
- Hermes
- OpenClaw
- Generic OpenAI
- Generic Anthropic

OpenAI-compatible clients should use:

```env
OPENAI_BASE_URL=http://localhost:2099/v1
OPENAI_API_KEY=<SIFTGATE_GATEWAY_API_KEY>
model=auto
```

Anthropic/Claude-style clients should use:

```env
ANTHROPIC_BASE_URL=http://localhost:2099
ANTHROPIC_AUTH_TOKEN=<SIFTGATE_GATEWAY_API_KEY>
model=claude-siftgate-auto
```

`claude-siftgate-auto` is profile-scoped. It is exposed only for the matching active Agent Profile and Gateway API key, and it maps to internal smart routing as `auto` rather than direct Claude model routing. Smart routing requires `allow_auto`; direct model routing requires `allow_direct`.

Agent and chatbot configs should use Gateway API keys only. Provider API keys stay in Nodes, env vars, or secret references. Rendered configs use placeholders or masked metadata and never expose stored secrets.

## Supported Examples

| Example | File | What it shows |
| --- | --- | --- |
| OpenAI Python SDK | `examples/agents/openai_sdk_base_url.py` | `OpenAI(base_url=..., api_key=..., default_headers=...)` pointed at SiftGate |
| LangChain | `examples/agents/langchain_chat.py` | `ChatOpenAI` with custom `base_url`, SiftGate headers, and `with_structured_output(..., method="json_schema")` |
| CrewAI | `examples/agents/crewai_researcher.py` | `crewai.LLM` with `base_url`, Gateway API key, `extra_headers`, and a Pydantic task output |
| OpenAI Agents SDK | `examples/agents/openai_agents_sdk.py` | `OpenAIChatCompletionsModel` backed by `AsyncOpenAI(base_url=...)` and local SiftGate observability |

## Quick Start

```bash
cp examples/agents/.env.example examples/agents/.env
python -m venv .venv
source .venv/bin/activate
pip install -r examples/agents/requirements.txt
```

Create a Gateway API key in the local Dashboard, set `SIFTGATE_API_KEY` in `examples/agents/.env`, then run an example:

```bash
python examples/agents/openai_sdk_base_url.py
```

The examples default to `SIFTGATE_BASE_URL=http://localhost:2099` and `SIFTGATE_MODEL=auto`.

## Headers And Policy

All examples send:

- `Authorization: Bearer <SIFTGATE_API_KEY>` through the framework's OpenAI-compatible client.
- `x-siftgate-routing-hint` with advisory routing preferences.
- `x-session-id` for SiftGate session momentum and log correlation.
- `x-trace-id` plus `traceparent` for application-side trace labels.
- `x-siftgate-namespace` as an operator label.

Namespace enforcement is not based on trusting an arbitrary client header. Bind the Gateway API key to a local namespace in SiftGate when you want `allowed_nodes`, `allowed_models`, endpoint/modality policy, budget, and rate-limit constraints.

Routing hints are preferences only. SiftGate still applies Gateway API key permissions, namespace policy, budgets, rate limits, circuit state, model capability filters, and fallback policy before forwarding.

MCP access uses the same Gateway API key boundary. Use `allowed_endpoints` such as `mcp`, `mcp:<serverId>`, or `mcp:<serverId>:<toolName>` to scope tool access for agents.

## Structured Output

The examples intentionally request structured output:

- OpenAI SDK uses Chat Completions `response_format={"type":"json_schema", ...}`.
- LangChain uses `with_structured_output(..., method="json_schema")`.
- CrewAI uses a Pydantic `output_pydantic` task target and explicit JSON instructions.
- OpenAI Agents SDK uses `output_type=AgentRunSummary`.

SiftGate preserves structured-output intent where the target provider can support it. If the request is routed across protocols or to a provider that cannot safely honor the schema, route decisions and logs should show the passthrough, downgrade, unsupported, or fallback reason.

## Observability Workflow

After running an agent example, use the Dashboard to answer production questions:

- **What did it cost?** Open Logs, API Keys, Analytics, or Benchmark reports. SiftGate attributes usage to the Gateway API key and namespace when available.
- **Why this model?** Open the log detail and follow the Route Explanation link for candidate targets, filtering reasons, capability evidence, cost/latency/context tradeoffs, and fallback chain.
- **Did fallback happen?** Logs and Route Explanation show fallback reason and final selected node/model.
- **Which agent run was this?** Filter or inspect `session_key` in logs. Use the same `SIFTGATE_SESSION_ID` across an agent workflow to correlate multiple model calls.
- **Which namespace was charged?** Bind the Gateway API key to a SiftGate namespace. The namespace header in these examples is just a readable label unless your local deployment explicitly consumes it.

By default, SiftGate records metadata, not prompt text, response text, raw auth headers, provider keys, media bytes, or video bytes. Keep that default unless you have a deliberate local retention policy.

## Framework Notes

- OpenAI Python SDK: keep your existing SDK and replace only `base_url` plus the API key.
- LangChain: use `ChatOpenAI` for OpenAI-compatible endpoints and pass SiftGate headers with `default_headers`.
- CrewAI: configure `LLM(base_url=..., api_key=..., extra_headers=...)` for OpenAI-compatible gateway traffic.
- OpenAI Agents SDK: disable OpenAI-hosted tracing for local OSS examples with `set_tracing_disabled(True)` and use SiftGate's local Dashboard for request and route evidence.

Reference docs used while shaping these examples:

- [OpenAI Agents SDK models](https://openai.github.io/openai-agents-python/models/)
- [OpenAI Agents SDK overview](https://platform.openai.com/docs/guides/agents-sdk/)
- [LangChain ChatOpenAI structured output](https://reference.langchain.com/python/langchain-openai/chat_models/base/ChatOpenAI/with_structured_output)
- [CrewAI LLM configuration](https://docs.crewai.com/en/concepts/llms)
