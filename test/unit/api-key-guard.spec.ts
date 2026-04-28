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
});
