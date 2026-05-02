import * as net from 'net';
import * as tls from 'tls';

export interface ClusterRedisClient {
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  keys(pattern: string): Promise<string[]>;
  delete(key: string): Promise<void>;
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, handler: (payload: string) => void): Promise<void>;
  close(): Promise<void>;
}

export interface ClusterRedisClientOptions {
  url: string;
  timeoutMs?: number;
}

export class RespClusterRedisClient implements ClusterRedisClient {
  private readonly parsedUrl: URL;
  private readonly timeoutMs: number;
  private subscriber?: RedisSubscriberConnection;

  constructor(options: ClusterRedisClientOptions) {
    this.parsedUrl = new URL(options.url);
    if (!['redis:', 'rediss:'].includes(this.parsedUrl.protocol)) {
      throw new Error('Redis URL must use redis:// or rediss://');
    }
    this.timeoutMs = options.timeoutMs ?? 1000;
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    await this.command([
      'SET',
      key,
      JSON.stringify(value),
      'EX',
      String(Math.max(1, Math.floor(ttlSeconds))),
    ]);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.command(['GET', key]);
    if (typeof value !== 'string') return null;
    return JSON.parse(value) as T;
  }

  async keys(pattern: string): Promise<string[]> {
    const value = await this.command(['KEYS', pattern]);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  async delete(key: string): Promise<void> {
    await this.command(['DEL', key]);
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.command(['PUBLISH', channel, payload]);
  }

  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.close();
    }
    this.subscriber = new RedisSubscriberConnection(
      this.parsedUrl,
      this.timeoutMs,
    );
    await this.subscriber.subscribe(channel, handler);
  }

  async close(): Promise<void> {
    await this.subscriber?.close();
    this.subscriber = undefined;
  }

  private command(args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createRedisSocket(this.parsedUrl);
      let settled = false;
      let buffer = Buffer.alloc(0);
      let expectedReplies = 1;
      let repliesSeen = 0;
      let lastReply: unknown;
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
      socket.once(connectEventFor(this.parsedUrl), () => {
        const commands = buildAuthCommands(this.parsedUrl);
        commands.push(args);
        expectedReplies = commands.length;
        socket.write(commands.map(encodeRespArray).join(''));
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          let offset = 0;
          while (offset < buffer.length) {
            const parsed = parseResp(buffer, offset);
            if (!parsed) {
              buffer = buffer.subarray(offset);
              return;
            }
            offset += parsed.bytes;
            repliesSeen += 1;
            lastReply = parsed.value;
            if (repliesSeen >= expectedReplies) {
              finish(null, lastReply);
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
}

class RedisSubscriberConnection {
  private socket?: net.Socket;

  constructor(
    private readonly parsedUrl: URL,
    private readonly timeoutMs: number,
  ) {}

  subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createRedisSocket(this.parsedUrl);
      this.socket = socket;
      let settled = false;
      let subscribed = false;
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        finish(
          new Error(`Redis subscribe timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
      timer.unref?.();

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve();
        }
      };

      socket.once('error', (err) => {
        if (!subscribed) finish(err);
      });
      socket.once(connectEventFor(this.parsedUrl), () => {
        const commands = buildAuthCommands(this.parsedUrl);
        commands.push(['SUBSCRIBE', channel]);
        socket.write(commands.map(encodeRespArray).join(''));
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          let offset = 0;
          while (offset < buffer.length) {
            const parsed = parseResp(buffer, offset);
            if (!parsed) {
              buffer = buffer.subarray(offset);
              return;
            }
            offset += parsed.bytes;
            const value = parsed.value;
            if (Array.isArray(value)) {
              const kind = value[0];
              if (kind === 'subscribe' && value[1] === channel) {
                subscribed = true;
                finish();
              } else if (
                kind === 'message' &&
                value[1] === channel &&
                typeof value[2] === 'string'
              ) {
                handler(value[2]);
              }
            }
          }
          buffer = buffer.subarray(offset);
        } catch (err) {
          if (!subscribed) finish(err as Error);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.socket?.destroy();
    this.socket = undefined;
  }
}

interface RespParseResult {
  value: unknown;
  bytes: number;
}

function createRedisSocket(parsedUrl: URL): net.Socket {
  const port = Number(parsedUrl.port || 6379);
  const host = parsedUrl.hostname || '127.0.0.1';
  if (parsedUrl.protocol === 'rediss:') {
    return tls.connect({ host, port, servername: host });
  }
  return net.connect({ host, port });
}

function connectEventFor(parsedUrl: URL): 'connect' | 'secureConnect' {
  return parsedUrl.protocol === 'rediss:' ? 'secureConnect' : 'connect';
}

function buildAuthCommands(parsedUrl: URL): string[][] {
  const commands: string[][] = [];
  const username = decodeURIComponent(parsedUrl.username || '');
  const password = decodeURIComponent(parsedUrl.password || '');
  const db = parsedUrl.pathname.replace(/^\//, '');
  if (password) {
    commands.push(username ? ['AUTH', username, password] : ['AUTH', password]);
  }
  if (db) commands.push(['SELECT', db]);
  return commands;
}

function encodeRespArray(values: string[]): string {
  return `*${values.length}\r\n${values
    .map((value) => `$${Buffer.byteLength(value, 'utf8')}\r\n${value}\r\n`)
    .join('')}`;
}

function parseResp(buffer: Buffer, start = 0): RespParseResult | null {
  if (buffer.length <= start + 2) return null;
  const prefix = String.fromCharCode(buffer[start]);
  const lineEnd = buffer.indexOf('\r\n', start);
  if (lineEnd === -1) return null;
  const header = buffer.subarray(start + 1, lineEnd).toString('utf8');

  if (prefix === '+') {
    return { value: header, bytes: lineEnd + 2 - start };
  }
  if (prefix === ':') {
    return { value: Number(header), bytes: lineEnd + 2 - start };
  }
  if (prefix === '-') {
    throw new Error(`Redis error: ${header}`);
  }
  if (prefix === '$') {
    const length = Number(header);
    if (length === -1) return { value: null, bytes: lineEnd + 2 - start };
    const bodyStart = lineEnd + 2;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd + 2) return null;
    return {
      value: buffer.subarray(bodyStart, bodyEnd).toString('utf8'),
      bytes: bodyEnd + 2 - start,
    };
  }
  if (prefix === '*') {
    const count = Number(header);
    if (count === -1) return { value: null, bytes: lineEnd + 2 - start };
    const values: unknown[] = [];
    let offset = lineEnd + 2;
    for (let i = 0; i < count; i++) {
      const parsed = parseResp(buffer, offset);
      if (!parsed) return null;
      values.push(parsed.value);
      offset += parsed.bytes;
    }
    return { value: values, bytes: offset - start };
  }

  throw new Error(`Unsupported Redis response: ${prefix}`);
}
