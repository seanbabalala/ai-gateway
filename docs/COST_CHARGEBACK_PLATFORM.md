# Cost And Chargeback Platform

SiftGate v2.6.0 turns cost analytics into an internal chargeback and anomaly
response layer for the open-source data plane. It is not a payment, recharge,
reseller balance, or public API marketplace feature.

The platform uses request metadata that SiftGate already records: workspace,
team, project, Gateway API key id/name, model, node, token counts, estimated
cost, latency, optimizer metadata, quality-gate status, provider price source
status, and optional thumbs feedback.

It does not store prompts, responses, source code, diffs, tool inputs, tool
outputs, raw provider headers, provider keys, media bytes, hidden reasoning
text, or resolved secrets by default.

## Dashboard

The Dashboard **Cost Platform** page reads:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/cost-platform` | Internal chargeback, anomaly, pricing, and feedback summary |
| `GET` | `/api/dashboard/cost-platform/export?format=csv` | CSV chargeback export |
| `GET` | `/api/dashboard/cost-platform/export?format=json` | JSON chargeback export |

Supported filters are `period`, `group_by`, `team_id`, `project`, and
`api_key_id`. Exports return metadata-only chargeback rows and include
`X-SiftGate-Privacy: metadata-only`.

## Chargeback Reports

Chargeback summaries include request counts, success/failure counts, token
usage, estimated USD cost, estimated optimizer savings, fallback count,
optimizer-applied count, quality-gate failure count, average latency, and
success rate.

Budget period close reports mark the workspace as `ready`, `near_budget`, or
`over_budget`. They deliberately keep `payment_collection: false` and
`recharge_balance: false`. Provider invoices and explicit operator rate cards
remain the billing authority.

## Cost Anomaly Detection

v2.6.0 ships a conservative rate-of-change detector over the selected period.
It compares the current half of the window against the previous half and emits
metadata-only `cost_anomaly` alerts for warning or critical spikes.

Automatic downgrade remains optional and disabled by default. The anomaly
payload includes a recommended policy such as `alert` or `optional_downgrade`,
but it does not silently change routing.

## Provider Price Sync Guardrails

The price sync summary is governance-first:

- only explicit supported sources are listed
- scheduled sync remains operator controlled
- source freshness and review-required states are surfaced
- operator overrides are never overwritten silently
- synced prices are not automatically trusted

SiftGate can use catalog/sync metadata for estimates when explicit pricing is
missing, but production chargeback decisions should use verified local rates.

## Feedback Loop

Clients can record thumbs feedback with:

```bash
curl http://localhost:2099/v1/feedback \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -H "content-type: application/json" \
  -d '{
    "request_id": "req_01HY...",
    "value": "up",
    "reason_code": "helpful"
  }'
```

Accepted values are `up`, `down`, `thumbs_up`, and `thumbs_down`.

The endpoint stores metadata only: workspace id, request id, route decision id
when present, Gateway API key id/name, team id, value, reason code, source, and
route weight evidence from the route decision trace.

Fields such as prompts, responses, source code, diffs, tool payloads, raw
headers, provider keys, media bytes, and hidden reasoning text are ignored and
not persisted.

v2.6.0 aggregates feedback by model and node. It does not automatically feed
feedback back into routing weights; that remains a future operator-controlled
policy.

## Boundaries

v2.6.0 does not add payments, prepaid balances, recharge flows, reseller
ledgers, customer billing identities, a public API marketplace, prompt/response
storage, automatic price trust, silent automatic provider price override, or
silent automatic quality downgrade.
