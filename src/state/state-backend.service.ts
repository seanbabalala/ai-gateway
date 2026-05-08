import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import {
  StateCategoryName,
  StateBackendType,
  StateBackendUnavailableError,
  StateRateLimitResult,
  StateRuntimeStatus,
  StateUnavailablePolicy,
} from './state.types';
import { RespRedisClient } from './resp-redis.client';
import { normalizeWorkspaceId } from '../workspaces/workspace-scope';

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
  private readonly categoryPolicies: Record<StateCategoryName, {
    unavailable_policy: StateUnavailablePolicy;
    ttl_seconds: number;
  }>;
  private readonly redis?: RespRedisClient;
  private recoveryInterval?: ReturnType<typeof setInterval>;
  private redisAvailable = false;
  private lastError: string | null = null;
  private lastErrorLoggedAt = 0;
  private readonly recentErrors: StateRuntimeStatus['recent_errors'] = [];

  constructor(private readonly config: ConfigService) {
    const state = this.config.state;
    this.configuredBackend = state.backend;
    this.policy = state.unavailable_policy;
    this.prefix = state.redis.prefix;
    this.syncIntervalMs = state.redis.sync_interval_ms;
    this.categoryPolicies = mergeCategoryPolicies(
      defaultCategoryPolicies(this.policy),
      state.categories,
    );

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
      key_prefix: this.prefix,
      redis_available: this.redisAvailable,
      unavailable_policy: this.policy,
      degraded: this.configuredBackend === 'redis' && !this.redisAvailable,
      last_error: this.lastError,
      recent_errors: [...this.recentErrors],
      categories: this.categoryStatuses(),
    };
  }

  get activeBackend(): StateBackendType {
    return this.redis && this.redisAvailable ? 'redis' : 'memory';
  }

  isRedisConfigured(): boolean {
    return this.configuredBackend === 'redis';
  }

  shouldFailClosed(category?: StateCategoryName): boolean {
    return (
      this.configuredBackend === 'redis' &&
      !this.redisAvailable &&
      this.categoryPolicy(category).unavailable_policy === 'fail_closed'
    );
  }

  async getJson<T>(
    namespace: StateCategoryName,
    key: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<T | null> {
    const storageKey = this.key(namespace, key, options.workspaceId);
    if (this.redis && this.redisAvailable) {
      try {
        const value = await this.redis.command(['GET', storageKey]);
        return parseJson<T>(typeof value === 'string' ? value : null);
      } catch (err) {
        this.markRedisUnavailable(err, namespace);
        if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      }
    }

    return parseJson<T>(this.memoryGet(storageKey));
  }

  async setJson(
    namespace: StateCategoryName,
    key: string,
    value: unknown,
    ttlSeconds?: number,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const categoryTtl = this.categoryPolicy(namespace).ttl_seconds;
    const effectiveTtl = ttlSeconds ?? categoryTtl;
    const storageKey = this.key(namespace, key, options.workspaceId);
    const json = JSON.stringify(value);
    this.memorySet(storageKey, json, effectiveTtl);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      return;
    }

    try {
      if (effectiveTtl && effectiveTtl > 0) {
        await this.redis.command(['SETEX', storageKey, String(Math.ceil(effectiveTtl)), json]);
      } else {
        await this.redis.command(['SET', storageKey, json]);
      }
    } catch (err) {
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async delete(
    namespace: StateCategoryName,
    key: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const storageKey = this.key(namespace, key, options.workspaceId);
    this.memory.delete(storageKey);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['DEL', storageKey]);
    } catch (err) {
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async clearNamespace(
    namespace: StateCategoryName,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const namespacePrefix = this.key(namespace, '', options.workspaceId);
    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(namespacePrefix)) this.memory.delete(key);
    }

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
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
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async getHashAllJson<T>(
    namespace: StateCategoryName,
    hashKey: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<Map<string, T>> {
    const storageKey = this.key(namespace, hashKey, options.workspaceId);
    if (this.redis && this.redisAvailable) {
      try {
        const response = await this.redis.command(['HGETALL', storageKey]);
        return hashArrayToJsonMap<T>(response);
      } catch (err) {
        this.markRedisUnavailable(err, namespace);
        if (this.shouldFailClosed(namespace)) throw this.unavailableError();
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
    namespace: StateCategoryName,
    hashKey: string,
    field: string,
    value: unknown,
    options: { workspaceId?: string | null; ttlSeconds?: number } = {},
  ): Promise<void> {
    const storageKey = this.key(namespace, hashKey, options.workspaceId);
    const json = JSON.stringify(value);
    let hash = this.memoryHashes.get(storageKey);
    if (!hash) {
      hash = new Map<string, string>();
      this.memoryHashes.set(storageKey, hash);
    }
    hash.set(field, json);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['HSET', storageKey, field, json]);
      const ttl = options.ttlSeconds ?? this.categoryPolicy(namespace).ttl_seconds;
      if (ttl && ttl > 0) {
        await this.redis.command(['EXPIRE', storageKey, String(Math.ceil(ttl))]);
      }
    } catch (err) {
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async deleteHashField(
    namespace: StateCategoryName,
    hashKey: string,
    field: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const storageKey = this.key(namespace, hashKey, options.workspaceId);
    this.memoryHashes.get(storageKey)?.delete(field);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['HDEL', storageKey, field]);
    } catch (err) {
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async clearHash(
    namespace: StateCategoryName,
    hashKey: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const storageKey = this.key(namespace, hashKey, options.workspaceId);
    this.memoryHashes.delete(storageKey);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
      return;
    }

    try {
      await this.redis.command(['DEL', storageKey]);
    } catch (err) {
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async hitRateLimit(
    namespace: StateCategoryName,
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
    options: { workspaceId?: string | null } = {},
  ): Promise<StateRateLimitResult> {
    if (this.redis && this.redisAvailable) {
      return this.hitRedisRateLimit(namespace, key, limit, windowMs, now, options.workspaceId);
    }

    if (this.shouldFailClosed(namespace)) {
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

    return this.hitMemoryRateLimit(namespace, key, limit, windowMs, now, this.isRedisConfigured(), options.workspaceId);
  }

  async addSortedJson(
    namespace: StateCategoryName,
    key: string,
    value: unknown,
    score: number,
    maxEntries: number,
    ttlMs: number,
    options: { workspaceId?: string | null } = {},
  ): Promise<void> {
    const storageKey = this.key(namespace, key, options.workspaceId);
    const json = JSON.stringify(value);
    this.memorySortedAdd(storageKey, json, score, maxEntries);

    if (!this.redis || !this.redisAvailable) {
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
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
      this.markRedisUnavailable(err, namespace);
      if (this.shouldFailClosed(namespace)) throw this.unavailableError();
    }
  }

  async getSortedJson<T>(
    namespace: StateCategoryName,
    key: string,
    options: { workspaceId?: string | null } = {},
  ): Promise<T[]> {
    const storageKey = this.key(namespace, key, options.workspaceId);
    if (this.redis && this.redisAvailable) {
      try {
        const values = await this.redis.command(['ZRANGE', storageKey, '0', '-1']);
        if (!Array.isArray(values)) return [];
        return values
          .map((value) => parseJson<T>(typeof value === 'string' ? value : null))
          .filter((value): value is T => value !== null);
      } catch (err) {
        this.markRedisUnavailable(err, namespace);
        if (this.shouldFailClosed(namespace)) throw this.unavailableError();
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
    workspaceId?: string | null,
  ): Promise<StateRateLimitResult> {
    const windowId = Math.floor(now / windowMs);
    const storageKey = this.key(namespace as StateCategoryName, `${key}:${windowId}`, workspaceId);
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
      this.markRedisUnavailable(err, namespace as StateCategoryName);
      if (this.shouldFailClosed(namespace as StateCategoryName)) {
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
    workspaceId?: string | null,
  ): StateRateLimitResult {
    const windowId = Math.floor(now / windowMs);
    const storageKey = this.key(namespace as StateCategoryName, `${key}:${windowId}`, workspaceId);
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

  key(namespace: StateCategoryName, key: string, workspaceId?: string | null): string {
    return `${this.keyPrefix(namespace, workspaceId)}${key}`;
  }

  keyPrefix(namespace: StateCategoryName, workspaceId?: string | null): string {
    return `${this.prefix}ws:${normalizeWorkspaceId(workspaceId)}:${namespace}:`;
  }

  categoryPolicy(category?: StateCategoryName): {
    unavailable_policy: StateUnavailablePolicy;
    ttl_seconds: number;
  } {
    if (category && this.categoryPolicies?.[category]) {
      return this.categoryPolicies[category];
    }
    return { unavailable_policy: this.policy, ttl_seconds: 300 };
  }

  private categoryStatuses(): StateRuntimeStatus['categories'] {
    const result = {} as StateRuntimeStatus['categories'];
    const categories = this.categoryPolicies ?? defaultCategoryPolicies(this.policy);
    for (const category of Object.keys(categories) as StateCategoryName[]) {
      const policy = categories[category];
      result[category] = {
        name: category,
        unavailable_policy: policy.unavailable_policy,
        ttl_seconds: policy.ttl_seconds,
        shared: this.configuredBackend === 'redis',
      };
    }
    return result;
  }

  private markRedisUnavailable(err: unknown, category: StateCategoryName = 'rate_limit'): void {
    this.redisAvailable = false;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.recordRecentError(category, this.lastError);
    const now = Date.now();
    if (now - this.lastErrorLoggedAt > 30_000) {
      this.lastErrorLoggedAt = now;
      this.logger.warn(
        `Redis state backend unavailable (${this.policy}): ${this.lastError}`,
      );
    }
  }

  private recordRecentError(category: StateCategoryName, message: string): void {
    this.recentErrors.unshift({
      category,
      message,
      at: new Date().toISOString(),
    });
    this.recentErrors.splice(8);
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

function defaultCategoryPolicies(
  unavailablePolicy: StateUnavailablePolicy,
): Record<StateCategoryName, {
  unavailable_policy: StateUnavailablePolicy;
  ttl_seconds: number;
}> {
  return {
    rate_limit: { unavailable_policy: unavailablePolicy, ttl_seconds: 60 },
    circuit_breaker: { unavailable_policy: unavailablePolicy, ttl_seconds: 3600 },
    cache_affinity: { unavailable_policy: 'fail_open', ttl_seconds: 1800 },
    momentum: { unavailable_policy: 'fail_open', ttl_seconds: 1800 },
    prompt_cache: { unavailable_policy: 'fail_open', ttl_seconds: 300 },
    concurrency: { unavailable_policy: unavailablePolicy, ttl_seconds: 120 },
    health_probe: { unavailable_policy: 'fail_open', ttl_seconds: 120 },
    realtime_session: { unavailable_policy: 'fail_open', ttl_seconds: 1800 },
  };
}

function mergeCategoryPolicies(
  defaults: Record<StateCategoryName, {
    unavailable_policy: StateUnavailablePolicy;
    ttl_seconds: number;
  }>,
  overrides?: Partial<Record<StateCategoryName, Partial<{
    unavailable_policy: StateUnavailablePolicy;
    ttl_seconds: number;
  }>>>,
): Record<StateCategoryName, {
  unavailable_policy: StateUnavailablePolicy;
  ttl_seconds: number;
}> {
  const merged = { ...defaults };
  for (const category of Object.keys(defaults) as StateCategoryName[]) {
    const override = overrides?.[category];
    merged[category] = {
      unavailable_policy:
        override?.unavailable_policy ?? defaults[category].unavailable_policy,
      ttl_seconds: override?.ttl_seconds ?? defaults[category].ttl_seconds,
    };
  }
  return merged;
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
