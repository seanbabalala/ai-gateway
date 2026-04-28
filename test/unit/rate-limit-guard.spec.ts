import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from '../../src/auth/rate-limit.guard';
import { mockConfigService } from '../helpers';

function makeContext(overrides: { apiKeyName?: string; ip?: string } = {}): any {
  const request: any = {
    apiKeyName: overrides.apiKeyName,
    ip: overrides.ip || '127.0.0.1',
    connection: { remoteAddress: overrides.ip || '127.0.0.1' },
  };
  const headers: Record<string, string> = {};
  const response: any = {
    setHeader: jest.fn((name: string, value: string) => { headers[name] = value; }),
    _headers: headers,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    _response: response,
    _headers: headers,
  };
}

describe('RateLimitGuard', () => {
  it('should allow all requests when rate_limit is not configured', () => {
    const config = mockConfigService({ auth: { api_keys: [], rate_limit: undefined } });
    const guard = new RateLimitGuard(config);
    const ctx = makeContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow requests within the limit', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [],
        rate_limit: { requests_per_minute: 5, requests_per_minute_ip: 3 },
      },
    });
    const guard = new RateLimitGuard(config);

    for (let i = 0; i < 3; i++) {
      const ctx = makeContext({ ip: '10.0.0.1' });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('should throw 429 when limit is exceeded', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [],
        rate_limit: { requests_per_minute: 60, requests_per_minute_ip: 2 },
      },
    });
    const guard = new RateLimitGuard(config);

    // Use 2 allowed requests
    guard.canActivate(makeContext({ ip: '10.0.0.1' }));
    guard.canActivate(makeContext({ ip: '10.0.0.1' }));

    // 3rd request should fail
    try {
      guard.canActivate(makeContext({ ip: '10.0.0.1' }));
      fail('Expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('should use per-key limit when API key name is present', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [],
        rate_limit: { requests_per_minute: 3, requests_per_minute_ip: 1 },
      },
    });
    const guard = new RateLimitGuard(config);

    // Per-key limit is 3 (not the per-IP limit of 1)
    expect(guard.canActivate(makeContext({ apiKeyName: 'my-app', ip: '10.0.0.1' }))).toBe(true);
    expect(guard.canActivate(makeContext({ apiKeyName: 'my-app', ip: '10.0.0.1' }))).toBe(true);
    expect(guard.canActivate(makeContext({ apiKeyName: 'my-app', ip: '10.0.0.1' }))).toBe(true);

    // 4th request with same key should fail
    try {
      guard.canActivate(makeContext({ apiKeyName: 'my-app', ip: '10.0.0.1' }));
      fail('Expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
    }
  });

  it('should set rate limit headers', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [],
        rate_limit: { requests_per_minute: 60, requests_per_minute_ip: 10 },
      },
    });
    const guard = new RateLimitGuard(config);
    const ctx = makeContext({ ip: '10.0.0.2' });

    guard.canActivate(ctx);

    const setHeader = ctx._response.setHeader;
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String));
  });

  it('should track different IPs separately', () => {
    const config = mockConfigService({
      auth: {
        api_keys: [],
        rate_limit: { requests_per_minute: 60, requests_per_minute_ip: 1 },
      },
    });
    const guard = new RateLimitGuard(config);

    // Each IP gets 1 request
    expect(guard.canActivate(makeContext({ ip: '10.0.0.1' }))).toBe(true);
    expect(guard.canActivate(makeContext({ ip: '10.0.0.2' }))).toBe(true);

    // Second request from same IP should fail
    try {
      guard.canActivate(makeContext({ ip: '10.0.0.1' }));
      fail('Expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
    }
  });
});
