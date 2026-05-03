import { Injectable, Logger } from "@nestjs/common";
import { createHmac, createHash } from "crypto";
import { ConfigService } from "./config.service";
import { SecretReference, extractSecretReferences } from "./secret-references";
import type {
  AwsSecretsManagerConfig,
  GcpSecretManagerConfig,
  SecretManagerConfig,
  VaultSecretManagerConfig,
} from "./gateway.config";

interface CachedSecret {
  value: string;
  expiresAt: number;
}

@Injectable()
export class SecretReferenceResolver {
  private readonly logger = new Logger(SecretReferenceResolver.name);
  private readonly cache = new Map<string, CachedSecret>();

  constructor(private readonly config: ConfigService) {}

  async resolveString(value: string): Promise<string> {
    const refs = extractSecretReferences(value);
    if (refs.length === 0) return value;

    let resolved = value;
    for (const ref of refs) {
      const secret = await this.resolveReference(ref);
      resolved = resolved.replace(ref.raw, secret);
    }
    return resolved;
  }

  async resolveRecord(
    value: Record<string, string> | undefined,
  ): Promise<Record<string, string>> {
    if (!value) return {};
    const resolved: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      resolved[key] = await this.resolveString(item);
    }
    return resolved;
  }

  private async resolveReference(ref: SecretReference): Promise<string> {
    const secrets = this.config.secrets;
    if (secrets.enabled === false) {
      throw new Error(
        `Secret reference ${ref.raw} cannot be resolved because secrets.enabled=false`,
      );
    }

    const cacheKey = `${ref.provider}:${ref.target}#${ref.field || ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    let value: string;
    if (ref.provider === "vault") {
      value = await this.resolveVault(ref, secrets.vault || {});
    } else if (ref.provider === "aws-sm") {
      value = await this.resolveAwsSecretsManager(ref, secrets.aws || {});
    } else {
      value = await this.resolveGcpSecretManager(ref, secrets.gcp || {});
    }

    const ttlMs = Math.max(0, secrets.cache_ttl_seconds ?? 300) * 1000;
    if (ttlMs > 0) {
      this.cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  }

  private async resolveVault(
    ref: SecretReference,
    config: VaultSecretManagerConfig,
  ): Promise<string> {
    const address = trimTrailingSlash(
      config.address || process.env.VAULT_ADDR || "",
    );
    const token = config.token || process.env.VAULT_TOKEN || "";
    if (!address)
      throw new Error(`Vault address is required to resolve ${ref.raw}`);
    if (!token)
      throw new Error(`Vault token is required to resolve ${ref.raw}`);

    const apiPath = this.resolveVaultApiPath(ref.target, config);
    const response = await this.fetchJson(
      `${address}/v1/${apiPath}`,
      {
        method: "GET",
        headers: { "X-Vault-Token": token },
      },
      config.timeout_ms,
    );

    const data =
      config.kv_version === 1
        ? nestedRecord(response, ["data"])
        : nestedRecord(response, ["data", "data"]) ||
          nestedRecord(response, ["data"]);
    return extractSecretValue(data, ref.field, ref.raw);
  }

  private resolveVaultApiPath(
    target: string,
    config: VaultSecretManagerConfig,
  ): string {
    const normalized = target.replace(/^\/+/, "");
    if (config.kv_version === 1 || normalized.includes("/data/")) {
      return normalized;
    }

    const mount = (
      config.mount ||
      normalized.split("/")[0] ||
      "secret"
    ).replace(/^\/+|\/+$/g, "");
    const relative = normalized.startsWith(`${mount}/`)
      ? normalized.slice(mount.length + 1)
      : normalized;
    return `${mount}/data/${relative}`;
  }

  private async resolveAwsSecretsManager(
    ref: SecretReference,
    config: AwsSecretsManagerConfig,
  ): Promise<string> {
    const region =
      config.region ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "";
    const accessKeyId =
      config.access_key_id || process.env.AWS_ACCESS_KEY_ID || "";
    const secretAccessKey =
      config.secret_access_key || process.env.AWS_SECRET_ACCESS_KEY || "";
    const sessionToken =
      config.session_token || process.env.AWS_SESSION_TOKEN || "";
    if (!region)
      throw new Error(`AWS region is required to resolve ${ref.raw}`);
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(
        `AWS access key credentials are required to resolve ${ref.raw}`,
      );
    }

    const endpoint =
      config.endpoint || `https://secretsmanager.${region}.amazonaws.com/`;
    const url = new URL(endpoint);
    const body = JSON.stringify({ SecretId: ref.target });
    const headers = signAwsJsonRequest({
      url,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      target: "secretsmanager.GetSecretValue",
      body,
    });

    const response = await this.fetchJson(
      url.toString(),
      { method: "POST", headers, body },
      config.timeout_ms,
    );
    const secretString =
      typeof response.SecretString === "string"
        ? response.SecretString
        : typeof response.SecretBinary === "string"
          ? Buffer.from(response.SecretBinary, "base64").toString("utf8")
          : undefined;

    if (secretString === undefined) {
      throw new Error(
        `AWS Secrets Manager response for ${ref.raw} did not contain a secret value`,
      );
    }
    return extractSecretValue(parseMaybeJson(secretString), ref.field, ref.raw);
  }

  private async resolveGcpSecretManager(
    ref: SecretReference,
    config: GcpSecretManagerConfig,
  ): Promise<string> {
    const endpoint = trimTrailingSlash(
      config.endpoint || "https://secretmanager.googleapis.com",
    );
    const resource = this.resolveGcpResourceName(ref.target, config);
    const token = await this.resolveGcpAccessToken(config);
    if (!token) {
      throw new Error(
        `GCP access token is required to resolve ${ref.raw}; set secrets.gcp.access_token or GCP_SECRET_MANAGER_TOKEN`,
      );
    }

    const response = await this.fetchJson(
      `${endpoint}/v1/${resource}:access`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      config.timeout_ms,
    );
    const encoded = nestedValue(response, ["payload", "data"]);
    if (typeof encoded !== "string") {
      throw new Error(
        `GCP Secret Manager response for ${ref.raw} did not contain payload.data`,
      );
    }
    return extractSecretValue(
      parseMaybeJson(Buffer.from(encoded, "base64").toString("utf8")),
      ref.field,
      ref.raw,
    );
  }

  private resolveGcpResourceName(
    target: string,
    config: GcpSecretManagerConfig,
  ): string {
    if (target.startsWith("projects/")) return target;
    const projectId =
      config.project_id ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      "";
    if (!projectId) {
      throw new Error(
        `GCP project_id is required for short Secret Manager reference "${target}"`,
      );
    }
    return `projects/${projectId}/secrets/${target}/versions/latest`;
  }

  private async resolveGcpAccessToken(
    config: GcpSecretManagerConfig,
  ): Promise<string> {
    const configured =
      config.access_token ||
      process.env.GCP_SECRET_MANAGER_TOKEN ||
      process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
      "";
    if (configured) return configured;
    if (config.use_metadata === false) return "";

    try {
      const response = await this.fetchJson(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {
          method: "GET",
          headers: { "Metadata-Flavor": "Google" },
        },
        config.timeout_ms ?? 1000,
      );
      return typeof response.access_token === "string"
        ? response.access_token
        : "";
    } catch (err) {
      this.logger.debug(
        `GCP metadata token lookup failed: ${(err as Error).message}`,
      );
      return "";
    }
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Secret manager returned a non-object JSON response");
      }
      return parsed as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function signAwsJsonRequest(params: {
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  target: string;
  body: string;
}): Record<string, string> {
  const service = "secretsmanager";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(params.body);
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host: params.url.host,
    "x-amz-date": amzDate,
    "x-amz-target": params.target,
  };
  if (params.sessionToken)
    headers["x-amz-security-token"] = params.sessionToken;

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key}:${headers[key].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest = [
    "POST",
    params.url.pathname || "/",
    params.url.search ? params.url.search.slice(1) : "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = getAwsSigningKey(
    params.secretAccessKey,
    dateStamp,
    params.region,
    service,
  );
  const signature = hmacHex(signingKey, stringToSign);
  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function getAwsSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractSecretValue(
  value: unknown,
  field: string | undefined,
  ref: string,
): string {
  if (field) {
    const selected = nestedValue(value, field.split("."));
    if (selected === undefined || selected === null) {
      throw new Error(
        `Secret reference ${ref} did not contain field "${field}"`,
      );
    }
    if (typeof selected === "string") return selected;
    return JSON.stringify(selected);
  }

  if (typeof value === "string") return value;
  if (isRecord(value)) {
    for (const key of ["value", "api_key", "token", "secret"]) {
      if (typeof value[key] === "string") return value[key] as string;
    }
    const entries = Object.values(value);
    if (entries.length === 1 && typeof entries[0] === "string") {
      return entries[0];
    }
  }

  throw new Error(
    `Secret reference ${ref} resolved to an object; add a "#field" selector.`,
  );
}

function nestedRecord(
  value: unknown,
  path: string[],
): Record<string, unknown> | undefined {
  const found = nestedValue(value, path);
  return isRecord(found) ? found : undefined;
}

function nestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
