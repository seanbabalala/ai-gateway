/**
 * E2E tests — v0.6 experimental realtime WebSocket preview.
 */

import * as http from 'http';
import * as net from 'net';
import { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { API_KEY, createE2EHarness, E2EHarness } from './setup';
import { ConfigService } from '../../src/config/config.service';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface ParsedFrame {
  opcode: number;
  payload: Buffer<ArrayBufferLike>;
}

class FrameQueue {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly frames: ParsedFrame[] = [];
  private readonly waiters: Array<(frame: ParsedFrame) => void> = [];

  constructor(
    private readonly socket: net.Socket,
    initial: Buffer<ArrayBufferLike> = Buffer.alloc(0),
  ) {
    if (initial.length > 0) this.push(initial);
    socket.on('data', (chunk) => this.push(chunk));
  }

  next(timeoutMs = 1500): Promise<ParsedFrame> {
    const existing = this.frames.shift();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Timed out waiting for websocket frame'));
      }, timeoutMs);
      this.waiters.push((frame) => {
        clearTimeout(timeout);
        resolve(frame);
      });
    });
  }

  private push(chunk: Buffer<ArrayBufferLike>): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let frame: ParsedFrame | null;
    while ((frame = readFrameFromBuffer(this)) !== null) {
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    }
  }

  takeBuffer(): Buffer<ArrayBufferLike> {
    return this.buffer;
  }

  setBuffer(buffer: Buffer<ArrayBufferLike>): void {
    this.buffer = buffer;
  }
}

function readFrameFromBuffer(queue: FrameQueue): ParsedFrame | null {
  const buffer = queue.takeBuffer();
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) === 0x80;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }
  queue.setBuffer(buffer.subarray(offset + length));
  return { opcode, payload };
}

function encodeFrame(
  payload: Buffer | string,
  opcode = 0x1,
  masked = false,
): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const first = Buffer.from([0x80 | opcode]);
  let header: Buffer;
  const maskBit = masked ? 0x80 : 0;
  if (body.length < 126) {
    header = Buffer.concat([first, Buffer.from([maskBit | body.length])]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = first[0];
    header[1] = maskBit | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first[0];
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  if (!masked) return Buffer.concat([header, body]);
  const mask = randomBytes(4);
  const maskedBody = Buffer.from(body);
  for (let i = 0; i < maskedBody.length; i++) {
    maskedBody[i] ^= mask[i % 4];
  }
  return Buffer.concat([header, mask, maskedBody]);
}

function closeCode(frame: ParsedFrame): number {
  return frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000;
}

async function readHttpResponse(socket: net.Socket): Promise<{
  status: number;
  headers: string;
  rest: Buffer<ArrayBufferLike>;
}> {
  let buffer = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for handshake')), 1500);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      clearTimeout(timeout);
      socket.off('data', onData);
      const header = buffer.subarray(0, idx).toString('utf8');
      const status = Number(/^HTTP\/1\.1\s+(\d+)/.exec(header)?.[1] || 0);
      resolve({
        status,
        headers: header,
        rest: buffer.subarray(idx + 4),
      });
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });
}

async function connectGateway(
  harness: E2EHarness,
  path: string,
  apiKey?: string,
): Promise<{
  status: number;
  headers: string;
  socket: net.Socket;
  frames: FrameQueue;
  sendText: (text: string) => void;
  close: () => void;
}> {
  const address = harness.app.getHttpServer().address() as AddressInfo;
  const socket = net.createConnection(address.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const key = randomBytes(16).toString('base64');
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${address.port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  if (apiKey) lines.push(`Authorization: Bearer ${apiKey}`);
  socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  const response = await readHttpResponse(socket);
  const frames = new FrameQueue(socket, response.rest);
  return {
    status: response.status,
    headers: response.headers,
    socket,
    frames,
    sendText: (text: string) => socket.write(encodeFrame(text, 0x1, true)),
    close: () => socket.write(encodeFrame(Buffer.alloc(0), 0x8, true)),
  };
}

function pointRealtimeNodeAt(harness: E2EHarness, upstreamUrl: string): void {
  const config = harness.app.get(ConfigService);
  const node = config.getFullConfig().nodes.find((entry) => entry.id === 'mock-openai');
  if (node) node.realtime_endpoint = upstreamUrl;
}

async function startRealtimeUpstream(options: { reject?: boolean } = {}) {
  const connections: Array<{
    url: string | undefined;
    headers: http.IncomingHttpHeaders;
    messages: string[];
  }> = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer();

  server.on('upgrade', (req, socket) => {
    sockets.add(socket as net.Socket);
    socket.on('close', () => sockets.delete(socket as net.Socket));
    if (options.reject) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );

    const record = { url: req.url, headers: req.headers, messages: [] as string[] };
    connections.push(record);
    const frames = new FrameQueue(socket as net.Socket);
    const pump = async () => {
      while (!socket.destroyed) {
        const frame = await frames.next(5000).catch(() => null);
        if (!frame) return;
        if (frame.opcode === 0x8) {
          socket.write(encodeFrame(Buffer.alloc(0), 0x8, false));
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) {
          const text = frame.payload.toString('utf8');
          record.messages.push(text);
          socket.write(
            encodeFrame(JSON.stringify({ type: 'server.echo', received_bytes: frame.payload.length }), 0x1, false),
          );
        } else if (frame.opcode === 0x2) {
          socket.write(encodeFrame(frame.payload, 0x2, false));
        }
      }
    };
    void pump();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${address.port}/v1/realtime`,
    connections,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('Realtime preview (e2e)', () => {
  const originalEndpoint = process.env.REALTIME_UPSTREAM_ENDPOINT;

  afterEach(() => {
    if (originalEndpoint === undefined) {
      delete process.env.REALTIME_UPSTREAM_ENDPOINT;
    } else {
      process.env.REALTIME_UPSTREAM_ENDPOINT = originalEndpoint;
    }
  });

  it('rejects websocket upgrades without a Gateway API key', async () => {
    const upstream = await startRealtimeUpstream();
    process.env.REALTIME_UPSTREAM_ENDPOINT = upstream.url;
    const harness = await createE2EHarness();
    pointRealtimeNodeAt(harness, upstream.url);
    try {
      const client = await connectGateway(harness, '/v1/realtime?model=gpt-4o-realtime-preview');
      expect(client.status).toBe(401);
      expect(client.headers).toContain('Unauthorized');
      client.socket.destroy();
      expect(upstream.connections).toHaveLength(0);
    } finally {
      await harness.close();
      await upstream.close();
    }
  }, 30_000);

  it('rejects direct node/model realtime targets that are not configured', async () => {
    const upstream = await startRealtimeUpstream();
    process.env.REALTIME_UPSTREAM_ENDPOINT = upstream.url;
    const harness = await createE2EHarness();
    pointRealtimeNodeAt(harness, upstream.url);
    try {
      const client = await connectGateway(
        harness,
        '/v1/realtime?model=mock-openai/not-configured',
        API_KEY,
      );
      expect(client.status).toBe(400);
      expect(client.headers).toContain('Bad Request');
      client.socket.destroy();
      expect(upstream.connections).toHaveLength(0);
    } finally {
      await harness.close();
      await upstream.close();
    }
  }, 30_000);

  it('proxies OpenAI-style realtime websocket messages and exposes node status', async () => {
    const upstream = await startRealtimeUpstream();
    process.env.REALTIME_UPSTREAM_ENDPOINT = upstream.url;
    const harness = await createE2EHarness();
    pointRealtimeNodeAt(harness, upstream.url);
    try {
      const client = await connectGateway(
        harness,
        '/v1/realtime?model=gpt-4o-realtime-preview',
        API_KEY,
      );
      expect(client.status).toBe(101);

      const nodesWhileOpen = await harness.agent.get('/api/dashboard/nodes');
      const realtimeStatus = nodesWhileOpen.body.nodes.find((node: { id: string }) => node.id === 'mock-openai').realtime;
      expect(realtimeStatus.supported).toBe(true);
      expect(realtimeStatus.active_connections).toBe(1);

      client.sendText(JSON.stringify({ type: 'session.update', redacted_payload: true }));
      const frame = await client.frames.next();
      expect(frame.opcode).toBe(0x1);
      expect(JSON.parse(frame.payload.toString('utf8'))).toEqual({
        type: 'server.echo',
        received_bytes: expect.any(Number),
      });

      expect(upstream.connections).toHaveLength(1);
      expect(upstream.connections[0].url).toContain('model=gpt-4o-realtime-preview');
      expect(upstream.connections[0].headers.authorization).toBe('Bearer mock-openai-key');
      expect(upstream.connections[0].headers['openai-beta']).toBe('realtime=v1');

      client.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const nodesAfterClose = await harness.agent.get('/api/dashboard/nodes');
      const closedStatus = nodesAfterClose.body.nodes.find((node: { id: string }) => node.id === 'mock-openai').realtime;
      expect(closedStatus.active_connections).toBe(0);
      expect(closedStatus.last_closed_at).toBeTruthy();
    } finally {
      await harness.close();
      await upstream.close();
    }
  }, 30_000);

  it('closes the accepted client connection when the upstream websocket fails', async () => {
    const upstream = await startRealtimeUpstream({ reject: true });
    process.env.REALTIME_UPSTREAM_ENDPOINT = upstream.url;
    const harness = await createE2EHarness();
    pointRealtimeNodeAt(harness, upstream.url);
    try {
      const client = await connectGateway(
        harness,
        '/v1/realtime?model=gpt-4o-realtime-preview',
        API_KEY,
      );
      expect(client.status).toBe(101);
      const close = await client.frames.next(3000);
      expect(close.opcode).toBe(0x8);
      expect(closeCode(close)).toBe(1011);

      const health = await harness.agent.get('/health');
      const status = health.body.nodes.find((node: { id: string }) => node.id === 'mock-openai').realtime;
      expect(status.last_error).toBeTruthy();
      expect(JSON.stringify(status)).not.toContain('mock-openai-key');
      client.socket.destroy();
    } finally {
      await harness.close();
      await upstream.close();
    }
  }, 30_000);
});
