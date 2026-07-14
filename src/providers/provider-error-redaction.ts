const SENSITIVE_PROVIDER_ERROR_FIELD =
  /^(authorization|x-api-key|api[_-]?key|apikey|access[_-]?token|accesstoken|refresh[_-]?token|refreshtoken|id[_-]?token|idtoken|auth[_-]?token|authtoken|bearer|secret|client[_-]?secret|clientsecret|password)$/i;

export function sanitizeProviderErrorBody(body: string): string {
  try {
    return JSON.stringify(redactProviderErrorValue(JSON.parse(body)));
  } catch {
    return redactProviderErrorText(body);
  }
}

export function redactProviderErrorText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bgw_sk_live_[A-Za-z0-9._-]+\b/g, '[REDACTED]')
    .replace(/\b(?:sk-ant|sk|rk|gsk|xai)-[A-Za-z0-9._-]{8,}\b/g, '[REDACTED]')
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)=)[^&\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      (_match: string, prefix: string, value: string) => {
        if (value.startsWith('"')) return `${prefix}"[REDACTED]"`;
        if (value.startsWith("'")) return `${prefix}'[REDACTED]'`;
        return `${prefix}[REDACTED]`;
      },
    );
}

function redactProviderErrorValue(value: unknown, fieldName?: string): unknown {
  if (fieldName && SENSITIVE_PROVIDER_ERROR_FIELD.test(fieldName)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return redactProviderErrorText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProviderErrorValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactProviderErrorValue(nested, key),
      ]),
    );
  }
  return value;
}
