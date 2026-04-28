import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { mockConfigService } from '../helpers';

/** Minimal mock AuthService */
function mockAuthService(overrides: Record<string, unknown> = {}): any {
  return {
    isAuthRequired: true,
    verifyPassword: jest.fn().mockResolvedValue(true),
    generateToken: jest.fn().mockReturnValue('jwt-token-123'),
    config: { dashboardPasswordHash: '$2b$10$hash' },
    ...overrides,
  };
}

function makeReq(ip = '127.0.0.1'): any {
  return { ip, connection: { remoteAddress: ip } };
}

describe('AuthController', () => {
  describe('login', () => {
    it('should return a token for valid password', async () => {
      const authService = mockAuthService();
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      const result = await controller.login(makeReq(), { password: 'correct' });
      expect(result).toEqual({ token: 'jwt-token-123' });
      expect(authService.verifyPassword).toHaveBeenCalledWith('correct', '$2b$10$hash');
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const authService = mockAuthService({
        verifyPassword: jest.fn().mockResolvedValue(false),
      });
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      await expect(
        controller.login(makeReq(), { password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is missing', async () => {
      const authService = mockAuthService();
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      await expect(
        controller.login(makeReq(), {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return empty token when auth is not required', async () => {
      const authService = mockAuthService({ isAuthRequired: false });
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      const result = await controller.login(makeReq(), {});
      expect(result).toEqual({ token: '' });
    });
  });

  describe('getStatus', () => {
    it('should return authRequired: true when password configured', () => {
      const authService = mockAuthService({ isAuthRequired: true });
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      expect(controller.getStatus()).toEqual({ authRequired: true });
    });

    it('should return authRequired: false when no password', () => {
      const authService = mockAuthService({ isAuthRequired: false });
      const config = mockConfigService();
      const controller = new AuthController(authService, config);

      expect(controller.getStatus()).toEqual({ authRequired: false });
    });
  });

  describe('login brute-force protection', () => {
    it('should allow up to 5 login attempts per IP per minute', async () => {
      const authService = mockAuthService({
        verifyPassword: jest.fn().mockResolvedValue(false),
      });
      const config = mockConfigService({
        auth: { api_keys: [], rate_limit: { login_requests_per_minute: 5 } },
      });
      const controller = new AuthController(authService, config);
      const req = makeReq('192.168.1.1');

      // First 5 attempts should throw UnauthorizedException (bad password) not 429
      for (let i = 0; i < 5; i++) {
        await expect(
          controller.login(req, { password: 'wrong' }),
        ).rejects.toThrow(UnauthorizedException);
      }

      // 6th attempt should throw 429
      try {
        await controller.login(req, { password: 'wrong' });
        fail('Expected HttpException 429');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('should track different IPs separately for login attempts', async () => {
      const authService = mockAuthService({
        verifyPassword: jest.fn().mockResolvedValue(false),
      });
      const config = mockConfigService({
        auth: { api_keys: [], rate_limit: { login_requests_per_minute: 2 } },
      });
      const controller = new AuthController(authService, config);

      // IP1: 2 attempts
      const req1 = makeReq('10.0.0.1');
      await expect(controller.login(req1, { password: 'x' })).rejects.toThrow(UnauthorizedException);
      await expect(controller.login(req1, { password: 'x' })).rejects.toThrow(UnauthorizedException);

      // IP1: 3rd attempt should be rate limited
      try {
        await controller.login(req1, { password: 'x' });
        fail('Expected 429');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }

      // IP2: should still be allowed
      const req2 = makeReq('10.0.0.2');
      await expect(
        controller.login(req2, { password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should use default limit of 5 when not configured', async () => {
      const authService = mockAuthService({
        verifyPassword: jest.fn().mockResolvedValue(false),
      });
      const config = mockConfigService({
        auth: { api_keys: [], rate_limit: undefined },
      });
      const controller = new AuthController(authService, config);
      const req = makeReq('10.0.0.5');

      // Should allow 5 attempts
      for (let i = 0; i < 5; i++) {
        await expect(
          controller.login(req, { password: 'wrong' }),
        ).rejects.toThrow(UnauthorizedException);
      }

      // 6th should be 429
      try {
        await controller.login(req, { password: 'wrong' });
        fail('Expected 429');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });
  });
});
