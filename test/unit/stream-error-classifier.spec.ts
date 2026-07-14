import { streamErrorMessage } from '../../src/providers/stream/stream-error-classifier';

describe('stream error classification', () => {
  it('redacts provider secrets from stream error messages', () => {
    const message = streamErrorMessage({
      type: 'error',
      error: {
        message:
          'Authorization failed for Bearer sk-secret-provider-token api_key=sk-query-secret-token',
        code: 'invalid_api_key:sk-code-secret-token',
        type: 'auth_token=access-token-secret',
      },
    });

    expect(message).toContain('[REDACTED]');
    expect(message).not.toContain('sk-secret-provider-token');
    expect(message).not.toContain('sk-query-secret-token');
    expect(message).not.toContain('sk-code-secret-token');
    expect(message).not.toContain('access-token-secret');
  });
});
