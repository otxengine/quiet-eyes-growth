import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { event, data, old_data } = body;

  // Can be called by entity automation (Lead create/update) or manually
  const lead = data;
  if (!lead || !lead.linked_business) {
    return Response.json({ skipped: true, reason: 'no lead data or linked_business' });
  }

  const eventType = event?.type || 'manual';

  // Get business profile
  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === lead.linked_business);
  if (!profile) {
    return Response.json({ skipped: true, reason: 'profile not found' });
  }

  // Check if any CRM sync is enabled
  const webhookEnabled = profile.crm_webhook_enabled && profile.crm_webhook_url;
  const zapierEnabled = profile.crm_zapier_enabled && profile.crm_zapier_url;

  if (!webhookEnabled && !zapierEnabled) {
    return Response.json({ skipped: true, reason: 'no CRM sync configured' });
  }

  // Check if this event type should be synced
  const syncEvents = (profile.crm_sync_events || 'create,update').split(',').map(s => s.trim());
  const isStatusChange = old_data && old_data.status !== lead.status;
  
  if (eventType === 'create' && !syncEvents.includes('create')) {
    return Response.json({ skipped: true, reason: 'create events not synced' });
  }
  if (eventType === 'update' && !syncEvents.includes('update') && !(isStatusChange && syncEvents.includes('status_change'))) {
    return Response.json({ skipped: true, reason: 'update events not synced' });
  }

  // Build payload
  const payload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    business: {
      name: profile.name,
      category: profile.category,
      city: profile.city,
    },
    lead: {
      id: lead.id || event?.entity_id,
      name: lead.name,
      status: lead.status,
      score: lead.score,
      source: lead.source,
      service_needed: lead.service_needed,
      budget_range: lead.budget_range,
      contact_info: lead.contact_info,
      city: lead.city,
      urgency: lead.urgency,
      intent_strength: lead.intent_strength,
      intent_source: lead.intent_source,
      created_at: lead.created_at || lead.created_date,
    },
  };

  if (isStatusChange) {
    payload.status_change = {
      from: old_data.status,
      to: lead.status,
    };
  }

  const results = { webhook: null, zapier: null };

  // Send to custom Webhook
  if (webhookEnabled) {
    try {
      const res = await fetch(profile.crm_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      results.webhook = { status: res.status, ok: res.ok };
      console.log(`CRM Webhook sent: ${res.status} to ${profile.crm_webhook_url}`);
    } catch (err) {
      results.webhook = { error: err.message };
      console.error(`CRM Webhook error: ${err.message}`);
    }
  }

  // Send to Zapier
  if (zapierEnabled) {
    try {
      const res = await fetch(profile.crm_zapier_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      results.zapier = { status: res.status, ok: res.ok };
      console.log(`Zapier Webhook sent: ${res.status}`);
    } catch (err) {
      results.zapier = { error: err.message };
      console.error(`Zapier Webhook error: ${err.message}`);
    }
  }

  // Update sync stats
  await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
    crm_last_sync: new Date().toISOString(),
    crm_sync_count: (profile.crm_sync_count || 0) + 1,
  });

  console.log(`crmWebhookSync: event=${eventType}, lead=${lead.name}, results=`, JSON.stringify(results));
  return Response.json({ synced: true, event: eventType, lead_name: lead.name, results });
});