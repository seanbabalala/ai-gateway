# guardrails

Official SiftGate guardrails skeleton plugin. It provides a minimal local policy hook that can audit or block configured input/output regex patterns.

## Example

```yaml
plugins:
  - path: plugins/guardrails
    required: false
    config:
      enabled: true
      mode: block
      input_patterns:
        - "(?i)do not answer"
      blocked_message: This request was blocked by local policy.
```

## Safety

- Disabled by default.
- Runs locally in the Data Plane and does not call an external moderation service.
- Logs only finding counts by default, not prompt or response text.
- `include_prompt_in_logs: true` is required before match details are logged.
