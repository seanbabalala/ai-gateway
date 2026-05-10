# OSS Concepts

SiftGate OSS uses a few platform concepts that sound similar but serve
different jobs. This page is the product vocabulary used by the Dashboard and
docs in v2.8.0.

## Capability Status Language

| Label | Meaning |
| --- | --- |
| Read-only | The Dashboard reports state or evidence. It does not create or mutate the resource from that page. |
| Config-driven | The concept is created or changed through `gateway.config.yaml`, existing config APIs, or existing management flows. |
| Preview | The surface is available in OSS, but the feature boundary is intentionally narrow. |
| OSS fixed roles | The open-source Dashboard uses the fixed Admin, Operator, and Viewer roles. |
| Runtime-supported | The gateway runtime already enforces or records the concept. The Dashboard explains the boundary. |
| Requires config | The page stays empty until the related providers, namespaces, policies, or samples are configured. |

## Workspace

A Workspace is the active operating scope for Dashboard data, RBAC membership,
audit evidence, Gateway API keys, budgets, nodes, logs, eval reports, MCP
metadata, and other local metadata.

Fresh OSS installs bootstrap `Default Organization` and `Default Workspace`.
The Dashboard can switch among workspaces returned by
`GET /api/dashboard/workspaces`. v2.8.0-alpha.3 adds admin-only local
Workspace management: create, rename, disable, reactivate, and switch.
Creating a Workspace grants the current Dashboard identity the Admin role in
that Workspace.

Disabling a Workspace is not deletion. SiftGate keeps the local metadata and
audit history, does not migrate default Workspace data, and does not resolve a
disabled Workspace for runtime Dashboard selection until an Admin reactivates
it.

## Policy Namespace

A Policy Namespace is a local routing policy label. It is configured under
`namespaces:` and can be attached to Gateway API keys, local Teams, MCP server
allow-lists, shadow filters, budgets, logs, and stats.

Policy Namespace is not a Workspace, tenant, team, folder, or identity system.
It does not create isolation by itself; it participates in policy checks with
Gateway API keys, Teams, budgets, allowed nodes/models/endpoints, rate limits,
and routing config.

v2.8.0-beta.1 adds admin-only Dashboard management for config-backed Policy
Namespaces. Admins can create, edit, and delete `namespaces` with id, name,
allowed nodes, allowed models, budget, and rate-limit fields. SiftGate rewrites
only the `namespaces` section, validates the full candidate config, records a
config audit event, and hot-reloads through the existing rollback-safe path.
Deleting a namespace that is bound to API keys or Teams requires explicit
impact confirmation and still fails if backend validation rejects the resulting
config.

## Team

A Team is a local Dashboard policy bundle for multiple Gateway API keys. Team
policy is intersected with key policy and optional Policy Namespace policy.
Disabling a Team disables the keys bound to it.

Teams are useful for shared budgets, rate limits, allowed endpoints, allowed
modalities, allowed nodes, and allowed models across several client apps.

## Gateway API Key

A Gateway API Key identifies a client application calling SiftGate. It can bind
to a Team and/or Policy Namespace and can restrict auto routing, direct routing,
endpoints, modalities, nodes, models, budgets, and rate limits.

Dashboard create/rotate responses show the full key once. Stored Dashboard and
API views show only masked prefixes and policy metadata.

## Node

A Node is a configured upstream route in `gateway.config.yaml`: a provider
account, deployment, proxy, local model server, or custom upstream. Nodes are
runtime targets that SiftGate can route to after policy, budget, health, and
fallback checks pass.

## Provider

A Provider is catalog metadata: identity, base URL defaults, auth type,
compatibility profile, model buckets, capabilities, pricing source status,
refresh source status, and visibility. Provider Catalog rows help operators
configure Nodes, but they are not live credentials or runtime routes by
themselves.

The Provider Catalog shows active canonical projections by default. Legacy,
transport-only, deprecated, and review-required rows can exist for compatibility
or migration context, but they stay behind explicit visibility controls unless
the operator configures them.

## Common Confusions

| If you mean... | Use this concept |
| --- | --- |
| "Which workspace's Dashboard data and RBAC am I looking at?" | Workspace |
| "Which local policy label should this key/team/request use?" | Policy Namespace |
| "Which group shares key permissions and limits?" | Team |
| "Which client app is calling the gateway?" | Gateway API Key |
| "Which upstream deployment can receive traffic?" | Node |
| "Which provider preset/catalog metadata helps me create a node?" | Provider |

## First-Run Setup Order

For a fresh OSS install, follow this order:

1. Workspace: choose the local Dashboard/RBAC/data scope.
2. Provider Node: connect at least one upstream runtime target.
3. Gateway API Key: issue a client credential for `/v1/*`.
4. Budget scope: confirm the daily Global, Policy Namespace, Team, and API Key
   source of truth.
5. Policy Namespace: optional, only when keys or Teams need shared local
   policy.
6. First request: send traffic from Playground or an OpenAI-compatible client.
7. Evidence: inspect Logs and Route Explanation.
8. Advanced setup: enable Semantic Controls, Traffic Experiments, Eval Reports,
   Shadow Traffic, or MCP Tool Gateway only when those specific jobs are needed.

## Privacy Boundary

These concepts do not change the default storage contract. SiftGate does not
store prompts, responses, raw provider headers, provider keys, Gateway API key
plaintext, tool payloads, media bytes, hidden reasoning text, or resolved
secrets by default.
