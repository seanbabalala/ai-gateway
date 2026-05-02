import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  StateBackendType,
  StateBackendUnavailableError,
  StateRateLimitResult,
  StateRuntimeStatus,
  StateUnavailablePolicy,
} from './state.types';
import { RespRedisClient } from './resp-redis.client';

interface MemoryValue {
  value: string;
  expiresAt: number | null;
}

@Injectable()
export class StateBackendService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StateBackendService.name);
  private readonly memory = new Map<string, MemoryValue>();
  private readonly memoryHashes = new Map<string, Map<string, string>>();
  private readonly memorySorted = new Map<string, { score: number; value: string }[]>();
  private readonly configuredBackend: StateBackendType;
  private readonly policy: StateUnavailablePolicy;
  private readonly prefix: string;
  private readonly syncIntervalMs: number;
  private readonly redis?: RespRedisClient;
  private recoveryInterval?: ReturnType<typeof setInterval>;
  private redisAvailable = false;
  private lastError: string | null = null;
  private lastErrorLoggedAt = 0;

  constructor(private readonly config: ConfigService) {
    const state = this.config.state;
    this.configuredBackend = state.backend;
    this.policy = state.unavailable_policy;
    this.prefix = state.redis.prefix;
    this.syncIntervalMs = state.redis.sync_interval_ms;

    if (state.backend === 'redis') {
      try {
        this.redis = new RespRedisClient(state.redis.url, state.redis.timeout_ms);
      } catch (err) {
        this.markRedisUnavailable(err);
      }
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;
    await this.probeRedis();
    this.recoveryInterval = setInterval(
      () => void this.probeRedis(),
      this.syncIntervalMs,
    );
    this.recoveryInterval.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
  }

  get status(): StateRuntimeStatus {
    return {
      backend: this.activeBackend,
      configured_backend: this.configuredBackend,
      redis_available: this.redisAvailable,
      unavailable_policy: this.policy,
      degraded: this.configuredBackend === 'redis' && !this.redisAvailable,
      last_error: this.lastError,
    };
  }

  get activeBackend(): StateBackendType {
    return this.redis && this.redisAvailable ? 'redis' : 'memory';
  }

  isRedisConfigured(): boolean {
    return this.configuredBackend === 'redis';
  }

  shouldFailClosed(): boolean {
    return this.configuredBackend === 'redis' && !this.redisAvailable && this.policy === 'fail_closed';
  }

  async getJson<T>(namespace: string, key: string): Promise<T | null> {
    const storageKey = this.key(namespace, key);
    if (this.redis && this.redisAvailable) {
      try {
        const value = await this.redis.command(['GET', storageKey]);
        return parseJson<T>(typeof value === 'string' ? value : null);
      } catch (err) {
        this.markRedisUnavailable(err);
        if (this.policy === 'fail_closed') throw this.unavailableError();
      }
    }

    return parseJson<T>(this.memoryGet(storageKey));
  }

  async setJson(
    namespace: string,
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const storageKey = this.key(namespace, key);
    const json = JSON.stringify(value);
    this.memorySet(storageKey, json, ttlSeconds);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.redis.command(['SETEX', storageKey, String(Math.ceil(ttlSeconds)), json]);
      } else {
        await this.redis.command(['SET', storageKey, json]);
      }
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    const storageKey = this.key(namespace, key);
    this.memory.delete(storageKey);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['DEL', storageKey]);
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async clearNamespace(namespace: string): Promise<void> {
    const namespacePrefix = this.key(namespace, '');
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(namespacePrefix)) this.memory.delete(key);
    }

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      const keys = await this.redis.command(['KEYS', `${namespacePrefix}*`]);
      if (Array.isArray(keys) && keys.length > 0) {
        const redisKeys = keys.filter((key): key is string => typeof key === 'string');
        if (redisKeys.length > 0) {
          await this.redis.command(['DEL', ...redisKeys]);
        }
      }
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async getHashAllJson<T>(
    namespace: string,
    hashKey: string,
  ): Promise<Map<string, T>> {
    const storageKey = this.key(namespace, hashKey);
    if (this.redis && this.redisAvailable) {
      try {
        const response = await this.redis.command(['HGETALL', storageKey]);
        return hashArrayToJsonMap<T>(response);
      } catch (err) {
        this.markRedisUnavailable(err);
        if (this.policy === 'fail_closed') throw this.unavailableError();
      }
    }

    const result = new Map<string, T>();
    const hash = this.memoryHashes.get(storageKey);
    if (!hash) return result;
    for (const [field, value] of hash.entries()) {
      const parsed = parseJson<T>(value);
      if (parsed !== null) result.set(field, parsed);
    }
    return result;
  }

  async setHashJson(
    namespace: string,
    hashKey: string,
    field: string,
    value: unknown,
  ): Promise<void> {
    const storageKey = this.key(namespace, hashKey);
    const json = JSON.stringify(value);
    let hash = this.memoryHashes.get(storageKey);
    if (!hash) {
      hash = new Map<string, string>();
      this.memoryHashes.set(storageKey, hash);
    }
    hash.set(field, json);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['HSET', storageKey, field, json]);
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async deleteHashField(
    namespace: string,
    hashKey: string,
    field: string,
  ): Promise<void> {
    const storageKey = this.key(namespace, hashKey);
    this.memoryHashes.get(storageKey)?.delete(field);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['HDEL', storageKey, field]);
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async clearHash(namespace: string, hashKey: string): Promise<void> {
    const storageKey = this.key(namespace, hashKey);
    this.memoryHashes.delete(storageKey);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['DEL', storageKey]);
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async hitRateLimit(
    namespace: string,
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<StateRateLimitResult> {
    if (this.redis && this.redisAvailable) {
      return this.hitRedisRateLimit(namespace, key, limit, windowMs, now);
    }

    if (this.shouldFailClosed()) {
      return {
        allowed: false,
        count: limit,
        limit,
        remaining: 0,
        resetAt: Math.ceil((now + windowMs) / 1000),
        retryAfterSec: Math.ceil(windowMs / 1000),
        degraded: true,
      };
    }

    if (this.isRedisConfigured()) {
      return this.openRateLimitResult(limit, windowMs, now);
    }

    return this.hitMemoryRateLimit(namespace, key, limit, windowMs, now, this.isRedisConfigured());
  }

  async addSortedJson(
    namespace: string,
    key: string,
    value: unknown,
    score: number,
    maxEntries: number,
    ttlMs: number,
  ): Promise<void> {
    const storageKey = this.key(namespace, key);
    const json = JSON.stringify(value);
    this.memorySortedAdd(storageKey, json, score, maxEntries);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed()) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['ZADD', storageKey, String(score), json]);
      const count = await this.redis.command(['ZCARD', storageKey]);
      if (typeof count === 'number' && count > maxEntries) {
        await this.redis.command([
          'ZREMRANGEBYRANK',
          storageKey,
          '0',
          String(count - maxEntries - 1),
        ]);
      }
      await this.redis.command(['PEXPIRE', storageKey, String(ttlMs)]);
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') throw this.unavailableError();
    }
  }

  async getSortedJson<T>(
    namespace: string,
    key: string,
  ): Promise<T[]> {
    const storageKey = this.key(namespace, key);
    if (this.redis && this.redisAvailable) {
      try {
        const values = await this.redis.command(['ZRANGE', storageKey, '0', '-1']);
        if (!Array.isArray(values)) return [];
        return values
          .map((value) => parseJson<T>(typeof value === 'string' ? value : null))
          .filter((value): value is T => value !== null);
      } catch (err) {
        this.markRedisUnavailable(err);
        if (this.policy === 'fail_closed') throw this.unavailableError();
      }
    }

    const values = this.memorySorted.get(storageKey) || [];
    return values
      .map((item) => parseJson<T>(item.value))
      .filter((value): value is T => value !== null);
  }

  private async hitRedisRateLimit(
    namespace: string,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<StateRateLimitResult> {
    const windowId = Math.floor(now / windowMs);
    const storageKey = this.key(namespace, `${key}:${windowId}`);
    try {
      const countResponse = await this.redis!.command(['INCR', storageKey]);
      const count = typeof countResponse === 'number' ? countResponse : 1;
      if (count === 1) {
        await this.redis!.command(['PEXPIRE', storageKey, String(windowMs)]);
      }
      const pttlResponse = await this.redis!.command(['PTTL', storageKey]);
      const pttl = typeof pttlResponse === 'number' && pttlResponse > 0
        ? pttlResponse
        : windowMs;
      const resetAt = Math.ceil((now + pttl) / 1000);
      const remaining = Math.max(0, limit - count);
      return {
        allowed: count <= limit,
        count,
        limit,
        remaining,
        resetAt,
        retryAfterSec: Math.max(1, Math.ceil(pttl / 1000)),
        degraded: false,
      };
    } catch (err) {
      this.markRedisUnavailable(err);
      if (this.policy === 'fail_closed') {
        return {
          allowed: false,
          count: limit,
          limit,
          remaining: 0,
          resetAt: Math.ceil((now + windowMs) / 1000),
          retryAfterSec: Math.ceil(windowMs / 1000),
          degraded: true,
        };
      }
      return this.openRateLimitResult(limit, windowMs, now);
    }
  }

  private openRateLimitResult(
    limit: number,
    windowMs: number,
    now: number,
  ): StateRateLimitResult {
    return {
      allowed: true,
      count: 1,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt: Math.ceil((now + windowMs) / 1000),
      retryAfterSec: Math.ceil(windowMs / 1000),
      degraded: true,
    };
  }

  private hitMemoryRateLimit(
    namespace: string,
    key: string,
    limit: number,
    windowMs: number,
    now: number,
    degraded: boolean,
  ): StateRateLimitResult {
    const windowId = Math.floor(now / windowMs);
    const storageKey = this.key(namespace, `${key}:${windowId}`);
    const current = Number(this.memoryGet(storageKey) || '0') + 1;
    this.memorySet(storageKey, String(current), Math.ceil(windowMs / 1000));
    const windowEnd = (windowId + 1) * windowMs;
    return {
      allowed: current <= limit,
      count: current,
      limit,
      remaining: Math.max(0, limit - current),
      resetAt: Math.ceil(windowEnd / 1000),
      retryAfterSec: Math.max(1, Math.ceil((windowEnd - now) / 1000)),
      degraded,
    };
  }

  private memorySortedAdd(
    storageKey: string,
    value: string,
    score: number,
    maxEntries: number,
  ): void {
    const values = this.memorySorted.get(storageKey) || [];
    values.push({ score, value });
    values.sort((a, b) => a.score - b.score);
    while (values.length > maxEntries) values.shift();
    this.memorySorted.set(storageKey, values);
  }

  private memoryGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySet(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds && ttlSeconds > 0
      ? Date.now() + ttlSeconds * 1000
      : null;
    this.memory.set(key, { value, expiresAt });
  }

  private key(namespace: string, key: string): string {
    return `${this.prefix}${namespace}:${key}`;
  }

  private markRedisUnavailable(err: unknown): void {
    this.redisAvailable = false;
    this.lastError = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 30_000) {
      this.lastErrorLoggedAt = now;
      this.logger.warn(
        `Redis state backend unavailable (${this.policy}): ${this.lastError}`,
      );
    }
  }

  private async probeRedis(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.ping();
      if (!this.redisAvailable) {
        this.logger.log('Redis state backend connected');
      }
      this.redisAvailable = true;
      this.lastError = null;
    } catch (err) {
      this.markRedisUnavailable(err);
    }
  }

  private unavailableError(): StateBackendUnavailableError {
    return new StateBackendUnavailableError(
      `Redis state backend is unavailable (${this.lastError || 'unknown error'})`,
    );
  }
}

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hashArrayToJsonMap<T>(value: unknown): Map<string, T> {
  const result = new Map<string, T>();
  if (!Array.isArray(value)) return result;
  for (let index = 0; index < value.length; index += 2) {
    const field = value[index];
    const raw = value[index + 1];
    if (typeof field !== 'string' || typeof raw !== 'string') continue;
    const parsed = parseJson<T>(raw);
    if (parsed !== null) result.set(field, parsed);
  }
  return result;
}
