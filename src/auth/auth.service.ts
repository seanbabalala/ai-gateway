import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { ConfigService } from '../config/config.service';

const ALLOW_UNAUTHENTICATED_DASHBOARD_ENV =
  'SIFTGATE_ALLOW_UNAUTHENTICATED_DASHBOARD';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePasswordHashed();
  }

  /** Whether dashboard auth is required. Secure by default unless explicitly disabled. */
  get isAuthRequired(): boolean {
    if (this.config.dashboard?.auth_required !== false) return true;
    return !this.isUnauthenticatedDashboardAllowed();
  }

  get isLocalPasswordAuthEnabled(): boolean {
    return !!this.config.dashboardPasswordHash;
  }

  get isOidcEnabled(): boolean {
    return this.config.dashboardOidc?.enabled ?? false;
  }

  get allowsLegacyDashboardTokenAuth(): boolean {
    return this.config.dashboard?.allow_legacy_token_auth !== false;
  }

  /** Hash a plain-text password with bcrypt (10 rounds) */
  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  /** Verify a plain-text password against a bcrypt hash */
  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Generate a JWT token for the dashboard session (24h expiry) */
  generateToken(subject = 'dashboard', claims: Record<string, unknown> = {}): string {
    const secret = this.getJwtSecret();
    return jwt.sign({ ...claims, sub: subject }, secret, {
      expiresIn: '24h',
      algorithm: 'HS256',
    });
  }

  /** Verify a JWT token, return payload or null */
  verifyToken(token: string): jwt.JwtPayload | null {
    try {
      const secret = this.getJwtSecret();
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      });
      return payload as jwt.JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Derive the JWT secret from the password hash.
   * SHA-256("gw-jwt:" + passwordHash)
   * Changing the password automatically invalidates all existing tokens.
   */
  private getJwtSecret(): string {
    const configuredSecret = this.config.dashboard?.session_secret;
    if (configuredSecret && configuredSecret.trim()) {
      return configuredSecret.trim();
    }
    const hash = this.config.dashboardPasswordHash;
    if (!hash) {
      if (this.isOidcEnabled) {
        throw new Error(
          'dashboard.session_secret is required when OIDC is enabled without a local dashboard password',
        );
      }
      throw new Error('No dashboard password configured');
    }
    return crypto
      .createHash('sha256')
      .update(`gw-jwt:${hash}`)
      .digest('hex');
  }

  /**
   * On startup: if a plain-text password is configured (not a bcrypt hash),
   * hash it and write the hash back to the YAML config.
   */
  async ensurePasswordHashed(): Promise<void> {
    const password = this.config.dashboardPasswordHash;
    if (
      this.config.dashboard?.auth_required === false &&
      !this.isUnauthenticatedDashboardAllowed()
    ) {
      this.logger.warn(
        `dashboard.auth_required=false is ignored in production unless ${ALLOW_UNAUTHENTICATED_DASHBOARD_ENV}=true is set. Dashboard auth will fail closed.`,
      );
    }
    if (!password) {
      if (!this.isAuthRequired) {
        this.logger.warn(
          'Dashboard authentication is explicitly disabled by dashboard.auth_required=false.',
        );
        return;
      }
      if (this.isOidcEnabled) {
        this.logger.log('Dashboard local password is disabled; OIDC authentication is enabled.');
        return;
      }

      const generatedPassword = this.generateInitialPassword();
      const hash = await this.hashPassword(generatedPassword);
      try {
        this.config.setDashboardPasswordHash(hash);
      } catch (err) {
        throw new Error(
          `Dashboard authentication is required by default, but no dashboard.password is configured and SiftGate could not persist a generated password: ${(err as Error).message}. ` +
            'Set dashboard.password, enable OIDC, or explicitly set dashboard.auth_required=false for trusted local development.',
        );
      }
      this.logger.warn(
        `Generated initial Dashboard password: ${generatedPassword}`,
      );
      this.logger.warn(
        'Store this password now; only its bcrypt hash was written back to gateway.config.yaml.',
      );
      return;
    }

    // bcrypt hashes start with $2a$ or $2b$
    if (password.startsWith('$2a$') || password.startsWith('$2b$')) {
      this.logger.log('Dashboard password is already hashed');
      return;
    }

    // Plain-text password detected — hash it and write back
    this.logger.log('Hashing plain-text dashboard password...');
    const hash = await this.hashPassword(password);
    this.config.setDashboardPasswordHash(hash);
    this.logger.log('Dashboard password hashed and saved to config');
  }

  private generateInitialPassword(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private isUnauthenticatedDashboardAllowed(): boolean {
    if (process.env[ALLOW_UNAUTHENTICATED_DASHBOARD_ENV] === 'true') {
      return true;
    }
    return process.env.NODE_ENV !== 'production';
  }
}
