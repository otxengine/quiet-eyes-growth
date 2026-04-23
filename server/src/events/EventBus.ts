/**
 * In-process typed event bus for OTXEngine.
 * Supports async handlers, error isolation, and trace propagation.
 * Can be replaced by Redis Streams or Kafka in production.
 */

import { OTXEvent, OTXEventType } from './contracts';
import { createLogger } from '../infra/logger';

const logger = createLogger('EventBus');

type EventHandler<T = any> = (event: OTXEvent<T>) => Promise<void> | void;

class EventBus {
  private handlers: Map<OTXEventType, EventHandler[]> = new Map();
  private eventLog: OTXEvent[] = [];
  private readonly MAX_LOG = 500;

  on<T>(type: OTXEventType, handler: EventHandler<T>) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler as EventHandler);
    return () => this.off(type, handler as EventHandler);
  }

  off(type: OTXEventType, handler: EventHandler) {
    const list = this.handlers.get(type) || [];
    this.handlers.set(type, list.filter(h => h !== handler));
  }

  async emit<T>(event: OTXEvent<T>): Promise<void> {
    // Store in ring buffer
    this.eventLog.push(event);
    if (this.eventLog.length > this.MAX_LOG) this.eventLog.shift();

    logger.debug(`emit: ${event.type}`, { entity_id: event.entity_id, trace_id: event.trace_id });

    const list = this.handlers.get(event.type) || [];
    await Promise.allSettled(
      list.map(async h => {
        try {
          await h(event);
        } catch (err: any) {
          logger.error(`Handler error for ${event.type}`, { error: err.message, trace_id: event.trace_id });
        }
      })
    );
  }

  getRecentEvents(type?: OTXEventType, limit = 50): OTXEvent[] {
    const log = type ? this.eventLog.filter(e => e.type === type) : this.eventLog;
    return log.slice(-limit);
  }

  /** Generate a trace ID to propagate across pipeline stages */
  static newTraceId(): string {
    return `otx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Create a typed event */
  static makeEvent<T>(type: OTXEventType, entityId: string, payload: T, traceId?: string): OTXEvent<T> {
    return {
      event_id:  `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      entity_id: entityId,
      payload,
      timestamp: new Date().toISOString(),
      trace_id:  traceId ?? '',
      version:   1,
    };
  }

  /** Instance alias for makeEvent (allows `bus.makeEvent(...)`) */
  makeEvent<T>(type: OTXEventType, entityId: string, payload: T, traceId?: string): OTXEvent<T> {
    return EventBus.makeEvent(type, entityId, payload, traceId);
  }
}

// Singleton
export const eventBus = new EventBus();
export const bus      = eventBus;   // convenience alias used across services
export { EventBus };
