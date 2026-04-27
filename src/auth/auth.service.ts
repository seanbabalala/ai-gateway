import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { ConfigService } from '../config/config.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePasswordHashed();
  }

  /** Whether dashboard auth is enabled (password is configured) */
  get isAuthRequired(): boolean {
    return !!this.config.dashboardPasswordHash;
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
  generateToken(): string {
    const secret = this.getJwtSecret();
    return jwt.sign({ sub: 'dashboard' }, secret, {
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
    const hash = this.config.dashboardPasswordHash;
    if (!hash) {
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
    if (!password) {
      this.logger.log(
        'No dashboard password configured — dashboard is open',
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
}
