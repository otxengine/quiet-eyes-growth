import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// HubSpot: create or update contact + deal
async function syncToHubSpot(profile, lead, eventType, fieldMap) {
  const token = profile.crm_hubspot_api_key;
  if (!token) return { error: 'no API key' };

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';
  const map = fieldMap || {};

  // Create or update contact
  const contactProps = {
    [map.name || 'firstname']: lead.name || '',
    [map.phone || 'phone']: phone,
    [map.city || 'city']: lead.city || '',
    [map.source || 'hs_lead_status']: lead.status || 'NEW',
  };
  if (lead.service_needed) contactProps[map.service || 'jobtitle'] = lead.service_needed;

  let contactId = null;
  // Try to find existing contact by phone
  if (phone) {
    const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST', headers,
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: phone }] }] }),
    });
    const searchData = await searchRes.json();
    contactId = searchData.results?.[0]?.id;
  }

  if (contactId) {
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ properties: contactProps }),
    });
  } else {
    const createRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST', headers,
      body: JSON.stringify({ properties: contactProps }),
    });
    const created = await createRes.json();
    contactId = created.id;
    if (!contactId) {
      console.error('HubSpot contact create failed:', JSON.stringify(created));
      return { error: 'contact creation failed', details: created };
    }
  }

  // Create deal if new lead
  if (eventType === 'create') {
    const dealProps = {
      dealname: `${lead.name} — ${lead.service_needed || 'ליד חדש'}`,
      pipeline: profile.crm_hubspot_pipeline_id || 'default',
      dealstage: lead.status === 'hot' ? 'qualifiedtobuy' : 'appointmentscheduled',
      amount: lead.budget_range ? lead.budget_range.replace(/[^\d]/g, '') : '',
    };
    await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST', headers,
      body: JSON.stringify({ properties: dealProps, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }] }),
    });
  }

  return { ok: true, contactId };
}

// Monday.com: create item on board
async function syncToMonday(profile, lead, eventType, fieldMap) {
  const token = profile.crm_monday_api_key;
  const boardId = profile.crm_monday_board_id;
  if (!token || !boardId) return { error: 'missing API key or board ID' };

  const map = fieldMap || {};
  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';

  const statusMap = {
    hot: map.status_hot || 'חם',
    warm: map.status_warm || 'פושר',
    cold: map.status_cold || 'קר',
    contacted: map.status_contacted || 'נוצר קשר',
    completed: map.status_completed || 'טופל',
    lost: map.status_lost || 'לא רלוונטי',
  };

  const columnValues = {};
  if (map.phone_col) columnValues[map.phone_col] = phone;
  if (map.city_col) columnValues[map.city_col] = lead.city || '';
  if (map.service_col) columnValues[map.service_col] = lead.service_needed || '';
  if (map.budget_col) columnValues[map.budget_col] = lead.budget_range || '';
  if (map.source_col) columnValues[map.source_col] = lead.source || '';
  if (map.score_col) columnValues[map.score_col] = String(lead.score || 0);
  if (map.status_col) columnValues[map.status_col] = { label: statusMap[lead.status] || lead.status || '' };
  if (map.urgency_col) columnValues[map.urgency_col] = lead.urgency || '';

  const itemName = lead.name || 'ליד חדש';

  if (eventType === 'create') {
    const query = `mutation { create_item (board_id: ${boardId}, item_name: "${itemName.replace(/"/g, '\\"')}", column_values: ${JSON.stringify(JSON.stringify(columnValues))}) { id } }`;
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.errors) {
      console.error('Monday.com error:', JSON.stringify(data.errors));
      return { error: data.errors[0]?.message || 'unknown error' };
    }
    return { ok: true, itemId: data.data?.create_item?.id };
  }

  // For updates, try to find and update existing item by name
  const searchQuery = `query { items_page_by_column_values (board_id: ${boardId}, limit: 1, columns: [{column_id: "name", column_values: ["${itemName.replace(/"/g, '\\"')}"]}]) { items { id } } }`;
  const searchRes = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: searchQuery }),
  });
  const searchData = await searchRes.json();
  const existingId = searchData.data?.items_page_by_column_values?.items?.[0]?.id;

  if (existingId) {
    const updateQuery = `mutation { change_multiple_column_values (board_id: ${boardId}, item_id: ${existingId}, column_values: ${JSON.stringify(JSON.stringify(columnValues))}) { id } }`;
    await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: updateQuery }),
    });
    return { ok: true, itemId: existingId, updated: true };
  }

  // If not found on update, create new
  const createQuery = `mutation { create_item (board_id: ${boardId}, item_name: "${itemName.replace(/"/g, '\\"')}", column_values: ${JSON.stringify(JSON.stringify(columnValues))}) { id } }`;
  const createRes = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: createQuery }),
  });
  const createData = await createRes.json();
  return { ok: true, itemId: createData.data?.create_item?.id };
}

// Pipedrive
async function syncToPipedrive(profile: any, lead: any, eventType: string): Promise<any> {
  const apiKey = profile.crm_pipedrive_api_key;
  if (!apiKey) return { error: 'no API key' };

  const baseUrl = 'https://api.pipedrive.com/v1';
  const headers = { 'Content-Type': 'application/json' };
  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';

  // Find or create person
  let personId = null;
  if (phone) {
    const searchRes = await fetch(`${baseUrl}/persons/search?term=${phone}&fields=phone&api_token=${apiKey}`, { headers });
    const searchData = await searchRes.json();
    personId = searchData.data?.items?.[0]?.item?.id;
  }

  if (!personId) {
    const createRes = await fetch(`${baseUrl}/persons?api_token=${apiKey}`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: lead.name || 'ליד חדש',
        phone: [{ value: phone, primary: true }],
      }),
    });
    const created = await createRes.json();
    personId = created.data?.id;
  }

  if (!personId) return { error: 'Person creation failed' };

  if (eventType === 'create') {
    const stageMap: Record<string, number> = { hot: 1, warm: 2, cold: 3 };
    const dealRes = await fetch(`${baseUrl}/deals?api_token=${apiKey}`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: `${lead.name || 'ליד'} — ${lead.service_needed || 'שירות'}`,
        person_id: personId,
        pipeline_id: parseInt(profile.crm_pipedrive_pipeline_id || '1'),
        stage_id: stageMap[lead.status] || 2,
        value: lead.closed_value || (lead.budget_range ? parseInt(lead.budget_range.replace(/[^\d]/g, '')) : 0),
        currency: 'ILS',
      }),
    });
    const dealData = await dealRes.json();
    return { ok: true, personId, dealId: dealData.data?.id };
  }

  return { ok: true, personId, updated: true };
}

// Salesforce (OAuth2 with refresh token)
async function syncToSalesforce(profile: any, lead: any, eventType: string): Promise<any> {
  const { crm_salesforce_client_id, crm_salesforce_client_secret, crm_salesforce_refresh_token, crm_salesforce_instance_url } = profile;
  if (!crm_salesforce_client_id || !crm_salesforce_refresh_token || !crm_salesforce_instance_url) {
    return { error: 'missing Salesforce credentials' };
  }

  // Get access token using refresh token
  const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: crm_salesforce_client_id,
      client_secret: crm_salesforce_client_secret || '',
      refresh_token: crm_salesforce_refresh_token,
    }),
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) return { error: 'Token refresh failed', details: tokenData };

  const sfHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '';
  const [firstName, ...lastParts] = (lead.name || 'ליד').split(' ');

  const sfLead = {
    FirstName: firstName,
    LastName: lastParts.join(' ') || 'חדש',
    MobilePhone: phone,
    City: lead.city || '',
    Description: `${lead.service_needed || ''} | Score: ${lead.score} | Source: ${lead.source}`,
    LeadSource: lead.source || 'Web',
    Status: lead.status === 'hot' ? 'Working' : lead.status === 'warm' ? 'Open - Not Contacted' : 'Closed - Not Converted',
    Company: lead.name || 'ליד QuietEyes',
  };

  if (eventType === 'create') {
    const createRes = await fetch(`${crm_salesforce_instance_url}/services/data/v57.0/sobjects/Lead/`, {
      method: 'POST', headers: sfHeaders, body: JSON.stringify(sfLead),
    });
    const created = await createRes.json();
    if (created.errors?.length) return { error: created.errors[0].message };
    return { ok: true, sfLeadId: created.id };
  }

  // Upsert by phone
  const searchRes = await fetch(
    `${crm_salesforce_instance_url}/services/data/v57.0/query/?q=${encodeURIComponent(`SELECT Id FROM Lead WHERE MobilePhone='${phone}' LIMIT 1`)}`,
    { headers: sfHeaders }
  );
  const searchData = await searchRes.json();
  const existingId = searchData.records?.[0]?.Id;

  if (existingId) {
    await fetch(`${crm_salesforce_instance_url}/services/data/v57.0/sobjects/Lead/${existingId}`, {
      method: 'PATCH', headers: sfHeaders, body: JSON.stringify(sfLead),
    });
    return { ok: true, sfLeadId: existingId, updated: true };
  }

  return { ok: false, error: 'Lead not found in Salesforce for update' };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { event, data, old_data } = body;

  const lead = data;
  if (!lead || !lead.linked_business) {
    return Response.json({ skipped: true, reason: 'no lead data' });
  }

  const eventType = event?.type || 'manual';
  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === lead.linked_business);
  if (!profile) return Response.json({ skipped: true, reason: 'profile not found' });

  const syncEvents = (profile.crm_sync_events || 'create,update').split(',').map(s => s.trim());
  const isStatusChange = old_data && old_data.status !== lead.status;

  if (eventType === 'create' && !syncEvents.includes('create')) return Response.json({ skipped: true });
  if (eventType === 'update' && !syncEvents.includes('update') && !(isStatusChange && syncEvents.includes('status_change'))) {
    return Response.json({ skipped: true });
  }

  const results = {};

  // Generic webhook
  if (profile.crm_webhook_enabled && profile.crm_webhook_url) {
    const payload = {
      event: eventType, timestamp: new Date().toISOString(),
      business: { name: profile.name, category: profile.category, city: profile.city },
      lead: { id: lead.id || event?.entity_id, name: lead.name, status: lead.status, score: lead.score, source: lead.source, service_needed: lead.service_needed, budget_range: lead.budget_range, contact_info: lead.contact_info, city: lead.city, urgency: lead.urgency, created_at: lead.created_at || lead.created_date, closed_value: lead.closed_value || 0, closed_at: lead.closed_at || null, lifecycle_stage: lead.lifecycle_stage || lead.status },
    };
    if (isStatusChange) payload.status_change = { from: old_data.status, to: lead.status };
    try {
      const r = await fetch(profile.crm_webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      results.webhook = { status: r.status, ok: r.ok };
    } catch (e) { results.webhook = { error: e.message }; console.error('Webhook error:', e.message); }
  }

  // Zapier
  if (profile.crm_zapier_enabled && profile.crm_zapier_url) {
    const payload = {
      event: eventType, timestamp: new Date().toISOString(),
      lead_name: lead.name, lead_status: lead.status, lead_score: lead.score, lead_source: lead.source,
      service_needed: lead.service_needed, budget: lead.budget_range, contact_info: lead.contact_info,
      city: lead.city, urgency: lead.urgency, business_name: profile.name,
    };
    try {
      const r = await fetch(profile.crm_zapier_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
      results.zapier = { status: r.status, ok: r.ok };
    } catch (e) { results.zapier = { error: e.message }; console.error('Zapier error:', e.message); }
  }

  // HubSpot
  if (profile.crm_hubspot_enabled && profile.crm_hubspot_api_key) {
    let fieldMap = {};
    try { fieldMap = JSON.parse(profile.crm_hubspot_field_map || '{}'); } catch (_) {}
    try {
      results.hubspot = await syncToHubSpot(profile, lead, eventType, fieldMap);
    } catch (e) { results.hubspot = { error: e.message }; console.error('HubSpot error:', e.message); }
  }

  // Monday.com
  if (profile.crm_monday_enabled && profile.crm_monday_api_key) {
    let fieldMap = {};
    try { fieldMap = JSON.parse(profile.crm_monday_field_map || '{}'); } catch (_) {}
    try {
      results.monday = await syncToMonday(profile, lead, eventType, fieldMap);
    } catch (e) { results.monday = { error: e.message }; console.error('Monday error:', e.message); }
  }

  // Pipedrive
  if (profile.crm_pipedrive_enabled && profile.crm_pipedrive_api_key) {
    try {
      results.pipedrive = await syncToPipedrive(profile, lead, eventType);
    } catch (e: any) { results.pipedrive = { error: e.message }; console.error('Pipedrive error:', e.message); }
  }

  // Salesforce
  if (profile.crm_salesforce_enabled && profile.crm_salesforce_client_id) {
    try {
      results.salesforce = await syncToSalesforce(profile, lead, eventType);
    } catch (e: any) { results.salesforce = { error: e.message }; console.error('Salesforce error:', e.message); }
  }

  const anySync = Object.keys(results).length > 0;
  if (anySync) {
    await base44.asServiceRole.entities.BusinessProfile.update(profile.id, {
      crm_last_sync: new Date().toISOString(),
      crm_sync_count: (profile.crm_sync_count || 0) + 1,
    });
  }

  console.log(`syncLeadToCrm: event=${eventType}, lead=${lead.name}, results=`, JSON.stringify(results));
  return Response.json({ synced: anySync, event: eventType, lead_name: lead.name, results });
});