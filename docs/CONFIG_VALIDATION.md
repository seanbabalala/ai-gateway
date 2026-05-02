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
- Required node fields: `id`, `name`, `protocol`, `base_url`, `endpoint`,
  `api_key`, `models`, and `timeout_ms`.
- Duplicate node ids and duplicate model ids inside the same node.
- Shared ConfigService diagnostics for ambiguous node/model resolution,
  duplicate model ids across nodes, alias conflicts, duplicate prefixes,
  missing model pricing, and routing references.
- Routing integrity for `primary`, `fallbacks`, `split`, and future
  `targets` entries.
- Split weights, which must sum to `100`.
- `routing.domain_preferences` references to known node ids.
- Pricing entries with numeric `input` and `output` values.
- Environment references in the supported forms `${VAR}` and
  `${VAR:-default}`.
- Literal provider API keys and literal control-plane registration tokens.
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
`${VAR:-dummy}` in CI-only fixtures or accept the `env_reference_unset` warning.
Malformed env references are errors; missing env values without defaults are
warnings so config shape can still be validated without exposing secrets.
