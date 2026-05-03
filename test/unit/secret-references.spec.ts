import {
  scanConfigReferences,
  containsSecretReference,
} from "../../src/config/secret-references";

describe("secret reference parsing", () => {
  it("parses env references and secret manager references", () => {
    const scan = scanConfigReferences(
      "Bearer ${env:OPENAI_API_KEY:-test} ${vault:secret/openai#api_key}",
    );

    expect(scan.invalid).toHaveLength(0);
    expect(scan.env).toEqual([
      {
        raw: "${env:OPENAI_API_KEY:-test}",
        variable: "OPENAI_API_KEY",
        hasDefault: true,
        defaultValue: "test",
      },
    ]);
    expect(scan.secrets).toEqual([
      {
        raw: "${vault:secret/openai#api_key}",
        provider: "vault",
        target: "secret/openai",
        field: "api_key",
      },
    ]);
  });

  it("flags unsupported reference providers", () => {
    const scan = scanConfigReferences("${unknown:path}");

    expect(scan.invalid).toHaveLength(1);
    expect(scan.invalid[0].reason).toContain("Unsupported reference provider");
  });

  it("detects secret references", () => {
    expect(containsSecretReference("${aws-sm:prod/openai#api_key}")).toBe(true);
    expect(containsSecretReference("${OPENAI_API_KEY}")).toBe(false);
  });
});
