import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class DashboardGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    // No password configured → dashboard is open (backwards-compatible)
    if (!this.authService.isAuthRequired) {
      const request = context.switchToHttp().getRequest();
      request.dashboardUser = { sub: 'dashboard' };
      request.dashboardUserId = 'dashboard';
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Extract token from Authorization header or query param
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    // Verify the JWT token
    const payload = this.authService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.dashboardUser = payload;
    request.dashboardUserId =
      typeof payload.sub === 'string' && payload.sub.trim()
        ? payload.sub.trim()
        : 'dashboard';
    return true;
  }

  private extractToken(request: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  }): string | null {
    // 1. Authorization: Bearer <token>
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // 2. Query param ?token=<jwt> (for SSE / EventSource)
    const queryToken = request.query?.token;
    if (queryToken) {
      return queryToken;
    }

    return null;
  }
}
