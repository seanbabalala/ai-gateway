import { createHash } from 'crypto';
import * as net from 'net';
import * as tls from 'tls';
import type {
  CanonicalRequest,
  CanonicalResponse,
} from '../../src/canonical/canonical.types';
import type {
  GatewayPlugin,
  HookContext,
  HookResult,
  PostUpstreamData,
  PreRequestData,
} from '../../src/plugins/types';
import { stableStringify } from '../_shared/safety';

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttlSeconds: number, value: string): Promise<void>;
  close?(): Promise<void> | void;
}

interface RedisCacheConfig {
  enabled?: boolean;
  url?: string;
  key_prefix?: string;
  ttl_seconds?: number;
  timeout_ms?: number;
  include_session?: boolean;
  cache_stream?: boolean;
  max_value_bytes?: number;
  store_responses?: boolean;
  hash_salt?: string;
}

export default class RedisCachePlugin implements GatewayPlugin {
  meta = {
    name: 'redis-cache',
    version: '0.4.0',
    priority: 30,
  };

  private enabled = false;
  private client: RedisCacheClient | null = null;
  private keyPrefix = 'siftgate:cache:';
  private ttlSeconds = 300;
  private includeSession = true;
  private cacheStream = false;
  private maxValueBytes = 1_048_576;
  private storeResponses = false;
  private hashSalt = 'siftgate';

  async onLoad(config: Readonly<Record<string, unknown>>): Promise<void> {
    const cfg = config as RedisCacheConfig;
    this.enabled = cfg.enabled === true;
    this.keyPrefix = stringValue(cfg.key_prefix, this.keyPrefix);
    this.ttlSeconds = positiveInteger(cfg.ttl_seconds, this.ttlSeconds);
    this.includeSession = cfg.include_session !== false;
    this.cacheStream = cfg.cache_stream === true;
    this.maxValueBytes = positiveInteger(cfg.max_value_bytes, this.maxValueBytes);
    this.storeResponses = cfg.store_responses === true;
    this.hashSalt = stringValue(cfg.hash_salt, this.hashSalt);

    if (!this.enabled) return;
    if (!this.storeResponses) {
      this.enabled = false;
      return;
    }
    if (!cfg.url || typeof cfg.url !== 'string') {
      throw new Error('redis-cache requires config.url when enabled=true');
    }

    this.client = new RespRedisClient(
      cfg.url,
      positiveInteger(cfg.timeout_ms, 500),
    );
  }

  async onDestroy(): Promise<void> {
    await this.client?.close?.();
  }

  hooks = {
    preRequest: async (
      ctx: HookContext<PreRequestData>,
    ): Promise<HookResult<PreRequestData>> => {
      if (!this.isActive()) return { unchanged: true };
      const request = ctx.data.request;
      if (request.stream && !this.cacheStream) return { unchanged: true };

      try {
        const cached = await this.client!.get(this.cacheKey(request));
        if (!cached) return { unchanged: true };
        const response = JSON.parse(cached) as CanonicalResponse;
        if (!isCanonicalResponse(response)) return { unchanged: true };
        ctx.log.debug('redis-cache hit');
        return { shortCircuit: response };
      } catch (err) {
        ctx.log.warn(`redis-cache lookup skipped: ${(err as Error).message}`);
        return { unchanged: true };
      }
    },

    postUpstream: async (
      ctx: HookContext<PostUpstreamData>,
    ): Promise<HookResult<PostUpstreamData>> => {
      if (!this.isActive()) return { unchanged: true };
      const { request, response } = ctx.data;
      if (request.stream && !this.cacheStream) return { unchanged: true };

      try {
        const value = JSON.stringify(response);
        if (Buffer.byteLength(value, 'utf8') > this.maxValueBytes) {
          ctx.log.debug('redis-cache store skipped: response too large');
          return { unchanged: true };
        }
        await this.client!.setEx(this.cacheKey(request), this.ttlSeconds, value);
        ctx.log.debug('redis-cache stored response');
      } catch (err) {
        ctx.log.warn(`redis-cache store skipped: ${(err as Error).message}`);
      }
      return { unchanged: true };
    },
  };

  private isActive(): boolean {
    return this.enabled && this.storeResponses && this.client !== null;
  }

  private cacheKey(request: CanonicalRequest): string {
    const payload: Record<string, unknown> = {
      source_format: request.metadata.source_format,
      original_model: request.metadata.original_model || 'auto',
      messages: request.messages,
      tools: request.tools || null,
      tool_choice: request.tool_choice || null,
      max_tokens: request.max_tokens ?? null,
      temperature: request.temperature ?? 0,
      top_p: request.top_p ?? null,
      stop: request.stop || null,
    };

    if (this.includeSession) {
      payload.session_key = request.metadata.session_key || null;
      payload.api_key_name = request.metadata.api_key_name || null;
    }

    const digest = createHash('sha256')
      .update(this.hashSalt)
      .update('\0')
      .update(stableStringify(payload))
      .digest('hex');
    return `${this.keyPrefix}${digest}`;
  }
}

class RespRedisClient implements RedisCacheClient {
  private readonly parsedUrl: URL;

  constructor(
    url: string,
    private readonly timeoutMs: number,
  ) {
    this.parsedUrl = new URL(url);
    if (!['redis:', 'rediss:'].includes(this.parsedUrl.protocol)) {
      throw new Error('redis-cache url must use redis:// or rediss://');
    }
  }

  async get(key: string): Promise<string | null> {
    const value = await this.command(['GET', key]);
    return typeof value === 'string' ? value : null;
  }

  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.command(['SETEX', key, String(ttlSeconds), value]);
  }

  private command(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket();
      let settled = false;
      let buffer = Buffer.alloc(0);
      let expectedReplies = 1;
      let repliesSeen = 0;
      const timer = setTimeout(() => {
        finish(new Error(`Redis command timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      timer.unref?.();

      const finish = (err: Error | null, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value);
      };

      socket.once('error', (err) => finish(err));
      const connectEvent =
        this.parsedUrl.protocol === 'rediss:' ? 'secureConnect' : 'connect';
      socket.once(connectEvent, () => {
        const password = decodeURIComponent(this.parsedUrl.password || '');
        const db = this.parsedUrl.pathname.replace(/^\//, '');
        const commands: string[][] = [];
        if (password) commands.push(['AUTH', password]);
        if (db) commands.push(['SELECT', db]);
        commands.push(args);
        expectedReplies = commands.length;
        socket.write(commands.map(encodeRespArray).join(''));
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          let parsed: RespParseResult | null = null;
          let offset = 0;
          while (offset < buffer.length) {
            parsed = parseResp(buffer.subarray(offset));
            if (!parsed) {
              buffer = buffer.subarray(offset);
              return;
            }
            offset += parsed.bytes;
            repliesSeen += 1;
            if (repliesSeen >= expectedReplies) {
              finish(null, parsed.value);
              return;
            }
          }
          buffer = buffer.subarray(offset);
        } catch (err) {
          finish(err as Error);
        }
      });
    });
  }

  private createSocket(): net.Socket {
    const port = Number(this.parsedUrl.port || 6379);
    const host = this.parsedUrl.hostname || '127.0.0.1';
    if (this.parsedUrl.protocol === 'rediss:') {
      return tls.connect({ host, port, servername: host });
    }
    return net.connect({ host, port });
  }
}

interface RespParseResult {
  value: unknown;
  bytes: number;
}

function encodeRespArray(values: string[]): string {
  return `*${values.length}\r\n${values
    .map((value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`)
    .join('')}`;
}

function parseResp(buffer: Buffer): RespParseResult | null {
  if (buffer.length < 3) return null;
  const prefix = String.fromCharCode(buffer[0]);
  const lineEnd = buffer.indexOf('\r\n');
  if (lineEnd === -1) return null;
  const header = buffer.subarray(1, lineEnd).toString('utf8');

  if (prefix === '+') return { value: header, bytes: lineEnd + 2 };
  if (prefix === ':') return { value: Number(header), bytes: lineEnd + 2 };
  if (prefix === '-') throw new Error(`Redis error: ${header}`);
  if (prefix !== '$') throw new Error(`Unsupported Redis response: ${prefix}`);

  const length = Number(header);
  if (length === -1) return { value: null, bytes: lineEnd + 2 };
  const start = lineEnd + 2;
  const end = start + length;
  if (buffer.length < end + 2) return null;
  return {
    value: buffer.subarray(start, end).toString('utf8'),
    bytes: end + 2,
  };
}

function isCanonicalResponse(value: unknown): value is CanonicalResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as CanonicalResponse;
  return (
    typeof response.id === 'string' &&
    Array.isArray(response.content) &&
    typeof response.model === 'string' &&
    !!response.usage &&
    typeof response.usage.input_tokens === 'number' &&
    typeof response.usage.output_tokens === 'number'
  );
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
