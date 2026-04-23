import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile', enriched: 0 }, { status: 404 });

  const { name, category, city, relevant_services, tone_preference } = profile;
  const leads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id }, '-score', 20);
  const hotAndWarm = leads.filter(l => l.status === 'hot' || l.status === 'warm');

  if (hotAndWarm.length === 0) {
    return Response.json({ enriched: 0, messages_generated: 0 });
  }

  // Get sector knowledge for context
  const sectorData = await base44.asServiceRole.entities.SectorKnowledge.filter({ sector: category });
  const sectorContext = sectorData[0] ? `מחירי שוק: ${sectorData[0].price_range}, שירותים במגמה: ${sectorData[0].trending_services}` : '';

  const leadSummaries = hotAndWarm.slice(0, 10).map(l => 
    `ID:${l.id} | ${l.name} | שירות:${l.service_needed || '?'} | תקציב:${l.budget_range || '?'} | עיר:${l.city || '?'} | מקור:${l.source || '?'} | דחיפות:${l.urgency || '?'} | ציון:${l.score}`
  ).join('\n');

  const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are a sales intelligence specialist for Israeli SMBs.

BUSINESS: ${name}, Category: ${category}, City: ${city}
Services: ${relevant_services || 'לא הוגדר'}
Tone: ${tone_preference || 'friendly'}
${sectorContext}

LEADS TO ENRICH:
${leadSummaries}

For EACH lead, provide:
- lead_id: the ID from above
- fit_score: 0-100 how well this lead fits the business's ideal customer
- fit_reasoning: one sentence explaining the fit score (Hebrew)
- recommended_channel: WhatsApp / טלפון / מייל — best channel to contact
- personalized_message: a SHORT, warm first-contact message in Hebrew (2-3 sentences max, matching business tone "${tone_preference}")
- next_best_action: specific next step (Hebrew)
- urgency_note: any timing-sensitive info (Hebrew)

Consider: budget match, service relevance, location proximity, urgency level. ALL TEXT IN HEBREW.`,
    model: 'gemini_3_flash',
    add_context_from_internet: true,
    response_json_schema: {
      type: "object",
      properties: {
        enrichments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              lead_id: { type: "string" },
              fit_score: { type: "number" },
              fit_reasoning: { type: "string" },
              recommended_channel: { type: "string" },
              personalized_message: { type: "string" },
              next_best_action: { type: "string" },
              urgency_note: { type: "string" }
            }
          }
        }
      }
    }
  });

  const enrichments = llmResult?.enrichments || [];
  let enriched = 0;

  for (const e of enrichments) {
    if (!e.lead_id) continue;
    const lead = hotAndWarm.find(l => l.id === e.lead_id);
    if (!lead) continue;

    // Store enrichment data in questionnaire_answers field as JSON
    const enrichmentData = {
      fit_score: e.fit_score,
      fit_reasoning: e.fit_reasoning,
      recommended_channel: e.recommended_channel,
      personalized_message: e.personalized_message,
      next_best_action: e.next_best_action,
      urgency_note: e.urgency_note,
      enriched_at: new Date().toISOString(),
    };

    await base44.asServiceRole.entities.Lead.update(lead.id, {
      questionnaire_answers: JSON.stringify(enrichmentData),
    });
    enriched++;
  }

  // Check for dormant leads (no activity for 7+ days, still warm)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const dormantLeads = leads.filter(l => 
    l.status === 'warm' && (l.created_at || l.created_date) < sevenDaysAgo
  );

  let reEngaged = 0;
  for (const dormant of dormantLeads.slice(0, 3)) {
    await base44.asServiceRole.entities.ProactiveAlert.create({
      linked_business: profile.id,
      alert_type: 'action_needed',
      title: `ליד רדום: ${dormant.name}`,
      description: `הליד ${dormant.name} (${dormant.service_needed || '?'}) לא קיבל טיפול מזה שבוע+. שקול החייאה.`,
      suggested_action: `שלח הודעת מעקב ל${dormant.name} או עדכן סטטוס`,
      action_url: '/leads',
      priority: 'medium',
      source_agent: 'המסנן',
      is_dismissed: false,
      is_acted_on: false,
      created_at: new Date().toISOString(),
    });
    reEngaged++;
  }

  console.log(`enrichLeads complete: ${enriched} enriched, ${reEngaged} dormant alerts`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'enrichLeads',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: enriched,
      linked_business: profile.id,
    });
  } catch (_) {}

  return Response.json({ enriched, messages_generated: enriched, dormant_alerts: reEngaged });
});