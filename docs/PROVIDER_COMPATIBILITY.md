# Provider Compatibility Profiles

SiftGate v1.4 adds Provider Compatibility Profiles to the open-source Data Plane. A profile describes how a provider speaks to SiftGate: protocol family, request and response style, auth strategy, endpoint behavior, streaming support, multipart support, async job support, supported source formats, supported modalities, and field-mapping limitations.

Profiles are local metadata. They do not fetch provider docs, do not require provider SDKs, and do not send traffic unless an operator explicitly runs a compatibility test.

## Why Profiles Exist

Provider Catalog entries explain what a provider offers. Compatibility Profiles explain how safely SiftGate can forward a specific request to that provider.

The same profile registry is used by:

- config validation for `nodes[].compatibility_profile`
- routing filters for source format, modality, streaming, multipart, video, and batch
- provider forwarding evidence for passthrough, downgraded, and unsupported fields
- Provider Compatibility Test Matrix safe probe selection
- Dashboard Provider Catalog, Nodes, Logs, and Route Explanation views

This keeps the Dashboard, CLI, validation, and routing engine aligned instead of each surface inventing its own compatibility vocabulary.

## Built-In Profiles

The v1.4 registry includes these built-in profile ids:

| Profile | Use |
| --- | --- |
| `openai_compatible` | OpenAI Chat Completions-compatible text, vision, realtime-style, and Batch endpoint targets |
| `openai_responses_compatible` | OpenAI Responses-compatible targets |
| `anthropic_messages_compatible` | Anthropic Messages-compatible targets |
| `google_gemini_compatible` | Google Gemini native GenerateContent targets, including Gemini tools, JSON output, thinking config, and Google Search grounding |
| `google_vertex_compatible` | Google Vertex-style endpoints and long-running operations |
| `aws_bedrock_converse` | AWS Bedrock Converse-style targets |
| `azure_openai_compatible` | Azure OpenAI-compatible deployments |
| `huggingface_inference` | Hugging Face Inference Providers or endpoint-style targets |
| `openrouter_aggregator` | OpenRouter aggregator targets |
| `cohere_compatible` | Cohere-style chat, embedding, and rerank targets |
| `mistral_compatible` | Mistral-compatible OpenAI-style targets |
| `local_ollama` | Local Ollama targets |
| `local_vllm` | Local vLLM OpenAI-compatible servers |
| `local_tgi` | Local Text Generation Inference servers |
| `local_lmstudio` | Local LM Studio OpenAI-compatible servers |
| `media_generation_sync` | Synchronous image generation/edit/variation endpoints |
| `media_generation_async` | Async image/video generation jobs |
| `speech_transcription` | Audio transcription and translation endpoints |
| `speech_tts` | Text-to-speech endpoints |
| `rerank_compatible` | Rerank endpoints |
| `embedding_compatible` | Embedding endpoints |

Each built-in Provider Catalog provider references one or more profiles. Custom providers can either let SiftGate infer profiles from node fields or explicitly set `nodes[].compatibility_profile`.

## Config

The field accepts one profile id or an array:

```yaml
nodes:
  - id: local-vllm
    name: "Local vLLM"
    protocol: chat_completions
    base_url: "http://localhost:8000"
    endpoint: "/v1/chat/completions"
    api_key: ""
    models: ["local-model"]
    compatibility_profile: ["local_vllm", "embedding_compatible"]
```

Leave the field empty when the Provider Catalog already knows the provider. Use an explicit override for custom gateways, local model servers, or provider-compatible proxies that expose a narrower surface than their `protocol` suggests.

## Validation

Config validation is non-blocking for operator-managed compatibility warnings unless the profile id itself is malformed or unknown.

Validation checks:

- profile id exists
- provider and profile are a plausible match
- node protocol/source format is supported by at least one profile
- configured endpoint families match profile support
- configured model buckets match supported modalities
- custom provider profiles are explicit enough for operator review

Examples:

- an `image_models` bucket on a pure text profile warns for modality mismatch
- a streaming request to a profile with `streaming_strategy: unsupported` is filtered or downgraded with trace evidence
- a multipart request to a profile with `multipart_strategy: unsupported` is filtered or returns a clear `400` on media paths

## Routing Evidence

Route Decision Trace adds `compatibility_evidence` for each candidate target:

```json
{
  "provider_id": "anthropic",
  "compatibility_profile": ["anthropic_messages_compatible"],
  "endpoint_strategy": "provider_specific",
  "protocol_strategy": "anthropic:anthropic_messages",
  "passthrough_fields": ["metadata", "tools", "tool_choice", "thinking", "stream"],
  "downgraded_fields": ["response_format", "reasoning_effort"],
  "unsupported_fields": ["openai_responses_text_config"],
  "selected_reason": "profile_supported_selected",
  "filtered_by_profile_reason": null
}
```

The evidence is metadata-only. It does not include prompt text, response text, raw headers, provider keys, media bytes, or video bytes.

Routing uses profiles to filter or mark candidates when:

- `source_format` is unsupported
- requested modality is unsupported
- streaming is requested but the profile cannot safely stream
- multipart media is requested but the profile cannot handle multipart
- async video or batch job paths do not match the provider profile

When SiftGate cannot safely map a field, it records `passthrough`, `downgraded`, or `unsupported`. A field should be dropped only when that behavior is explicitly safe and documented.

## Compatibility Test Matrix

The Dashboard Nodes compatibility matrix now uses profiles to choose safe probes for:

- chat
- responses
- messages
- embeddings
- rerank
- images
- audio
- video endpoint/auth
- realtime endpoint/auth
- batch endpoint/auth

Text, embedding, and rerank probes use tiny synthetic requests. Video, realtime, media, and batch checks default to endpoint/auth/capability probes. Real generation or long-lived connections require a future explicit confirmation flow.

Compatibility results are local metadata. They never store prompt text, response bodies, raw headers, provider keys, media bytes, video bytes, or realtime frames.

## Dashboard

Provider Catalog detail, Node detail, Route Explanation, and Logs detail display compatibility profiles as read-only operational evidence.

Route Explanation answers three operator questions:

- why the selected provider can handle the request
- why a filtered provider was rejected by profile/source/modality
- which important fields were passed through, downgraded, or unsupported

Read-only details do not modify routing config. Operators still change node/profile configuration through `gateway.config.yaml` or the Add Node Wizard.

## Open-Source Boundary

Profiles are static local metadata plus optional operator-triggered probes. They do not implement provider SDKs, hosted provider discovery, enterprise marketplaces, or private package dependencies. The Data Plane remains useful with memory/SQLite defaults; Redis and PostgreSQL stay optional.
