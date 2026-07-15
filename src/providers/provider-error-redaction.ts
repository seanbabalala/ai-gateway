import {
  redactErrorText,
  stringifyRedactedErrorBody,
} from '../security/error-redaction';

const PROVIDER_ERROR_REDACTION = {
  bearerReplacement: 'Bearer [REDACTED]',
  gatewayKeyReplacement: '[REDACTED]',
  skKeyReplacement: '[REDACTED]',
  providerKeyReplacement: '[REDACTED]',
  sensitiveValueReplacement: '[REDACTED]',
};

export function sanitizeProviderErrorBody(body: unknown): string {
  if (typeof body === 'string') {
    try {
      return stringifyRedactedProviderErrorValue(JSON.parse(body));
    } catch {
      return redactProviderErrorText(body);
    }
  }

  return stringifyRedactedProviderErrorValue(body);
}

export function redactProviderErrorText(text: string): string {
  return redactErrorText(text, PROVIDER_ERROR_REDACTION);
}

function stringifyRedactedProviderErrorValue(value: unknown): string {
  return stringifyRedactedErrorBody(value, PROVIDER_ERROR_REDACTION);
}
