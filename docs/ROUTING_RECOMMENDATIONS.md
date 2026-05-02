# Routing Recommendations

SiftGate Data Plane includes a local recommendation mode for adaptive routing. It reads recent `call_logs`, computes sliding-window metrics per `node:model`, and returns reviewable suggestions for the configured tier lanes.

This mode is read-only. It does not edit `gateway.config.yaml`, does not call `ConfigService.updateRouting`, and does not apply Dashboard changes automatically.

## Metrics

The recommendation window reports:

- success rate
- p50 and p95 latency
- total and average cost
- cost per 1,000 calls
- fallback call count and fallback rate
- retry count

Defaults:

- `window_hours=24`
- `sample_limit=1000`
- `min_samples=5`

## API

```bash
GET /api/dashboard/routing/recommendations?window_hours=24&sample_limit=1000
```

Response shape:

```json
{
  "mode": "recommendation_only",
  "stats": {
    "observed_calls": 120,
    "targets": []
  },
  "recommendations": [
    {
      "tier": "standard",
      "type": "promote_primary",
      "current_primary": { "node": "openai", "model": "gpt-4o" },
      "suggested_primary": { "node": "anthropic", "model": "claude-sonnet-4-20250514" },
      "reasons": ["..."],
      "confidence": 0.72,
      "potential_savings": {
        "cost_usd_per_1k_calls": 0.42,
        "window_cost_usd": 0.12,
        "p50_latency_ms": 180,
        "p95_latency_ms": 430
      },
      "risks": ["..."]
    }
  ]
}
```

Recommendation types:

- `promote_primary` — a configured fallback or split target looks better than the current primary.
- `investigate_primary` — the current primary appears unreliable, but there is not enough evidence to promote another target.
- `collect_more_data` — the local window is too sparse for a route-change recommendation.

## Dashboard

The Routing page shows the same recommendations as a read-only panel. Operators can inspect confidence, reasons, savings, risks, and the underlying node:model stats before making manual routing changes.
