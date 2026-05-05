# SDKs

SiftGate is designed to work with existing provider SDKs by changing the base URL, while also providing lightweight local SDK scaffolds.

## OpenAI SDK

Point the OpenAI SDK at SiftGate:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:2099/v1",
  apiKey: process.env.SIFTGATE_API_KEY,
});
```

The request still goes through SiftGate auth, namespace policy, budget, routing, fallback, logs, and route explanation.

## TypeScript Client

The TypeScript scaffold lives in `packages/client`.

```bash
npm run build:sdk
npm run test:sdk
```

Use it when you want typed gateway helpers without replacing your app framework.

## Python SDK

The Python scaffold lives in `packages/python`.

```bash
python3 -m pip install -e packages/python
python3 -m unittest discover -s packages/python/tests
```

It supports base URL, Gateway API key auth, routing hints, chat, responses, messages, embeddings, rerank, images, audio, video jobs, and raw response access.

## Agent Examples

See [Agent Integrations](AGENT_INTEGRATIONS.md) for LangChain, CrewAI, OpenAI Agents SDK, and OpenAI SDK `base_url` examples.
