# Secret Management

SiftGate keeps the open-source Data Plane self-contained by default: provider
keys can stay in environment variables and the gateway still starts with
memory state and SQLite. For production deployments, sensitive config values
can reference external secret managers without adding SiftGate Cloud or any
enterprise dependency.

## Reference Syntax

Environment references continue to work:

```yaml
api_key: ${OPENAI_API_KEY}
api_key: ${OPENAI_API_KEY:-dummy-for-ci}
api_key: ${env:OPENAI_API_KEY}
```

Secret manager references are resolved lazily before outbound calls:

```yaml
api_key: ${vault:secret/openai#api_key}
api_key: ${aws-sm:prod/openai#api_key}
api_key: ${gcp-sm:openai-key#api_key}
api_key: ${gcp-sm:projects/my-project/secrets/openai-key/versions/latest#api_key}
```

The part after `#` is an optional field selector. Use it when the secret value
is JSON or a Vault KV object. Without a selector, SiftGate accepts a raw string
or common fields such as `value`, `api_key`, `token`, or `secret`.

## Config

```yaml
secrets:
  enabled: true
  cache_ttl_seconds: 300

  vault:
    address: ${VAULT_ADDR}
    token: ${VAULT_TOKEN}
    mount: secret
    kv_version: 2
    timeout_ms: 5000

  aws:
    region: ${AWS_REGION:-us-east-1}
    # access_key_id and secret_access_key fall back to AWS_ACCESS_KEY_ID
    # and AWS_SECRET_ACCESS_KEY. session_token falls back to AWS_SESSION_TOKEN.

  gcp:
    project_id: ${GOOGLE_CLOUD_PROJECT}
    # access_token falls back to GCP_SECRET_MANAGER_TOKEN or
    # GOOGLE_OAUTH_ACCESS_TOKEN, then the GCE metadata server when available.
```

`secrets` is optional. If references are present and the provider block is
omitted, validation prints warnings for missing runtime settings but still lets
CI validate config shape without exposing real secrets.

## Supported Values

The first implementation resolves these sensitive outbound values:

- `nodes[].api_key`
- `nodes[].headers`
- active health probe auth headers
- realtime upstream auth headers
- `control_plane.registration_token`

Database URLs and Dashboard password hashes should still be provided through
environment variables or platform-native secret mounts because those are needed
very early during startup.

## Provider Notes

Vault uses the HTTP API with `X-Vault-Token`. KV v2 is the default; when the
reference omits `/data/`, SiftGate inserts it using `secrets.vault.mount`.

AWS Secrets Manager uses a minimal SigV4 `GetSecretValue` request. It reads
credentials from the `secrets.aws` block or standard AWS environment variables.

GCP Secret Manager uses the `:access` API. Short refs require a project id.
Bearer tokens can come from config, `GCP_SECRET_MANAGER_TOKEN`,
`GOOGLE_OAUTH_ACCESS_TOKEN`, or the GCE metadata server.

## Safety

- Secret lookups are cached in memory for `cache_ttl_seconds`.
- Resolved secret values are not written back to `gateway.config.yaml`.
- Prompt, response, raw headers, and provider keys remain excluded from logs.
- Set `secrets.enabled=false` to make any secret-manager reference a validation
  error and a runtime failure.
