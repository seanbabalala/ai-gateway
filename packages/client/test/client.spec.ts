import { SiftGateClient, SiftGateError, type FetchLike } from "../src";

interface CapturedCall {
  url: string;
  method?: string;
  headers: Headers;
  body?: string;
}

function makeFetch(
  body: unknown,
  init: ResponseInit = { status: 200 },
): { fetch: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetch = jest.fn(
    async (input: string | URL | Request, requestInit?: RequestInit) => {
      calls.push({
        url: String(input),
        method: requestInit?.method,
        headers: new Headers(requestInit?.headers),
        body: requestInit?.body as string | undefined,
      });

      return new Response(
        typeof body === "string" ? body : JSON.stringify(body),
        {
          status: init.status ?? 200,
          statusText: init.statusText,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_test",
            ...(init.headers as Record<string, string> | undefined),
          },
        },
      );
    },
  ) as unknown as FetchLike;

  return { fetch, calls };
}

describe("@siftgate/client", () => {
  it("lists models with gateway auth and OpenAI-style /v1 base URL compatibility", async () => {
    const { fetch, calls } = makeFetch({
      object: "list",
      data: [{ id: "gpt-4o", object: "model" }],
    });
    const client = new SiftGateClient({
      baseUrl: "http://localhost:2099/v1/",
      gatewayApiKey: "gw_sk_test",
      fetch,
    });

    const models = await client.models.list();

    expect(models.data[0].id).toBe("gpt-4o");
    expect(calls[0].url).toBe("http://localhost:2099/v1/models");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.get("authorization")).toBe("Bearer gw_sk_test");
    expect(calls[0].headers.get("accept")).toBe("application/json");
  });

  it("posts chat completions JSON with a routing hint header", async () => {
    const { fetch, calls } = makeFetch({
      id: "chatcmpl_123",
      choices: [],
    });
    const client = new SiftGateClient({
      baseUrl: "http://localhost:2099",
      gatewayApiKey: "gw_sk_test",
      fetch,
    });

    await client.chat.completions.create(
      {
        model: "auto",
        messages: [{ role: "user", content: "Hello" }],
      },
      {
        routingHint: { tier: "standard", optimization: "cost" },
        headers: { "x-client-request-id": "client-1" },
      },
    );

    expect(calls[0].url).toBe("http://localhost:2099/v1/chat/completions");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.get("x-client-request-id")).toBe("client-1");
    expect(calls[0].headers.get("x-siftgate-routing-hint")).toBe(
      JSON.stringify({ tier: "standard", optimization: "cost" }),
    );
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({
      model: "auto",
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("covers responses, messages, and embeddings endpoints", async () => {
    const { fetch, calls } = makeFetch({ ok: true });
    const client = new SiftGateClient({ fetch, gatewayApiKey: "gw_sk_test" });

    await client.responses.create({
      model: "auto",
      input: "Say hi",
      text: { format: { type: "json_schema", name: "Greeting" } },
    });
    await client.messages.create({
      model: "auto",
      max_tokens: 64,
      messages: [{ role: "user", content: "Say hi" }],
    });
    await client.embeddings.create({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
      dimensions: 512,
    });

    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:2099/v1/responses",
      "http://localhost:2099/v1/messages",
      "http://localhost:2099/v1/embeddings",
    ]);
  });

  it("returns raw responses for streaming or advanced callers", async () => {
    const { fetch } = makeFetch("data: {}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    const client = new SiftGateClient({ fetch });

    const response = await client.requestRaw("POST", "/v1/chat/completions", {
      model: "auto",
      stream: true,
      messages: [{ role: "user", content: "Stream" }],
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toBe("data: {}\n\n");
  });

  it("throws SiftGateError with status, parsed body, and request id", async () => {
    const body = {
      error: {
        type: "budget_exceeded",
        message: "Daily budget exceeded",
      },
    };
    const { fetch } = makeFetch(body, {
      status: 429,
      statusText: "Too Many Requests",
    });
    const client = new SiftGateClient({ fetch });

    await expect(client.models.list()).rejects.toMatchObject({
      name: "SiftGateError",
      message: "Daily budget exceeded",
      status: 429,
      statusText: "Too Many Requests",
      body,
      requestId: "req_test",
    } satisfies Partial<SiftGateError>);
  });
});
