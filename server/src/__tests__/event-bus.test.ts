/**
 * Unit tests — EventBus
 *
 * Covers:
 * - on/emit/off mechanics
 * - Multiple handlers on same event type
 * - Handler error isolation (one error doesn't block others)
 * - Ring buffer truncation (MAX_LOG = 500)
 * - getRecentEvents filtering and limit
 * - Static helpers: newTraceId, makeEvent
 * - Instance makeEvent alias
 */

// Import the actual (non-mocked) EventBus
import { EventBus, bus as sharedBus } from '../events/EventBus';
import type { OTXEvent } from '../events/contracts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTestEvent(type: any, payload: unknown = {}): OTXEvent<unknown> {
  return EventBus.makeEvent(type, 'entity_01', payload, 'trace_test');
}

// Each test suite uses a fresh EventBus instance to avoid state leakage
let bus: EventBus;
beforeEach(() => {
  bus = new EventBus();
});

// ─── Basic pub/sub ────────────────────────────────────────────────────────────

describe('EventBus — on/emit/off', () => {
  test('registered handler is called on emit', async () => {
    const handler = jest.fn();
    bus.on('signal.classified', handler);

    const event = makeTestEvent('signal.classified', { test: true });
    await bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  test('multiple handlers on same event are all called', async () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    bus.on('signal.classified', h1);
    bus.on('signal.classified', h2);

    await bus.emit(makeTestEvent('signal.classified'));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test('off removes the handler', async () => {
    const handler = jest.fn();
    bus.on('signal.classified', handler);
    bus.off('signal.classified', handler);

    await bus.emit(makeTestEvent('signal.classified'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('on() returns an unsubscribe function that works', async () => {
    const handler    = jest.fn();
    const unsubscribe = bus.on('signal.classified', handler);

    unsubscribe();
    await bus.emit(makeTestEvent('signal.classified'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('handler on one event type does not fire for a different type', async () => {
    const handler = jest.fn();
    bus.on('signal.classified', handler);

    await bus.emit(makeTestEvent('opportunity.detected'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('emit with no handlers does not throw', async () => {
    await expect(bus.emit(makeTestEvent('signal.classified'))).resolves.toBeUndefined();
  });
});

// ─── Error isolation ──────────────────────────────────────────────────────────

describe('EventBus — error isolation', () => {
  test('error in one handler does not prevent other handlers from running', async () => {
    const failingHandler = jest.fn().mockRejectedValue(new Error('boom'));
    const goodHandler    = jest.fn();

    bus.on('signal.classified', failingHandler);
    bus.on('signal.classified', goodHandler);

    await bus.emit(makeTestEvent('signal.classified'));

    expect(failingHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  test('emit resolves even when all handlers throw', async () => {
    bus.on('signal.classified', jest.fn().mockRejectedValue(new Error('fail 1')));
    bus.on('signal.classified', jest.fn().mockRejectedValue(new Error('fail 2')));

    await expect(bus.emit(makeTestEvent('signal.classified'))).resolves.toBeUndefined();
  });
});

// ─── Event log / ring buffer ──────────────────────────────────────────────────

describe('EventBus — event log', () => {
  test('getRecentEvents returns emitted events', async () => {
    await bus.emit(makeTestEvent('signal.classified', { x: 1 }));
    await bus.emit(makeTestEvent('opportunity.detected', { x: 2 }));

    const all = bus.getRecentEvents();
    expect(all.length).toBe(2);
  });

  test('getRecentEvents(type) filters by event type', async () => {
    await bus.emit(makeTestEvent('signal.classified'));
    await bus.emit(makeTestEvent('opportunity.detected'));
    await bus.emit(makeTestEvent('signal.classified'));

    const classified = bus.getRecentEvents('signal.classified');
    expect(classified).toHaveLength(2);
    expect(classified.every(e => e.type === 'signal.classified')).toBe(true);
  });

  test('getRecentEvents(type, limit) respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await bus.emit(makeTestEvent('signal.classified'));
    }
    const recent = bus.getRecentEvents('signal.classified', 3);
    expect(recent).toHaveLength(3);
  });

  test('ring buffer drops oldest events beyond MAX_LOG (500)', async () => {
    for (let i = 0; i < 510; i++) {
      await bus.emit(makeTestEvent('signal.classified', { seq: i }));
    }
    const all = bus.getRecentEvents();
    expect(all.length).toBeLessThanOrEqual(500);
  });
});

// ─── Static helpers ───────────────────────────────────────────────────────────

describe('EventBus — static helpers', () => {
  test('newTraceId returns a string starting with otx-', () => {
    const id = EventBus.newTraceId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('otx-')).toBe(true);
  });

  test('newTraceId generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => EventBus.newTraceId()));
    expect(ids.size).toBe(100);
  });

  test('makeEvent shapes the event correctly', () => {
    const event = EventBus.makeEvent('signal.classified', 'biz_01', { foo: 'bar' }, 'trace_abc');
    expect(event.type).toBe('signal.classified');
    expect(event.entity_id).toBe('biz_01');
    expect((event.payload as any).foo).toBe('bar');
    expect(event.trace_id).toBe('trace_abc');
    expect(event.version).toBe(1);
    expect(event.event_id).toBeTruthy();
  });

  test('makeEvent uses empty string when no traceId provided', () => {
    const event = EventBus.makeEvent('signal.classified', 'biz_01', {});
    expect(event.trace_id).toBe('');
  });

  test('instance makeEvent is equivalent to static makeEvent', () => {
    const staticEvent   = EventBus.makeEvent('signal.classified', 'e1', { a: 1 }, 'trace1');
    const instanceEvent = bus.makeEvent('signal.classified', 'e1', { a: 1 }, 'trace1');
    expect(instanceEvent.type).toBe(staticEvent.type);
    expect(instanceEvent.entity_id).toBe(staticEvent.entity_id);
    expect((instanceEvent.payload as any).a).toBe((staticEvent.payload as any).a);
    expect(instanceEvent.trace_id).toBe(staticEvent.trace_id);
  });
});

// ─── Async handlers ───────────────────────────────────────────────────────────

describe('EventBus — async handler support', () => {
  test('async handler is awaited', async () => {
    const results: number[] = [];
    bus.on('signal.classified', async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push(1);
    });
    bus.on('signal.classified', async () => {
      results.push(2);
    });

    await bus.emit(makeTestEvent('signal.classified'));
    expect(results).toContain(1);
    expect(results).toContain(2);
  });
});
