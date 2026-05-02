# Security Policy

SiftGate is designed so self-hosted deployments keep prompts, responses, and provider API keys inside the operator's infrastructure.

## Reporting Vulnerabilities

Please report security issues privately to the project maintainers. Do not open a public GitHub issue for suspected vulnerabilities.

Include:

- affected version or commit
- deployment mode and database type
- reproduction steps
- impact assessment
- any relevant logs with secrets removed

## Secret Handling

- Provider API keys belong in environment variables or node configuration and should never be committed.
- Client Gateway API keys are generated in the Dashboard and are shown only once.
- Connected Gateway metadata upload must not include prompts, responses, tool payloads, provider API keys, or raw authorization headers by default.
- The hosted control-plane path should use registration tokens and short-lived access tokens.

## Supported Security Posture

The open-source data plane includes:

- Gateway API key authentication for `/v1/*`
- per-key permissions, rate limits, and budgets
- timing-safe key validation
- dashboard authentication when configured
- Helmet security headers
- configurable CORS, body limits, trust proxy, and graceful shutdown

Operators should configure a dashboard password before exposing the service beyond a trusted network.
