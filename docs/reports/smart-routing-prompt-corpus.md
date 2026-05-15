# Smart Routing Prompt Corpus

Generated at: 2026-05-06T22:02:19.419465
Version: 1.0.0
Random seed: 42
Total prompts: 500

This report summarizes the prompt corpus used for SiftGate smart-routing
benchmark work. It records source counts, task tiers, and source licenses so
operators can understand the benchmark input mix without requiring raw prompt
content in public documentation.

## Tier Distribution

| Tier | Prompt Count |
| --- | ---: |
| Simple | 75 |
| Standard | 150 |
| Complex | 175 |
| Reasoning | 100 |

## Source Counts

| Source | Institution | License | Prompt Count |
| --- | --- | --- | ---: |
| WildBench v2 | Allen Institute for AI | CC-BY-4.0 | 157 |
| IFEval | Google Research | Apache-2.0 | 140 |
| MT-Bench | LMSYS / UC Berkeley | Apache-2.0 | 95 |
| GSM8K | OpenAI | MIT | 53 |
| HumanEval | OpenAI | MIT | 55 |

Arena-Hard-Auto v2 was tracked as a candidate cited dataset under Apache-2.0,
but the prompt count for this committed corpus summary is 0.

## Notes

- The prompt corpus is separate from the v2.0.0 local mock-upstream latency
  report. The latency report measures gateway overhead; the prompt corpus
  supports smart-routing evaluation and input-mix evidence.
- Public docs summarize counts and licenses. They do not need to publish raw
  prompt text to explain the benchmark input mix.
