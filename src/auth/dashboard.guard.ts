import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { getDashboardSessionCookie } from './dashboard-session-cookie';

@Injectable()
export class DashboardGuard implements CanActivate {
  private readonly logger = new Logger(DashboardGuard.name);
  private legacyQueryTokenWarningEmitted = false;

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

    // Extract token from Authorization header, session cookie, or legacy query param.
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
    cookies?: Record<string, string | undefined>;
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  }): string | null {
    // 1. Authorization: Bearer <token>
    const authHeader = this.headerValue(request.headers?.authorization);
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // 2. HttpOnly dashboard session cookie.
    const cookieToken = getDashboardSessionCookie(request);
    if (cookieToken) {
      return cookieToken;
    }

    // 3. Legacy query param ?token=<jwt> for older EventSource clients.
    const queryToken = this.headerValue(request.query?.token);
    if (queryToken) {
      this.warnLegacyQueryToken();
      return queryToken;
    }

    return null;
  }

  private warnLegacyQueryToken(): void {
    if (this.legacyQueryTokenWarningEmitted) return;
    this.legacyQueryTokenWarningEmitted = true;
    this.logger.warn(
      'Dashboard query-token authentication is deprecated; use the HttpOnly dashboard session cookie for SSE clients.',
    );
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
