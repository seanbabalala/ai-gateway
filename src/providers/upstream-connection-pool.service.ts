import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, type Dispatcher } from 'undici';
import type { NodeConfig } from '../config/gateway.config';

export interface ResolvedNodeConnectionConfig {
  origin: string;
  poolSize: number;
  keepAliveMs: number;
  headersTimeoutMs?: number;
  bodyTimeoutMs?: number;
  http2: boolean;
}

interface PoolEntry {
  signature: string;
  dispatcher: Pool;
}

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_KEEP_ALIVE_MS = 60_000;

@Injectable()
export class UpstreamConnectionPoolService implements OnModuleDestroy {
  private readonly logger = new Logger(UpstreamConnectionPoolService.name);
  private readonly pools = new Map<string, PoolEntry>();

  getDispatcher(node: NodeConfig): Dispatcher | undefined {
    const connection = resolveNodeConnectionConfig(node);
    if (!connection) return undefined;

    const signature = buildConnectionSignature(connection);
    const existing = this.pools.get(node.id);
    if (existing?.signature === signature && !existing.dispatcher.closed) {
      return existing.dispatcher;
    }

    if (existing) {
      void existing.dispatcher.close().catch((error) => {
        this.logger.warn(
          `Failed to close upstream connection pool for ${node.id}: ${(error as Error).message}`,
        );
      });
    }

    const dispatcher = new Pool(connection.origin, {
      connections: connection.poolSize,
      keepAliveTimeout: connection.keepAliveMs,
      keepAliveMaxTimeout: connection.keepAliveMs,
      headersTimeout: connection.headersTimeoutMs,
      bodyTimeout: connection.bodyTimeoutMs,
      allowH2: connection.http2,
    });

    if (connection.http2) {
      this.logger.warn(
        `HTTP/2 upstream pooling is experimental for node "${node.id}" and only enabled because nodes[].connection.http2=true.`,
      );
    }

    this.pools.set(node.id, { signature, dispatcher });
    return dispatcher;
  }

  async onModuleDestroy(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(pools.map((entry) => entry.dispatcher.close()));
  }
}

export function resolveNodeConnectionConfig(
  node: NodeConfig,
): ResolvedNodeConnectionConfig | undefined {
  const raw = node.connection;
  if (!raw || raw.enabled === false || raw.keep_alive === false) {
    return undefined;
  }

  return {
    origin: new URL(node.base_url).origin,
    poolSize: positiveIntegerOrDefault(raw.pool_size, DEFAULT_POOL_SIZE),
    keepAliveMs: positiveIntegerOrDefault(
      raw.keep_alive_ms,
      DEFAULT_KEEP_ALIVE_MS,
    ),
    headersTimeoutMs: optionalNonNegativeInteger(raw.headers_timeout_ms),
    bodyTimeoutMs: optionalNonNegativeInteger(raw.body_timeout_ms),
    http2: raw.http2 === true,
  };
}

function positiveIntegerOrDefault(
  value: number | undefined,
  defaultValue: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : defaultValue;
}

function optionalNonNegativeInteger(
  value: number | undefined,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function buildConnectionSignature(config: ResolvedNodeConnectionConfig): string {
  return JSON.stringify(config);
}
