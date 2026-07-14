import {
  redactProviderErrorText,
  sanitizeProviderErrorBody,
} from '../../src/providers/provider-error-redaction';

describe('provider error redaction', () => {
  it('redacts nested provider error JSON fields without leaking secret values', () => {
    const raw = {
      error: {
        message:
          'Authorization failed for Bearer sk-secret-provider-token',
        details: {
          headers: {
            Authorization: 'Bearer sk-nested-header-secret',
            'x-api-key': 'xai-nested-header-secret',
          },
          request: {
            client_secret: 'client-secret-value',
            password: 123456,
            url: 'https://provider.test/v1/chat?api_key=sk-query-secret-token',
          },
        },
      },
    };

    const sanitized = sanitizeProviderErrorBody(JSON.stringify(raw));
    const parsed = JSON.parse(sanitized);

    expect(parsed.error.message).toContain('Bearer [REDACTED]');
    expect(parsed.error.details.headers.Authorization).toBe('[REDACTED]');
    expect(parsed.error.details.headers['x-api-key']).toBe('[REDACTED]');
    expect(parsed.error.details.request.client_secret).toBe('[REDACTED]');
    expect(parsed.error.details.request.password).toBe('[REDACTED]');
    expect(parsed.error.details.request.url).toContain('api_key=[REDACTED]');
    expect(sanitized).not.toContain('sk-secret-provider-token');
    expect(sanitized).not.toContain('sk-nested-header-secret');
    expect(sanitized).not.toContain('xai-nested-header-secret');
    expect(sanitized).not.toContain('client-secret-value');
    expect(sanitized).not.toContain('sk-query-secret-token');
  });

  it.each([
    [
      'object body',
      {
        error: {
          message: 'bad api_key=sk-object-secret-token',
          access_token: 'access-token-secret',
        },
        retry_after: 30,
      },
    ],
    [
      'array body',
      [
        'Bearer sk-array-secret-token',
        { refresh_token: 'refresh-token-secret' },
        429,
      ],
    ],
  ])('redacts non-string provider error %s', (_name, body) => {
    const sanitized = sanitizeProviderErrorBody(body);

    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('sk-object-secret-token');
    expect(sanitized).not.toContain('access-token-secret');
    expect(sanitized).not.toContain('sk-array-secret-token');
    expect(sanitized).not.toContain('refresh-token-secret');
  });

  it('redacts plain text provider error fragments', () => {
    const sanitized = redactProviderErrorText(
      'upstream rejected api_key=sk-plain-secret-token; Authorization: Bearer sk-bearer-secret-token',
    );

    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toContain('sk-plain-secret-token');
    expect(sanitized).not.toContain('sk-bearer-secret-token');
  });
});
