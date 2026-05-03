# Multimodal Capability Schema

SiftGate v0.6 introduces a unified capability schema for the open-source Data
Plane. It keeps existing chat, responses, messages, and embeddings
configuration compatible while preparing routing for image, audio, video,
rerank, and realtime protocol entrypoints.

## Configuration

Capability fields can be declared at the node level as defaults, then refined
per model under `model_capabilities`.

```yaml
nodes:
  - id: openai
    protocol: chat_completions
    endpoint: /v1/chat/completions
    models: [gpt-4o]
    embedding_models: [text-embedding-3-small]
    modalities: [text, vision]
    endpoints:
      image: /v1/images/generations
      audio: /v1/audio/transcriptions
      video: /v1/videos/generations
      rerank: /v1/rerank
      realtime: wss://api.openai.com/v1/realtime
    input_types: [text, image, audio, video]
    output_types: [text, image, video, events]
    max_file_size: 20000000
    supports_streaming: true
    supports_realtime: false
    supports_rerank: false
    model_capabilities:
      gpt-4o:
        modalities: [text, image, audio]
        structured_output: true
        max_context_tokens: 128000
        pricing: { input: 2.5, output: 10 }
      text-embedding-3-small:
        modalities: [text, embedding]
        dimensions: [512, 1536]
        pricing: { input: 0.02, output: 0 }
```

Supported `modalities` are `text`, `vision`, `image`, `audio`, `video`,
`embedding`, `rerank`, and `realtime`. `vision` is kept as the legacy image-input alias and
matches `image` during routing.

Supported endpoint keys are `chat_completions`, `responses`, `messages`,
`embeddings`, `image`, `audio`, `video`, `rerank`, and `realtime`. Values can be relative
paths or absolute `http(s)` / `ws(s)` URLs.

## Routing Behavior

Smart routing uses detected request modalities as hard constraints. If an input
contains an image, SiftGate only keeps targets whose model capability supports
`vision` or `image`. Incompatible targets are removed from the candidate set,
including fallback candidates. If no target in the selected tier can satisfy the
request modality, the gateway returns a clear routing constraint error.

Direct model routing still honors the caller's explicit model choice. It logs a
warning when the selected target appears incompatible, and direct fallbacks are
filtered to compatible models.

## Dashboard

The Dashboard Nodes page and Routing page show resolved model capability
metadata read-only: modalities, streaming/realtime/rerank flags, context window,
embedding dimensions, file-size limit, and pricing hints. The Dashboard does not
automatically apply or rewrite these settings.

v0.8 also adds a Provider Compatibility Matrix to the Nodes page. It verifies
configured capabilities with safe local tests and stores only metadata: status,
timestamp, latency, HTTP status, and sanitized failure reason. It never stores
prompts, responses, raw headers, provider keys, media bytes, or realtime frames.
