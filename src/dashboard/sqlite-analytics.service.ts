import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { resolve } from 'path';
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'worker_threads';
import Database = require('better-sqlite3');
import { ConfigService } from '../config/config.service';

interface AnalyticsWorkerRequest {
  id: number;
  sql: string;
  params: unknown[];
}

interface AnalyticsWorkerResponse {
  id: number;
  rows?: Record<string, unknown>[];
  error?: string;
}

interface AnalyticsWorkerData {
  siftgateSqliteAnalytics?: boolean;
  databasePath?: string;
}

const MAX_PENDING_ANALYTICS_REQUESTS = 16;
const ANALYTICS_REQUEST_TIMEOUT_MS = 60_000;

const analyticsParentPort = parentPort;

if (
  !isMainThread &&
  (workerData as AnalyticsWorkerData | undefined)?.siftgateSqliteAnalytics &&
  analyticsParentPort
) {
  const databasePath = (workerData as AnalyticsWorkerData).databasePath;
  if (!databasePath) {
    throw new Error('SQLite analytics worker requires a database path.');
  }
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  database.pragma('query_only = ON');
  database.pragma('busy_timeout = 5000');
  database.pragma('temp_store = MEMORY');
  database.pragma('cache_size = -32768');
  database.pragma('mmap_size = 0');

  analyticsParentPort.on('message', (request: AnalyticsWorkerRequest) => {
    try {
      const rows = database.prepare(request.sql).all(...request.params) as Record<
        string,
        unknown
      >[];
      analyticsParentPort.postMessage({
        id: request.id,
        rows,
      } satisfies AnalyticsWorkerResponse);
    } catch (error) {
      analyticsParentPort.postMessage({
        id: request.id,
        error: (error as Error).message,
      } satisfies AnalyticsWorkerResponse);
    }
  });
}

@Injectable()
export class SqliteAnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(SqliteAnalyticsService.name);
  private readonly worker?: Worker;
  private readonly pending = new Map<
    number,
    {
      resolve: (rows: Record<string, unknown>[]) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextRequestId = 1;
  private shuttingDown = false;
  private workerStopped = false;

  constructor(config: ConfigService) {
    const database = config.database;
    if (
      database.type !== 'sqlite' ||
      !database.path ||
      database.path === ':memory:'
    ) {
      return;
    }

    const databasePath = resolve(process.cwd(), database.path);
    this.worker = new Worker(__filename, {
      workerData: {
        siftgateSqliteAnalytics: true,
        databasePath,
      } satisfies AnalyticsWorkerData,
    });
    this.worker.on('message', (response: AnalyticsWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.error) {
        pending.reject(new Error(response.error));
        return;
      }
      pending.resolve(response.rows || []);
    });
    this.worker.on('error', (error) => {
      this.workerStopped = true;
      this.rejectPending(error);
      this.logger.error(`SQLite analytics worker failed: ${error.message}`);
    });
    this.worker.on('exit', (code) => {
      this.workerStopped = true;
      if (!this.shuttingDown && code !== 0) {
        const error = new Error(`SQLite analytics worker exited with code ${code}`);
        this.rejectPending(error);
        this.logger.error(error.message);
      }
    });
  }

  get available(): boolean {
    return Boolean(this.worker) && !this.workerStopped && !this.shuttingDown;
  }

  queryAll<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!this.worker || this.workerStopped || this.shuttingDown) {
      return Promise.reject(new Error('SQLite analytics worker is unavailable.'));
    }
    if (this.pending.size >= MAX_PENDING_ANALYTICS_REQUESTS) {
      return Promise.reject(new Error('SQLite analytics worker is busy.'));
    }
    const id = this.nextRequestId++;
    return new Promise<T[]>((resolveQuery, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.workerStopped = true;
        reject(new Error('SQLite analytics worker request timed out.'));
        void this.worker?.terminate();
      }, ANALYTICS_REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, {
        resolve: (rows) => resolveQuery(rows as T[]),
        reject,
        timer,
      });
      try {
        this.worker?.postMessage({ id, sql, params } satisfies AnalyticsWorkerRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) return;
    this.shuttingDown = true;
    this.rejectPending(new Error('SQLite analytics worker is shutting down.'));
    await this.worker.terminate();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
