# Dashboard Playground

The Playground is a local Dashboard page for safe operator-triggered probes.

## What It Tests

- Chat Completions
- Responses
- Anthropic Messages
- Embeddings
- Rerank
- Images
- Audio
- Video job probe
- Realtime capability probe

## Privacy Defaults

The Playground uses tiny sample requests by default and does not persist prompt or response bodies outside normal metadata-only call logging. Provider keys and raw authorization headers are never returned to the browser.

## Useful Fields

- API key selection applies the selected key policy without exposing the plaintext key.
- Namespace selection verifies local namespace boundaries.
- Routing hints are advisory and never bypass permissions.
- Route Decision links show why the gateway selected or filtered candidates.

## Related Docs

- [Dashboard](DASHBOARD.md)
- [API Reference](API_REFERENCE.md)
- [Security](SECURITY.md)
