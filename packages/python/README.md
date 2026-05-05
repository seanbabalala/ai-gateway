# siftgate

Lightweight Python client scaffold for the SiftGate open-source Data Plane. The package is intentionally small, synchronous, type-annotated, and stdlib-only.

SiftGate remains OpenAI-compatible, so existing applications can keep using the OpenAI Python SDK by pointing `base_url` at SiftGate. This client is for teams that want a tiny SiftGate-native wrapper with routing hints, Gateway API key handling, typed errors, and helpers for the gateway's wider endpoint surface.

This package is not published to PyPI yet. It is prepared for local install and test from the monorepo.

## Install Locally

```bash
python3 -m pip install -e packages/python
```

## Basic Usage

```python
from siftgate import SiftGateClient

client = SiftGateClient(
    base_url="http://localhost:2099",
    gateway_api_key="gw_sk_live_...",
)

models = client.models.list()

chat = client.chat.completions.create({
    "model": "auto",
    "messages": [{"role": "user", "content": "Return a concise answer."}],
})
```

## Endpoint Helpers

```python
client.models.list()

client.chat.completions.create({
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}],
})

client.responses.create({
    "model": "auto",
    "input": "Hello",
})

client.messages.create({
    "model": "claude",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Hello"}],
})

client.embeddings.create({
    "model": "text-embedding-3-small",
    "input": ["hello", "world"],
})

client.rerank.create({
    "model": "auto",
    "query": "what is SiftGate?",
    "documents": ["SiftGate is an AI traffic gateway."],
    "top_n": 1,
})

client.images.generations.create({
    "model": "auto",
    "prompt": "A clean product render",
})

client.audio.speech.create({
    "model": "auto",
    "input": "Hello",
    "voice": "alloy",
})

job = client.video.generations.create({
    "model": "auto",
    "prompt": "A short product demo",
})
client.video.jobs.retrieve(job["id"])
client.video.jobs.content(job["id"])
client.video.jobs.cancel(job["id"])
```

`client.videos` is an alias for `client.video`.

## Multipart Media

The SDK does not inspect, resize, transcode, or process media. It can build a simple multipart request from bytes or local file paths and pass the payload through to SiftGate.

```python
client.images.edits.create(
    {"model": "auto", "prompt": "Remove the background"},
    files={"image": "./image.png"},
)

client.audio.transcriptions.create(
    {"model": "auto"},
    files={"file": ("speech.wav", b"...", "audio/wav")},
)
```

## Routing Hints

Routing hints are sent as `x-siftgate-routing-hint`. They are advisory and do not bypass Gateway API key permissions, namespace policy, budgets, rate limits, or direct model restrictions.

```python
client.chat.completions.create(
    {
        "model": "auto",
        "messages": [{"role": "user", "content": "Use the cheapest capable route."}],
    },
    routing_hint={"tier": "standard", "optimization": "cost"},
)
```

## Errors

Non-2xx responses raise `SiftGateError`.
`SiftGateError.request_id` prefers `x-siftgate-request-id`, then falls back to `x-request-id` and `x-correlation-id`.

```python
from siftgate import SiftGateError

try:
    client.models.list()
except SiftGateError as exc:
    print(exc.status_code, exc.request_id, exc.body)
```

## Raw Responses

Use `request_raw` for streaming, binary payloads, or custom paths.

```python
response = client.request_raw(
    "POST",
    "/v1/chat/completions",
    {"model": "auto", "stream": True, "messages": [{"role": "user", "content": "Hi"}]},
)
for chunk in response.content.splitlines():
    print(chunk)
```

## OpenAI SDK Compatibility

You do not need this SDK to use SiftGate. Existing OpenAI SDK users can keep their client and replace only the base URL and API key:

```python
from openai import OpenAI

openai = OpenAI(
    base_url="http://localhost:2099/v1",
    api_key="gw_sk_live_...",
)
```

SiftGate authenticates that Gateway API key locally and routes requests through the open-source Data Plane.
