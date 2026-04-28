// ===================================================================
// EventBusService — Generic multi-topic event bus
// ===================================================================
// Generalizes the existing LogEventBus pattern into a multi-topic
// event bus. Plugins can subscribe to any topic. Uses RxJS Subject.
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

interface BusEvent {
  topic: string;
  payload: unknown;
}

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly subject = new Subject<BusEvent>();

  /** Emit an event on the given topic */
  emit(topic: string, payload: unknown): void {
    this.subject.next({ topic, payload });
  }

  /** Subscribe to events on the given topic. Returns an RxJS Subscription for cleanup. */
  on(
    topic: string,
    handler: (payload: unknown) => void | Promise<void>,
  ): Subscription {
    return this.subject
      .pipe(filter((evt) => evt.topic === topic))
      .subscribe(async (evt) => {
        try {
          await handler(evt.payload);
        } catch (err) {
          this.logger.error(
            `Event handler error on topic "${topic}": ${(err as Error).message}`,
          );
        }
      });
  }

  /** Tear down the subject (used in tests or shutdown) */
  destroy(): void {
    this.subject.complete();
  }
}
