import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { GatewayApiKeyService } from './gateway-api-key.service';
import {
  applyGatewayRequestIdHeaders,
  buildPublicErrorBody,
  ensureGatewayRequestId,
  extractRequestIdFromHeaders,
  protocolForPublicPath,
} from '../http/public-contract';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly apiKeys: GatewayApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse?.();
    const authHeader: string | undefined = request.headers?.authorization;
    const requestId = ensureGatewayRequestId(
      extractRequestIdFromHeaders((request.headers || {}) as Record<string, unknown>),
    );
    const protocol = protocolForPublicPath(request.originalUrl || request.url);

    if (!authHeader?.startsWith('Bearer ')) {
      if (response) applyGatewayRequestIdHeaders(response, requestId);
      throw new UnauthorizedException(
        buildPublicErrorBody(
          protocol,
          'Missing API key. Use Authorization: Bearer <key>',
          {
            type: 'authentication_error',
            requestId,
          },
        ),
      );
    }

    const key = authHeader.slice(7);
    const ip: string | undefined = request.ip || request.connection?.remoteAddress;
    const match = await this.apiKeys.findContextByPlainKey(key, ip);

    if (!match) {
      this.logger.warn('Invalid or disabled gateway API key rejected');
      if (response) applyGatewayRequestIdHeaders(response, requestId);
      throw new UnauthorizedException(
        buildPublicErrorBody(protocol, 'Invalid API key', {
          type: 'authentication_error',
          requestId,
        }),
      );
    }

    // Attach key context to request for logging, budget, rate-limit, and permissions.
    request.apiKeyName = match.name;
    request.apiKeyId = match.id;
    request.gatewayApiKey = match;
    return true;
  }
}
