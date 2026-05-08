# OIDC Login And Workspace Invites

SiftGate OSS supports optional generic OIDC login for the local Dashboard. It
runs alongside the existing local password login and does not require SiftGate
Cloud.

## Configuration

```yaml
dashboard:
  session_secret: "${env:SIFTGATE_DASHBOARD_SESSION_SECRET}"
  oidc:
    enabled: true
    issuer: "https://accounts.google.com"
    client_id: "${env:OIDC_CLIENT_ID}"
    client_secret: "${env:OIDC_CLIENT_SECRET}"
    redirect_uri: "https://siftgate.example.com/api/auth/oidc/callback"
    allowed_domains:
      - example.com
    default_role: viewer
    default_workspace_id: default-workspace
    scopes: [openid, email, profile]
```

`dashboard.session_secret` is required when OIDC is enabled without
`dashboard.password`. Keep client secrets in env, Vault, AWS Secrets Manager, or
GCP Secret Manager references. Dashboard APIs never return the resolved secret.

## Provider Templates

- Google: issuer `https://accounts.google.com`.
- GitHub: use a GitHub Enterprise or identity-provider setup that exposes a
  standard OIDC issuer discovery document.
- Azure AD / Entra ID: use the tenant-specific issuer from the app
  registration's OpenID Connect metadata.

SiftGate intentionally keeps the runtime generic: discovery, authorization,
token exchange, userinfo, domain allow-list, default role, and default workspace
mapping come from configuration instead of vendor-specific branches.

## Invites

Workspace Admins can create invitation metadata from the Members page. An invite
contains workspace, role, optional email, expiry, and status. OSS returns the
plain invite link once and does not send email by default.

The database stores only a SHA-256 hash of the invite token. OIDC login state
stores the invite token hash, not the reusable plain token. Invites can be
accepted through local Dashboard login or OIDC login.

## Non-Goals

- No SCIM or LDAP in this release.
- No built-in email sending in OSS.
- No mandatory cloud dependency.
