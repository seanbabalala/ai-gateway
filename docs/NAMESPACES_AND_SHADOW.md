# Policy Namespaces And Shadow Traffic

SiftGate v0.5 adds two open-source Data Plane features that work without SiftGate Cloud:

- Policy Namespaces for API key policy boundaries.
- Shadow traffic for safely mirroring sampled requests to a test node.

These are intentionally local OSS features. They do not implement enterprise workspaces, SSO, SCIM, RBAC, or organization billing.

## Policy Namespaces

A Policy Namespace is a local policy label that can be attached to a Gateway API key or local Team. It can restrict which nodes/models the key may use and can define its own budget and rate limit.

It is not a Workspace, tenant, Team, folder, or identity provider. Workspace is
the Dashboard/RBAC/data scope; Policy Namespace is a routing-policy label inside
that scope. See [OSS Concepts](OSS_CONCEPTS.md).

```yaml
namespaces:
  - id: team-a
    name: "Team A"
    allowed_nodes: [openai, anthropic]
    allowed_models: [gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514]
    budget:
      daily_token_limit: 1000000
      daily_cost_limit: 25.00
      alert_threshold: 0.8
    rate_limit:
      requests_per_minute: 120
```

Dashboard-managed keys can be assigned to a namespace when they are created or edited. YAML-defined keys can use `namespace_id`:

```yaml
auth:
  api_keys:
    - key: "${SIFTGATE_TEAM_A_KEY}"
      name: team-a-service
      namespace_id: team-a
```

Policy behavior:

- Policy Namespace `allowed_nodes` and `allowed_models` are intersected with API-key restrictions.
- Policy Namespace budgets are checked and recorded alongside global, Team, and API-key budgets.
- Policy Namespace rate limits apply when a key does not have a stricter key-specific rate limit.
- Unknown Policy Namespace references are rejected during config validation.
- Call logs store `namespace_id`, and Dashboard stats/logs/cost/budget views can be filtered by Policy Namespace.

The Dashboard Policy Namespaces page manages the same config-backed
`namespaces` records. Admins can create, edit, and delete id, name,
`allowed_nodes`, `allowed_models`, `budget`, and `rate_limit` fields. Each
mutation writes through the config audit/rollback path, validates the full
candidate config, hot-reloads the gateway, and rewrites only the `namespaces`
section so provider secrets and runtime secret references outside that section
are not materialized by namespace edits.

`GET /api/dashboard/namespaces` returns local Policy Namespace policies, budget
status, summary counts, and current API key/Team bindings. `POST
/api/dashboard/namespaces`, `PUT /api/dashboard/namespaces/:id`, and `DELETE
/api/dashboard/namespaces/:id` require a Dashboard Admin role. Deleting a
namespace with bound API keys or Teams returns conflict unless the caller
resubmits with `confirm_impact: true`; backend validation still decides whether
the delete is safe to persist.

## Shadow Traffic

Shadow traffic mirrors a sampled copy of successful primary requests to a configured test node/model. It is disabled by default and runs asynchronously, so it does not block, modify, or promote the primary response path.

```yaml
shadow:
  enabled: true
  sample_rate: 0.05
  target_node: openai-staging
  target_model: gpt-4o-mini
  timeout_ms: 30000
  max_recent_results: 100
  compare:
    store_prompts: false
    store_responses: false
    sample_max_chars: 4000
```

Safety defaults:

- `enabled` defaults to `false`.
- `sample_rate` defaults to `0`.
- Prompt/input samples are not stored unless `compare.store_prompts: true`.
- Response samples are not stored unless `compare.store_responses: true`.
- If sample storage is explicitly enabled, samples are redacted with built-in secret/email patterns and truncated to `compare.sample_max_chars`.
- Raw request headers and provider keys are never stored in shadow results.
- Media bytes, video bytes, raw realtime frames, and uploaded files are never stored in shadow comparison reports.
- Shadow sends are fire-and-forget and do not affect routing, budgets, or call logs for the primary request.

When comparison storage is enabled, the config validator prints a warning because local prompt/response samples may still contain sensitive data after redaction.

The Dashboard endpoint `GET /api/dashboard/shadow?namespace=<id>&limit=50` returns the sanitized shadow status and recent results. The Dashboard Shadow Traffic page is read-only; it cannot apply routing changes or promote a shadow target.

### Comparison report

v0.9 adds a read-only report layer on top of the existing shadow result rows. The report pairs `shadow_traffic_results.request_id` with the primary `call_logs.request_id` and calculates:

- primary and shadow success rate
- latency delta plus p50/p95 latency comparison
- estimated cost delta and potential savings
- token delta and fallback delta
- quality sample coverage, confidence, and risk notes

APIs:

- `GET /api/dashboard/shadow/report`
- `GET /api/dashboard/shadow/results/:id/comparison`

`/api/dashboard/shadow/report` supports `namespace`, `api_key`, `api_key_id`, `node`, `model`, `period`, and `source_format` filters. Node/model filters match either the primary side or the shadow side, which makes it easy to inspect a candidate test node or compare all traffic from one primary model.

Reports are decision support only. They do not apply routing changes, edit split weights, or promote shadow targets automatically.

The Dashboard **Setup state and mirror boundary** panel summarizes whether
shadow traffic is enabled, whether a target node/model is configured, and
whether prompt/response samples are explicitly stored. Keep
`compare.store_prompts=false` and `compare.store_responses=false` for the
default metadata-only comparison mode.

Shadow Traffic, Traffic Experiments, and Evals intentionally answer different
questions:

- Traffic Experiments split live primary traffic between configured routing
  variants.
- Evals run controlled primary/candidate/judge comparisons and report
  metadata-only outcomes.
- Shadow Traffic mirrors sampled successful requests after the primary path and
  never changes routing by itself.

## Validation

`npm run validate:config -- --config gateway.config.yaml` checks:

- namespace shape, unique IDs, node/model references, budget values, and rate-limit values
- API key `namespace_id` references
- shadow `sample_rate`, target node/model references, timeout, retention limit, sample length, and comparison-storage warnings

Errors are CI-failing. Warnings do not fail validation but should be reviewed before production deploys.
