# Config Validation

SiftGate ships a local config validator for the open-source Data Plane. It does
not require SiftGate Cloud, and `control_plane` remains optional.

## Run It

From a source checkout:

```bash
npm run validate:config -- --config gateway.config.yaml
```

After `npm run build`, the compiled executable can be called directly:

```bash
node dist/cli/siftgate.js validate --config gateway.config.yaml
```

The `package.json` bin entry exposes the same command as:

```bash
siftgate validate --config gateway.config.yaml
```

For CI logs or automation, use JSON output:

```bash
npm run validate:config -- --config gateway.config.yaml --json
```

## Exit Codes

- `0`: no errors were found.
- `1`: at least one error was found, arguments were invalid, or the config file
  could not be read.

Warnings and info do not fail the command. They are intended to make production
hardening visible without blocking local development.

## What Is Checked

- YAML parse errors and unreadable/missing files.
- Required top-level sections: `server`, `database`, `auth`, `nodes`,
  `routing`, `budget`, and `models_pricing`.
- Database shape, including SQLite path, PostgreSQL URL, and boolean
  `database.synchronize` when set. PostgreSQL configs warn unless production
  schema synchronization is explicitly disabled.
- Required node fields: `id`, `name`, `protocol`, `base_url`, `endpoint`,
  either `api_key` or `credentials[]`, `models`, and `timeout_ms`.
- Optional `nodes[].credentials[]` provider credential pools, including unique
  credential ids, positive weights, boolean enablement, supported
  `credential_pool.strategy`/`sticky_by` values, cooldown controls, and retry
  HTTP status lists.
- Optional `nodes[].connection` pool settings, including `pool_size`,
  `keep_alive_ms`, `headers_timeout_ms`, `body_timeout_ms`,
  `stream_max_duration_ms`, and experimental `http2`.
- Duplicate node ids and duplicate model ids inside the same node.
- Shared ConfigService diagnostics for ambiguous node/model resolution,
  duplicate model ids across nodes, alias conflicts, duplicate prefixes,
  missing model pricing, and routing references. When merged Provider Catalog
  pricing can supply a fallback, the validator reports catalog price source
  status instead of a plain missing-pricing warning.
- Routing integrity for `primary`, `fallbacks`, `split`, and `targets` entries.
- `routing.optimization`, which must be `cost`, `latency`, `balanced`, or
  `quality` when configured.
- Split weights, which must sum to `100`.
- `routing.domain_preferences` references to known node ids.
- `routing.fallback_policy` shape, including explicit timeout race thresholds
  and cost-downgrade limits when those policies are enabled.
- Pricing entries with numeric `input` and `output` values. v1.4 also accepts
  governance aliases such as `input_per_1m_tokens`,
  `output_per_1m_tokens`, `cache_read_per_1m_tokens`,
  `cache_write_per_1m_tokens`, `image_per_generation`,
  `audio_per_minute`, `video_per_generation`, and `batch_discount`.
- Provider Catalog price source status for configured models: missing prices,
  review-required entries, stale `last_verified_at` / `retrieved_at` /
  `last_updated` values, missing source/source URL metadata, modality unit
  mismatches, cache-aware routing without cache read/write prices, media
  endpoints without matching media price units, and `routing.optimization=cost`
  or `balanced` candidates without usable input/output token prices.
- Provider Catalog sync configuration: `catalog.sync` is disabled by default,
  `write_to` must be `cache` or `override`, paths must be non-empty, and
  scheduled sync warns unless at least one supported adapter is explicitly
  enabled. In v1.2, only `openrouter` is an automatic adapter; other providers
  remain docs-review or local override workflows.
- v0.3 model capability metadata, including positive `max_context_tokens`,
  boolean `structured_output`, non-negative `quality_score`, and optional
  per-model `pricing` overrides.
- v0.6 multimodal capability metadata at both node and model level, including
  valid `modalities`, endpoint maps for `chat_completions`, `responses`,
  `messages`, `embeddings`, `image`, `audio`, `rerank`, and `realtime`,
  non-empty `input_types` / `output_types`, positive `max_file_size`, and
  boolean `supports_streaming`, `supports_realtime`, and `supports_rerank`.
- `cache` shape, including positive TTL/entry limits and explicit
  `cache.stream_cache.enabled` boolean validation.
- Optional `embedding_batching` shape, including boolean enablement and
  positive queue/window/batch/timeout values.
- Optional `mcp` Gateway preview shape, including boolean enablement, `/mcp`
  path warnings, unique local server ids, HTTP JSON-RPC, Streamable HTTP,
  legacy SSE, and stdio transport settings, `message_url`, stdio
  `command`/`args`/`env`/`cwd`, namespace allow-list references, header string
  values, positive timeout/body limits, and static tool metadata names/schemas.
- `alerts` webhook channel shape, supported event names, debounce values,
  retry controls, and spike detector thresholds.
- Optional `logging.sinks` entries for file, webhook, S3 interface, and
  Elasticsearch exports, including batching, retry, queue, URL/header, and
  sensitive-field filter checks.
- Optional `state` backend configuration, including `memory`/`redis` backend
  names, Redis URL scheme (`redis://` or `rediss://`), and non-empty key
  prefixes.
- Optional `cluster` configuration, including boolean switches, instance id
  shape, heartbeat interval/TTL values, reload broadcast settings, and Redis
  overrides used by multi-instance Pub/Sub.
- Environment and secret references in the supported forms `${VAR}`,
  `${VAR:-default}`, `${env:VAR}`, `${vault:path#field}`,
  `${aws-sm:secret#field}`, and `${gcp-sm:secret#field}`.
- `secret_manager` shape, disabled backend usage, malformed references, missing
  env values without defaults, and optional backend timeout/failure-policy
  settings.
- Literal provider API keys and literal control-plane registration tokens.
- Suspicious secret-like values in `catalog.override.yaml`; overrides are for
  catalog metadata, not provider credentials.
- `control_plane` safety when enabled, including required fields, HTTPS for
  non-local URLs, and prompt/response telemetry warnings.

## CI Example

```yaml
- run: npm ci
- run: npm run validate:config -- --config gateway.config.yaml
- run: npm run build
- run: npm test -- --runInBand
```

If your CI environment intentionally does not have provider secrets, use
`${VAR:-dummy}` or `${env:VAR:-dummy}` in CI-only fixtures. The static validator
can still warn about unset env references without blocking offline config-shape
checks, but the runtime changed in v1.5.0: startup and reload now fail fast
when a legacy `${VAR}` reference has no value and no default.
