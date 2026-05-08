# SiftGate v2.x Platform Roadmap

SiftGate v2.x moves the open-source data plane from a smart AI gateway into an
AI infrastructure platform for teams and agents. The core product promise stays
local-first: operators keep AI traffic, prompts, responses, provider keys, and
runtime policy inside their own environment by default.

## Positioning

SiftGate is the open-source AI infrastructure platform for teams running agents
and AI applications across multiple providers.

The v2.x line keeps SiftGate focused on internal AI infrastructure:

- one governed ingress for applications, agents, and chatbot clients
- workspace-aware policy, budgets, API keys, routing, and observability
- explainable model routing with privacy-safe metadata evidence
- local-first deployment with optional PostgreSQL, Redis, Kubernetes, and Helm
- no required hosted control plane for core data-plane operation

## Why Now

In 2025 and 2026, enterprise AI usage is moving from experiments to scaled
operations. Teams are no longer calling one model from one developer laptop.
They are running multiple agents, multiple providers, multiple protocols,
shared budgets, internal compliance rules, and production reliability targets.

Traditional API proxies can forward requests, but they do not answer the
operational questions that appear at scale:

- Which team, agent, model, or provider is driving spend?
- Why did this request route to this model?
- Which fallback happened during an incident?
- Which policy allowed or blocked the call?
- How do we preserve privacy while still operating the platform?
- How do developers onboard without copying provider keys into every tool?

SiftGate v2.x is designed for that stage: a self-hosted AI infrastructure
platform that governs the data plane while keeping sensitive request content and
provider credentials local by default.

## v2.0.0 Theme: Platform Trust

v2.0.0 is the trust foundation for the platform. It should prove that SiftGate
can safely sit in front of team and agent traffic without changing the v1.9
gateway contract.

The v2.0.0 scope is intentionally narrow:

- workspace and organization foundations
- RBAC with Admin, Operator, and Viewer roles
- production PostgreSQL path while preserving SQLite local defaults
- Redis-backed shared state for cluster mode
- upgrade and migration safety from v1.9 single-tenant installs
- auditability for management operations
- repeatable performance benchmark reporting
- first-run onboarding and docs that make the platform path clear

v2.0.0 should not ship a broad provider-count push, a full workflow engine, or
an API resale/recharge system.

## v2.0.x Policy

After v2.0.0 GA, v2.0.x is reserved for hotfixes, security fixes, migration
fixes, documentation corrections, and safe polish. New non-breaking product
capabilities should ship as minor releases such as v2.1.0, v2.2.0, and onward.

This keeps semantic versioning clear:

- patch releases protect trust in the v2.0 contract
- minor releases add new platform capabilities
- published tags are never rewritten or moved

## v2.x Release Train

| Version | Theme | Goal |
| --- | --- | --- |
| v1.9.1 | Roadmap and release baseline | Document the v2.x execution plan, release checklist, and version checks without runtime changes. |
| v1.9.2 | v1 to v2 migration dry run | Add a read-only migration report before changing the data model. |
| v2.0.0-alpha.1 | Workspace core | Released. Introduces organization/workspace bootstrap, default workspace mapping, workspace-scoped metadata, and Dashboard workspace context. |
| v2.0.0-alpha.2 | RBAC and resource permissions | Released. Adds local Dashboard memberships, Admin/Operator/Viewer enforcement, member management, role badges, and permission-aware controls. |
| v2.0.0-alpha.3 | PostgreSQL production path | Released. Adds pool/SSL config, fail-fast diagnostics, `/ready`, DB health, production examples, and RBAC migration coverage while preserving SQLite local use. |
| v2.0.0-alpha.4 | Redis cluster state | Make shared runtime state coherent for multi-instance data planes. |
| v2.0.0-beta.1 | OIDC and invite skeleton | Add generic OIDC login and invitation foundations behind safe configuration. |
| v2.0.0-rc.1 | Audit and upgrade hardening | Add management audit logs and final v1.9-to-v2 upgrade guardrails. |
| v2.0.0-rc.2 | Performance report | Publish repeatable benchmark methodology and release-candidate measurements. |
| v2.0.0 | Platform Trust GA | Stabilize docs, onboarding, migration, tests, benchmark data, and release packaging. |
| v2.1.0 | Coding Agent Gateway | Govern Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, and compatible coding agents. |
| v2.2.0 | Intelligence Loop | Add cost optimizer, token prediction, async eval metadata, and opt-in quality gates. |
| v2.3.0 | Provider Extensibility | Add custom provider templates, provider generator beta, registry design, and health dashboard. |
| v2.4.0 | Provider Ecosystem | Expand provider coverage through tested registry and compatibility workflows. |
| v2.5.0 | Agent Platform Preview | Deepen A2A hub, tool registry, and lightweight orchestration without becoming an app builder. |
| v2.6.0 | Cost and Chargeback | Add internal chargeback, anomaly detection, price-change alerts, and feedback metadata. |
| v2.7.0 | Semantic Platform | Productionize semantic cache, prompt registry, context optimization, and intent classification. |

## Non-Goals

SiftGate v2.x is not trying to become every adjacent product:

- no API resale, recharge, or public token distribution platform
- no mandatory SiftGate Cloud dependency for the open-source data plane
- no default storage of prompts, responses, raw provider headers, provider keys,
  tool payloads, hidden reasoning text, media bytes, or resolved secrets
- no full DAG workflow engine in v2.0.0
- no provider-count race at the expense of testability and source governance

## Competitive Framing

| Product | Strength | SiftGate v2.x Difference |
| --- | --- | --- |
| One API | API key redistribution, user quota, and channel management | SiftGate does not optimize for resale. It focuses on internal governance, explainable routing, privacy-safe observability, and self-hosted team infrastructure. |
| New API | Model aggregation, distribution, payments, and format conversion | SiftGate keeps BYOK traffic inside the operator's environment and prioritizes workspace policy, audit, routing evidence, and production operations. |
| LiteLLM | Broad provider compatibility, SDK surface, proxy ecosystem | SiftGate emphasizes workspace governance, route explanations, agent observability, metadata-only privacy boundaries, and a dashboard-first operations model. |
| Portkey | Hosted AI gateway, observability, guardrails, prompt and cost tooling | SiftGate is self-hosted-first: the open-source data plane remains useful without a hosted proxy or mandatory SaaS control plane. |
| Dify | AI application building and workflow composition | SiftGate is not an app builder. It governs AI traffic beneath applications and agents. |
| LangGraph | Agent workflow framework | SiftGate does not replace agent frameworks. It provides the governed ingress, routing, policy, and observability layer those frameworks can call. |

## Release And Safety Rules

Every v2.x release should follow the shared release discipline:

- one version, one branch, one PR, one tag, one release
- no force-pushes or published tag rewrites
- a hotfix release takes priority over roadmap work when existing v1.9 behavior
  is blocked
- each prompt must run its focused tests and the integration gate after merge
- new Dashboard strings require all seven locales: `en`, `zh`, `zh-TW`, `ja`,
  `ko`, `th`, and `es`
- all release metadata must stay aligned across packages, OpenAPI, deployment
  manifests, docs, and tests

The detailed execution prompts live in
[`docs/V2_EXECUTION_PROMPTS.md`](V2_EXECUTION_PROMPTS.md).
