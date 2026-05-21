import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getAgentMission, getAllMissions } from '../../lib/missionPlanner';

/**
 * lostLeadRecovery — finds leads that went cold and generates personalized recovery messages.
 * Cold = no contact in 14+ days, status not closed/archived.
 * Creates ProactiveAlerts with ready-to-send re-engagement messages.
 */
export async function lostLeadRecovery(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    const activeStatuses = ['new', 'contacted', 'hot', 'warm', 'follow_up', 'proposal'];

    const coldLeads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: { in: activeStatuses },
        OR: [
          { last_contact_at: { lt: fourteenDaysAgo.toISOString() } },
          {
            AND: [
              { last_contact_at: null },
              { created_date: { lt: fourteenDaysAgo } },
            ],
          },
        ],
      },
      orderBy: { score: 'desc' },
      take: 10,
    });

    if (coldLeads.length === 0) {
      await writeAutomationLog('lostLeadRecovery', businessProfileId, startTime, 0);
      return res.json({ cold_leads_found: 0, items_created: 0, message: 'No cold leads' });
    }

    // Mission intelligence: reactivation templates + value props
    const nurtureMission = getAgentMission<{
      tone_he?: string;
      value_propositions_he?: string[];
      best_contact_time_he?: string;
    }>(profile, 'smartLeadNurture');
    const allMissions = getAllMissions(profile);
    const reactivationTemplate = allMissions?.content?.retention_message_templates_he?.reactivation || '';
    const valueProps = nurtureMission?.value_propositions_he || [];
    const missionTone = nurtureMission?.tone_he || profile.tone_preference || 'ידידותי';

    // Check for existing recovery alerts to avoid duplicates
    const existingAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, alert_type: 'lost_lead_recovery', is_dismissed: false, is_acted_on: false },
      select: { title: true },
    });
    const existingTitles = new Set(existingAlerts.map(a => a.title));

    let created = 0;

    for (const lead of coldLeads.slice(0, 5)) {
      const title = `שחזר ליד: ${lead.name}`;
      if (existingTitles.has(title)) continue;

      const daysSilent = Math.floor((Date.now() - new Date(lead.last_contact_at || lead.created_date).getTime()) / 86400000);

      // Pick a value proposition relevant to this lead's service
      const relevantValueProp = valueProps.find(v =>
        v.toLowerCase().includes((lead.service_needed || '').toLowerCase().slice(0, 10))
      ) || valueProps[0] || '';

      const result = await invokeLLM({
        profile,
        model: 'sonnet',
        maxTokens: 250,
        skipCache: true,
        prompt: `You are a customer relations expert for the business "${profile.name}".
A previously interested lead has gone quiet for ${daysSilent} days. Your job: write a re-engagement WhatsApp message that re-ignites their interest WITHOUT mentioning the silence or time passed.

Lead: ${lead.name} | Service: ${lead.service_needed || 'לא צוין'} | Score: ${lead.score || 'N/A'}/100
Source: ${lead.source || 'לא ידוע'}
Notes: ${lead.notes?.substring(0, 80) || 'אין'}

Tone: ${missionTone}
${relevantValueProp ? `Value to offer: ${relevantValueProp}` : ''}
${reactivationTemplate ? `Style baseline (DO NOT copy, inspire only): "${reactivationTemplate}"` : ''}

Message rules:
1. Open with their name + reference to the specific thing they were looking for
2. Offer new, concrete value — a recent development, seasonal timing, or relevant opportunity (specific to this sector)
3. One open question that's easy to answer and doesn't feel like a sales pitch
4. 40-60 words total. No mention of time passing. No "האם אתם עדיין מעוניינים".
5. Must feel like a real person, not an automated message.

Return ONLY valid JSON. ALL string values must be in Hebrew.
Format: { "message": "...", "subject": "..." }`,
        response_json_schema: { type: 'object' },
      });

      const message = result?.message || `היי ${lead.name}, שמחנו לדבר איתך לאחרונה. יש לנו הצעה חדשה שעשויה לעניין אותך — אפשר לדבר?`;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'lost_lead_recovery',
          title,
          description: `${lead.name} לא ענה ${daysSilent} ימים (${lead.service_needed || lead.source || 'ליד'})`,
          suggested_action: `שלח הודעת חזרה ל${lead.name} ב-WhatsApp`,
          priority: (lead.score || 0) >= 70 ? 'high' : 'medium',
          source_agent: JSON.stringify({
            action_label: 'שלח הודעה',
            action_type: 'call',
            action_platform: 'whatsapp',
            prefilled_text: message,
            urgency_hours: 24,
            impact_reason: `ליד בציון ${lead.score || 'N/A'} מסתמן כנטוש — חלון ההצלה נסגר`,
          }),
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });

      // Update lead next_action
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          next_action: 'שלח הודעת חזרה',
          next_action_date: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      existingTitles.add(title);
      created++;
    }

    await writeAutomationLog('lostLeadRecovery', businessProfileId, startTime, created);
    return res.json({ cold_leads_found: coldLeads.length, items_created: created, leads_recovered: created });
  } catch (err: any) {
    console.error('lostLeadRecovery error:', err.message);
    await writeAutomationLog('lostLeadRecovery', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
