import { SecretReferenceResolver } from "../../src/config/secret-reference-resolver.service";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function makeResolver(
  secrets: Record<string, unknown>,
): SecretReferenceResolver {
  return new SecretReferenceResolver({ secrets } as any);
}

describe("SecretReferenceResolver", () => {
  it("resolves Vault KV v2 references and caches the result", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ data: { data: { api_key: "sk-vault" } } }),
        ),
    });
    global.fetch = fetchMock as any;

    const resolver = makeResolver({
      vault: {
        address: "https://vault.example.com",
        token: "vault-token",
        kv_version: 2,
        timeout_ms: 100,
      },
      cache_ttl_seconds: 60,
    });

    await expect(
      resolver.resolveString("${vault:secret/openai#api_key}"),
    ).resolves.toBe("sk-vault");
    await expect(
      resolver.resolveString("${vault:secret/openai#api_key}"),
    ).resolves.toBe("sk-vault");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://vault.example.com/v1/secret/data/openai",
    );
    expect(fetchMock.mock.calls[0][1].headers["X-Vault-Token"]).toBe(
      "vault-token",
    );
  });

  it("resolves AWS Secrets Manager JSON fields with SigV4 headers", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          SecretString: JSON.stringify({ api_key: "sk-aws" }),
        }),
      ),
    });
    global.fetch = fetchMock as any;

    const resolver = makeResolver({
      aws: {
        region: "us-east-1",
        access_key_id: "AKIA_TEST",
        secret_access_key: "secret",
        endpoint: "https://secretsmanager.us-east-1.amazonaws.com/",
      },
      cache_ttl_seconds: 0,
    });

    await expect(
      resolver.resolveString("${aws-sm:prod/openai#api_key}"),
    ).resolves.toBe("sk-aws");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(init.headers["x-amz-target"]).toBe("secretsmanager.GetSecretValue");
    expect(JSON.parse(init.body)).toEqual({ SecretId: "prod/openai" });
  });

  it("resolves GCP Secret Manager short refs", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          payload: {
            data: Buffer.from(JSON.stringify({ api_key: "sk-gcp" })).toString(
              "base64",
            ),
          },
        }),
      ),
    });
    global.fetch = fetchMock as any;

    const resolver = makeResolver({
      gcp: {
        project_id: "siftgate-prod",
        access_token: "gcp-token",
        timeout_ms: 100,
      },
      cache_ttl_seconds: 0,
    });

    await expect(
      resolver.resolveString("${gcp-sm:openai-key#api_key}"),
    ).resolves.toBe("sk-gcp");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://secretmanager.googleapis.com/v1/projects/siftgate-prod/secrets/openai-key/versions/latest:access",
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer gcp-token",
    );
  });

  it("fails closed when secret refs are disabled", async () => {
    const resolver = makeResolver({ enabled: false });

    await expect(
      resolver.resolveString("${vault:secret/openai#api_key}"),
    ).rejects.toThrow("secrets.enabled=false");
  });
});
