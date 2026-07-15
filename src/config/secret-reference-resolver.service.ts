import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { ConfigService } from './config.service';
import { fetchWithTimeout } from '../http/fetch-with-timeout';
import type {
  AwsSecretsManagerConfig,
  GcpSecretManagerConfig,
  SecretManagerConfig,
  SecretManagerFailurePolicy,
  VaultSecretManagerConfig,
} from './gateway.config';
import {
  SecretReference,
  extractSecretReferences,
  scanSecretReferences,
} from './secret-references';

interface CachedSecret {
  value: string;
  expiresAt: number;
}

export interface ResolveSecretOptions {
  optional?: boolean;
  location?: string;
}

@Injectable()
export class SecretReferenceResolverService {
  private readonly logger = new Logger(SecretReferenceResolverService.name);
  private readonly cache = new Map<string, CachedSecret>();

  constructor(private readonly config: ConfigService) {}

  async resolveString(
    value: string,
    options: ResolveSecretOptions = {},
  ): Promise<string> {
    const resolved = await this.resolveStringMaybe(value, options);
    if (resolved === undefined) {
      return '';
    }
    return resolved;
  }

  async resolveOptionalString(
    value: string | undefined,
    options: ResolveSecretOptions = {},
  ): Promise<string | undefined> {
    if (value === undefined) return undefined;
    return this.resolveStringMaybe(value, { ...options, optional: true });
  }

  async resolveRecord(
    value: Record<string, string> | undefined,
    options: ResolveSecretOptions = {},
  ): Promise<Record<string, string>> {
    if (!value) return {};
    const resolved: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = await this.resolveStringMaybe(item, {
        ...options,
        optional: options.optional ?? true,
        location: options.location ? `${options.location}.${key}` : key,
      });
      if (next !== undefined) {
        resolved[key] = next;
      }
    }
    return resolved;
  }

  clearCache(): void {
    this.cache.clear();
  }

  isReference(value: string | undefined | null): boolean {
    return typeof value === 'string' && extractSecretReferences(value).length > 0;
  }

  private async resolveStringMaybe(
    value: string,
    options: ResolveSecretOptions,
  ): Promise<string | undefined> {
    const scan = scanSecretReferences(value);
    if (scan.invalid.length > 0) {
      throw new Error(
        `Invalid secret reference at ${options.location || 'config'}: ${scan.invalid[0].reason}`,
      );
    }
    if (scan.references.length === 0) return value;

    let resolved = value;
    for (const ref of scan.references) {
      let secret: string;
      try {
        secret = await this.resolveReference(ref);
      } catch (err) {
        const fallback = this.handleResolveFailure(ref, err, options);
        if (fallback === undefined) return undefined;
        secret = fallback;
      }
      resolved = resolved.split(ref.raw).join(secret);
    }
    return resolved;
  }

  private handleResolveFailure(
    ref: SecretReference,
    err: unknown,
    options: ResolveSecretOptions,
  ): string | undefined {
    const message = err instanceof Error ? err.message : String(err);
    const location = options.location ? ` at ${options.location}` : '';
    if (
      options.optional &&
      this.secretManager.failure_policy === 'fail_open_for_optional'
    ) {
      this.logger.warn(
        `Optional secret reference ${ref.raw}${location} was not resolved and will be omitted: ${this.sanitizeError(message)}`,
      );
      return undefined;
    }
    throw new Error(
      `Secret reference ${ref.raw}${location} could not be resolved: ${this.sanitizeError(message)}`,
    );
  }

  private async resolveReference(ref: SecretReference): Promise<string> {
    const cacheKey = `${ref.backend}:${ref.target}#${ref.field || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    this.assertBackendEnabled(ref);

    let value: string;
    if (ref.backend === 'env') {
      value = this.resolveEnv(ref);
    } else if (ref.backend === 'vault') {
      value = await this.resolveVault(ref, this.secretManager.backends.vault);
    } else if (ref.backend === 'aws-sm') {
      value = await this.resolveAwsSecretsManager(
        ref,
        this.secretManager.backends.aws_sm,
      );
    } else {
      value = await this.resolveGcpSecretManager(
        ref,
        this.secretManager.backends.gcp_sm,
      );
    }

    const ttlMs = Math.max(0, this.secretManager.cache_ttl_seconds) * 1000;
    if (ttlMs > 0) {
      this.cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    }
    return value;
  }

  private assertBackendEnabled(ref: SecretReference): void {
    const backends = this.secretManager.backends;
    const enabled =
      ref.backend === 'env'
        ? backends.env.enabled
        : ref.backend === 'vault'
          ? backends.vault.enabled
          : ref.backend === 'aws-sm'
            ? backends.aws_sm.enabled
            : backends.gcp_sm.enabled;

    if (!enabled) {
      throw new Error(`secret backend "${ref.backend}" is not enabled`);
    }
  }

  private resolveEnv(ref: SecretReference): string {
    const value = process.env[ref.target];
    if (value !== undefined) return value;
    if (ref.defaultValue !== undefined) return ref.defaultValue;
    throw new Error(`environment variable ${ref.target} is not set`);
  }

  private async resolveVault(
    ref: SecretReference,
    config: Required<VaultSecretManagerConfig>,
  ): Promise<string> {
    const address = trimTrailingSlash(
      (await this.resolveBackendEnvOnly(config.address, 'vault.address')) ||
        process.env.VAULT_ADDR ||
        '',
    );
    const token =
      (await this.resolveBackendEnvOnly(config.token, 'vault.token')) ||
      process.env.VAULT_TOKEN ||
      '';
    if (!address) {
      throw new Error('Vault address is required');
    }
    if (!token) {
      throw new Error('Vault token is required');
    }

    const apiPath = this.resolveVaultApiPath(ref.target, config);
    const response = await this.fetchJson(
      `${address}/v1/${apiPath}`,
      {
        method: 'GET',
        headers: { 'X-Vault-Token': token },
      },
      config.timeout_ms,
    );
    const data =
      config.kv_version === 1
        ? nestedRecord(response, ['data'])
        : nestedRecord(response, ['data', 'data']) ||
          nestedRecord(response, ['data']);
    return extractSecretValue(data, ref.field, ref.raw);
  }

  private resolveVaultApiPath(
    target: string,
    config: Required<VaultSecretManagerConfig>,
  ): string {
    const normalized = target.replace(/^\/+/, '');
    if (config.kv_version === 1 || normalized.includes('/data/')) {
      return normalized;
    }
    const mount = (config.mount || normalized.split('/')[0] || 'secret')
      .replace(/^\/+|\/+$/g, '');
    const relative = normalized.startsWith(`${mount}/`)
      ? normalized.slice(mount.length + 1)
      : normalized;
    return `${mount}/data/${relative}`;
  }

  private async resolveAwsSecretsManager(
    ref: SecretReference,
    config: Required<AwsSecretsManagerConfig>,
  ): Promise<string> {
    const region =
      (await this.resolveBackendEnvOnly(config.region, 'aws_sm.region')) ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      '';
    const accessKeyId =
      (await this.resolveBackendEnvOnly(
        config.access_key_id,
        'aws_sm.access_key_id',
      )) ||
      process.env.AWS_ACCESS_KEY_ID ||
      '';
    const secretAccessKey =
      (await this.resolveBackendEnvOnly(
        config.secret_access_key,
        'aws_sm.secret_access_key',
      )) ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      '';
    const sessionToken =
      (await this.resolveBackendEnvOnly(
        config.session_token,
        'aws_sm.session_token',
      )) ||
      process.env.AWS_SESSION_TOKEN ||
      '';
    if (!region) {
      throw new Error('AWS region is required');
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('AWS access key credentials are required');
    }

    const endpoint =
      (await this.resolveBackendEnvOnly(config.endpoint, 'aws_sm.endpoint')) ||
      `https://secretsmanager.${region}.amazonaws.com/`;
    const url = new URL(endpoint);
    const body = JSON.stringify({ SecretId: ref.target });
    const headers = signAwsJsonRequest({
      url,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      target: 'secretsmanager.GetSecretValue',
      body,
    });

    const response = await this.fetchJson(
      url.toString(),
      { method: 'POST', headers, body },
      config.timeout_ms,
    );
    const secretString =
      typeof response.SecretString === 'string'
        ? response.SecretString
        : typeof response.SecretBinary === 'string'
          ? Buffer.from(response.SecretBinary, 'base64').toString('utf8')
          : undefined;
    if (secretString === undefined) {
      throw new Error('AWS Secrets Manager response did not contain a secret value');
    }
    return extractSecretValue(parseMaybeJson(secretString), ref.field, ref.raw);
  }

  private async resolveGcpSecretManager(
    ref: SecretReference,
    config: Required<GcpSecretManagerConfig>,
  ): Promise<string> {
    const endpoint = trimTrailingSlash(
      (await this.resolveBackendEnvOnly(config.endpoint, 'gcp_sm.endpoint')) ||
        'https://secretmanager.googleapis.com',
    );
    const resource = await this.resolveGcpResourceName(ref.target, config);
    const token = await this.resolveGcpAccessToken(config);
    if (!token) {
      throw new Error(
        'GCP access token is required; set secret_manager.backends.gcp_sm.access_token or GCP_SECRET_MANAGER_TOKEN',
      );
    }

    const response = await this.fetchJson(
      `${endpoint}/v1/${resource}:access`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      config.timeout_ms,
    );
    const encoded = nestedValue(response, ['payload', 'data']);
    if (typeof encoded !== 'string') {
      throw new Error('GCP Secret Manager response did not contain payload.data');
    }
    return extractSecretValue(
      parseMaybeJson(Buffer.from(encoded, 'base64').toString('utf8')),
      ref.field,
      ref.raw,
    );
  }

  private async resolveGcpResourceName(
    target: string,
    config: Required<GcpSecretManagerConfig>,
  ): Promise<string> {
    if (target.startsWith('projects/')) return target;
    const projectId =
      (await this.resolveBackendEnvOnly(config.project_id, 'gcp_sm.project_id')) ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      '';
    if (!projectId) {
      throw new Error(`GCP project_id is required for "${target}"`);
    }
    return `projects/${projectId}/secrets/${target}/versions/latest`;
  }

  private async resolveGcpAccessToken(
    config: Required<GcpSecretManagerConfig>,
  ): Promise<string> {
    const configured =
      (await this.resolveBackendEnvOnly(config.access_token, 'gcp_sm.access_token')) ||
      process.env.GCP_SECRET_MANAGER_TOKEN ||
      process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
      '';
    if (configured) return configured;
    if (config.use_metadata === false) return '';

    try {
      const response = await this.fetchJson(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        {
          method: 'GET',
          headers: { 'Metadata-Flavor': 'Google' },
        },
        config.timeout_ms ?? 1000,
      );
      return typeof response.access_token === 'string'
        ? response.access_token
        : '';
    } catch (err) {
      this.logger.debug(
        `GCP metadata token lookup failed: ${this.sanitizeError(err)}`,
      );
      return '';
    }
  }

  private async resolveBackendEnvOnly(
    value: string | undefined,
    location: string,
  ): Promise<string> {
    if (!value) return '';
    const scan = scanSecretReferences(value);
    if (scan.invalid.length > 0) {
      throw new Error(
        `Invalid secret_manager backend setting ${location}: ${scan.invalid[0].reason}`,
      );
    }
    let resolved = value;
    for (const ref of scan.references) {
      if (ref.backend !== 'env') {
        throw new Error(
          `secret_manager backend setting ${location} only supports env references`,
        );
      }
      resolved = resolved.split(ref.raw).join(this.resolveEnv(ref));
    }
    return resolved;
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const response = await fetchWithTimeout(url, init, {
      timeoutMs,
      timeoutMessage: `Secret manager request timed out after ${Math.max(1, Math.floor(timeoutMs))}ms.`,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('Secret manager returned a non-object JSON response');
    }
    return parsed;
  }

  private get secretManager(): Required<SecretManagerConfig> & {
    failure_policy: SecretManagerFailurePolicy;
    backends: {
      env: { enabled: boolean };
      vault: Required<VaultSecretManagerConfig>;
      aws_sm: Required<AwsSecretsManagerConfig>;
      gcp_sm: Required<GcpSecretManagerConfig>;
    };
  } {
    return this.config.secretManager;
  }

  private sanitizeError(value: unknown): string {
    const raw = value instanceof Error ? value.message : String(value);
    return raw
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/gw_sk_[A-Za-z0-9._~+/-]+/gi, 'gw_sk_[redacted]')
      .replace(/sk-[A-Za-z0-9._~+/-]+/gi, 'sk-[redacted]')
      .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA[redacted]')
      .slice(0, 300);
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
  const service = 'secretsmanager';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(params.body);
  const headers: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.1',
    host: params.url.host,
    'x-amz-date': amzDate,
    'x-amz-target': params.target,
  };
  if (params.sessionToken) {
    headers['x-amz-security-token'] = params.sessionToken;
  }

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key}:${headers[key].trim()}\n`)
    .join('');
  const signedHeaders = sortedHeaderKeys.join(';');
  const canonicalRequest = [
    'POST',
    params.url.pathname || '/',
    params.url.search ? params.url.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
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
  const kDate = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
    const selected = nestedValue(value, field.split('.'));
    if (selected === undefined || selected === null) {
      throw new Error(`Secret reference ${ref} did not contain field "${field}"`);
    }
    return typeof selected === 'string' ? selected : JSON.stringify(selected);
  }

  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    for (const key of ['value', 'api_key', 'token', 'secret']) {
      if (typeof value[key] === 'string') return value[key] as string;
    }
    const entries = Object.values(value);
    if (entries.length === 1 && typeof entries[0] === 'string') {
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
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
