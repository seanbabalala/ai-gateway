# Compatibility Migration

SiftGate can generate starter configs between the MIT Data Plane and common
gateway ecosystems:

- LiteLLM -> SiftGate
- New API channel export -> SiftGate
- One API channel export -> SiftGate
- SiftGate -> LiteLLM scaffold
- SiftGate -> New API / One API channel scaffold

The tool is intentionally conservative. It writes a migration report with
compatible, incompatible, and manual-review items, and it refuses to overwrite an
existing output unless `--overwrite` is passed.

## Commands

```bash
npm run build

# Import third-party configs into SiftGate.
node dist/cli/siftgate.js migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
node dist/cli/siftgate.js migrate --from newapi --config ./newapi.channels.yaml --out ./gateway.generated.yaml
node dist/cli/siftgate.js migrate --from oneapi --config ./oneapi.channels.yaml --out ./gateway.generated.yaml

# Export SiftGate into reviewable third-party scaffolds.
node dist/cli/siftgate.js migrate --from siftgate --to litellm --config ./gateway.config.yaml --out ./litellm.generated.yaml
node dist/cli/siftgate.js migrate --from siftgate --to newapi --config ./gateway.config.yaml --out ./newapi.generated.yaml
node dist/cli/siftgate.js migrate --from siftgate --to oneapi --config ./gateway.config.yaml --out ./oneapi.generated.yaml
```

## Options

| Option | Description |
|--------|-------------|
| `--from <type>` | `litellm`, `newapi`, `oneapi`, or `siftgate` |
| `--to <type>` | Target type. Defaults to `siftgate` |
| `--config <path>` | Source YAML/JSON file |
| `--out <path>` | Output path |
| `--overwrite` | Allow replacing the output file |
| `--dry-run` | Print generated YAML without writing |
| `--json` | Print a machine-readable report and generated object |

## What Is Mapped

### LiteLLM -> SiftGate

- `model_list[].model_name` to SiftGate model aliases.
- `litellm_params.model` provider prefixes such as `openai/`, `anthropic/`,
  and `azure/`.
- API key environment references such as `os.environ/OPENAI_API_KEY`,
  `${OPENAI_API_KEY}`, and `$OPENAI_API_KEY`.
- `router_settings.fallbacks` to SiftGate tier fallbacks.
- `router_settings.num_retries` and known retry defaults.
- Known routing strategies: LiteLLM latency routing becomes `least_latency`,
  shuffle/random becomes `random`, and unknown strategies become `weighted` with
  manual-review notes.
- LiteLLM per-token pricing fields become SiftGate per-1M-token
  `models_pricing`.

### New API / One API -> SiftGate

- Channel arrays from top-level `channels`, `data`, `items`, or `records`.
- Common channel fields: `name`, `type`, `base_url`, `key`, `models`,
  `model_mapping`, `weight`, and timeout fields.
- String provider names and common numeric channel types for OpenAI, Azure,
  OpenAI-compatible, and Anthropic.
- OpenAI-like models to `nodes[].models`.
- Embedding-like model names to `nodes[].embedding_models`.
- Literal channel keys are not copied; generated configs use environment
  placeholders instead.

### SiftGate -> LiteLLM / New API / One API

- SiftGate `nodes[]` become LiteLLM `model_list[]` or New API/One API
  `channels[]` scaffolds.
- Model aliases are exported as LiteLLM `model_name` values or channel
  `model_mapping`.
- SiftGate standard-tier fallback hints are exported to LiteLLM
  `router_settings.fallbacks`.
- Provider API keys are only exported when they are already environment
  references; literal secrets are replaced with generated environment
  placeholders and manual-review notes.

## Manual Review

Generated configs are starter files, not production-ready proof. Review the
report before use.

Common manual items:

- Literal API keys are not copied. Move secrets to environment variables and
  update the generated key references.
- New API and One API exports are declarative scaffolds, not direct database
  dumps. Import through the target admin UI or adapt fields to your deployed
  schema before writing a database.
- Unknown providers without base URLs are emitted with placeholder URLs and
  marked incompatible.
- New API / One API channel exports usually do not include authoritative model
  pricing; generated SiftGate pricing defaults to `0` until you fill it in.
- Multiple source-specific fallback maps may collapse into one SiftGate tier or
  one LiteLLM fallback map.

## Validation

After generating a SiftGate config, validate it before restart:

```bash
node dist/cli/siftgate.js validate --config ./gateway.generated.yaml
```

For v0.5 database migration from local SQLite runtime data to PostgreSQL, see
[Production Deployment](PRODUCTION.md).
