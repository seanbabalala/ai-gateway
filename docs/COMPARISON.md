# Comparison

SiftGate is positioned as an open-source AI traffic data plane for teams that
want self-hosted control over provider keys, provider credential pools, model
routing, agent traffic, budgets, policy, audit, and operational evidence. It is
not primarily an API resale platform, billing wallet, or single-purpose model
router.

Public positioning references:

| Project | Public source |
| --- | --- |
| Manifest | [github.com/mnfst/manifest](https://github.com/mnfst/manifest) |
| One API | [github.com/songquanpeng/one-api](https://github.com/songquanpeng/one-api) |
| New API | [github.com/QuantumNous/new-api](https://github.com/QuantumNous/new-api) |
| LiteLLM Proxy | [docs.litellm.ai](https://docs.litellm.ai/) |

## Prior Art And Acknowledgements

SiftGate is built in conversation with a broader open-source AI gateway
ecosystem. Manifest helped make cost-aware intelligent model routing for agents
and applications feel practical. One API and New API made multi-provider API
aggregation, channel management, quota workflows, and self-hosted admin
operations accessible to many operators. LiteLLM helped normalize the idea that
teams should not be locked into one provider SDK or model API.

SiftGate takes a different path: a self-hosted AI traffic data plane focused on
BYOK governance, explainable routing, agent and MCP controls, privacy-safe
metadata, and production operations. We are grateful for the public work these
projects contributed to the ecosystem.

## Positioning Summary

| Product | Best At | SiftGate Difference |
| --- | --- | --- |
| Manifest | Cost-first smart model routing for agents and applications | SiftGate adds a broader team data plane: Workspaces, Dashboard RBAC, Policy Namespaces, provider compatibility profiles, richer protocol coverage, MCP governance, route explanations, provider credential pools, audit, production deployment paths, and metadata-only privacy defaults. |
| One API | LLM API management, channels, users, tokens, quota, and redistribution | SiftGate is not primarily a redistribution panel. It focuses on BYOK team-owned traffic, explainable routing, policy hierarchy, provider credential pools, agent governance, provider health, semantic controls, audit, and self-hosted production operations. |
| New API | Aggregation/distribution hub with UI, channel management, billing, and OpenAI/Claude/Gemini conversion | SiftGate overlaps on gatewaying and protocol compatibility, but emphasizes local policy enforcement, evidence-rich route decisions, workspace-scoped operational metadata, provider credential pools, no default content storage, and separation from reseller/payment workflows. |
| LiteLLM Proxy | Broad provider compatibility and developer-friendly proxying | SiftGate emphasizes Dashboard-first operations, canonical protocol metadata, policy governance, cost evidence, provider catalog governance, agent profiles, MCP gatewaying, and route explainability. |

## Capability Matrix

| Capability | SiftGate | Manifest | One API | New API | LiteLLM Proxy |
| --- | --- | --- | --- | --- | --- |
| Primary stance | Self-hosted AI traffic data plane | Smart model router | API management and redistribution | Aggregation/distribution hub | Multi-provider proxy |
| Core buyer/operator | Platform teams, AI infrastructure owners, agent teams | Agent builders and cost-conscious app builders | API distributors and internal admins | Aggregation operators and internal admins | Developers and platform teams |
| OpenAI-compatible ingress | Yes | Yes | Yes | Yes | Yes |
| Anthropic Messages-compatible ingress | Yes | Not primary | Partial / adapter-dependent | Yes | Yes |
| OpenAI Responses support | Yes | Not primary | Not primary | Version/provider dependent | Yes / provider-dependent |
| Embeddings and rerank | Yes | Model-dependent | Provider-dependent | Yes | Yes |
| Images, audio, video | Yes, with endpoint families and preview flags where appropriate | Limited / not primary | Provider-dependent | Broad protocol coverage; exact endpoint coverage depends on deployment/version | Provider-dependent |
| Batch API | Yes | Not primary | Not primary | Version/provider dependent | Provider-dependent |
| Realtime | Preview pass-through, disabled by default | Not primary | Not primary | Version/provider dependent | Provider-dependent |
| Smart routing | Complexity scoring, compatibility filtering, cache-aware cost evidence, circuit state, split rules | Core strength: cheapest capable model by local scoring | Channel priority/weight/load balancing | Channel weighting and failover | Routing and fallbacks |
| Route explainability | First-class Route Explanation with selected/rejected candidates and policy/cost/latency/compatibility evidence | Cost/model metadata focus | Channel/log evidence | Channel/log/quota evidence | Logs and callback metadata |
| Provider catalog governance | 50+ provider metadata, compatibility profiles, price source status, active vs transport-only visibility, local overrides | Model catalog oriented toward cost routing | Channel/provider administration | Channel/model asset administration | Provider support matrix |
| Gateway API keys | Yes, separate from provider keys | Yes / provider credentials model | Yes, token-centric | Yes, token-centric | Yes / virtual keys |
| Provider credential pools | Yes: multiple `credentials[]` per node, least-in-flight, weighted round-robin, sticky affinity, cooldown, retryable-status failover, and credential-hit logs without secret exposure | Not the center of the product; provider credentials support routing | Usually channel/token based rather than per-node credential-pool operations | Usually channel/provider based capacity and failover | Supports provider keys and routing patterns; implementation depends on deployment |
| Policy hierarchy | Workspace, API key, Team, Policy Namespace, endpoint/modality/node/model restrictions | Agents, providers, budgets, limits | Users, tokens, channels, quotas | Users, groups, tokens, channels, quotas, billing | Keys, teams/orgs, budgets depending on setup |
| Budget scopes | Global, Policy Namespace, Team, API Key | Spend limits and tracking | Quota/token accounting | Billing, recharge/subscription-style quotas | Budgets and spend controls |
| Agent profiles | Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, Generic OpenAI, Generic Anthropic | Strong personal-agent orientation | Generic API integration | AI editor skills and app integrations | Generic client/proxy integration |
| MCP Tool Gateway | Built in with Gateway API key auth, namespace allow-lists, rate limits, metadata logs | Not primary | Not primary | Skills/app integrations exist; gatewaying is not the core product surface | Not primary |
| Semantic controls | Semantic Cache v2, Prompt Registry metadata, context optimizer evidence, intent classification, guardrails metadata | Not primary | Not primary | Not primary | Not primary |
| Audit and rollback | Management audit, config audit, validation-first rollback | Not primary | Admin logs | Admin logs | Logs and config practices |
| Privacy default | Metadata-only by default; no prompt/response/raw header/provider key/tool payload/media/source/diff storage by default | Public docs state prompt/response are not stored by default | Deployment/operator dependent | Deployment/operator dependent | Deployment/operator dependent |
| Production path | SQLite local default, PostgreSQL production path, optional Redis, Docker, Kubernetes, Helm, OIDC, secret references, log sinks, OpenTelemetry | Docker-focused self-hosting plus cloud option | Single binary and Docker-ready | Docker, database options, admin UI, multi-tenant operations | Docker/Kubernetes/common infra patterns |
| Product boundary | Governance and operations for team-owned AI traffic | Cost optimization for agents/apps | API distribution and key management | API aggregation, distribution, billing, and asset management | Provider abstraction and proxying |

## What SiftGate Is

- A self-hosted gateway for Chat Completions, Responses, Messages, Embeddings,
  Rerank, Images, Audio, Video preview, Batch, Realtime preview, Feedback, and
  MCP Tool Gateway traffic.
- A local data plane where provider keys, runtime policy, and operational
  metadata stay with the operator by default.
- A provider credential-pool layer that can rotate multiple upstream keys
  inside one logical node before node-level fallback runs.
- A routing and governance layer for teams using multiple models, agents,
  providers, and client applications.
- A Dashboard-first operations product for keys, workspaces, budgets, route
  evidence, logs, sessions, provider health, audit, cost, semantic controls,
  eval reports, shadow traffic, and MCP.

## What SiftGate Is Not

- Not an AI model provider.
- Not an AI API resale platform by default.
- Not a billing wallet or public marketplace.
- Not a hosted proxy that must sit in the middle of all customer AI traffic.
- Not dependent on a hosted control plane for core local operation.
- Not a prompt store, response store, source-code store, or tool-payload store
  by default.

## Why The Data-Plane Model Matters

If all enterprise AI traffic flows through a vendor-hosted proxy, the vendor
absorbs bandwidth, streaming connection load, latency risk, and
sensitive-content responsibility. SiftGate keeps the runtime data plane in the
operator's environment and treats any external control-plane direction as
optional metadata, policy, recommendation, and audit coordination.
