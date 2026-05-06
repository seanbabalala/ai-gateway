# Secret Management

SiftGate v0.9 adds optional runtime secret references for the open-source Data
Plane. The default single-node setup still works with `.env` and
`gateway.config.yaml`; Vault, AWS Secrets Manager, and GCP Secret Manager are
disabled until explicitly configured.

## Supported References

```yaml
api_key: "${env:OPENAI_API_KEY}"
api_key: "${vault:secret/openai#api_key}"
api_key: "${aws-sm:openai/prod#api_key}"
api_key: "${gcp-sm:openai-prod#api_key}"
```

Legacy startup interpolation still works:

```yaml
api_key: "${OPENAI_API_KEY}"
api_key: "${OPENAI_API_KEY:-dummy-for-ci}"
```

Use `${env:...}` when you want the value resolved at request time with the
SecretReferenceResolver cache. Use legacy `${VAR}` when startup-time expansion
is enough and the environment variable is guaranteed to exist. From v1.5.0
onward, `${VAR}` is treated as required during startup and reload; only
`${VAR:-default}` keeps fallback semantics.

## Where References Work

- `nodes[].api_key`
- `nodes[].headers`
- Active health probes, because they inherit node auth and headers
- Realtime upstream auth, because it inherits node auth and headers
- Video status/content/cancel provider proxy auth, because it inherits node auth and headers
- Provider compatibility tests, without saving resolved values
- `control_plane.registration_token`

Resolved values are not written to provider compatibility results, call logs,
route decision traces, Dashboard config responses, telemetry summaries, catalog
override diagnostics, or logs.

## Configuration

```yaml
secret_manager:
  cache_ttl_seconds: 300
  failure_policy: fail_closed # fail_closed | fail_open_for_optional
  backends:
    env:
      enabled: true
    vault:
      enabled: false
      address: "${env:VAULT_ADDR}"
      token: "${env:VAULT_TOKEN}"
      mount: secret
      kv_version: 2
      timeout_ms: 5000
    aws_sm:
      enabled: false
      region: "${env:AWS_REGION:-us-east-1}"
      access_key_id: "${env:AWS_ACCESS_KEY_ID}"
      secret_access_key: "${env:AWS_SECRET_ACCESS_KEY}"
      session_token: "${env:AWS_SESSION_TOKEN:-}"
      timeout_ms: 5000
    gcp_sm:
      enabled: false
      project_id: "${env:GOOGLE_CLOUD_PROJECT}"
      access_token: "${env:GCP_SECRET_MANAGER_TOKEN:-}"
      use_metadata: true
      timeout_ms: 5000
```

`env` is enabled by default. External backends must be explicitly enabled so a
mistyped reference cannot silently call a network service.

`fail_closed` rejects the request when a required reference cannot be resolved.
`fail_open_for_optional` omits optional values such as custom node headers when
they fail to resolve, but required values such as `nodes[].api_key` still fail
closed.

## Backend Notes

Vault uses a small HTTP adapter. KV v2 paths such as
`${vault:secret/openai#api_key}` become `secret/data/openai`; set
`kv_version: 1` when using KV v1 paths.

AWS Secrets Manager uses a minimal SigV4 HTTP request to
`secretsmanager.GetSecretValue`. No AWS SDK is required. `SecretString` may be a
plain string or JSON object; use `#field` for JSON values.

GCP Secret Manager uses the REST `:access` endpoint. Short names become
`projects/<project_id>/secrets/<name>/versions/latest`; full `projects/...`
resource names are also accepted.

## Validation

Run:

```bash
npm run validate:config -- --config gateway.config.yaml
```

The validator reports malformed references, disabled backends, unset env
references, suspicious catalog override secrets, and unsafe literal provider or
control-plane tokens.
