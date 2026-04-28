import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { ConfigService } from '../config/config.service';
import { ApiKeyEntry } from '../config/gateway.config';

interface HashedKeyEntry {
  hash: Buffer;
  entry: ApiKeyEntry;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  /** Pre-computed SHA-256 hashes for each configured API key */
  private keyHashes: HashedKeyEntry[] = [];
  private lastKeys: ApiKeyEntry[] | undefined;

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiKeys = this.config.auth?.api_keys;

    // No API keys configured → open access (backwards-compatible, dev-friendly)
    if (!apiKeys || apiKeys.length === 0) {
      return true;
    }

    // Re-compute hashes if keys changed (config reload)
    if (apiKeys !== this.lastKeys) {
      this.keyHashes = apiKeys.map((entry) => ({
        hash: createHash('sha256').update(entry.key).digest(),
        entry,
      }));
      this.lastKeys = apiKeys;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key. Use Authorization: Bearer <key>');
    }

    const key = authHeader.slice(7);
    const match = this.findKey(key);

    if (!match) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach key name to request for logging/auditing
    request.apiKeyName = match.name;
    return true;
  }

  /**
   * Timing-safe key lookup using SHA-256 hashes.
   * Prevents timing attacks that could leak key bytes via response-time analysis.
   */
  private findKey(candidateKey: string): ApiKeyEntry | undefined {
    const candidateHash = createHash('sha256').update(candidateKey).digest();
    for (const { hash, entry } of this.keyHashes) {
      if (
        candidateHash.length === hash.length &&
        timingSafeEqual(candidateHash, hash)
      ) {
        return entry;
      }
    }
    return undefined;
  }
}
