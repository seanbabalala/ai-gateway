# Billing Loop

This document defines the accounting invariants for SiftGate.

v2.6.0 adds the Cost And Chargeback Platform on top of these invariants. It
produces internal workspace/team/project/API-key chargeback summaries, exports,
cost anomaly alerts, provider price-source status, and thumbs feedback
aggregation. It does not add payments, prepaid balances, recharge, reseller
ledgers, customer billing identities, or a public API marketplace.

## Identity

- Provider API keys are upstream credentials. They are never client billing identity.
- Gateway API keys are client credentials. A generated Gateway API key has an immutable `id`.
- `api_key_id` is the primary billing, budget, rate-limit, and log identity.
- `api_key_name` is a display label. It remains useful for older YAML-defined keys, but generated keys must not depend on the name for accounting.

## Request Path

For every proxy request:

1. `ApiKeyGuard` validates `Authorization: Bearer <gateway_key>`.
2. The request metadata receives `api_key_id`, `api_key_name`, and permissions.
3. `RateLimitGuard` uses `api_key_id` when present, otherwise legacy key name or IP.
4. `BudgetService.reserve()` reserves estimated token and cost usage against
   global, namespace, team, and per-key rules before provider dispatch.
5. Routing resolves either `auto` or direct model routing according to key
   permissions.
6. The gateway serves a prompt-cache hit or calls an upstream node.
7. Successful responses commit actual token and cost usage against global,
   namespace, team, and per-key budgets.
8. Failed or aborted responses release unused reservation amounts.
9. `call_logs` stores the same `api_key_id`, key name, route, usage, cost,
   status, and latency.

Dashboard views that filter generated Gateway API keys use `api_key_id`. The older `api_key` name filter is retained only as a compatibility path for legacy YAML-defined keys.

## Budgets

Global budget rules have both `api_key_id = NULL` and `api_key_name = NULL`.

Generated-key budget rules have `api_key_id = GatewayApiKey.id` and `api_key_name = current display name`.

Legacy YAML per-key budget rules have `api_key_id = NULL` and `api_key_name = YAML key name`.

Generated-key budget rules are owned by `GatewayApiKeyService`. YAML cleanup must not deactivate them.

Budget reset uses `budget_rule.id`. It must not use rule type, because `daily_tokens` and `daily_cost` can exist in both global and per-key scopes.

## Shared Budget Backend Decision

PostgreSQL is the supported shared backend for strict multi-instance budget
reservation semantics. When every gateway instance points at the same
PostgreSQL metadata database, `BudgetService.reserve()`, `commit()`, `release()`,
and `record()` run their mutations inside database transactions and lock active
budget rows before evaluating projected usage. This keeps concurrent gateways
from admitting reservations that would exceed the same global, namespace, team,
or per-key rule.

SQLite and in-memory repositories remain supported for local development,
tests, and small single-process deployments. They serialize budget mutations
inside one gateway process, but they are not a cross-process coordination
mechanism. Do not advertise strict shared-budget enforcement for multiple
gateway instances unless they share PostgreSQL as the budget source of truth.

Redis shared state is intentionally not a budget ledger today. Redis is useful
for runtime coordination such as rate limits, circuit breaker state, affinity,
and realtime metadata, but budget counters remain durable database records. A
Redis atomic reservation backend should be added only if a future deployment
requirement needs strict shared-budget enforcement across multiple gateway
instances without using PostgreSQL as the shared metadata database.

## Cache Hits

Gateway prompt-cache hits do not call an upstream provider, but they are successful client responses. They are logged with:

- `tier = cached`
- `node_id = cache`
- `model = cached response model`
- the cached response usage
- estimated cost from the cached response model pricing

The same usage and cost are recorded against budgets. This keeps Budget, Logs, Analytics, and per-key usage views in sync.

## Failures

Failed upstream requests are logged with status/error, retry count, and zero token/cost usage.

Successful streaming requests record usage after the final usage event. If a stream fails before final usage is available, the failure log remains zero usage/cost.

## Over-Budget Responses

Budget failures return HTTP `429`.

OpenAI-style endpoints return:

```json
{
  "error": {
    "type": "budget_exceeded",
    "code": "daily_cost",
    "message": "Budget exceeded ...",
    "details": {
      "scope": "api_key",
      "api_key_id": "key_...",
      "api_key_name": "production",
      "budget_type": "daily_cost",
      "current": 5.25,
      "limit": 5,
      "reset_at": "2026-04-30T00:00:00.000Z"
    }
  }
}
```

Anthropic Messages-style endpoints return the same details under:

```json
{
  "type": "error",
  "error": {
    "type": "budget_exceeded",
    "message": "Budget exceeded ...",
    "details": {}
  }
}
```

## Pricing Gaps

If a model has no node/model pricing override and no `models_pricing` entry, SiftGate can fall back to the merged Provider Catalog price when that catalog entry has usable input/output token pricing. Explicit user configuration always wins over catalog metadata.

v1.4 uses one pricing resolver for routing, benchmark reports, catalog APIs, and config validation. The resolver priority is:

1. `nodes[].model_capabilities.<model>.pricing`
2. `models_pricing`
3. `catalog.override.yaml`
4. local catalog sync cache
5. built-in Provider Catalog

Built-in catalog prices are local reference snapshots and usually marked `manual_review_required`; they are good enough to keep cost-aware routing and budget estimates from going blind, but operators should override them with verified local rates for production billing decisions. OpenRouter can sync prices into the local catalog cache or an override file. In v1.7, ZeroEval can also enrich known provider/model entries with third-party reference pricing metadata in the local sync cache, but that enrichment remains review-required and never outranks explicit operator config. Other providers still need docs review or local rate cards.

If no explicit price and no usable catalog fallback exists, routing is still allowed and tokens are still logged. Cost is recorded as `0`, and diagnostics surface the missing pricing or catalog price source issue.

## Chargeback And Feedback

Chargeback reports read `call_logs` and `route_decisions` metadata only. They
can group cost by workspace, team, project, Gateway API key, model, or node and
export CSV/JSON for internal allocation. Exports never include prompts,
responses, source code, diffs, tool payloads, raw headers, provider keys, media
bytes, hidden reasoning text, or resolved secrets.

`POST /v1/feedback` lets clients attach thumbs up/down metadata to a request id.
The feedback row stores workspace id, request id, route decision id when
available, Gateway API key id/name, team id, value, reason code, source, and
route-weight evidence. It ignores content-bearing fields and does not
automatically change routing weights in v2.6.0.

Cost anomaly detection compares spend windows and emits metadata-only
`cost_anomaly` alerts. Recommended policies may suggest optional downgrade, but
automatic routing changes require explicit operator policy.

## Verification

The E2E billing-loop test creates a dashboard-generated Gateway API key, sends both `auto` and direct requests, checks logs/stats/budget by `api_key_id`, verifies direct-routing permission failures, and confirms over-budget requests return `429` without reaching an upstream node.
