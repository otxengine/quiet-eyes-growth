/**
 * eventBus.ts — OTX-001
 * Centralized event data bus.
 * Agents publish events here; the routing engine reads and dispatches.
 */

import { prisma } from '../db';

export type EventType =
  | 'competitor_change'
  | 'new_review'
  | 'market_signal'
  | 'local_event'
  | 'sports_match'
  | 'hot_lead'
  | 'retention_risk'
  | 'social_signal'
  | 'price_change';

export interface ContextAttributes {
  city?:        string;
  category?:    string;
  sector?:      string;
  region?:      string;
  impact?:      'high' | 'medium' | 'low';
  time_of_day?: string; // 'morning'|'afternoon'|'evening'|'night'
  day_of_week?: string;
  [key: string]: any;
}

export interface PublishOptions {
  businessId:    string;
  eventType:     EventType;
  source:        string;        // agent name
  payload:       Record<string, any>;
  contextAttrs?: ContextAttributes;
}

/**
 * Publish an event to the system bus.
 * Returns the created SystemEvent id.
 */
export async function publishEvent(opts: PublishOptions): Promise<string> {
  const { businessId, eventType, source, payload, contextAttrs } = opts;

  // Enrich context with time-of-day and day-of-week automatically
  const now = new Date();
  const hour = now.getHours();
  const enriched: ContextAttributes = {
    time_of_day: hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night',
    day_of_week: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()],
    ...contextAttrs,
  };

  const event = await prisma.systemEvent.create({
    data: {
      business_id:    businessId,
      event_type:     eventType,
      source,
      payload:        JSON.stringify(payload),
      context_attrs:  JSON.stringify(enriched),
      routing_status: 'pending',
    },
  });

  return event.id;
}

/**
 * Fetch pending events for a business (or all businesses if not specified).
 * Used by the routing engine on each scan cycle.
 */
export async function fetchPendingEvents(businessId?: string, limit = 50) {
  return prisma.systemEvent.findMany({
    where: {
      routing_status: 'pending',
      ...(businessId ? { business_id: businessId } : {}),
    },
    orderBy: { created_at: 'asc' },
    take: limit,
  });
}

/**
 * Mark an event as dispatched with the list of agents activated.
 */
export async function markDispatched(eventId: string, agents: string[]) {
  await prisma.systemEvent.update({
    where: { id: eventId },
    data: {
      routing_status: 'dispatched',
      dispatched_to:  JSON.stringify(agents),
    },
  });
}

/**
 * Mark an event as fully processed.
 */
export async function markProcessed(eventId: string, compositeId?: string) {
  await prisma.systemEvent.update({
    where: { id: eventId },
    data: {
      routing_status: 'processed',
      processed_at:   new Date().toISOString(),
      ...(compositeId ? { composite_id: compositeId } : {}),
    },
  });
}

/**
 * Mark an event as failed.
 */
export async function markFailed(eventId: string) {
  await prisma.systemEvent.update({
    where: { id: eventId },
    data: { routing_status: 'failed' },
  }).catch(() => {});
}
