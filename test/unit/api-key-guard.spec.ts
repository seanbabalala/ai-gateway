import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from '../../src/auth/api-key.guard';
import { mockConfigService } from '../helpers';

function makeContext(headers: Record<string, string> = {}): any {
  const request: any = { headers, apiKeyName: undefined };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    _request: request,
  };
}

describe('ApiKeyGuard', () => {
  it('should allow access when no API keys are configured', () => {
    const config = mockConfigService({ auth: { api_keys: [] } });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when auth is undefined', () => {
    const config = mockConfigService({ auth: undefined });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException when header is missing', () => {
    const config = mockConfigService({
      auth: { api_keys: [{ key: 'sk-test-123', name: 'test' }] },
    });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException for invalid key', () => {
    const config = mockConfigService({
      auth: { api_keys: [{ key: 'sk-test-123', name: 'test' }] },
    });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext({ authorization: 'Bearer sk-wrong-key' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should pass and attach key name for valid key', () => {
    const config = mockConfigService({
      auth: { api_keys: [{ key: 'sk-test-123', name: 'my-app' }] },
    });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext({ authorization: 'Bearer sk-test-123' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx._request.apiKeyName).toBe('my-app');
  });

  // ===== Timing-safe comparison tests =====

  it('should use timing-safe comparison (correct key matches via SHA-256)', () => {
    const config = mockConfigService({
      auth: { api_keys: [{ key: 'sk-timing-safe-key', name: 'secure-app' }] },
    });
    const guard = new ApiKeyGuard(config);
    const ctx = makeContext({ authorization: 'Bearer sk-timing-safe-key' });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx._request.apiKeyName).toBe('secure-app');
  });

  it('should reject a key that differs by one character', () => {
    const config = mockConfigService({
      auth: { api_keys: [{ key: 'sk-test-abc', name: 'test' }] },
    });
    const guard = new ApiKeyGuard(config);

    // Differs by last character
    const ctx = makeContext({ authorization: 'Bearer sk-test-abd' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should match the correct key among multiple configured keys', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [
          { key: 'sk-first', name: 'first' },
          { key: 'sk-second', name: 'second' },
          { key: 'sk-third', name: 'third' },
        ],
      },
    });
    const guard = new ApiKeyGuard(config);

    const ctx = makeContext({ authorization: 'Bearer sk-second' });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(ctx._request.apiKeyName).toBe('second');
  });

  it('should re-compute hashes when config keys change', () => {
    const keys = [{ key: 'sk-old', name: 'old' }];
    const config = mockConfigService({ auth: { api_keys: keys } });
    const guard = new ApiKeyGuard(config);

    // Old key works
    expect(guard.canActivate(makeContext({ authorization: 'Bearer sk-old' }))).toBe(true);

    // Simulate config reload — replace the array reference
    const newKeys = [{ key: 'sk-new', name: 'new' }];
    config.auth = { api_keys: newKeys };

    // New key works
    expect(guard.canActivate(makeContext({ authorization: 'Bearer sk-new' }))).toBe(true);

    // Old key no longer works
    expect(() =>
      guard.canActivate(makeContext({ authorization: 'Bearer sk-old' })),
    ).toThrow(UnauthorizedException);
  });
});
