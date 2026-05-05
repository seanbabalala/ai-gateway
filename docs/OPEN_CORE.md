# Open-Source Scope

SiftGate is maintained as a complete self-hosted Data Plane. The open-source runtime should remain useful on one machine with memory state and SQLite, while still supporting optional Redis, PostgreSQL, Docker, Kubernetes, and Helm deployments.

## Public Repository Owns

- gateway runtime
- protocol ingress and provider forwarding
- smart routing, fallback, retry, circuit breakers, and recommendations
- Provider Catalog and local overrides
- Dashboard for local operations
- Gateway API keys, namespaces, local teams, budgets, and rate limits
- config audit and rollback
- secret references
- guardrails plugins
- cache, semantic cache preview, shadow reports, benchmark reports, and eval reports
- local metadata stores and migrations
- Docker, Kubernetes, Helm, docs, SDK scaffolds, and examples

## Runtime Boundary

Open-source users should be able to operate SiftGate independently:

- no hosted service is required for `/v1/*` traffic
- no private package is required for build, test, Docker, Kubernetes, or Helm
- prompts, responses, provider keys, raw headers, media bytes, video bytes, and resolved secret values stay local unless an operator explicitly enables an export surface

## Optional External Integrations

External control planes, log sinks, alert webhooks, secret managers, Redis, and PostgreSQL are integrations. They must stay optional and must not be required for the default memory/SQLite path.

## Feature Placement Rule

Keep runtime data-plane capabilities in the public repository when they are useful to a single self-hosted gateway: routing, fallback, budgets, local API keys, local teams, plugins, cache, protocol conversion, telemetry metadata, Dashboard visibility, and deployment manifests.

Avoid adding code that requires hosted tenancy, private organization services, private dependency packages, or committed secrets.
