/**
 * routingEngine.ts — OTX-001
 * Dynamic routing engine: evaluates RoutingRule conditions at runtime
 * and selectively activates agents for each SystemEvent.
 */

import { prisma } from '../db';
import { markDispatched, markFailed } from './eventBus';

// ── Default routing rules (seeded on first use) ───────────────────────────────
// These are also stored in the DB so operators can modify them at runtime.
const DEFAULT_RULES: Array<{
  event_type:    string;
  conditions:    null | Array<{ field: string; op: string; value: any }>;
  target_agents: string[];
  priority:      number;
  description:   string;
}> = [
  {
    event_type:    'new_review',
    conditions:    [{ field: 'payload.rating', op: '<=', value: 3 }],
    target_agents: ['generateProactiveAlerts', 'sendWhatsAppAlert'],
    priority:      10,
    description:   'Negative review → alert + WhatsApp notification',
  },
  {
    event_type:    'new_review',
    conditions:    null,
    target_agents: ['generateProactiveAlerts'],
    priority:      5,
    description:   'Any review → proactive alert',
  },
  {
    event_type:    'competitor_change',
    conditions:    null,
    target_agents: ['generateProactiveAlerts', 'runCompetitorIdentification'],
    priority:      7,
    description:   'Competitor change → alert + rescan',
  },
  {
    event_type:    'market_signal',
    conditions:    [{ field: 'context_attrs.impact', op: '==', value: 'high' }],
    target_agents: ['generateProactiveAlerts', 'findLocalEvents'],
    priority:      8,
    description:   'High-impact signal → alert + find related events',
  },
  {
    event_type:    'market_signal',
    conditions:    null,
    target_agents: ['generateProactiveAlerts'],
    priority:      4,
    description:   'Any market signal → proactive alert',
  },
  {
    event_type:    'local_event',
    conditions:    null,
    target_agents: ['generateProactiveAlerts'],
    priority:      6,
    description:   'Local event → proactive alert',
  },
  {
    event_type:    'sports_match',
    conditions:    null,
    target_agents: ['generateProactiveAlerts'],
    priority:      7,
    description:   'Sports match → proactive alert (high traffic)',
  },
  {
    event_type:    'hot_lead',
    conditions:    null,
    target_agents: ['generateProactiveAlerts', 'sendWhatsAppAlert'],
    priority:      10,
    description:   'Hot lead → immediate alert',
  },
  {
    event_type:    'retention_risk',
    conditions:    null,
    target_agents: ['generateProactiveAlerts'],
    priority:      8,
    description:   'Retention risk → proactive alert',
  },
];

// ── Condition evaluator ───────────────────────────────────────────────────────
function getNestedValue(obj: any, path: string): any {
  // path like "payload.rating" or "context_attrs.impact"
  return path.split('.').reduce((acc, key) => {
    if (acc && typeof acc === 'object') {
      // If the value is a JSON string, parse it first
      const val = acc[key];
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    }
    return undefined;
  }, obj);
}

function evaluateCondition(
  event: any,   // raw SystemEvent row
  cond: { field: string; op: string; value: any }
): boolean {
  // Build a searchable object: parse JSON payload and context_attrs
  const eventObj: any = { ...event };
  try { eventObj.payload = JSON.parse(event.payload || '{}'); } catch {}
  try { eventObj.context_attrs = JSON.parse(event.context_attrs || '{}'); } catch {}

  const actual = getNestedValue(eventObj, cond.field);
  if (actual === undefined) return false;

  switch (cond.op) {
    case '==':  return actual == cond.value;     // eslint-disable-line eqeqeq
    case '!=':  return actual != cond.value;     // eslint-disable-line eqeqeq
    case '>':   return Number(actual) > Number(cond.value);
    case '>=':  return Number(actual) >= Number(cond.value);
    case '<':   return Number(actual) < Number(cond.value);
    case '<=':  return Number(actual) <= Number(cond.value);
    case 'includes': return String(actual).toLowerCase().includes(String(cond.value).toLowerCase());
    case 'in':  return Array.isArray(cond.value) && cond.value.includes(actual);
    default:    return false;
  }
}

function ruleMatches(
  event: any,
  rule: { event_type: string; conditions: any }
): boolean {
  // event_type must match (or rule uses '*' wildcard)
  if (rule.event_type !== '*' && rule.event_type !== event.event_type) return false;

  // If no conditions, rule always matches
  const conditions = typeof rule.conditions === 'string'
    ? JSON.parse(rule.conditions || 'null')
    : rule.conditions;
  if (!conditions || conditions.length === 0) return true;

  // All conditions must pass (AND logic)
  return conditions.every((c: any) => evaluateCondition(event, c));
}

// ── Seed default rules if table is empty ─────────────────────────────────────
async function ensureDefaultRules() {
  const count = await prisma.routingRule.count();
  if (count === 0) {
    await prisma.routingRule.createMany({
      data: DEFAULT_RULES.map(r => ({
        event_type:    r.event_type,
        conditions:    r.conditions ? JSON.stringify(r.conditions) : null,
        target_agents: JSON.stringify(r.target_agents),
        priority:      r.priority,
        description:   r.description,
        is_active:     true,
      })),
      skipDuplicates: true,
    });
  }
}

// ── Main routing function ─────────────────────────────────────────────────────
/**
 * Route a single SystemEvent: find matching rules, return activated agent names.
 * The caller is responsible for actually invoking those agents.
 */
export async function routeEvent(event: any): Promise<string[]> {
  await ensureDefaultRules();

  const rules = await prisma.routingRule.findMany({
    where: { is_active: true },
    orderBy: { priority: 'desc' },
  });

  const activatedAgents = new Set<string>();

  for (const rule of rules) {
    if (ruleMatches(event, rule)) {
      const agents: string[] = JSON.parse(rule.target_agents || '[]');
      agents.forEach(a => activatedAgents.add(a));
    }
  }

  return [...activatedAgents];
}

/**
 * Process a batch of pending events.
 * Marks each as dispatched with the list of activated agents.
 * Returns a summary of {eventId, agents} pairs for the caller to execute.
 */
export async function processPendingEvents(events: any[]): Promise<Array<{
  eventId: string;
  businessId: string;
  eventType: string;
  agents: string[];
  payload: any;
}>> {
  await ensureDefaultRules();

  const dispatches: Array<{
    eventId: string;
    businessId: string;
    eventType: string;
    agents: string[];
    payload: any;
  }> = [];

  for (const event of events) {
    try {
      const agents = await routeEvent(event);
      if (agents.length > 0) {
        await markDispatched(event.id, agents);
        dispatches.push({
          eventId:    event.id,
          businessId: event.business_id,
          eventType:  event.event_type,
          agents,
          payload:    JSON.parse(event.payload || '{}'),
        });
      } else {
        // No matching rules — mark as processed immediately
        await markDispatched(event.id, []);
      }
    } catch (err: any) {
      console.error(`[routingEngine] failed to route event ${event.id}:`, err.message);
      await markFailed(event.id);
    }
  }

  return dispatches;
}
