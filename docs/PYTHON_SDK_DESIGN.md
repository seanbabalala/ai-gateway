# Python SDK

The v1.1 Python SDK scaffold lives in `packages/python`. It gives Python users a small SiftGate-native client while keeping the gateway fully usable through raw HTTP or the OpenAI Python SDK with `base_url="http://localhost:2099/v1"`.

The package is not published to PyPI yet. It is prepared for local install and tests from the monorepo:

```bash
python3 -m pip install -e packages/python
npm run test:python-sdk
```

## Goals

- Keep the SDK lightweight, synchronous, type-annotated, and stdlib-only.
- Preserve OpenAI SDK compatibility for teams that prefer `OpenAI(base_url="http://localhost:2099/v1", api_key=...)`.
- Add SiftGate-specific helpers where they improve ergonomics: Gateway API key auth, routing hints, typed gateway errors, raw response access, and helpers for the gateway's wider endpoint surface.
- Avoid any SiftGate Cloud or enterprise dependency.

## Package Shape

```text
packages/python/
  pyproject.toml
  src/siftgate/
    __init__.py
    client.py
    errors.py
    types.py
    py.typed
  tests/
    test_client.py
```

The public API mirrors the TypeScript scaffold where practical:

- `client.models.list()`
- `client.chat.completions.create(...)`
- `client.responses.create(...)`
- `client.messages.create(...)`
- `client.embeddings.create(...)`
- `client.rerank.create(...)`
- `client.images.generations.create(...)`
- `client.images.edits.create(...)`
- `client.images.variations.create(...)`
- `client.audio.transcriptions.create(...)`
- `client.audio.translations.create(...)`
- `client.audio.speech.create(...)`
- `client.video.generations.create(...)`
- `client.video.jobs.retrieve(...)`
- `client.video.jobs.content(...)`
- `client.video.jobs.cancel(...)`
- `client.request_raw(...)` for streaming, binary responses, or custom paths

## Client Options

- `base_url`: defaults to `http://localhost:2099`; `/v1` is handled without duplicating paths.
- `gateway_api_key`: dashboard-generated Gateway API key, sent as `Authorization: Bearer ...`.
- `headers`: optional default headers.
- `timeout`: default request timeout.
- `transport`: injectable HTTP transport for tests and custom deployments.

## Routing Hints

Python calls accept an optional `routing_hint` argument and encode it as the `x-siftgate-routing-hint` header. Hints remain advisory and never bypass Gateway API key permissions, namespace policy, budgets, rate limits, or routing restrictions.

```py
client.chat.completions.create(
    {
        "model": "auto",
        "messages": [{"role": "user", "content": "Use the cheapest capable route."}],
    },
    routing_hint={"tier": "standard", "optimization": "cost"},
)
```

## Error Model

Non-2xx responses raise `SiftGateError` with:

- `status_code`
- `body`
- `request_id`
- message text parsed from JSON or plain-text responses when possible

## Media And Video

The SDK does not inspect, resize, transcode, or persist media. It can build simple multipart requests from bytes, file-like objects, or local paths for image/audio endpoints and passes them to SiftGate. Video helpers use SiftGate's async job routes and do not store prompts, input media, or video bytes in the SDK.

## Future Work

- Optional async client once the sync package shape settles.
- Higher-level SSE iterator helpers for streaming responses.
- Optional typed request/response models generated from the gateway OpenAPI schema.
