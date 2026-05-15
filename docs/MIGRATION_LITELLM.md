# LiteLLM Migration

SiftGate can generate a starter `gateway.config.yaml` from a LiteLLM YAML config.
The broader compatibility migrator also supports New API and One API channel
imports plus SiftGate-to-LiteLLM/New API/One API scaffold exports; see
[Compatibility Migration](MIGRATION_COMPAT.md).

```bash
npm run build
node dist/cli/siftgate.js migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
```

The command defaults to `gateway.config.yaml` in the current directory. It refuses to overwrite an existing file unless you pass `--force` (`--overwrite` remains accepted for older scripts).

## Options

```bash
siftgate migrate --from litellm --config ./litellm_config.yaml
siftgate migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
siftgate migrate --from litellm --config ./litellm_config.yaml --dry-run
siftgate migrate --from litellm --config ./litellm_config.yaml --json
siftgate migrate --to litellm --config ./gateway.config.yaml --out ./litellm.generated.yaml
```

| Option | Description |
|--------|-------------|
| `--from litellm` | Required source type |
| `--config <path>` | LiteLLM YAML path |
| `--out <path>` | Output SiftGate YAML path |
| `--force` | Allow replacing the output file |
| `--overwrite` | Backward-compatible alias for `--force` |
| `--dry-run` | Print generated YAML without writing |
| `--json` | Print machine-readable report and generated config |

## What Is Mapped

- `model_list[].model_name` to SiftGate model aliases.
- `litellm_params.model` provider prefixes such as `openai/`, `anthropic/`, and `azure/`.
- API key environment references such as `os.environ/OPENAI_API_KEY`, `${OPENAI_API_KEY}`, and `$OPENAI_API_KEY`.
- `router_settings.fallbacks` to SiftGate tier fallbacks.
- `router_settings.num_retries` and known retry defaults.
- Known routing strategies: LiteLLM latency routing becomes `least_latency`, shuffle/random becomes `random`, and unknown strategies become `weighted` with manual review notes.
- LiteLLM per-token pricing fields become SiftGate per-1M-token `models_pricing`.
- SiftGate v0.8 model buckets are preserved when exporting back to LiteLLM through `model_info.mode` scaffold fields.

## Manual Review

The generated config is intentionally conservative. Review the migration report before production use.

Common manual items:

- Literal API keys are not copied. Move secrets to environment variables and update `nodes[].api_key`.
- Unknown providers without `api_base` are emitted with placeholder URLs and marked incompatible.
- Multiple LiteLLM per-model fallback maps are collapsed into one SiftGate tier fallback chain.
- Global `litellm_settings` may need manual mapping to SiftGate cache, telemetry, timeout, or provider settings.
- Pricing defaults to `0` when LiteLLM pricing is missing; set real pricing before enforcing budgets.

## Example

LiteLLM:

```yaml
model_list:
  - model_name: gpt-4o-public
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

router_settings:
  routing_strategy: latency-based-routing
  fallbacks:
    - gpt-4o-public: []
```

Command:

```bash
node dist/cli/siftgate.js migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
```

After generation:

```bash
node dist/cli/siftgate.js validate --config ./gateway.generated.yaml
```

## Verify The Migrated Route

After the generated config validates, run one request through SiftGate before
moving production traffic. Use the migrated alias or model name so the check
exercises the imported route instead of a hand-picked direct model:

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "gpt-4o-public",
    "messages": [{"role": "user", "content": "Migration smoke test."}]
  }'
```

Then open Dashboard logs and Route Explanation for that request. Confirm:

- the requested LiteLLM alias maps to the expected SiftGate node and upstream
  model;
- fallback order matches the migration report and any collapsed LiteLLM
  fallback map has been reviewed;
- pricing confidence is not `low` before budgets or cost routing are enforced;
- provider compatibility evidence matches the endpoint, modality, streaming,
  and structured-output behavior the client expects;
- cache evidence is visible when semantic cache or provider prompt-cache
  routing is enabled.

SiftGate stores route/cost/policy metadata for this verification path. It does
not store prompts, responses, raw auth headers, provider keys, resolved
secrets, media bytes, or MCP tool payloads by default.

For v0.5 database migration from local SQLite runtime data to PostgreSQL, see
[Production Deployment](PRODUCTION.md).
