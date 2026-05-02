import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LogSinkService } from '../../src/log-sinks/log-sink.service';
import type { CallLog } from '../../src/database/entities/call-log.entity';
import { mockConfigService } from '../helpers';

function makeLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 1,
    request_id: 'req_1',
    timestamp: new Date('2026-05-02T00:00:00.000Z'),
    source_format: 'chat_completions',
    tier: 'standard',
    score: 0.42,
    node_id: 'openai',
    model: 'gpt-4o',
    input_tokens: 100,
    output_tokens: 25,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cost_usd: 0.001,
    latency_ms: 345,
    status_code: 200,
    is_fallback: false,
    session_key: 'sess_1',
    error: null,
    api_key_name: 'demo-key',
    api_key_id: 'key_1',
    retry_count: 0,
    experiment_group: null,
    ...overrides,
  } as CallLog;
}

describe('LogSinkService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('writes file sinks as JSONL batches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siftgate-log-sinks-'));
    const file = path.join(dir, 'calls.jsonl');
    const service = new LogSinkService(
      mockConfigService({
        logSinks: {
          enabled: true,
          sinks: [
            {
              type: 'file',
              name: 'local-file',
              path: file,
              batch_size: 2,
              flush_interval_ms: 60_000,
            },
          ],
        },
      }),
    );

    service.enqueue(makeLog({ request_id: 'req_1' }));
    service.enqueue(makeLog({ request_id: 'req_2' }));
    await service.flushForTests();

    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      request_id: 'req_1',
      node_id: 'openai',
      model: 'gpt-4o',
    });
    expect(JSON.parse(lines[1])).toMatchObject({ request_id: 'req_2' });
  });

  it('posts webhook batches with sanitized records', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    global.fetch = fetchMock as typeof fetch;
    const service = new LogSinkService(
      mockConfigService({
        logSinks: {
          enabled: true,
          sinks: [
            {
              type: 'webhook',
              name: 'ops',
              url: 'https://hooks.example.test/logs',
              headers: { Authorization: 'Bearer test-token' },
              fields: ['request_id', 'model', 'prompt', 'raw_headers'],
              batch_size: 1,
              retry: { attempts: 1, timeout_ms: 1000, backoff_ms: 0 },
            },
          ],
        },
      }),
    );

    service.enqueue(makeLog({ request_id: 'req_webhook' }) as CallLog & {
      prompt?: string;
      raw_headers?: Record<string, string>;
    });
    await service.flushForTests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      version: 'siftgate.call_log_batch.v1',
      events: [{ request_id: 'req_webhook', model: 'gpt-4o' }],
    });
    expect(JSON.stringify(body)).not.toContain('prompt');
    expect(JSON.stringify(body)).not.toContain('raw_headers');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('retries failed webhook deliveries before marking sent', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, text: async () => '' });
    global.fetch = fetchMock as typeof fetch;
    const service = new LogSinkService(
      mockConfigService({
        logSinks: {
          enabled: true,
          sinks: [
            {
              type: 'webhook',
              name: 'retry-hook',
              url: 'https://hooks.example.test/logs',
              batch_size: 1,
              retry: { attempts: 2, backoff_ms: 0, timeout_ms: 1000 },
            },
          ],
        },
      }),
    );

    service.enqueue(makeLog());
    await service.flushForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.getStatus()[0]).toMatchObject({
      delivered: 1,
      dropped: 0,
      failed_batches: 0,
      last_status: 'sent',
    });
  });

  it('applies field filters and deny-list redaction', () => {
    const service = new LogSinkService(
      mockConfigService({ logSinks: { enabled: false, sinks: [] } }),
    );

    const record = service.buildLogRecordForTests(
      {
        ...makeLog({ error: 'provider said nope' }),
        prompt: 'secret prompt',
        provider_api_key: 'sk-secret',
        raw_headers: { authorization: 'Bearer secret' },
      },
      {
        fields: ['request_id', 'error', 'prompt', 'provider_api_key', 'raw_headers'],
        exclude_fields: ['error'],
      },
    );

    expect(record).toEqual({ request_id: 'req_1' });
  });

  it('drops newest records when the sink queue overflows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'siftgate-log-sinks-'));
    const file = path.join(dir, 'overflow.jsonl');
    const service = new LogSinkService(
      mockConfigService({
        logSinks: {
          enabled: true,
          sinks: [
            {
              type: 'file',
              name: 'overflow-file',
              path: file,
              batch_size: 10,
              flush_interval_ms: 60_000,
              max_queue: 1,
              overflow: 'drop_newest',
            },
          ],
        },
      }),
    );

    service.enqueue(makeLog({ request_id: 'kept' }));
    service.enqueue(makeLog({ request_id: 'dropped' }));
    await service.flushForTests();

    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ request_id: 'kept' });
    expect(service.getStatus()[0]).toMatchObject({
      delivered: 1,
      dropped: 1,
    });
  });
});
