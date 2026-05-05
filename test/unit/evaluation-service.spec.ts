import { EvaluationService } from '../../src/evaluation/evaluation.service';

type Where = Record<string, unknown>;

class MemoryRepo<T extends Record<string, any>> {
  rows: T[] = [];
  private nextId = 1;

  constructor(private readonly idKind: 'number' | 'uuid' = 'number') {}

  create(input: Partial<T> = {}): T {
    return { ...input } as T;
  }

  async save(input: T | T[]): Promise<T | T[]> {
    if (Array.isArray(input)) {
      return Promise.all(input.map((row) => this.saveOne(row)));
    }
    return this.saveOne(input);
  }

  async findOne(options: { where: Where }): Promise<T | null> {
    return this.rows.find((row) => matches(row, options.where)) || null;
  }

  async find(options: { where?: Where; order?: Record<string, 'ASC' | 'DESC'>; take?: number } = {}): Promise<T[]> {
    let rows = options.where
      ? this.rows.filter((row) => matches(row, options.where!))
      : [...this.rows];
    const [orderKey, orderDirection] = Object.entries(options.order || {})[0] || [];
    if (orderKey) {
      rows = rows.sort((a, b) => {
        const left = a[orderKey];
        const right = b[orderKey];
        const delta = left > right ? 1 : left < right ? -1 : 0;
        return orderDirection === 'DESC' ? -delta : delta;
      });
    }
    return rows.slice(0, options.take || rows.length);
  }

  createQueryBuilder() {
    const filters: Array<(row: T) => boolean> = [];
    let takeCount = 50;
    const builder = {
      where: () => builder,
      andWhere: (condition: string, params: Record<string, unknown>) => {
        if (condition.includes('created_at >=')) {
          filters.push((row) => new Date(row.created_at).getTime() >= new Date(params.since as Date).getTime());
        }
        if (condition.includes('run.status =')) {
          filters.push((row) => row.status === params.status);
        }
        if (condition.includes('run.dataset_id =')) {
          filters.push((row) => row.dataset_id === params.datasetId);
        }
        return builder;
      },
      orderBy: () => builder,
      take: (count: number) => {
        takeCount = count;
        return builder;
      },
      getMany: async () =>
        this.rows
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, takeCount),
    };
    return builder;
  }

  private async saveOne(row: T): Promise<T> {
    const mutable = row as Record<string, any>;
    if (mutable.id === undefined || mutable.id === null) {
      mutable.id = this.idKind === 'uuid' ? `uuid-${this.nextId++}` : this.nextId++;
    }
    const now = new Date('2026-05-05T00:00:00.000Z');
    mutable.created_at ||= now;
    mutable.updated_at ||= now;
    const existingIndex = this.rows.findIndex((existing) => existing['id'] === mutable.id);
    if (existingIndex >= 0) {
      this.rows[existingIndex] = row;
    } else {
      this.rows.push(row);
    }
    return row;
  }
}

function matches(row: Record<string, any>, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function makeService(options: {
  evaluation?: Record<string, unknown>;
  pipeline?: { process: jest.Mock };
} = {}) {
  const datasets = new MemoryRepo<any>('uuid');
  const runs = new MemoryRepo<any>('uuid');
  const samples = new MemoryRepo<any>('number');
  const callLogs = new MemoryRepo<any>('number');
  const config = {
    getFullConfig: jest.fn(() => ({
      evaluation: {
        store_samples: false,
        max_sample_chars: 120,
        ...options.evaluation,
      },
    })),
  };
  const service = new EvaluationService(
    config as any,
    datasets as any,
    runs as any,
    samples as any,
    callLogs as any,
    options.pipeline as any,
  );
  return { service, datasets, runs, samples, callLogs, config };
}

describe('EvaluationService', () => {
  it('records primary vs candidate metadata and aggregate judge metrics without prompt or response text', async () => {
    const { service } = makeService();

    const report = await service.recordRun({
      dataset: { name: 'routing-regression', metadata: { prompt: 'do not store me', owner: 'oss' } },
      primary: { node_id: 'openai', model: 'gpt-4o-mini' },
      candidate: { node_id: 'groq', model: 'llama-3.3-70b' },
      judge: { model: 'gpt-4o-mini', rubric: 'secret rubric text' },
      samples: [
        {
          sample_id: 'case-1',
          sample_hash: 'hash-1',
          primary: { request_id: 'p-1', success: true, latency_ms: 100, cost_usd: 0.01 },
          candidate: { request_id: 'c-1', success: true, latency_ms: 80, cost_usd: 0.004 },
          judge: { request_id: 'j-1', score: 0.9, label: 'candidate', reason_summary: 'Candidate is tighter.' },
          metadata: { response: 'never persist', suite: 'smoke' },
        },
        {
          sample_id: 'case-2',
          sample_hash: 'hash-2',
          primary: { request_id: 'p-2', success: false, latency_ms: 200, cost_usd: 0.02, is_fallback: true },
          candidate: { request_id: 'c-2', success: true, latency_ms: 120, cost_usd: 0.006 },
          judge: { request_id: 'j-2', score: 0.7, label: 'candidate', reason_summary: 'Candidate recovered.' },
        },
      ],
    });

    expect(report?.run.primary.success_rate).toBe(50);
    expect(report?.run.candidate.success_rate).toBe(100);
    expect(report?.run.primary.avg_latency_ms).toBe(150);
    expect(report?.run.candidate.total_cost_usd).toBe(0.01);
    expect(report?.run.primary.fallback_rate).toBe(50);
    expect(report?.run.judge.avg_score).toBe(0.8);
    expect(report?.run.winner).toBe('candidate');
    expect(report?.privacy.metadata_only).toBe(true);
    expect(JSON.stringify(report)).not.toContain('do not store me');
    expect(JSON.stringify(report)).not.toContain('never persist');
    expect(JSON.stringify(report)).not.toContain('secret rubric text');
    expect(report?.samples[0].metadata).toMatchObject({
      response: '[redacted]',
      suite: 'smoke',
    });
  });

  it('runs primary, candidate, and LLM-as-judge through the normal SiftGate pipeline', async () => {
    const callLogs = new MemoryRepo<any>('number');
    const pipeline = {
      process: jest.fn(async (canonical) => {
        const sessionKey = canonical.metadata.session_key as string;
        const role = sessionKey.includes('-primary-')
          ? 'primary'
          : sessionKey.includes('-candidate-')
            ? 'candidate'
            : 'judge';
        await callLogs.save({
          request_id: `${role}-request`,
          session_key: sessionKey,
          status_code: 200,
          latency_ms: role === 'candidate' ? 45 : 60,
          cost_usd: role === 'candidate' ? 0.002 : 0.003,
          is_fallback: role === 'primary',
        });
        if (role === 'judge') {
          return {
            statusCode: 200,
            body: { choices: [{ message: { content: '{"score":0.75,"label":"candidate","reason":"better metadata"}' } }] },
          };
        }
        return {
          statusCode: 200,
          body: { choices: [{ message: { content: `${role} answer with private words` } }] },
        };
      }),
    };
    const serviceContext = makeService({ pipeline });
    (serviceContext as any).callLogs.rows = callLogs.rows;
    (serviceContext.service as any).callLogs = callLogs;

    const report = await serviceContext.service.runComparison({
      dataset: { name: 'local-dataset', metadata: { content: 'redact this' } },
      primary: { node_id: 'primary-node', model: 'primary-model' },
      candidate: { node_id: 'candidate-node', model: 'candidate-model' },
      judge: { model: 'judge-model', rubric: 'Pick the better answer.' },
      samples: [{ id: 'sample-1', prompt: 'private prompt text', expected: 'private expected text' }],
    });

    expect(pipeline.process).toHaveBeenCalledTimes(3);
    expect(pipeline.process.mock.calls[0][0].metadata.original_model).toBe('primary-model');
    expect(pipeline.process.mock.calls[1][0].metadata.original_model).toBe('candidate-model');
    expect(pipeline.process.mock.calls[2][0].metadata.original_model).toBe('judge-model');
    expect(report?.run.judge.avg_score).toBe(0.75);
    expect(report?.samples[0].request_ids).toEqual({
      primary: 'primary-request',
      candidate: 'candidate-request',
      judge: 'judge-request',
    });
    expect(report?.samples[0].metadata).toMatchObject({ sample_previews_stored: false });
    expect(JSON.stringify(report)).not.toContain('private prompt text');
    expect(JSON.stringify(report)).not.toContain('private expected text');
    expect(JSON.stringify(report)).not.toContain('primary answer with private words');
  });

  it('stores only redacted previews when config and request explicitly enable sample storage', async () => {
    const callLogs = new MemoryRepo<any>('number');
    const pipeline = {
      process: jest.fn(async (canonical) => {
        const sessionKey = canonical.metadata.session_key as string;
        const role = sessionKey.includes('-candidate-') ? 'candidate' : sessionKey.includes('-judge-') ? 'judge' : 'primary';
        await callLogs.save({
          request_id: `${role}-request`,
          session_key: sessionKey,
          status_code: 200,
          latency_ms: 10,
          cost_usd: 0.001,
          is_fallback: false,
        });
        return role === 'judge'
          ? { statusCode: 200, body: { output_text: '{"score":0.5,"label":"tie","reason":"ok"}' } }
          : { statusCode: 200, body: { output_text: `${role} says sk-${'abcdefghijklmnopqrstuvwxyz'}` } };
      }),
    };
    const context = makeService({
      evaluation: { store_samples: true, max_sample_chars: 80 },
      pipeline,
    });
    (context as any).callLogs.rows = callLogs.rows;
    (context.service as any).callLogs = callLogs;

    const report = await context.service.runComparison({
      dataset: { name: 'explicit-storage' },
      primary: { model: 'primary-model' },
      candidate: { model: 'candidate-model' },
      samples: [
        {
          prompt: 'Hello Bearer abcdefghijklmnopqrstuvwxyz',
          expected: 'Expected with gw_sk_abcdefghijklmnop',
        },
      ],
      store_samples: true,
    });

    const metadata = report?.samples[0].metadata as Record<string, string>;
    expect(report?.privacy.sample_previews_stored).toBe(true);
    expect(metadata.prompt_preview).toContain('Bearer [redacted]');
    expect(metadata.expected_preview).toContain('gw_sk_[redacted]');
    expect(metadata.primary_preview).toContain('sk-[redacted]');
    expect(JSON.stringify(report)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
