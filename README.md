# SiftGate

SiftGate is the open-source AI infrastructure platform for teams running agents and AI applications across multiple providers. It gives applications OpenAI-compatible and provider-compatible ingress, then applies workspace isolation, RBAC, routing, fallback, budget, API key policy, observability, cache evidence, audit, and Dashboard operations before forwarding traffic upstream.

Current release: **v2.8.0 GA**.

Current development focus after v2.8.0: preserve Platform Trust stability,
fix regressions quickly, and avoid changing runtime defaults outside explicit
future release prompts.

## Why SiftGate

- One gateway for Chat Completions, Responses, Anthropic Messages, Embeddings, Rerank, Images, Audio, Video preview, Realtime preview, MCP Tool Gateway preview, and Batch proxy.
- Explainable routing: every request can show why a node/model was selected or filtered.
- Local governance: Gateway API keys, Policy Namespaces, local teams, budgets, rate limits, allowed endpoints, allowed modalities, allowed nodes, and allowed models.
- Production defaults: single-node memory/SQLite works out of the box; Redis, PostgreSQL, Kubernetes, and Helm are optional.
- Privacy-first operations: call logs, route traces, shadow reports, guardrails findings, batch jobs, video jobs, semantic cache, and eval reports are metadata-only by default.
- Catalog-backed setup: Nodes, Add Node Wizard, Provider Catalog, and config validation use one merged provider catalog surface backed by canonical model projections instead of hardcoded provider/model lists.
- Price source governance: cost-aware routing, benchmarks, Route Explanation, config validation, and catalog override workflows share one resolver with explicit user config taking priority over sync cache and built-in references.
- Provider extensibility: custom provider templates, `custom-header` auth,
  Provider SDK Generator beta output, community registry design, and the
  Provider Health Dashboard expand ecosystem coverage without auto-trusting
  generated adapters or community pricing.
- Provider ecosystem expansion: v2.4 adds tested, source-governed catalog rows
  for DeepInfra, Nebius AI Studio, Novita AI, FriendliAI, Databricks Mosaic AI,
  and GitHub Models, plus offline provider registry manifest checks for
  community PRs.
- Agent Platform preview: v2.5 adds a workspace-scoped A2A registry,
  MCP-backed Tool Registry, preview-only workflow metadata, Conversation Memory
  Gateway counters, and recent agent trace spans without storing prompts,
  responses, source code, diffs, tool payloads, raw headers, provider keys,
  media bytes, hidden reasoning text, or resolved secrets by default.
- Cost and chargeback platform: v2.6 adds internal workspace/team/project
  chargeback reports, CSV/JSON exports, cost anomaly alerts, provider price
  sync governance, and thumbs feedback aggregation without payments, recharge,
  reseller balances, public marketplaces, or prompt/response storage.
- Semantic Controls: v2.7 adds Semantic Cache v2, Prompt Registry, Context
  Window Optimizer evidence, Intent Classification, and Guardrails v2 with
  metadata-only defaults and explicit opt-ins for replayable response or
  template body storage.
- Coding-agent gateway: Dashboard-managed Coding Agent Gateway profiles render
  redacted connector configs for Cursor, Cline, Roo Code, Continue, Codex,
  Claude Code, OpenCode, Generic OpenAI-compatible agents, and Generic
  Anthropic-compatible agents.
- Intelligence Loop: optional cost optimizer evidence, token prediction,
  async eval metadata, and opt-in quality gates make routing decisions easier
  to trust without storing prompts, responses, raw headers, provider keys,
  source code, diffs, tool payloads, media bytes, or hidden reasoning text by
  default.

## Quick Start

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
npm run build
npm start
```

Open:

- Gateway: `http://localhost:2099`
- OpenAPI: `http://localhost:2099/docs`
- Dashboard: `http://localhost:2099/dashboard`

Add at least one upstream node in `gateway.config.yaml`, then point your app at SiftGate:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Explain this in one sentence."}]
  }'
```

You can also keep the OpenAI SDK and set `baseURL` to `http://localhost:2099/v1`.

## v2.8 Highlights

- v2.8.0 GA ships the complete clarified OSS concept model with no new scope
  beyond the alpha, beta, and rc hardening path. The Dashboard setup path now
  covers Workspace, Provider Node, Gateway API Key, optional Policy Namespace,
  daily Budget scope, first request, evidence review, and advanced setup
  surfaces.
- Dashboard concept panels now link to the matching OSS docs from Overview,
  Workspaces, Nodes, Provider Catalog, API Keys, Policy Namespaces, Budget,
  Semantic Controls, Traffic Experiments, Eval Reports, Shadow Traffic, and
  MCP Tool Gateway so self-hosters can configure the gateway end to end without
  guessing where a concept lives.
- The GA release keeps the v2.8 privacy and runtime boundaries intact: no new
  default prompt, response, raw header, provider key, tool payload, media byte,
  hidden reasoning, or resolved secret storage is added.
- v2.8.0-beta.3 makes advanced OSS surfaces setup-complete in product:
  Semantic Controls, Traffic Experiments, Eval Reports, Shadow Traffic, and
  MCP Tool Gateway now show setup state, safe YAML examples, and clearer
  boundaries between metadata controls, live split analytics, controlled evals,
  asynchronous shadow mirroring, and tool-call proxy governance.
- The beta.3 release keeps advanced features disabled or metadata-only by
  default and does not add auto-promotion, workflow automation, routing changes,
  or prompt/response/tool payload storage.
- v2.8.0-beta.2 makes daily budget setup obvious across Global, Policy
  Namespace, Team, and API Key scopes. The Budget page shows source of truth,
  inherited or unset state, daily reset time, alert threshold, current usage,
  and the unchanged blocking order from global to namespace to team to key.
- Safe budget edits reuse existing supported paths: Policy Namespace config
  updates, Team policy updates, and Dashboard-managed API Key policy updates.
  Global budgets remain config-backed through `gateway.config.yaml`.
- v2.8.0-beta.1 makes Policy Namespaces manageable from the OSS Dashboard.
  Admins can create, edit, and delete config-backed namespaces with the existing
  validation, config audit, rollback, and hot-reload path.
- The Policy Namespaces page shows bound Gateway API keys and Teams before
  deletion. Bound namespaces require explicit impact confirmation and backend
  validation before SiftGate rewrites only the `namespaces` config section.
- v2.8.0-alpha.3 closes the OSS Workspace management gap: Workspace Admins can
  create, switch, rename, disable, and reactivate local Workspaces from the
  Dashboard using the existing workspace data model.
- Creating a Workspace grants the current Dashboard identity Admin in that
  Workspace. Disabled Workspaces keep metadata and audit history, cannot be
  selected until reactivated, and do not delete or migrate default Workspace
  data.
- v2.8.0-alpha.2 separates active Provider Catalog rows from connectable
  transport-only presets. The Dashboard now shows counts for active,
  transport-only, custom, deprecated/legacy, and total provider presets, and
  detail panels explain runtime support, catalog confidence, pricing
  confidence, and hidden-by-default reasons.
- Transport-only providers are still configurable as nodes. They stay hidden
  from the default model catalog when model or pricing truth is not trusted,
  instead of being promoted as active catalog rows just to increase the visible
  count.
- v2.8.0-alpha.1 makes confusing OSS concepts explain themselves in product:
  Workspace, Policy Namespace, Semantic Controls, Traffic Experiments, Evals,
  Shadow Traffic, MCP Tool Gateway, budget scopes, fixed OSS roles, and
  Provider Catalog visibility now share clear Dashboard copy and status labels.
- The alpha.1 concept-clarity release kept behavior unchanged. Later v2.8
  prereleases add real local Workspace and Policy Namespace management without
  changing runtime routing, MCP proxying, provider projection, or privacy
  storage defaults.
- Added [`docs/OSS_CONCEPTS.md`](docs/OSS_CONCEPTS.md) as the shared glossary
  for Workspace vs Policy Namespace vs Team vs Gateway API Key vs Node vs
  Provider.

## v2.7 Highlights

- v2.7.1 reorganizes the Dashboard sidebar into Monitor, Runtime,
  Intelligence, Agents & Tools, and Governance groups so v2 platform surfaces
  follow the operator workflow more clearly.
- v2.7.0 makes the semantic layer production-grade without changing SiftGate's
  default privacy boundary.
- Semantic Cache v2 adds workspace/API-key/model isolation, TTL invalidation,
  preview Redis/vector backend validation, and a per-request opt-in header
  before replayable response storage is allowed.
- Prompt Registry adds workspace-scoped template metadata, versioning,
  variables, route policy binding, and A/B metadata while storing hashes only by
  default.
- Context Window Optimizer and Intent Classification record route evidence for
  context pressure and task type without silently changing prompt content.
- Guardrails v2 records metadata-only PII, toxicity, and jailbreak findings for
  input/output policy surfaces.
- The Dashboard **Semantic Controls** page and Route Explanation semantic panel
  are localized across `en`, `zh`, `zh-TW`, `ja`, `ko`, `th`, and `es`.
- See [`docs/SEMANTIC_PLATFORM.md`](docs/SEMANTIC_PLATFORM.md) and
  [`docs/CACHING.md`](docs/CACHING.md).

## v2.6 Highlights

- v2.6.0 turns cost analytics into an internal chargeback and anomaly response
  platform while staying out of API resale, recharge, and payments.
- Added `GET /api/dashboard/cost-platform` plus CSV/JSON export endpoints for
  workspace-scoped chargeback summaries grouped by team, project, API key,
  model, node, or workspace.
- Added `POST /v1/feedback` for metadata-only thumbs feedback tied to a request
  id and route-weight evidence. Prompts, responses, source code, diffs, tool
  payloads, raw headers, provider keys, media bytes, and hidden reasoning text
  are not accepted or persisted.
- Added cost anomaly detection with metadata-only `cost_anomaly` webhook alerts
  and optional downgrade recommendations that do not silently change routing.
- Provider price sync is surfaced as source-governed status: explicit sources
  only, no automatic trust, and no silent overwrite of operator overrides.
- See [`docs/COST_CHARGEBACK_PLATFORM.md`](docs/COST_CHARGEBACK_PLATFORM.md)
  and [`docs/BILLING_LOOP.md`](docs/BILLING_LOOP.md).

## v2.5 Highlights

- v2.5.0 deepens the agent platform without turning SiftGate into a full app
  builder. The new Dashboard **Agent Platform** page is a read-only, metadata
  first control plane.
- Added `GET /api/dashboard/agent-platform` for workspace-scoped A2A registry
  rows, MCP-backed Tool Registry permission evidence, preview workflow metadata,
  Conversation Memory Gateway counters, recent agent trace spans, and an
  explicit privacy contract.
- Tool permissions are derived from Agent Profile `mcp_server_ids`, Gateway API
  key endpoint policy, MCP server namespace allow-lists, and active profile/key
  state. Tool inputs and outputs are not stored.
- Workflow metadata is marked preview-only with `runtime_enabled=false`; SiftGate
  does not add a LangGraph/Dify-style workflow runtime in v2.5.
- See [`docs/AGENT_PLATFORM_PREVIEW.md`](docs/AGENT_PLATFORM_PREVIEW.md),
  [`docs/CODING_AGENT_GATEWAY.md`](docs/CODING_AGENT_GATEWAY.md), and
  [`docs/MCP_GATEWAY.md`](docs/MCP_GATEWAY.md).

## v2.4 Highlights

- v2.4.0 starts the Provider Ecosystem Expansion series by using the v2.3
  extensibility foundation instead of adding untested rows for count inflation.
- Added built-in, review-required provider metadata for DeepInfra, Nebius AI
  Studio, Novita AI, FriendliAI, Databricks Mosaic AI, and GitHub Models.
- Each new provider includes compatibility profile evidence, model buckets,
  source-governed pricing references, health/catalog identity, and Dashboard
  logo identity.
- Added `npm run provider-registry:check` with an offline manifest fixture so
  community provider PRs can validate provider shape, source URLs, pricing
  governance, and secret hygiene without provider network calls.
- See [`docs/PROVIDER_CATALOG.md`](docs/PROVIDER_CATALOG.md) and
  [`docs/PROVIDER_EXTENSIBILITY.md`](docs/PROVIDER_EXTENSIBILITY.md).

## v2.3 Highlights

- v2.3.0 adds Provider Extensibility for the OSS data plane: custom provider
  templates, custom-header auth, Provider SDK Generator beta, community
  registry design, and a workspace-scoped Provider Health Dashboard.
- The Dashboard Add Node flow can configure providers that require a custom
  auth header name and optional prefix while still keeping provider key values
  in local config, env vars, or secret references.
- Provider Health aggregates active probes, circuit state, call-log latency,
  error rate, compatibility labels, and pricing-source warnings without raw
  request/response content or provider keys.
- Provider SDK Generator beta returns reviewable adapter, manifest, README, and
  test skeleton files in the API response only. Generated adapters are not
  written to disk or auto-trusted.
- Community provider registry guidance now defines manifest shape, CI evidence,
  compatibility proof, and pricing governance for sustainable provider growth.
- See [`docs/PROVIDER_EXTENSIBILITY.md`](docs/PROVIDER_EXTENSIBILITY.md).

## v2.2 Highlights

- v2.2.0 adds the first Intelligence Loop for the OSS data plane: Real-time Cost
  Optimizer v1, Token Prediction v1, Async Eval metadata, and disabled-by-default
  Quality Gate v1.
- Cost Optimizer starts in evidence-only mode and can apply route changes only
  when `intelligence.cost_optimizer.action=optimize` is explicit. Quality-critical
  coding/security/deep requests are protected from silent downgrade by default.
- Token Prediction estimates input/output/context tokens and cost risk before
  the upstream call. Reject or downgrade behavior happens only through explicit
  workspace/config policy.
- Quality Gate can retry, fallback, or alert for configured critical
  non-streaming routes, and never retries or falls back after streaming bytes
  have started.
- Dashboard Overview and Route Explanation show optimizer evidence, token risk,
  quality gate events, async eval metadata, and a workspace cost optimization
  summary with seven-locale copy.
- See [`docs/INTELLIGENCE_LOOP.md`](docs/INTELLIGENCE_LOOP.md).

## v2.1 Highlights

- v2.1.0 adds Coding Agent Gateway profiles for Cursor, Cline, Roo Code,
  Continue, Codex, Claude Code, OpenCode, Generic OpenAI-compatible coding
  agents, and Generic Anthropic-compatible coding agents.
- Coding agents can use profile-scoped virtual model aliases:
  `coding-auto`, `coding-fast`, `coding-deep`, and `coding-security`. The
  aliases map to internal smart routing hints without forcing one provider and
  still require Gateway API key `allow_auto`.
- The Dashboard **Agents** page now shows metadata-only coding-agent sessions,
  including connector, session, optional repo/project labels, token/cost/latency
  summaries, fallback/retry evidence, and Route Explanation links.
- Safe agent headers such as `x-siftgate-agent-session-id`,
  `x-siftgate-agent-turn-id`, `x-siftgate-repo`, and `x-siftgate-project` are
  sanitized and stored only as labels. SiftGate does not store source code,
  prompts, responses, diffs, tool payloads, raw repository content, raw headers,
  provider keys, or resolved secrets by default.
- The v2.1 North Star demo is an Engineering PR Review Workspace where several
  coding agents share one workspace-controlled gateway and operators inspect
  cost, latency, fallback, and route explanations by connector/repo/project.

## v2.0 Highlights

- v2.0.0 GA ships the Platform Trust foundation: workspace isolation, local Dashboard RBAC, optional OIDC login and workspace invites, PostgreSQL production guidance, Redis shared-state cluster mode, management audit logs, upgrade guardrails, first-run onboarding, and public benchmark evidence.
- v2.0.0 publishes the GA Platform Trust performance benchmark: a deterministic local `benchmark:platform` harness, JSON/Markdown reports, direct mock baselines, non-streaming and streaming proxy overhead, `model=auto` smart-routing overhead, Dashboard metadata read/write measurements, and optional PostgreSQL/Redis modes that are skipped unless explicitly configured.
- v2.0.0-rc.1 completes the Platform Trust audit and upgrade hardening pass: workspace-scoped management audit events, denied-action evidence, a Dashboard Audit Log page, hash-chain fields, finalized migration dry-run export, and SQLite-to-PostgreSQL coverage for `management_audit_events`.
- v2.0.0-beta.1 adds optional generic OIDC Dashboard login plus workspace invitation metadata: local password login remains supported, OIDC uses secret references for client secrets, Admins can create/revoke invite links, invitations can be accepted by local or OIDC identities, and seven-locale Dashboard copy covers login and invite flows.
- v2.0.0-alpha.4 turns Redis shared state into coherent cluster mode for multi-instance data planes: workspace-scoped runtime keys, per-category TTL/fail policy, shared rate limits/circuit state/cache affinity/momentum/concurrency/health/realtime metadata, Dashboard cluster status, and updated Docker/Helm/Kubernetes guidance while keeping Redis optional.
- v2.0.0-alpha.3 makes PostgreSQL the documented production path with pool/SSL configuration, fail-fast diagnostics, database-aware `/health`, database-only `/ready`, production examples, and RBAC membership migration coverage while keeping SQLite as the local default.
- v2.0.0-alpha.2 adds local Dashboard RBAC for workspace governance: Admin, Operator, and Viewer memberships, centralized Dashboard permission guards, a Members page, role badges, permission-aware disabled controls, and seven-locale role copy.
- v2.0.0-alpha.1 introduces the Workspace Core foundation: every OSS install now bootstraps a default organization and default workspace, legacy v1.9 resources map safely to that workspace, Dashboard APIs expose active workspace state, and the header selector sends `x-siftgate-workspace-id` for workspace-scoped views.

## v1.9 Highlights

- v1.9.2 adds the read-only `siftgate migrate-v2 --dry-run` migration planner and [`docs/MIGRATION_V1_TO_V2.md`](docs/MIGRATION_V1_TO_V2.md), so operators can preview how v1.9 single-tenant config and metadata rows will map into the future v2 default organization/workspace before any schema change exists.
- v1.9.1 adds the v2.x platform roadmap, execution prompts, release checklist, and a read-only release version alignment check so future releases have consistent scope, tests, metadata, tags, and GitHub release steps.
- Agent Gateway Profiles: SiftGate has a Dashboard **Agents** page for local
  connection profiles that render setup snippets for coding agents and
  compatible chatbot clients.
- Connector-safe smart routing: OpenAI-compatible agents can use `model=auto`; Claude-style agents can use the profile-scoped `claude-siftgate-auto` virtual model, which maps to internal smart routing instead of direct Claude routing.
- Gateway key boundary: agent and chatbot configs use only Dashboard-generated Gateway API keys. Provider API keys stay in Nodes, env vars, or secret references, and rendered snippets expose placeholders or masked metadata only.
- Seven-language Dashboard support: the Agent Profiles page, navigation, forms, render panel, connector labels, privacy copy, and error states are localized across `en`, `zh`, `zh-TW`, `ja`, `ko`, `th`, and `es`.
- Agent client UX polish: Cherry Studio smart-router-only setup now avoids leaking direct/provider model clutter into model pickers, direct routing uses model selectors instead of free-text-only entry, connector cards use real project logos, and Logs label total response time plus streaming/sync mode separately so long streamed replies are not mistaken for upstream latency.
- Policy preservation: `allow_auto`, `allow_direct`, Policy Namespace bindings, budgets, rate limits, endpoint/model/node/modality restrictions, metadata-only logs, sessions, route explanations, and MCP `allowed_endpoints` still apply to all Agent Profile traffic.

## v1.8 Highlights

- OpenRouter-first canonical model registry: SiftGate now materializes an internal canonical model dataset from OpenRouter's public models API, then uses that registry as the primary source for fresher model ids, context windows, supported parameters, architecture metadata, and reference pricing.
- ZeroEval enrichment overlay: ZeroEval no longer depends on fragile built-in provider/model exact matches. It overlays lifecycle, throughput, benchmarks, multimodal/spec metadata, and review-required secondary pricing onto canonical models through a stricter matching system with confidence tracking and diagnostics.
- Provider projection and visibility cleanup: the public merged provider catalog still stays one operator-facing surface, but provider model rows are now projected from canonical truth instead of letting stale built-in static model lists keep acting like primary truth. Legacy, deprecated, and transport-only presets stay compatible without misleading the default path.
- Unified node UX: Nodes, Add Node, and Provider Catalog now show the same provider status, coverage, trust, and recommended-model signals. Add Node defaults come from canonical recommended buckets, default pricing rows prefill from those recommendations, and non-active providers are hidden unless the operator explicitly shows transport-only/hidden presets. Provider Catalog counts separate active catalog rows from connectable transport-only presets so the default visible count is not confused with total runtime support.

## v1.7 Highlights

- ZeroEval-backed catalog enrichment introduced review-required third-party model metadata and default pricing references through the existing catalog sync cache instead of creating a second catalog.
- Fresh model defaults for Add Node introduced backend-generated `recommended_model_buckets`, `latest_model_hints`, and `recommended_models` so default provider/model suggestions stopped depending on naive alphabetical ordering.
- Default pricing prefill via merged catalog seeded Add Node pricing editors from merged catalog pricing metadata while keeping explicit node pricing, `models_pricing`, `catalog.override.yaml`, and sync-cache precedence unchanged.
- Catalog enrichment metadata added lifecycle, specs, source metadata, and selected benchmark snippets to merged catalog and Dashboard API model rows.

## v1.6 Highlights

- Usage schema registry: compatibility profiles now declare official usage/cache field paths so non-streaming and streaming extraction can normalize provider cache tokens across OpenAI-compatible, Responses-compatible, Anthropic Messages, Gemini, DeepSeek, Cohere, and local runtime surfaces.
- Provider cache-aware cost accounting: built-in pricing and canonical usage handling now preserve normal input, cache read, and cache creation token distinctions so actual cost and no-cache baseline cost stay comparable.
- Cache Savings Dashboard: overview KPIs, Analytics, Logs, and Budget views now show provider-cache hit rate, savings, cost split, and no-cache baselines without exposing prompts, responses, raw headers, or provider keys.
- Cache Session Affinity routing: when a session has recent confirmed provider cache hits on the same node/model, routing can bias toward that target within a safe TTL window and explain the decision in Route Explanation.

## v1.5 Highlights

- Required env fail-fast: legacy `${VAR}` references are now enforced during startup and config reload. `${VAR:-default}` still works for local defaults and CI-safe placeholders, while `${env:VAR}` and external secret backends stay runtime-resolved.
- Runtime-safe reloads: dashboard reload, watcher reload, rollback restore, and `SIGHUP` now reject invalid configs atomically and keep the last known-good config in memory.
- Public error contract hardening: gateway-generated public errors now go through one mapping layer so `message`, `type`, `request_id`, `x-siftgate-request-id`, and protocol-compatible OpenAI / Anthropic / Batch / MCP / Video envelopes stay aligned.

## v1.4 Highlights

| Area | What changed |
| --- | --- |
| Provider Catalog 50+ | Built-in providers now cover foundation models, aggregators, cloud platforms, China providers, self-hosted/local runtimes, media, speech/audio, embedding, and rerank providers. |
| Pricing Source Governance | Routing, benchmarks, config validation, CLI, and Dashboard views share one pricing resolver with source, freshness, confidence, and review-required evidence. |
| Catalog Dashboard UX | Provider Catalog is now a filterable explorer with family/type/modality/compatibility/price-source filters, grouped rows, detail panels, and catalog-backed Add Node search. |
| Compatibility Profiles | Providers and nodes can expose protocol/endpoint/streaming/multipart/async-job strategies, with routing and Route Explanation evidence for supported, downgraded, and unsupported fields. |

## Core Features

| Category | Capabilities |
| --- | --- |
| Protocols | `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/embeddings`, `/v1/rerank`, image/audio endpoints, async video preview, realtime preview, MCP Tool Gateway preview, Batch proxy. |
| Routing | Complexity tiers, domain hints, multimodal capability filtering, cost/context optimization, cache-aware routing, reasoning-aware routing, fallback chains, circuit breakers. |
| Explainability | Route Decision Trace, Route Explanation page, candidate filtering reasons, capability evidence, compatibility profile evidence, cache evidence, cost/latency/context tradeoffs. |
| Governance | Local Gateway API keys, Policy Namespaces, teams, budgets, rate limits, allowed endpoints/models/nodes/modalities, audit events, config rollback. |
| Provider Ops | Provider Catalog with provider transport presets, OpenRouter-first canonical model registry, ZeroEval enrichment overlay, provider compatibility profiles and matrix, custom provider templates, Provider SDK Generator beta, Provider Health Dashboard, pricing source governance, and catalog override/sync CLI. |
| Safety | Secret references, guardrails plugin, metadata-only logs, sanitized route traces, privacy-safe shadow reports, secure defaults for cache/eval storage. |
| Deployment | Single-node memory/SQLite, Docker, Kubernetes manifests, Helm chart, optional Redis/PostgreSQL. |
| Developer UX | TypeScript client scaffold, Python SDK scaffold, Dashboard Playground, session trace view, agent framework examples, Coding Agent Gateway profiles. |

## After v2.7 Priorities

- Preserve Platform Trust behavior while adding deeper agent-platform and
  semantic-layer capabilities as minor releases.
- Continue improving connector compatibility for common coding agents while
  preserving advisory-only routing hints and profile-scoped virtual models.
- Deepen canonical coverage without adding runtime coupling: more safe freshness adapters or provider-availability overlays are possible, but they must stay cache/override based and preserve operator-reviewed pricing governance.
- Continue optional Redis/vector semantic-cache backends, prompt lifecycle
  workflows, and guardrail policy depth without regressing single-node
  memory/SQLite defaults.

## Configuration

The default path is `gateway.config.yaml`. Start from `gateway.config.example.yaml` and keep real provider keys out of git.

In v1.5, legacy `${VAR}` references are treated as required config inputs: startup and reload fail fast if the variable is missing. Use `${VAR:-default}` when you intentionally want a local default, or `${env:VAR}` / Vault / AWS / GCP references when you want request-time secret resolution.

Common settings:

- `nodes[]`: upstream providers, compatible proxies, local model servers, and model buckets.
- `routing`: tiers, fallback chains, load balancing, optimization mode.
- `auth.api_keys[]`: local Gateway API keys and permissions.
- `namespaces[]`: local Policy Namespace labels for node/model restrictions,
  budgets, rate limits, API key/team binding, MCP allow-lists, and filters.
- `cache`: deterministic prompt response cache.
- `semantic_cache`: disabled-by-default semantic cache preview.
- `semantic_platform`: disabled-by-default Semantic Cache v2 controls, Prompt
  Registry, context optimizer, intent classification, and Guardrails v2.
- `evaluation`: disabled-by-default local eval metadata and sample-storage controls.
- `state`: optional Redis shared runtime state.
- `database`: SQLite by default, PostgreSQL optional.

Validate config before deploying:

```bash
npm run validate:config
```

## Documentation

| Topic | Link |
| --- | --- |
| Quickstart | [docs/QUICKSTART.md](docs/QUICKSTART.md) |
| API reference | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) |
| Dashboard | [docs/DASHBOARD.md](docs/DASHBOARD.md) |
| Cost And Chargeback Platform | [docs/COST_CHARGEBACK_PLATFORM.md](docs/COST_CHARGEBACK_PLATFORM.md) |
| Coding Agent Gateway | [docs/CODING_AGENT_GATEWAY.md](docs/CODING_AGENT_GATEWAY.md) |
| Agent Gateway Profiles | [docs/AGENT_GATEWAY.md](docs/AGENT_GATEWAY.md) |
| Production | [docs/PRODUCTION.md](docs/PRODUCTION.md) |
| Kubernetes / Helm | [docs/KUBERNETES.md](docs/KUBERNETES.md) |
| Provider Catalog | [docs/PROVIDER_CATALOG.md](docs/PROVIDER_CATALOG.md) |
| Provider Extensibility | [docs/PROVIDER_EXTENSIBILITY.md](docs/PROVIDER_EXTENSIBILITY.md) |
| Adding Providers | [docs/ADDING_PROVIDERS.md](docs/ADDING_PROVIDERS.md) |
| Provider Compatibility | [docs/PROVIDER_COMPATIBILITY.md](docs/PROVIDER_COMPATIBILITY.md) |
| SDKs | [docs/SDKS.md](docs/SDKS.md) |
| Playground | [docs/PLAYGROUND.md](docs/PLAYGROUND.md) |
| MCP Tool Gateway | [docs/MCP_GATEWAY.md](docs/MCP_GATEWAY.md) |
| Batch API | [docs/BATCH_API.md](docs/BATCH_API.md) |
| Caching | [docs/CACHING.md](docs/CACHING.md) |
| Evaluation Framework | [docs/EVALUATION_FRAMEWORK.md](docs/EVALUATION_FRAMEWORK.md) |
| Security | [docs/SECURITY.md](docs/SECURITY.md) |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Roadmap | [docs/GATEWAY_ROADMAP.md](docs/GATEWAY_ROADMAP.md) |
| v2 Platform Roadmap | [docs/V2_PLATFORM_ROADMAP.md](docs/V2_PLATFORM_ROADMAP.md) |
| v1 to v2 Migration | [docs/MIGRATION_V1_TO_V2.md](docs/MIGRATION_V1_TO_V2.md) |
| Release Checklist | [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) |

## Development

```bash
npm run build
npm test -- --runInBand
npm run test:e2e
npm run validate:k8s
npm run docs:check
cd frontend && npm test && npm run build
```

Useful commands:

```bash
npm run catalog -- list
npm run catalog -- sync zeroeval
npm run validate:config
npm run benchmark:upstream
npm run release:check
npm run test:python-sdk
```

## Community

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Issues: use the templates under [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE)

SiftGate is MIT licensed and designed so the open-source Data Plane remains useful on its own.
