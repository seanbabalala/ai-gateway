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
});
