import { ProviderClientService } from "../../src/providers/provider-client.service";
import { TelemetryService } from "../../src/telemetry/telemetry.service";
import { CanonicalRequest, Tier } from "../../src/canonical/canonical.types";

const routingMeta = {
  tier: "standard" as Tier,
  score: 0.1,
  is_fallback: false,
};
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function makeCanonical(): CanonicalRequest {
  return {
    messages: [{ role: "user", content: "Hi" }],
    stream: false,
    metadata: { source_format: "chat_completions", raw_headers: {} },
  };
}

describe("ProviderClientService secret references", () => {
  it("resolves provider api keys and custom headers before forwarding", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        id: "chatcmpl_1",
        model: "gpt-4o",
        choices: [
          {
            message: { role: "assistant", content: "Hi" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    global.fetch = fetchMock as any;

    const node = {
      id: "openai",
      name: "OpenAI",
      protocol: "chat_completions",
      base_url: "https://api.openai.com",
      endpoint: "/v1/chat/completions",
      api_key: "${vault:secret/openai#api_key}",
      headers: { "X-Provider-Org": "${aws-sm:org/header#value}" },
      models: ["gpt-4o"],
      timeout_ms: 5000,
    };
    const resolver = {
      resolveString: jest.fn().mockResolvedValue("sk-resolved"),
      resolveRecord: jest
        .fn()
        .mockResolvedValue({ "X-Provider-Org": "org-resolved" }),
    };
    const service = new ProviderClientService(
      { getNode: jest.fn().mockReturnValue(node) } as any,
      new TelemetryService(),
      undefined,
      resolver as any,
    );

    await service.forward(makeCanonical(), "openai", "gpt-4o", routingMeta);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-resolved");
    expect(init.headers["X-Provider-Org"]).toBe("org-resolved");
    expect(resolver.resolveString).toHaveBeenCalledWith(
      "${vault:secret/openai#api_key}",
    );
    expect(resolver.resolveRecord).toHaveBeenCalledWith(node.headers);
  });
});
