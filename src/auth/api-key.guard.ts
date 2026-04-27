import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiKeys = this.config.auth?.api_keys;

    // No API keys configured → open access (backwards-compatible, dev-friendly)
    if (!apiKeys || apiKeys.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key. Use Authorization: Bearer <key>');
    }

    const key = authHeader.slice(7);
    const match = apiKeys.find((k) => k.key === key);

    if (!match) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach key name to request for logging/auditing
    request.apiKeyName = match.name;
    return true;
  }
}
