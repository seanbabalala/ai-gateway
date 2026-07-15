const SENSITIVE_BATCH_ERROR_FIELD =
  /^(authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|refreshtoken|id[_-]?token|idtoken|auth[_-]?token|authtoken|bearer|secret|client[_-]?secret|clientsecret|password)$/i;

type BatchProviderErrorBody = Record<string, unknown> | Buffer | string;

export function extractBatchProviderError(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return redactBatchProviderErrorText(value, { maxLength: 500 });
  }
  if (isRecord(value)) {
    if (value.error) return extractBatchProviderError(value.error);
    if (typeof value.message === 'string') {
      return redactBatchProviderErrorText(value.message, { maxLength: 500 });
    }
    if (typeof value.reason === 'string') {
      return redactBatchProviderErrorText(value.reason, { maxLength: 500 });
    }
    if (typeof value.type === 'string') {
      return redactBatchProviderErrorText(value.type, { maxLength: 500 });
    }
    return 'provider_batch_error';
  }
  return 'provider_batch_error';
}

export function sanitizeBatchProviderErrorBody<T extends BatchProviderErrorBody>(
  body: T,
): T {
  if (typeof body === 'string') {
    return redactBatchProviderErrorText(body) as T;
  }
  if (Buffer.isBuffer(body)) {
    return Buffer.from(redactBatchProviderErrorText(body.toString('utf8'))) as T;
  }
  return redactBatchProviderErrorValue(body) as T;
}

export function redactBatchProviderErrorText(
  text: string,
  options: { maxLength?: number } = {},
): string {
  const redacted = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bgw_sk_[A-Za-z0-9._~+/-]+/gi, 'gw_sk_[redacted]')
    .replace(/\b(?:sk-ant|sk|rk|gsk|xai)-[A-Za-z0-9._-]{8,}\b/gi, '[redacted-provider-key]')
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)=)[^&\s]+/gi,
      '$1[redacted]',
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match: string, prefix: string, value: string) => {
        if (value.startsWith('"')) return `${prefix}"[redacted]"`;
        if (value.startsWith("'")) return `${prefix}'[redacted]'`;
        return `${prefix}[redacted]`;
      },
    );
  return options.maxLength ? redacted.slice(0, options.maxLength) : redacted;
}

function redactBatchProviderErrorValue(value: unknown, fieldName?: string): unknown {
  if (fieldName && SENSITIVE_BATCH_ERROR_FIELD.test(fieldName)) {
    return '[redacted]';
  }
  if (typeof value === 'string') return redactBatchProviderErrorText(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactBatchProviderErrorValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactBatchProviderErrorValue(nested, key),
      ]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}
