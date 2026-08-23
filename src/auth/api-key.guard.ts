import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { GatewayApiKeyService } from './gateway-api-key.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly apiKeys: GatewayApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = this.extractApiKey(request.headers);

    if (!key) {
      throw new UnauthorizedException(
        'Missing API key. Use Authorization: Bearer <key> or X-Api-Key: <key>',
      );
    }
    const ip: string | undefined =
      request.ip || request.connection?.remoteAddress;
    const match = await this.apiKeys.findContextByPlainKey(key, ip);

    if (!match) {
      this.logger.warn('Invalid or disabled gateway API key rejected');
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach key context to request for logging, budget, rate-limit, and permissions.
    request.apiKeyName = match.name;
    request.apiKeyId = match.id;
    request.workspaceId = match.workspace_id;
    request.gatewayApiKey = match;
    return true;
  }

  /**
   * OpenAI-compatible clients send Authorization: Bearer, while native
   * Anthropic clients conventionally send x-api-key. Accept both client
   * authentication forms at the gateway boundary; upstream authentication is
   * handled independently by the selected provider node.
   */
  private extractApiKey(
    headers?: Record<string, string | string[] | undefined>,
  ): string | undefined {
    const authorization = this.headerValue(headers?.authorization);
    const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
    const bearerKey = bearerMatch?.[1]?.trim();
    if (bearerKey) return bearerKey;

    return this.headerValue(headers?.['x-api-key'])?.trim() || undefined;
  }

  private headerValue(
    value: string | string[] | undefined,
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
