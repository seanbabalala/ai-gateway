import { validateConfigObject } from "../../src/config/config-validator";

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    server: { port: 2099, host: "0.0.0.0" },
    database: { type: "sqlite", path: ":memory:" },
    auth: { api_keys: [] },
    nodes: [
      {
        id: "openai",
        name: "OpenAI",
        protocol: "chat_completions",
        base_url: "https://api.openai.com",
        endpoint: "/v1/chat/completions",
        api_key: "${vault:secret/openai#api_key}",
        models: ["gpt-4o"],
        timeout_ms: 60000,
      },
    ],
    routing: {
      tiers: {
        standard: {
          primary: { node: "openai", model: "gpt-4o" },
          fallbacks: [],
        },
      },
      scoring: { simple_max: -0.1, standard_max: 0.08, complex_max: 0.35 },
    },
    budget: {
      daily_token_limit: 1000000,
      daily_cost_limit: 25,
      alert_threshold: 0.8,
    },
    models_pricing: { "gpt-4o": { input: 2.5, output: 10 } },
    ...overrides,
  };
}

const codes = (issues: { code: string }[]) => issues.map((item) => item.code);

describe("config validator secret manager support", () => {
  it("accepts provider api_key secret manager references", () => {
    const result = validateConfigObject(
      baseConfig({
        secrets: {
          vault: {
            address: "${VAULT_ADDR:-https://vault.example.com}",
            token: "${VAULT_TOKEN:-test-token}",
            kv_version: 2,
          },
        },
      }),
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).not.toContain("literal_provider_api_key");
    expect(codes(result.info)).toContain("secret_references_detected");
  });

  it("errors when secret references are disabled", () => {
    const result = validateConfigObject(
      baseConfig({ secrets: { enabled: false } }),
      { env: {} },
    );

    expect(result.ok).toBe(false);
    expect(codes(result.errors)).toContain("secret_refs_disabled");
  });

  it("warns when a referenced provider is not configured", () => {
    const result = validateConfigObject(baseConfig(), { env: {} });

    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain("secret_provider_not_configured");
    expect(codes(result.info)).toContain("secret_manager_default_config");
  });

  it("supports ${env:VAR} references alongside ${VAR}", () => {
    const result = validateConfigObject(
      baseConfig({
        nodes: [
          {
            id: "openai",
            name: "OpenAI",
            protocol: "chat_completions",
            base_url: "https://api.openai.com",
            endpoint: "/v1/chat/completions",
            api_key: "${env:OPENAI_API_KEY:-test}",
            models: ["gpt-4o"],
            timeout_ms: 60000,
          },
        ],
      }),
      { env: {} },
    );

    expect(result.ok).toBe(true);
    expect(codes(result.errors)).not.toContain("malformed_env_reference");
  });
});
