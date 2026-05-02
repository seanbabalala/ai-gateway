# Comparison

SiftGate is positioned as an open-source data plane for enterprise AI traffic, with a future hosted control plane for policy, governance, and intelligent routing.

## Short Version

| Product | Best At | SiftGate Difference |
| --- | --- | --- |
| Manifest | simple model auto-routing for apps/agents | SiftGate adds multi-protocol conversion, gateway keys, budgets, dashboard, observability, plugins, and a control-plane direction |
| New API | model aggregation and distribution platform | SiftGate is not primarily a reseller/channel platform; it focuses on team-owned traffic, BYOK, governance, and self-hosted data planes |
| LiteLLM Proxy | broad provider compatibility and proxying | SiftGate emphasizes protocol canonicalization, explainable routing, dashboard-first operations, and future fleet policy feedback |
| Cloudflare | network traffic policy and edge controls | SiftGate applies the control-plane pattern to AI traffic, models, budgets, and provider reliability |

## What SiftGate Is

- A self-hosted gateway that accepts Chat Completions, Responses, and Messages APIs.
- A local data plane where prompts, responses, and provider keys stay with the operator.
- A routing and governance layer for teams using multiple models and providers.
- A path toward a hosted AI traffic control plane.

## What SiftGate Is Not

- Not an AI model provider.
- Not an AI API resale platform by default.
- Not a hosted proxy that must sit in the middle of all customer AI traffic.
- Not dependent on the future hosted control plane for core local operation.

## Why The Control-Plane Model Matters

If all enterprise AI traffic flows through a vendor-hosted proxy, the vendor absorbs bandwidth, streaming connection load, latency risk, and sensitive-content responsibility. SiftGate's long-term architecture keeps the data plane in the customer's environment and lets the hosted control plane manage metadata, policy, recommendations, and audit.
