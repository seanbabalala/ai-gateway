import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { getDashboardSessionCookie } from './dashboard-session-cookie';
import { TelemetryService } from '../telemetry/telemetry.service';

@Injectable()
export class DashboardGuard implements CanActivate {
  private readonly logger = new Logger(DashboardGuard.name);
  private legacyQueryTokenWarningEmitted = false;

  constructor(
    private readonly authService: AuthService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // No password configured → dashboard is open (backwards-compatible)
    if (!this.authService.isAuthRequired) {
      const request = context.switchToHttp().getRequest();
      request.dashboardUser = { sub: 'dashboard' };
      request.dashboardUserId = 'dashboard';
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // Extract token from the HttpOnly session cookie or configured legacy fallbacks.
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
    // 1. HttpOnly dashboard session cookie.
    const cookieToken = getDashboardSessionCookie(request);
    if (cookieToken) {
      return cookieToken;
    }

    // 2. Legacy Authorization: Bearer <token>.
    const authHeader = this.headerValue(request.headers?.authorization);
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    // 3. Legacy query param ?token=<jwt> for older EventSource clients.
    const queryToken = this.headerValue(request.query?.token);

    if (!this.authService.allowsLegacyDashboardTokenAuth) {
      if (bearerToken !== null) {
        this.recordLegacyTokenEvent('legacy_rejected', 'bearer');
      } else if (queryToken) {
        this.recordLegacyTokenEvent('legacy_rejected', 'query');
      }
      return null;
    }

    if (bearerToken !== null) {
      this.recordLegacyTokenEvent('legacy_bearer_used', 'bearer');
      return bearerToken;
    }

    if (queryToken) {
      this.warnLegacyQueryToken();
      this.recordLegacyTokenEvent('legacy_query_used', 'query');
      return queryToken;
    }

    return null;
  }

  private recordLegacyTokenEvent(
    event: 'legacy_bearer_used' | 'legacy_query_used' | 'legacy_rejected',
    source: 'bearer' | 'query',
  ): void {
    this.telemetry?.recordDashboardLegacyTokenEvent({ event, source });
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
