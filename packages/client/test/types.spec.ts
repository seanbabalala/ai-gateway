import type {
  ChatCompletionRequest,
  EmbeddingsRequest,
  MessagesRequest,
  ResponsesRequest,
  RoutingHint,
} from "../src";

describe("@siftgate/client types", () => {
  it("accepts gateway requests across supported protocol shapes", () => {
    const chat: ChatCompletionRequest = {
      model: "auto",
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Answer",
          schema: { type: "object" },
          strict: true,
        },
      },
    };

    const responses: ResponsesRequest = {
      model: "auto",
      input: "Return JSON",
      text: {
        format: {
          type: "json_schema",
          name: "Answer",
          schema: { type: "object" },
          strict: true,
        },
      },
    };

    const messages: MessagesRequest = {
      model: "claude",
      max_tokens: 128,
      messages: [{ role: "user", content: "Hello" }],
    };

    const embeddings: EmbeddingsRequest = {
      model: "text-embedding-3-small",
      input: ["alpha", "beta"],
      dimensions: 512,
    };

    const hint: RoutingHint = {
      tier: "standard",
      node: "openai-prod",
      optimization: "balanced",
    };

    expect(chat.model).toBe("auto");
    expect(responses.text?.format?.type).toBe("json_schema");
    expect(messages.max_tokens).toBe(128);
    expect(embeddings.dimensions).toBe(512);
    expect(hint.optimization).toBe("balanced");
  });
});
