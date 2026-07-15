# Operator Observability Runbook

This runbook gives operators one place to triage SiftGate health signals across
Dashboard auth, streaming lifecycle, budget reservations, error redaction, MCP
Tool Gateway, and frontend performance gates. It only uses bounded labels and
metadata-only surfaces; do not add prompts, responses, provider keys, raw
headers, tool payloads, or resolved secret values to incident notes.

## Enable Runtime Telemetry

OpenTelemetry is disabled by default. Enable it in deployments that need
runtime metrics or traces:

```yaml
telemetry:
  enabled: true
  service_name: siftgate
  metrics:
    prometheus_port: 9464
  traces:
    endpoint: "http://localhost:4318/v1/traces"
    sample_rate: 1
```

The Prometheus scrape endpoint is exposed on `:9464/metrics` by default when
telemetry is enabled. Some Prometheus exporters normalize dots in metric names
to underscores; use the exact name shown by your `/metrics` output when writing
alerts.

## Triage Loop

1. Pick a short observation window such as `15m` for active incidents or `24h`
   for release burn-down checks.
2. Start from the signal matrix below and inspect only bounded labels.
3. Compare the metric spike with Dashboard metadata pages, management audit
   entries, config changes, and recent deploys.
4. Decide whether the next action is rollback, config tuning, client migration,
   provider escalation, or test coverage.
5. Record the metric query, time window, affected deployment, and remediation in
   release or incident notes.

## Signal Matrix

| Area | Primary signal | Bounded labels | First question |
| --- | --- | --- | --- |
| Dashboard auth | `siftgate_dashboard_auth_events_total` | `event`, `mode` | Did auth fail closed or did a deployment intentionally disable auth? |
| Legacy Dashboard tokens | `siftgate_dashboard_legacy_token_events_total` | `event`, `source` | Are any clients still using bearer or SSE query-token compatibility? |
| Stream lifecycle | `siftgate_stream_lifecycle_total` | `event`, `reason`, `phase`, `node`, `model` | Are timeouts from provider slowness, configured caps, or client aborts? |
| Budget reservations | `siftgate_budget_reservations_total`, `siftgate_budget_usage_ratio` | `event`, `scope`, `budget_type` | Are reservations rejected by policy or leaking without commit/release? |
| Error redaction | `siftgate_error_redactions_total` | `surface`, `reason` | Are sanitized provider/control surfaces seeing new secret-bearing errors? |
| MCP Tool Gateway | Dashboard MCP summary at `GET /api/dashboard/mcp` | `denial_reason`, `server_id`, `stdio_env_policy` | Is denial caused by endpoint, tool, namespace, or stdio env policy? |
| Frontend performance | `cd frontend && npm run build`, `npm run fcp:check` | chunk label, route smoke | Did a release grow the dashboard entry, vendor, chart, or route chunks? |

## Dashboard Auth

Watch auth status and disabled-auth startup events:

```promql
sum by (event, mode) (
  increase(siftgate_dashboard_auth_events_total[15m])
)
```

- `event="status_failure"` means `/api/auth/status` could not build a normal
  response and protected routes should stay blocked.
- `event="disabled_auth", mode="production_ignored"` means production ignored
  `dashboard.auth_required=false` because the explicit break-glass env var was
  absent.
- `mode="production_allowed"` should be treated as a temporary exception and
  tied to an incident or controlled maintenance window.

For legacy token migration, use the dedicated
[legacy token burn-down runbook](SECURITY.md#legacy-dashboard-token-burn-down):

```promql
sum by (event, source) (
  increase(siftgate_dashboard_legacy_token_events_total[24h])
)
```

## Stream Lifecycle

Watch stream interruptions by reason and phase:

```promql
sum by (reason, phase, node, model) (
  increase(siftgate_stream_lifecycle_total[15m])
)
```

- `reason="client_aborted"` usually points to browser, SDK, proxy, or caller
  disconnect behavior. A sudden spike can indicate an upstream UI or timeout
  change.
- `reason="idle_timeout"` means the provider stream stopped producing chunks
  longer than `connection.body_timeout_ms`.
- `reason="max_duration"` means `connection.stream_max_duration_ms` capped the
  total stream lifetime.
- `phase="pre_first_chunk"` can still be fallbackable; `phase="transmission"`
  means some data may already have reached the caller.

Pair lifecycle counters with latency and upstream errors:

```promql
histogram_quantile(
  0.95,
  sum by (le, node, model) (rate(siftgate_request_duration_seconds_bucket[5m]))
)
```

If the provider-specific upstream metric appears as
`gateway_upstream_duration` or `gateway_upstream_errors` in your scrape output,
use that normalized name for provider-level dashboards.

## Budget Reservations

Budget reservation events are intentionally low-cardinality:

```promql
sum by (event, scope, budget_type) (
  increase(siftgate_budget_reservations_total[15m])
)
```

- `event="rejected"` means a budget rule blocked the request before provider
  dispatch. Confirm the `scope` and `budget_type` match the intended policy.
- `event="reserve"` should roughly pair with `commit` or `release` after
  in-flight requests settle. A sustained gap can indicate a request lifecycle
  path that reserves but does not finish cleanly.
- `siftgate_budget_usage_ratio` reports the highest current usage ratio by
  `scope` and `budget_type`; alert before `1.0` if operators need time to raise
  or reset budgets.

Useful release check:

```promql
max by (scope, budget_type) (siftgate_budget_usage_ratio)
```

When investigating rejected budget requests, use Dashboard budget views and
management audit summaries. Do not add API key names or secret key material to
shared incident notes.

## Error Redaction

Redaction events count that sensitive-looking material was removed before
public responses, logs, reports, or compatibility surfaces:

```promql
sum by (surface, reason) (
  increase(siftgate_error_redactions_total[15m])
)
```

Expected `surface` values are `provider`, `batch`, `realtime`, `benchmark`, and
`compatibility`. Expected `reason` values are `bearer_token`, `gateway_key`,
`provider_key`, `sensitive_value`, and `sensitive_field`.

Treat spikes as a prompt to inspect the owning surface and provider behavior.
Treat `reason="unknown"` or `surface="unknown"` as a regression candidate for a
focused redaction test.

## MCP Tool Gateway

The MCP Tool Gateway exposes operational metadata through the Dashboard MCP page
and `GET /api/dashboard/mcp`.

Use these fields first:

- `denial_summary[]` grouped by `server_id` and `denial_reason`
- `recent_calls[]` status, latency, request byte size, and sanitized error type
- `stdio_env_policy.blocked_parent_env_count` for local stdio servers

Denial reasons are bounded:

- `endpoint_policy`: the Gateway API key is not allowed to call MCP.
- `tool_policy`: the key can call MCP but not the requested tool.
- `namespace_required`: the MCP server requires a Policy Namespace.
- `namespace_policy`: the provided namespace is not allowed for that server.

For stdio MCP servers, a high blocked parent env count is expected when the
default least-privilege env policy is working. Add explicit `env` or
`env_allowlist` entries only for variables the MCP process truly needs.

## Frontend Performance Gates

Frontend performance is enforced at release time, not through runtime
Prometheus metrics.

Run:

```bash
cd frontend
npm run fcp:check
npm run build
```

`npm run build` runs `bundle:check` after Vite build. Current gzip budgets are:

| Bundle label | Limit |
| --- | ---: |
| Dashboard entry | 20 kB |
| React vendor | 70 kB |
| Shared vendor | 120 kB |
| Charts vendor | 95 kB |
| Largest route chunk | 30 kB |

If a budget fails, inspect the emitted asset name, keep route-heavy imports lazy,
and avoid moving chart or provider-catalog dependencies into the dashboard entry
chunk.

## Release Evidence Checklist

For releases that touch these areas, capture:

- The exact metric query and window used for auth, stream, budget, and redaction
  checks.
- Whether legacy Dashboard token usage was zero before
  `dashboard.allow_legacy_token_auth=false`.
- The MCP denial summary if MCP policy or stdio env behavior changed.
- Frontend `npm run fcp:check` and `npm run build` output when dashboard code
  changed.
- Any rollback switch used, including the config key and the reason it was
  safe to revert.
