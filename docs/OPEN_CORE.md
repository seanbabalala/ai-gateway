# Open Core Strategy

SiftGate is open source as a complete self-hosted data plane. The hosted product is a control plane for teams that need fleet governance, shared policy, audit, and intelligent router optimization.

## Repositories

SiftGate is split across two repositories:

| Repository | Visibility | License | Owns |
| --- | --- | --- | --- |
| `https://github.com/seanbabalala/ai-gateway` | Public | MIT | Open-source Data Plane, local dashboard, routing runtime, plugin SDK, observability, Docker, tests, and public connected-gateway client/types. |
| `https://github.com/seanbabalala/siftgate-cloud` | Enterprise/private | Commercial/private unless changed separately | Cloud Control Plane API, enterprise dashboard, public website, multi-tenant workspace/RBAC/audit/policy workflows, deployment config, and commercial product surfaces. |

The Cloud repository must not be committed as a subdirectory of the public repository. Local checkouts may sit next to each other, or temporarily under the same parent folder, but Git tracking stays separate.

## Open Source Data Plane

The open-source gateway runs in your infrastructure and handles real AI traffic locally:

- `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and `/v1/models`
- protocol conversion and streaming
- smart routing, fallback, retry, circuit breaker, and A/B split
- Gateway API keys, permissions, budgets, and rate limits
- Dashboard, logs, analytics, node health, and cache visibility
- plugins, OpenTelemetry, Docker, SQLite/Postgres

Prompts, responses, provider API keys, and customer network traffic stay in the operator's environment.

## Hosted Control Plane

The hosted product manages gateways without proxying AI requests by default:

- workspace and team management
- gateway fleet registration, heartbeat, version drift, and health
- privacy-preserving telemetry and audit metadata
- policy bundles for routing, budgets, rate limits, emergency overrides, and key policy
- router recommendations, savings reports, reliability analysis, and future Autopilot

The hosted control plane receives metadata such as model, node, tier, latency, token usage, cost, status, fallback, retry, cache hit, and policy hits. It does not need prompt or response content for cost optimization, health analysis, or route recommendations.

## Integration Contract

The repositories meet at explicit public contracts:

- Data Plane source of truth: `src/control-plane/types.ts`, `src/control-plane/*`, and `docs/CONTROL_PLANE.md`
- Cloud implementation: the enterprise repo implements the Data Plane-facing endpoints and may keep its own generated DTOs/OpenAPI files
- Transport: HTTPS APIs for registration, heartbeat, telemetry batch upload, and policy pull
- Dependency rule: the public Data Plane must not import enterprise packages or require Cloud services to serve `/v1/*` traffic

When a contract change is needed, update the public Data Plane types/docs first, then update the Cloud implementation and compatibility smoke in the enterprise repository.

## Commercial Boundary

Open-source users should be able to operate SiftGate independently. Paid value comes from managing many gateways and teams over time:

- Team: hosted workspace, gateway fleet, metadata analytics, policy sync
- Business: RBAC, audit history, recommendations, policy versioning
- Enterprise: SSO, approval workflows, audit export, compliance, Autopilot, SLA

SiftGate does not plan to make AI API resale the default business model. Users bring their own provider endpoints and keys.

## Feature Placement Rule

Keep runtime data-plane capabilities in the public repo when they are useful to a single self-hosted gateway: routing, fallback, budgets, local API keys, plugins, cache, protocol conversion, local telemetry, and local dashboard visibility.

Keep fleet and commercial surfaces in the enterprise repo when they require hosted tenancy or organization-wide coordination: workspaces, billing, RBAC, SSO, invite flows, fleet policy management, audit export, recommendations across many gateways, website, pricing, and deployment automation.
