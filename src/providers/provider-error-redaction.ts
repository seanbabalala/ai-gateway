import type { ErrorRedactionTelemetry } from '../security/error-redaction';
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

export function sanitizeProviderErrorBody(
  body: unknown,
  telemetry?: ErrorRedactionTelemetry,
): string {
  if (typeof body === 'string') {
    try {
      return stringifyRedactedProviderErrorValue(JSON.parse(body), telemetry);
    } catch {
      return redactProviderErrorText(body, telemetry);
    }
  }

  return stringifyRedactedProviderErrorValue(body, telemetry);
}

export function redactProviderErrorText(
  text: string,
  telemetry?: ErrorRedactionTelemetry,
): string {
  return redactErrorText(text, { ...PROVIDER_ERROR_REDACTION, telemetry });
}

function stringifyRedactedProviderErrorValue(
  value: unknown,
  telemetry?: ErrorRedactionTelemetry,
): string {
  return stringifyRedactedErrorBody(value, { ...PROVIDER_ERROR_REDACTION, telemetry });
}
