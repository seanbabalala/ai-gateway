import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ConfigService } from '../config/config.service';
import {
  AuthStatusResponseDto,
  ErrorEnvelopeDto,
  LoginRequestDto,
  LoginResponseDto,
} from '../openapi/openapi.dto';

@Controller('api/auth')
@ApiTags('Dashboard Auth')
export class AuthController {
  /** Per-IP sliding window for login attempts: ip → timestamp[] */
  private readonly loginAttempts = new Map<string, number[]>();

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/auth/login
   * Verify password and return a JWT token.
   */
  @Post('login')
  @ApiOperation({ summary: 'Login to the local Dashboard' })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiTooManyRequestsResponse({ type: ErrorEnvelopeDto })
  async login(@Req() req: any, @Body() body: { password?: string }) {
    const ip: string = req.ip || req.connection?.remoteAddress || 'unknown';
    this.checkLoginRate(ip);

    if (!this.authService.isAuthRequired) {
      // No password configured — this shouldn't be called, but handle gracefully
      return { token: '' };
    }

    const { password } = body;
    if (!password) {
      throw new UnauthorizedException('Password is required');
    }

    const hash = this.authService['config'].dashboardPasswordHash!;
    const valid = await this.authService.verifyPassword(password, hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid password');
    }

    const token = this.authService.generateToken();
    return { token };
  }

  /**
   * GET /api/auth/status
   * Public endpoint — returns whether auth is required.
   * No guard needed — this must be accessible without a token.
   */
  @Get('status')
  @ApiOperation({ summary: 'Check whether Dashboard authentication is enabled' })
  @ApiOkResponse({ type: AuthStatusResponseDto })
  getStatus() {
    return { authRequired: this.authService.isAuthRequired };
  }

  /**
   * Check per-IP login rate limit.
   * Throws 429 if login_requests_per_minute is exceeded.
   */
  private checkLoginRate(ip: string): void {
    const limit = this.config.auth?.rate_limit?.login_requests_per_minute ?? 5;
    const now = Date.now();
    const windowMs = 60_000;
    const windowStart = now - windowMs;

    let timestamps = this.loginAttempts.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.loginAttempts.set(ip, timestamps);
    }

    // Trim timestamps outside the window
    timestamps = timestamps.filter((t) => t > windowStart);
    this.loginAttempts.set(ip, timestamps);

    if (timestamps.length >= limit) {
      const retryAfterSec = Math.ceil(
        (timestamps[0] + windowMs - now) / 1000,
      );
      throw new HttpException(
        {
          error: {
            message: `Too many login attempts. Max ${limit} per minute.`,
            type: 'login_rate_limit_exceeded',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Record this attempt
    timestamps.push(now);
  }
}
