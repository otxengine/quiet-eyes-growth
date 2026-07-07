import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * enrichLeads — AI enrichment for hot/warm leads.
 * Generates fit_score, recommended_channel, personalized_message, next_best_action.
 * Also creates ProactiveAlerts for dormant warm leads (7d+ no action).
 */
export async function enrichLeads(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city, relevant_services, tone_preference } = profile;

    const leads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: { in: ['hot', 'warm'] },
      },
      orderBy: { score: 'desc' },
      take: 20,
    });

    const hotAndWarm = leads.slice(0, 10);
    if (hotAndWarm.length === 0) {
      await writeAutomationLog('enrichLeads', businessProfileId, startTime, 0);
      return res.json({ enriched: 0, messages_generated: 0, dormant_alerts: 0 });
    }

    const sectorData = await prisma.sectorKnowledge.findFirst({
      where: { sector: category },
      orderBy: { created_date: 'desc' },
      select: { price_range: true, trending_services: true },
    });
    const sectorContext = sectorData
      ? `מחירי שוק: ${sectorData.price_range || '?'}, שירותים במגמה: ${sectorData.trending_services || '?'}`
      : '';

    const leadSummaries = hotAndWarm.map(l =>
      `ID:${l.id} | ${l.name} | שירות:${l.service_needed || '?'} | תקציב:${(l as any).budget_range || '?'} | עיר:${(l as any).city || '?'} | מקור:${l.source || '?'} | דחיפות:${(l as any).urgency || '?'} | ציון:${l.score}`
    ).join('\n');

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1500,
      skipCache: true,
      prompt: `You are a sales intelligence specialist for Israeli SMBs.

BUSINESS: ${name}, Category: ${category}, City: ${city}
Services: ${relevant_services || 'לא הוגדר'}
Tone: ${tone_preference || 'friendly'}
${sectorContext}

LEADS TO ENRICH:
${leadSummaries}

For EACH lead provide a JSON enrichment. ALL TEXT IN HEBREW.
Return ONLY valid JSON.`,
      response_json_schema: {
        type: 'object',
        properties: {
          enrichments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lead_id:              { type: 'string' },
                fit_score:            { type: 'number' },
                fit_reasoning:        { type: 'string' },
                recommended_channel:  { type: 'string' },
                personalized_message: { type: 'string' },
                next_best_action:     { type: 'string' },
                urgency_note:         { type: 'string' },
              },
            },
          },
        },
      },
    }) as { enrichments?: any[] } | null;

    const enrichments = result?.enrichments || [];
    let enriched = 0;

    for (const e of enrichments) {
      if (!e.lead_id) continue;
      const lead = hotAndWarm.find(l => l.id === e.lead_id);
      if (!lead) continue;

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          questionnaire_answers: JSON.stringify({
            fit_score: e.fit_score,
            fit_reasoning: e.fit_reasoning,
            recommended_channel: e.recommended_channel,
            personalized_message: e.personalized_message,
            next_best_action: e.next_best_action,
            urgency_note: e.urgency_note,
            enriched_at: new Date().toISOString(),
          }),
        },
      });
      enriched++;
    }

    // Dormant warm leads (7d+ with no action)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const dormantLeads = leads.filter(l =>
      l.status === 'warm' && (l.created_at || l.created_date?.toISOString() || '') < sevenDaysAgo
    );

    let reEngaged = 0;
    for (const dormant of dormantLeads.slice(0, 3)) {
      const title = `ליד רדום: ${dormant.name}`;
      const existing = await prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, title, is_dismissed: false },
      });
      if (existing) continue;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'action_needed',
          title,
          description: `הליד ${dormant.name} (${dormant.service_needed || '?'}) לא קיבל טיפול מזה שבוע+. שקול החייאה.`,
          suggested_action: `שלח הודעת מעקב ל${dormant.name} או עדכן סטטוס`,
          priority: 'medium',
          source_agent: 'enrichLeads',
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
      reEngaged++;
    }

    await writeAutomationLog('enrichLeads', businessProfileId, startTime, enriched);
    return res.json({ enriched, messages_generated: enriched, dormant_alerts: reEngaged });
  } catch (err: any) {
    console.error('enrichLeads error:', err.message);
    await writeAutomationLog('enrichLeads', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
