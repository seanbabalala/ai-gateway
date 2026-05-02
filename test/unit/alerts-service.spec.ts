import { AlertService } from '../../src/alerts/alert.service';
import { mockConfigService } from '../helpers';

function makeAlerts(overrides: Record<string, unknown> = {}) {
  const config = mockConfigService({
    alerts: {
      enabled: true,
      history_size: 20,
      channels: [
        {
          type: 'webhook',
          name: 'ops',
          url: 'https://hooks.example.test/siftgate',
          events: [
            'budget_threshold',
            'budget_exceeded',
            'node_down',
            'node_recovered',
            'circuit_open',
            'circuit_close',
            'error_spike',
            'latency_spike',
          ],
          debounce_seconds: 60,
          retry: { attempts: 1, backoff_ms: 0, timeout_ms: 1000 },
        },
      ],
      error_spike: { enabled: true, window_seconds: 60, min_requests: 3, error_rate: 0.5 },
      latency_spike: { enabled: true, window_seconds: 60, min_requests: 3, p95_ms: 1000 },
      ...overrides,
    },
  });
  return new AlertService(config as any);
}

describe('AlertService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('debounces repeated webhook events for the same channel/event/key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
    const alerts = makeAlerts();

    alerts.emit({
      type: 'node_down',
      severity: 'critical',
      message: 'Node down: openai',
      dedupeKey: 'openai',
      details: { node_id: 'openai' },
    });
    alerts.emit({
      type: 'node_down',
      severity: 'critical',
      message: 'Node down: openai',
      dedupeKey: 'openai',
      details: { node_id: 'openai' },
    });
    await alerts.flushForTests();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(alerts.getDashboardSnapshot().recent.map((item) => item.status)).toEqual(
      expect.arrayContaining(['sent', 'debounced']),
    );
  });

  it('retries webhook delivery and records the final sent status', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' })
      .mockResolvedValueOnce({ ok: true });
    global.fetch = fetchMock as any;
    const alerts = makeAlerts({
      channels: [
        {
          type: 'webhook',
          name: 'ops',
          url: 'https://hooks.example.test/siftgate',
          events: ['budget_exceeded'],
          debounce_seconds: 0,
          retry: { attempts: 2, backoff_ms: 0, timeout_ms: 1000 },
        },
      ],
    });

    alerts.emit({
      type: 'budget_exceeded',
      severity: 'critical',
      message: 'Budget exceeded',
      dedupeKey: 'global:daily_tokens',
      details: { budget_type: 'daily_tokens' },
    });
    await alerts.flushForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [status] = alerts.getDashboardSnapshot().recent;
    expect(status.status).toBe('sent');
    expect(status.attempts).toBe(2);
    expect(status.last_error).toBeNull();
  });

  it('redacts prompt, response, provider keys, and raw headers from payload details', () => {
    const alerts = makeAlerts();

    const payload = alerts.buildWebhookPayloadForTests({
      type: 'circuit_open',
      severity: 'critical',
      message: 'Circuit opened',
      details: {
        node_id: 'openai',
        api_key_id: 'key_123',
        provider_api_key: 'sk-secret',
        prompt: 'hidden prompt',
        response: 'hidden response',
        raw_headers: { authorization: 'Bearer secret' },
        nested: { headers: { 'x-api-key': 'secret' }, latency_ms: 123 },
      },
    }) as { details: Record<string, unknown> };

    expect(payload.details.node_id).toBe('openai');
    expect(payload.details.api_key_id).toBe('key_123');
    expect(payload.details.provider_api_key).toBeUndefined();
    expect(payload.details.prompt).toBeUndefined();
    expect(payload.details.response).toBeUndefined();
    expect(payload.details.raw_headers).toBeUndefined();
    expect(payload.details.nested).toEqual({ latency_ms: 123 });
  });

  it('detects error and latency spikes from call-log samples', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as any;
    const alerts = makeAlerts({
      channels: [
        {
          type: 'webhook',
          name: 'ops',
          url: 'https://hooks.example.test/siftgate',
          events: ['error_spike', 'latency_spike'],
          debounce_seconds: 0,
          retry: { attempts: 1, backoff_ms: 0, timeout_ms: 1000 },
        },
      ],
    });

    const timestamp = new Date();
    alerts.recordCall({ timestamp, status_code: 200, latency_ms: 1200, node_id: 'openai', model: 'gpt-4o' } as any);
    alerts.recordCall({ timestamp, status_code: 500, latency_ms: 1400, node_id: 'openai', model: 'gpt-4o' } as any);
    alerts.recordCall({ timestamp, status_code: 503, latency_ms: 1600, node_id: 'openai', model: 'gpt-4o' } as any);
    await alerts.flushForTests();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const events = alerts.getDashboardSnapshot().recent.map((item) => item.event);
    expect(events).toEqual(expect.arrayContaining(['error_spike', 'latency_spike']));
  });
});
