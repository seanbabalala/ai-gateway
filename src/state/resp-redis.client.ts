import * as net from 'net';
import * as tls from 'tls';

interface RespParseResult {
  value: unknown;
  bytes: number;
}

export class RespRedisClient {
  private readonly parsedUrl: URL;

  constructor(
    url: string,
    private readonly timeoutMs: number,
  ) {
    this.parsedUrl = new URL(url);
    if (!['redis:', 'rediss:'].includes(this.parsedUrl.protocol)) {
      throw new Error('Redis URL must use redis:// or rediss://');
    }
  }

  async ping(): Promise<void> {
    await this.command(['PING']);
  }

  async command(args: string[]): Promise<unknown> {
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
        const commands = this.connectionCommands();
        commands.push(args);
        expectedReplies = commands.length;
        socket.write(commands.map(encodeRespArray).join(''));
      });

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          let offset = 0;
          while (offset < buffer.length) {
            const parsed = parseResp(buffer.subarray(offset));
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

  private connectionCommands(): string[][] {
    const password = decodeURIComponent(this.parsedUrl.password || '');
    const username = decodeURIComponent(this.parsedUrl.username || '');
    const db = this.parsedUrl.pathname.replace(/^\//, '');
    const commands: string[][] = [];

    if (username && password) {
      commands.push(['AUTH', username, password]);
    } else if (password) {
      commands.push(['AUTH', password]);
    }
    if (db) commands.push(['SELECT', db]);

    return commands;
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
  if (prefix === '$') return parseBulkString(buffer, header, lineEnd);
  if (prefix === '*') return parseArray(buffer, header, lineEnd);
  throw new Error(`Unsupported Redis response: ${prefix}`);
}

function parseBulkString(
  buffer: Buffer,
  header: string,
  lineEnd: number,
): RespParseResult | null {
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

function parseArray(
  buffer: Buffer,
  header: string,
  lineEnd: number,
): RespParseResult | null {
  const length = Number(header);
  if (length === -1) return { value: null, bytes: lineEnd + 2 };

  const values: unknown[] = [];
  let offset = lineEnd + 2;
  for (let index = 0; index < length; index++) {
    const parsed = parseResp(buffer.subarray(offset));
    if (!parsed) return null;
    values.push(parsed.value);
    offset += parsed.bytes;
  }

  return { value: values, bytes: offset };
}
