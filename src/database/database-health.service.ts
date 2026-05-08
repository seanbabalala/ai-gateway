import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '../config/config.service';
import { databaseConnectionSummary } from './database-options';

export interface DatabaseHealthStatus {
  healthy: boolean;
  type: 'sqlite' | 'postgres';
  target: string;
  connected: boolean;
  latency_ms: number | null;
  checked_at: string;
  error: string | null;
  synchronize: boolean;
  pool?: {
    min: number;
    max: number;
    idle_timeout_ms: number;
    connection_timeout_ms: number;
    statement_timeout_ms?: number;
    query_timeout_ms?: number;
    max_uses?: number;
    application_name: string;
  };
  ssl?: 'disabled' | 'enabled' | 'enabled-no-verify';
}

@Injectable()
export class DatabaseHealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<DatabaseHealthStatus> {
    const started = Date.now();
    const summary = databaseConnectionSummary(this.config.database);
    try {
      if (!this.dataSource.isInitialized) {
        throw new Error('DataSource is not initialized.');
      }
      await this.dataSource.query('SELECT 1');
      return {
        healthy: true,
        connected: true,
        latency_ms: Date.now() - started,
        checked_at: new Date().toISOString(),
        error: null,
        ...summary,
      };
    } catch (error) {
      return {
        healthy: false,
        connected: false,
        latency_ms: null,
        checked_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Database health check failed.',
        ...summary,
      };
    }
  }
}
