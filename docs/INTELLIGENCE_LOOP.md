# Intelligence Loop

SiftGate v2.2.0 adds the first intelligence loop for the open-source data plane:
cost-aware routing evidence, token prediction, async eval metadata, and opt-in
quality gates. It builds on v2.1 Coding Agent Gateway metadata so coding-agent
virtual models such as `coding-fast`, `coding-deep`, and `coding-security` can
be treated as routing intent, not as vendor lock-in.

All features are disabled or evidence-only by default. Enabling the loop does
not store prompts, responses, raw provider headers, provider keys, media bytes,
tool payloads, source code, diffs, hidden reasoning text, or resolved secrets.

## Configuration

```yaml
intelligence:
  cost_optimizer:
    enabled: true
    action: evidence_only       # evidence_only | optimize
    objective: balanced         # cost | balanced | latency | quality
    history_window_hours: 24
    min_samples: 5
    min_savings_ratio: 0.05
    max_latency_penalty_ratio: 0.5
    max_quality_penalty: 0.15
    allow_quality_critical_downgrade: false
  token_prediction:
    enabled: true
    budget_policy: observe      # observe | reject | downgrade
    near_limit_ratio: 0.9
    allow_quality_critical_downgrade: false
  async_eval:
    enabled: true
    sample_rate: 0.05
    dimensions: [latency, toxicity, relevance, format]
    metadata_only: true
    max_recent_jobs: 200
  quality_gate:
    enabled: true
    rules:
      - id: critical-coding
        tiers: [complex, reasoning]
        agent_virtual_models: [coding-deep, coding-security]
        require_text: true
        min_output_tokens: 16
        max_latency_ms: 30000
        fail_on_stop_reasons: [max_tokens]
        actions: [fallback, alert]
```

Run:

```bash
GATEWAY_CONFIG_PATH=gateway.config.example.yaml npm run validate:config
```

## Cost Optimizer

The optimizer evaluates the selected route and fallback candidates with:

- estimated model price from node/model pricing, `models_pricing`, or catalog fallback
- workspace budget headroom from the existing budget service
- observed latency and success metadata when enough samples exist
- provider-cache capability hints
- model quality score where configured
- coding/task intent such as `coding-security` or deep reasoning requests

`action: evidence_only` records optimizer evidence in Route Explanation and call
log metadata but never changes the upstream target. `action: optimize` can move
traffic to a lower-cost eligible fallback only when savings and quality
thresholds pass. Quality-critical requests are not downgraded unless
`allow_quality_critical_downgrade: true` is explicit.

## Token Prediction

Token Prediction estimates input, output, context, and cost risk before the
upstream call. It uses conservative token estimates and the same model pricing
surface as cost analytics.

Budget policy controls action:

- `observe`: record risk evidence only
- `reject`: return `429` before the upstream call when estimated cost exceeds
  the active budget headroom
- `downgrade`: request a lower-cost route, subject to optimizer eligibility and
  quality-critical safeguards

The predictor does not override endpoint, node, model, API key, namespace, team,
workspace, circuit breaker, or fallback policy constraints.

## Async Eval Metadata

Async Eval v1 is a metadata queue, not inline judging. It records job id,
request id, selected target, dimensions, sample rate, workspace id, and
metadata-only status. It does not store prompt or response content unless a
separate existing eval sample-storage opt-in explicitly allows redacted samples.

Default dimensions are placeholders for future evaluators:

- latency
- toxicity
- relevance
- format

## Quality Gate

Quality Gate v1 is disabled by default and evaluates only configured rules. It
can check metadata-safe response properties such as empty text, minimum output
tokens, stop reason, target model, tier, source format, coding virtual model,
and latency.

Rule actions:

- `retry`: retry the same target once before response bytes are sent
- `fallback`: try the next fallback before response bytes are sent
- `alert`: emit a local `quality_gate_failed` alert event

For streaming requests, SiftGate records
`streaming_no_post_start_retry` and never retries or falls back after streaming
bytes have started.

## Dashboard And API

Route Explanation shows a new Intelligence Loop panel with:

- optimizer enabled/applied/evidence-only state
- optimizer objective and selected route change
- token risk and action
- estimated cost and remaining budget
- quality gate status and matched events
- async eval queue state and dimensions

Overview shows a compact Intelligence Loop card with estimated savings,
optimized route count, and quality gate failures.

The Dashboard API exposes:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/intelligence/summary` | Metadata-only optimizer, token risk, async eval, and quality gate summary |

Supported filters: `period`, `api_key`, `api_key_id`, and `namespace`.

The response is derived from call-log metadata only and includes a privacy block
showing prompts, responses, raw headers, provider keys, and tool payloads are
not stored.

## Operational Guidance

- Start with `cost_optimizer.enabled=true` and `action=evidence_only`.
- Enable `token_prediction.enabled=true` with `budget_policy=observe` before
  using reject or downgrade.
- Keep `async_eval.metadata_only=true` in production.
- Use quality gates only on critical routes where retry/fallback cost is
  acceptable.
- Add `quality_gate_failed` to `alerts.channels[].events` only for channels that
  should receive metadata-only quality alerts.
- Review Route Explanation before enabling optimizer `action=optimize`.
