import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/auth/login
   * Verify password and return a JWT token.
   */
  @Post('login')
  async login(@Body() body: { password?: string }) {
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
  getStatus() {
    return { authRequired: this.authService.isAuthRequired };
  }
}
