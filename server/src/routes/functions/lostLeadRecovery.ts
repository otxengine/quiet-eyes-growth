import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

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

      const result = await invokeLLM({
        prompt: `אתה מנהל קשרי לקוחות לעסק "${profile.name}" (${profile.category}).

ליד שהתקרר: ${lead.name}
שירות מבוקש: ${lead.service_needed || 'לא צוין'}
מקור: ${lead.source || 'לא ידוע'}
ציון: ${lead.score || 'N/A'}/100
ימים ללא קשר: ${daysSilent}
הערות: ${lead.notes?.substring(0, 100) || 'אין'}
ניסיון ראשון: ${lead.suggested_first_message?.substring(0, 80) || 'לא נשלח'}

כתוב הודעת WhatsApp קצרה לחידוש קשר (40-60 מילים בעברית):
- אל תזכיר שעברו ימים
- הצע ערך חדש (הנחה/שירות/תוכן)
- סיים עם שאלה פתוחה
- טון: ${profile.tone_preference || 'ידידותי'}

החזר JSON: { "message": "הטקסט המלא", "subject": "נושא קצר (5 מילים)" }`,
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
