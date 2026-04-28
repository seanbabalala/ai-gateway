/**
 * EventBusService unit tests.
 */

import { EventBusService } from '../../src/plugins/event-bus.service';

describe('EventBusService', () => {
  let bus: EventBusService;

  beforeEach(() => {
    bus = new EventBusService();
  });

  afterEach(() => {
    bus.destroy();
  });

  // ── Basic emit + on ───────────────────────────────────────

  it('should deliver events to subscribers', (done) => {
    bus.on('test', (payload) => {
      expect(payload).toEqual({ data: 'hello' });
      done();
    });

    bus.emit('test', { data: 'hello' });
  });

  // ── Multi-topic isolation ─────────────────────────────────

  it('should isolate events by topic', () => {
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    bus.on('topic-a', (p) => { receivedA.push(p); });
    bus.on('topic-b', (p) => { receivedB.push(p); });

    bus.emit('topic-a', 'event-a');
    bus.emit('topic-b', 'event-b');

    expect(receivedA).toEqual(['event-a']);
    expect(receivedB).toEqual(['event-b']);
  });

  // ── Multiple subscribers same topic ───────────────────────

  it('should deliver to multiple subscribers on same topic', () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    bus.on('shared', (p) => { received1.push(p); });
    bus.on('shared', (p) => { received2.push(p); });

    bus.emit('shared', 'payload');

    expect(received1).toEqual(['payload']);
    expect(received2).toEqual(['payload']);
  });

  // ── Subscriber exception isolation ────────────────────────

  it('should not throw if a subscriber throws', () => {
    bus.on('error-topic', () => {
      throw new Error('subscriber error');
    });

    // Should not throw
    expect(() => bus.emit('error-topic', 'data')).not.toThrow();
  });

  it('should still deliver to other subscribers when one throws', (done) => {
    bus.on('mixed', () => {
      throw new Error('bad handler');
    });
    bus.on('mixed', (p) => {
      expect(p).toBe('still-works');
      done();
    });

    bus.emit('mixed', 'still-works');
  });

  // ── Unsubscribe ───────────────────────────────────────────

  it('should stop receiving after unsubscribe', () => {
    const received: unknown[] = [];

    const sub = bus.on('unsub-test', (p) => { received.push(p); });
    bus.emit('unsub-test', 'first');
    sub.unsubscribe();
    bus.emit('unsub-test', 'second');

    expect(received).toEqual(['first']);
  });

  // ── No subscribers ────────────────────────────────────────

  it('should not throw when emitting to a topic with no subscribers', () => {
    expect(() => bus.emit('no-subs', 'data')).not.toThrow();
  });

  // ── Async handlers ────────────────────────────────────────

  it('should handle async handlers', (done) => {
    bus.on('async', async (p) => {
      await new Promise((r) => setTimeout(r, 1));
      expect(p).toBe('async-data');
      done();
    });

    bus.emit('async', 'async-data');
  });
});
