import type {
  ErrorRedactionOptions,
  ErrorRedactionTelemetry,
} from '../security/error-redaction';
import {
  extractErrorMessage,
  redactErrorBody,
  redactErrorText,
} from '../security/error-redaction';

type BatchProviderErrorBody = Record<string, unknown> | Buffer | string;

const BATCH_ERROR_REDACTION = {
  bearerReplacement: 'Bearer [redacted]',
  gatewayKeyReplacement: 'gw_sk_[redacted]',
  skKeyReplacement: '[redacted-provider-key]',
  providerKeyReplacement: '[redacted-provider-key]',
  sensitiveValueReplacement: '[redacted]',
};

export function extractBatchProviderError(
  value: unknown,
  telemetry?: ErrorRedactionTelemetry,
): string | null {
  return extractErrorMessage(
    value,
    { ...BATCH_ERROR_REDACTION, maxLength: 500, telemetry },
    'provider_batch_error',
  );
}

export function sanitizeBatchProviderErrorBody<T extends BatchProviderErrorBody>(
  body: T,
  telemetry?: ErrorRedactionTelemetry,
): T {
  return redactErrorBody(body, { ...BATCH_ERROR_REDACTION, telemetry });
}

export function redactBatchProviderErrorText(
  text: string,
  options: ErrorRedactionOptions = {},
): string {
  return redactErrorText(text, { ...BATCH_ERROR_REDACTION, ...options });
}
