# SiftGate Agent Framework Examples

These examples show how common Python agent stacks can send traffic through the local SiftGate Data Plane without storing real provider keys in application code.

They cover:

- OpenAI Python SDK with `base_url`
- LangChain with `ChatOpenAI`
- CrewAI with an OpenAI-compatible `LLM`
- OpenAI Agents SDK with a custom `AsyncOpenAI` client

Each example uses environment variables for the SiftGate base URL and Gateway API key. Do not commit a real `.env` file.

## Quick Start

Start SiftGate locally, create a Gateway API key in the Dashboard, then run:

```bash
cp examples/agents/.env.example examples/agents/.env
python -m venv .venv
source .venv/bin/activate
pip install -r examples/agents/requirements.txt
```

Edit `examples/agents/.env` and set `SIFTGATE_API_KEY` to the local Gateway API key.

Run one example:

```bash
python examples/agents/openai_sdk_base_url.py
python examples/agents/langchain_chat.py
python examples/agents/crewai_researcher.py
python examples/agents/openai_agents_sdk.py
```

## Environment

| Variable | Purpose |
| --- | --- |
| `SIFTGATE_BASE_URL` | Gateway URL, for example `http://localhost:2099` |
| `SIFTGATE_API_KEY` | Dashboard-generated Gateway API key |
| `SIFTGATE_MODEL` | `auto`, an alias, a direct model, or `node/model` |
| `SIFTGATE_NAMESPACE` | Operator label for the example; enforce namespace policy by binding the Gateway API key in SiftGate |
| `SIFTGATE_SESSION_ID` | Stable session header for routing momentum and log correlation |
| `SIFTGATE_TRACE_ID` | Trace label sent as `x-trace-id`; `traceparent` is also generated |
| `SIFTGATE_ROUTING_HINT` | Advisory `x-siftgate-routing-hint` JSON, such as `{"optimization":"cost"}` |

## What The Examples Demonstrate

- **Routing hint**: all calls send `x-siftgate-routing-hint`. SiftGate may use it as a routing preference, but it never bypasses Gateway API key permissions.
- **API key**: applications authenticate to SiftGate with the Gateway API key, not a provider key.
- **Namespace**: production namespace enforcement comes from the Gateway API key's namespace binding. The example namespace header is only an operator label unless your local gateway config chooses to consume it.
- **Session/trace**: calls include `x-session-id`, `x-trace-id`, and `traceparent` headers so logs and route decisions can be correlated.
- **Structured output**: examples use JSON schema or framework-level structured output so SiftGate can preserve structured-output intent across compatible providers.

## Observe The Runs In SiftGate

After a run, open the Dashboard:

- Logs: selected node/model, source format, latency, cost, usage, fallback reason, session key.
- Route Explanation: why the gateway selected or filtered each candidate target.
- API Keys: per-key calls, cost, errors, and last-used metadata.
- Benchmarks and Analytics: aggregate latency/cost evidence from local call logs.

See [Agent Integrations](../../docs/AGENT_INTEGRATIONS.md) for production notes and framework-specific guidance.
