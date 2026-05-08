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
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key. Use Authorization: Bearer <key>');
    }

    const key = authHeader.slice(7);
    const ip: string | undefined = request.ip || request.connection?.remoteAddress;
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
}
