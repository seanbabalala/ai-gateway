import { LogEventBus } from '../../src/dashboard/log-event-bus';
import { take } from 'rxjs';

describe('LogEventBus', () => {
  it('should emit log events to subscribers', (done) => {
    const bus = new LogEventBus();
    const mockLog = { id: 1, request_id: 'req-1' } as any;

    bus.events$.pipe(take(1)).subscribe({
      next: (log) => {
        expect(log).toBe(mockLog);
        done();
      },
    });

    bus.emit(mockLog);
  });

  it('should deliver events to multiple subscribers', () => {
    const bus = new LogEventBus();
    const received1: any[] = [];
    const received2: any[] = [];

    bus.events$.subscribe((log) => received1.push(log));
    bus.events$.subscribe((log) => received2.push(log));

    const log = { id: 1, request_id: 'req-1' } as any;
    bus.emit(log);

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('should deliver multiple events in order', () => {
    const bus = new LogEventBus();
    const received: any[] = [];

    bus.events$.subscribe((log) => received.push(log));

    bus.emit({ id: 1 } as any);
    bus.emit({ id: 2 } as any);
    bus.emit({ id: 3 } as any);

    expect(received).toHaveLength(3);
    expect(received.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('should not receive events emitted before subscription', () => {
    const bus = new LogEventBus();
    bus.emit({ id: 1 } as any); // emitted before any subscriber

    const received: any[] = [];
    bus.events$.subscribe((log) => received.push(log));

    expect(received).toHaveLength(0);
  });

  it('should emit a completed lifecycle event for a successful call log', (done) => {
    const bus = new LogEventBus();
    const timestamp = new Date('2026-09-03T01:00:00.000Z');

    bus.activityEvents$.pipe(take(1)).subscribe({
      next: (event) => {
        expect(event).toEqual({
          request_id: 'req-activity',
          phase: 'completed',
          timestamp: timestamp.toISOString(),
          workspace_id: 'workspace-1',
          source_format: 'responses',
          stream: true,
          node_id: 'anthropic-main',
          model: 'claude-sonnet-4',
          input_tokens: 120,
          output_tokens: 42,
          cost_usd: 0.0031,
          latency_ms: 812,
          status_code: 200,
          estimated_usage: false,
          is_fallback: false,
          fallback_reason: null,
          first_token_latency_ms: null,
          tokens_per_second: 51.7,
        });
        done();
      },
    });

    bus.emit({
      request_id: 'req-activity',
      timestamp,
      workspace_id: 'workspace-1',
      source_format: 'responses',
      stream: true,
      node_id: 'anthropic-main',
      model: 'claude-sonnet-4',
      input_tokens: 120,
      output_tokens: 42,
      cost_usd: 0.0031,
      latency_ms: 812,
      status_code: 200,
      error: null,
    } as any);
  });

  it('uses stream timing overrides for completed lifecycle metrics', (done) => {
    const bus = new LogEventBus();

    bus.activityEvents$.pipe(take(1)).subscribe({
      next: (event) => {
        expect(event.first_token_latency_ms).toBe(1_250);
        expect(event.tokens_per_second).toBe(80);
        done();
      },
    });

    bus.emit(
      {
        request_id: 'req-stream-performance',
        timestamp: new Date('2026-09-04T01:00:00.000Z'),
        workspace_id: 'workspace-1',
        source_format: 'responses',
        stream: true,
        node_id: 'openai-main',
        model: 'gpt-5.6',
        input_tokens: 100,
        output_tokens: 200,
        cost_usd: 0.01,
        latency_ms: 3_750,
        status_code: 200,
        error: null,
      } as any,
      {
        firstTokenLatencyMs: 1_250,
        tokensPerSecond: 80,
      },
    );
  });

  it('publishes terminal activity before the matching log event', () => {
    const bus = new LogEventBus();
    const received: string[] = [];
    bus.activityEvents$.subscribe(() => received.push('activity'));
    bus.events$.subscribe(() => received.push('log'));

    bus.emit({
      request_id: 'req-terminal-order',
      timestamp: new Date('2026-09-04T01:00:00.000Z'),
      workspace_id: 'workspace-1',
      source_format: 'responses',
      stream: true,
      node_id: 'openai-main',
      model: 'gpt-5.6',
      input_tokens: 100,
      output_tokens: 200,
      cost_usd: 0.01,
      latency_ms: 3_750,
      status_code: 200,
      error: null,
    } as any);

    expect(received).toEqual(['activity', 'log']);
  });

  it('should emit routed lifecycle metadata without storing content', (done) => {
    const bus = new LogEventBus();
    const event = {
      request_id: 'req-routed',
      phase: 'routed' as const,
      timestamp: '2026-09-03T01:00:00.000Z',
      workspace_id: 'workspace-1',
      source_format: 'chat_completions',
      stream: false,
      node_id: 'openai-main',
      model: 'gpt-5',
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      latency_ms: null,
      status_code: null,
    };

    bus.activityEvents$.pipe(take(1)).subscribe({
      next: (received) => {
        expect(received).toEqual(event);
        expect(received).not.toHaveProperty('prompt');
        expect(received).not.toHaveProperty('response');
        done();
      },
    });

    bus.emitActivity(event);
  });
});
