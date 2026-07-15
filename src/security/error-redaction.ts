const SENSITIVE_ERROR_FIELD =
  /^(authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|refreshtoken|id[_-]?token|idtoken|auth[_-]?token|authtoken|bearer|secret|client[_-]?secret|clientsecret|password)$/i;

export interface ErrorRedactionOptions {
  bearerReplacement?: string;
  gatewayKeyReplacement?: string;
  skKeyReplacement?: string;
  providerKeyReplacement?: string;
  sensitiveValueReplacement?: string;
  maxLength?: number;
}

export type RedactableErrorBody = Record<string, unknown> | Buffer | string;

export function redactErrorText(
  text: string,
  options: ErrorRedactionOptions = {},
): string {
  const replacement = normalizedOptions(options);
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement.bearerReplacement)
    .replace(/\bgw_sk_[A-Za-z0-9._~+/-]+/gi, replacement.gatewayKeyReplacement)
    .replace(/\b(?:sk-ant|sk)-[A-Za-z0-9._~+/-]+/gi, replacement.skKeyReplacement)
    .replace(/\b(?:rk|gsk|xai)-[A-Za-z0-9._~+/-]+/gi, replacement.providerKeyReplacement)
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)=)[^&\s]+/gi,
      `$1${replacement.sensitiveValueReplacement}`,
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match: string, prefix: string, value: string) => {
        if (value.startsWith('"')) return `${prefix}"${replacement.sensitiveValueReplacement}"`;
        if (value.startsWith("'")) return `${prefix}'${replacement.sensitiveValueReplacement}'`;
        return `${prefix}${replacement.sensitiveValueReplacement}`;
      },
    );
  return replacement.maxLength ? redacted.slice(0, replacement.maxLength) : redacted;
}

export function redactErrorValue(
  value: unknown,
  options: ErrorRedactionOptions = {},
  fieldName?: string,
): unknown {
  const replacement = normalizedOptions(options);
  if (fieldName && SENSITIVE_ERROR_FIELD.test(fieldName)) {
    return replacement.sensitiveValueReplacement;
  }
  if (typeof value === 'string') return redactErrorText(value, options);
  if (Array.isArray(value)) {
    return value.map((item) => redactErrorValue(item, options));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactErrorValue(nested, options, key),
      ]),
    );
  }
  return value;
}

export function stringifyRedactedErrorBody(
  body: unknown,
  options: ErrorRedactionOptions = {},
): string {
  const serialized = JSON.stringify(redactErrorValue(body, options));
  return serialized === undefined
    ? redactErrorText(String(body), options)
    : serialized;
}

export function redactErrorBody<T extends RedactableErrorBody>(
  body: T,
  options: ErrorRedactionOptions = {},
): T {
  if (typeof body === 'string') return redactErrorText(body, options) as T;
  if (Buffer.isBuffer(body)) {
    return Buffer.from(redactErrorText(body.toString('utf8'), options)) as T;
  }
  return redactErrorValue(body, options) as T;
}

export function extractErrorMessage(
  value: unknown,
  options: ErrorRedactionOptions = {},
  fallback = 'provider_error',
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return redactErrorText(value, options);
  if (isRecord(value)) {
    if (value.error) return extractErrorMessage(value.error, options, fallback);
    if (typeof value.message === 'string') {
      return redactErrorText(value.message, options);
    }
    if (typeof value.reason === 'string') {
      return redactErrorText(value.reason, options);
    }
    if (typeof value.type === 'string') {
      return redactErrorText(value.type, options);
    }
    return fallback;
  }
  return fallback;
}

function normalizedOptions(options: ErrorRedactionOptions): Required<ErrorRedactionOptions> {
  const sensitiveValue = options.sensitiveValueReplacement ?? '[redacted]';
  return {
    bearerReplacement: options.bearerReplacement ?? `Bearer ${sensitiveValue}`,
    gatewayKeyReplacement: options.gatewayKeyReplacement ?? sensitiveValue,
    skKeyReplacement: options.skKeyReplacement ?? sensitiveValue,
    providerKeyReplacement: options.providerKeyReplacement ?? sensitiveValue,
    sensitiveValueReplacement: sensitiveValue,
    maxLength: options.maxLength ?? 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}
