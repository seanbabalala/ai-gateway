# Compatibility Migration

SiftGate v0.9 expands the local migration CLI beyond LiteLLM. It can import
LiteLLM, New API, and One API style configuration into an OSS SiftGate
`gateway.config.yaml`, and it can export a SiftGate config back to lightweight
LiteLLM / New API / One API scaffold YAML.

This is a local, offline tool. It does not contact provider APIs, does not
resolve secrets, and does not require SiftGate Cloud.

## Commands

```bash
# Import into SiftGate
siftgate migrate --from litellm --config ./litellm_config.yaml --out ./gateway.generated.yaml
siftgate migrate --from newapi --config ./channels.yaml --out ./gateway.generated.yaml
siftgate migrate --from oneapi --config ./channels.yaml --out ./gateway.generated.yaml

# Export from SiftGate into adjacent gateway scaffolds
siftgate migrate --to litellm --config ./gateway.config.yaml --out ./litellm.generated.yaml
siftgate migrate --to newapi --config ./gateway.config.yaml --out ./newapi.generated.yaml
siftgate migrate --from siftgate --to oneapi --config ./gateway.config.yaml --out ./oneapi.generated.yaml
```

The default output is `gateway.config.yaml` when the target is SiftGate, or
`<target>.generated.yaml` for scaffold exports. Existing files are not replaced
unless `--force` is passed. `--overwrite` remains as a backward-compatible alias.

## Report Shape

Every run prints a report with:

- `compatible`: fields mapped directly.
- `partially_supported`: fields represented as a scaffold or requiring behavior review.
- `unsupported`: entries that cannot be safely mapped.
- `manual_actions`: operator follow-up items.
- `mapping_notes`: provider/model mapping evidence.
- `pricing_confidence`: `high`, `medium`, or `low`.
- `capability_confidence`: `high`, `medium`, or `low`.

Use `--json` for CI or automation.

## What Is Mapped

- Provider/channel name and type.
- Provider base URL and auth reference.
- API key references such as `${OPENAI_API_KEY}`, `${env:OPENAI_API_KEY}`,
  `$OPENAI_API_KEY`, `{{OPENAI_API_KEY}}`, and `os.environ/OPENAI_API_KEY`.
- Fallback/router settings where the source format exposes them.
- SiftGate v0.8 model buckets:
  - `models`
  - `embedding_models`
  - `rerank_models`
  - `image_models`
  - `audio_models`
  - `video_models`
  - `realtime_models`
- Provider Catalog hints for endpoints, modalities, limits, structured output,
  streaming/realtime/rerank support, and placeholder pricing.

## Privacy And Secrets

Literal provider keys are never copied to generated YAML. The migrator replaces
them with environment references such as `${OPENAI_CHANNEL_1_API_KEY}` and adds a
manual action to the report.

Prompt content, response content, media bytes, and provider headers are outside
the migration input and are not stored or generated.

## Limitations

New API and One API deployments vary by fork and database schema. The migrator
accepts common YAML shapes such as top-level arrays, `channels`, `data`, `items`,
or `records`, then emits a SiftGate config or a scaffold. Source-only fields are
listed as manual actions rather than silently discarded.

Reverse exports are intended as starting points. SiftGate has richer concepts
such as route explanations, namespaces, shadow traffic, media/video endpoints,
and provider compatibility results; adjacent gateway scaffolds may need manual
adjustment before import.
