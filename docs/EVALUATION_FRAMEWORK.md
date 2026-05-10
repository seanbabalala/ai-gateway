# Evaluation Framework

SiftGate v1.3 adds a local Evaluation Framework preview for comparing a primary route against a candidate route with the same OSS Data Plane that serves normal traffic. In the Dashboard this appears as **Eval Reports** to distinguish it from **Traffic Experiments**, which are read-only analytics for configured routing splits. Evals are designed for production operators who want comparison reports without sending prompts, responses, provider keys, or raw headers to a hosted service.

## What It Stores

The default storage model is metadata-only:

- dataset id, name, source, sample count, and sanitized metadata
- experiment run id, primary/candidate node and model, judge model, status, timestamps, aggregate success/latency/cost/fallback/judge metrics
- per-sample hashes, request ids, status codes, latency, cost, fallback flags, judge score, judge label, sanitized error type, and sanitized metadata

It does not store prompt text, response text, raw request headers, provider API keys, media bytes, video bytes, or judge rubric text by default.

If you explicitly enable both `evaluation.store_samples: true` in config and `store_samples: true` on a run request, SiftGate can keep short redacted previews for local debugging. This is off by default and should stay off for sensitive production datasets.

```yaml
evaluation:
  enabled: true
  store_samples: false
  max_sample_chars: 500
  retention_days: 30
  judge_model: gpt-4o-mini
```

## Dashboard APIs

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/dashboard/evals/reports` | List metadata-only experiment reports |
| `GET` | `/api/dashboard/evals/reports/:id` | Read one report with sample-level metadata |
| `POST` | `/api/dashboard/evals/runs` | Run a local primary-vs-candidate experiment through normal SiftGate routing |

The Dashboard page is read-only and uses the two `GET` endpoints. The `POST` endpoint is intended for local automation and requires the same Dashboard session guard.

## Run Shape

```json
{
  "dataset": {
    "name": "routing-regression",
    "source": "local"
  },
  "primary": {
    "node_id": "openai",
    "model": "gpt-4o-mini"
  },
  "candidate": {
    "node_id": "groq",
    "model": "llama-3.3-70b"
  },
  "judge": {
    "model": "gpt-4o-mini",
    "score_scale": "zero_to_one",
    "rubric": "Score candidate quality against the primary answer."
  },
  "samples": [
    {
      "id": "case-001",
      "prompt": "A local sample prompt used only in this run.",
      "expected": "Optional expected outcome summary."
    }
  ]
}
```

Primary, candidate, and judge calls all go through `PipelineService.process`, so normal routing, API key policy, budget, fallback, telemetry, call logs, and route-decision trace behavior still apply. The judge prompt is transient runtime input and is not persisted by the evaluation tables.

## Report Metrics

Reports compare:

- primary and candidate success rate
- average latency
- total estimated cost
- fallback rate
- LLM-as-judge average score
- winner: `primary`, `candidate`, or `tie`

Per-sample rows include request ids so operators can jump from an eval report to Logs or Route Explanation when those records exist.

## Production Notes

- Keep `store_samples` disabled unless you have a clear local debugging need and retention policy.
- Use small, representative datasets first; the judge model is a normal upstream call and can spend real budget.
- Treat judge scores as operational evidence, not ground truth. Review outliers and use fixed rubrics for comparable runs.
- Back up `eval_datasets`, `eval_experiment_runs`, and `eval_sample_results` if you rely on historical reports.
