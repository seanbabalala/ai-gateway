import {
  redactErrorBody,
  redactErrorText,
  type ErrorRedactionTelemetry,
} from '../../src/security/error-redaction';

describe('shared error redaction telemetry', () => {
  function telemetry(surface: ErrorRedactionTelemetry['surface']) {
    return {
      surface,
      record: jest.fn(),
    } satisfies ErrorRedactionTelemetry;
  }

  it('records bounded surface and reason labels without original secret values', () => {
    const events = telemetry('provider');
    const redacted = redactErrorText(
      [
        'Authorization failed for Bearer sk-bearer-secret-token',
        'gateway=gw_sk_live_gateway_secret_123456',
        'callback=https://provider.test/v1/chat?api_key=sk-query-secret-token',
        'provider=gsk-provider-secret-token',
      ].join(' '),
      {
        bearerReplacement: 'Bearer [redacted]',
        gatewayKeyReplacement: 'gw_sk_[redacted]',
        skKeyReplacement: '[redacted-provider-key]',
        providerKeyReplacement: '[redacted-provider-key]',
        sensitiveValueReplacement: '[redacted]',
        telemetry: events,
      },
    );

    expect(redacted).toContain('Bearer [redacted]');
    expect(redacted).toContain('gw_sk_[redacted]');
    expect(redacted).toContain('api_key=[redacted]');
    expect(redacted).toContain('[redacted-provider-key]');
    expect(events.record).toHaveBeenCalledWith({
      surface: 'provider',
      reason: 'bearer_token',
    });
    expect(events.record).toHaveBeenCalledWith({
      surface: 'provider',
      reason: 'gateway_key',
    });
    expect(events.record).toHaveBeenCalledWith({
      surface: 'provider',
      reason: 'sensitive_value',
    });
    expect(events.record).toHaveBeenCalledWith({
      surface: 'provider',
      reason: 'provider_key',
    });
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('sk-bearer-secret-token');
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('gw_sk_live_gateway_secret_123456');
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('sk-query-secret-token');
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('gsk-provider-secret-token');
  });

  it('records sensitive object fields as a bounded reason', () => {
    const events = telemetry('batch');
    const redacted = redactErrorBody(
      {
        headers: {
          authorization: 'Bearer sk-nested-secret-token',
        },
      },
      {
        sensitiveValueReplacement: '[redacted]',
        telemetry: events,
      },
    );

    expect((redacted.headers as Record<string, unknown>).authorization).toBe('[redacted]');
    expect(events.record).toHaveBeenCalledWith({
      surface: 'batch',
      reason: 'sensitive_field',
    });
    expect(JSON.stringify(events.record.mock.calls)).not.toContain('sk-nested-secret-token');
  });
});
