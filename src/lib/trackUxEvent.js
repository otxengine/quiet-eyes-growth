import { base44 } from '@/api/base44Client';

// Fire-and-forget UX event — never throws, never blocks a user action.
export function trackUxEvent(eventType, businessId, payload) {
  base44.raw.post('/events/ux', { eventType, businessId: businessId || null, payload: payload || null }).catch(() => {});
}
