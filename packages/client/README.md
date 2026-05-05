# @siftgate/client

Lightweight TypeScript client scaffold for the SiftGate open-source data plane. It has no runtime dependencies and uses the runtime `fetch` implementation available in Node.js 20+ and modern browsers.

The gateway is still OpenAI-compatible, so existing applications can keep using the OpenAI SDK by pointing its `baseURL` at SiftGate. This client is for users who want a small typed wrapper with SiftGate-specific helpers such as routing hints.

## Install

This scaffold lives in the monorepo at `packages/client`. It is private until the project intentionally publishes `@siftgate/client`.

```bash
npm --workspace @siftgate/client run build
```

## Usage

```ts
import { SiftGateClient } from "@siftgate/client";

const client = new SiftGateClient({
  baseUrl: "http://localhost:2099",
  gatewayApiKey: process.env.SIFTGATE_API_KEY,
});

const models = await client.models.list();

const chat = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Summarize this in JSON." }],
  response_format: { type: "json_object" },
});
```

## Endpoints

```ts
await client.models.list();

await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello" }],
});

await client.responses.create({
  model: "auto",
  input: "Hello",
  text: { format: { type: "json_schema", name: "Greeting" } },
});

await client.messages.create({
  model: "claude",
  max_tokens: 256,
  messages: [{ role: "user", content: "Hello" }],
});

await client.embeddings.create({
  model: "text-embedding-3-small",
  input: ["hello", "world"],
  dimensions: 512,
});
```

The embeddings helper targets `/v1/embeddings` so applications can adopt the SDK API before a gateway deployment enables that endpoint.

## Routing Hints

Routing hints are sent as `x-siftgate-routing-hint`. The open-source data plane can ignore unknown hints safely, so this is advisory rather than an authorization bypass.

```ts
await client.chat.completions.create(
  {
    model: "auto",
    messages: [{ role: "user", content: "Use the cheapest capable route." }],
  },
  {
    routingHint: { tier: "standard", optimization: "cost" },
  },
);
```

## Streaming And Advanced Calls

For Server-Sent Events or lower-level access, use `requestRaw` and handle the returned `Response` yourself.

```ts
const response = await client.requestRaw("POST", "/v1/chat/completions", {
  model: "auto",
  stream: true,
  messages: [{ role: "user", content: "Stream a short answer." }],
});
```

When SiftGate returns a non-2xx response, the client throws `SiftGateError`. Its `requestId` prefers `x-siftgate-request-id`, then falls back to `x-request-id` and `x-correlation-id` for older gateway releases or upstream proxies.

## OpenAI SDK Compatibility

You do not need this SDK to use SiftGate. Existing OpenAI SDK users can keep their client and replace only the base URL and API key:

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://localhost:2099/v1",
  apiKey: process.env.SIFTGATE_API_KEY,
});
```

SiftGate will authenticate with the dashboard-generated Gateway API key and continue routing requests through the local data plane.
