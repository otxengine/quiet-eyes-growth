import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { executeOrQueue } from '../../services/execution/executeOrQueue';
import { validateAction } from '../../lib/constraintValidator';
import { getAgentMission, getAllMissions } from '../../lib/missionPlanner';

/**
 * smartLeadNurture — follows up on contacted leads that haven't responded:
 * - 48h–7d silence: generate follow-up WhatsApp message + queue PendingAlert
 * - 7d+ silence: mark lead as 'cold' + create ProactiveAlert to reconsider
 */
export async function smartLeadNurture(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    const bizCtx = await loadBusinessContext(businessProfileId);

    // Mission Intelligence: read per-agent plan generated at onboarding
    const nurtureMission = getAgentMission<{
      tone_he?: string;
      followup_interval_days?: number;
      value_propositions_he?: string[];
      best_contact_time_he?: string;
    }>(profile, 'smartLeadNurture');
    const allMissions = getAllMissions(profile);
    const contentTemplates = allMissions?.content;

    // Tone: mission > bizCtx > profile > default
    const missionTone = nurtureMission?.tone_he || '';
    const bizTone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = missionTone
      ? missionTone
      : bizTone === 'casual'
      ? 'טון קליל וחברותי, קצר מאוד'
      : bizTone === 'warm'
      ? 'טון חם, מבין ולא לוחץ'
      : 'טון מקצועי ותכליתי';

    // Value propositions specific to this sector (from missions)
    const valuePropsBlock = nurtureMission?.value_propositions_he?.length
      ? `הצעות ערך לשלב בהודעה (בחר אחת שמתאימה להקשר):\n${nurtureMission.value_propositions_he.map(v => `• ${v}`).join('\n')}`
      : '';

    // WhatsApp template from content missions as example baseline
    const whatsappTemplate = contentTemplates?.first_contact_templates_he?.whatsapp || '';
    const templateBlock = whatsappTemplate
      ? `תבנית בסיסית לסגנון הודעה (התאם לסיטואציה, אל תעתיק מילה במילה):\n"${whatsappTemplate}"`
      : '';

    // Best contact time from mission
    const bestContactTime = nurtureMission?.best_contact_time_he || '';

    // Sector-dynamic timing: use sector knowledge to tune follow-up windows
    const sectorKnowledge = await prisma.sectorKnowledge.findFirst({
      where: { sector: category },
      orderBy: { created_date: 'desc' },
      select: { winner_lead_dna: true, peak_demand: true },
    });
    let followupWindowHours = 48;   // default: 48h before first follow-up
    let coldWindowDays = 7;         // default: 7d before marking cold
    if (sectorKnowledge?.winner_lead_dna) {
      try {
        const dna = JSON.parse(sectorKnowledge.winner_lead_dna);
        // High-conversion sectors (>40%) get longer consideration window
        if ((dna.lead_conversion_rate_pct || 0) > 40) {
          followupWindowHours = 72;
          coldWindowDays = 10;
        }
        // Low-conversion sectors get shorter, more aggressive follow-up
        if ((dna.lead_conversion_rate_pct || 0) < 15) {
          followupWindowHours = 24;
          coldWindowDays = 5;
        }
      } catch {}
    }
    const sectorPeakDemand = sectorKnowledge?.peak_demand || '';

    const fortyEightHoursAgo = new Date(Date.now() - followupWindowHours * 3600000);
    const sevenDaysAgo = new Date(Date.now() - coldWindowDays * 24 * 3600000);

    // Find leads that are 'contacted' and were created 48h+ ago without progressing
    const staleLeads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: 'contacted',
        created_date: { lte: fortyEightHoursAgo },
      },
      orderBy: { created_date: 'asc' },
      take: 10,
    });

    let nurtured = 0;
    let markedCold = 0;

    for (const lead of staleLeads) {
      try {
        const isCold = lead.created_date <= sevenDaysAgo;
        const customerName = lead.name || 'ליד';
        const serviceNeeded = lead.service_needed || category;

        if (isCold) {
          markedCold++;
          // Mark lead as cold
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              status: 'cold',
              lifecycle_stage: 'lost',
              lifecycle_updated_at: new Date().toISOString(),
              notes: `${lead.notes ? lead.notes + '\n' : ''}[אוטומטי] הועבר לקר — ללא מענה 7+ ימים`,
            },
          });

          const alertTitle = `ליד קר: ${customerName} — ללא מענה 7 ימים`;
          const existing = await prisma.proactiveAlert.findFirst({
            where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
          });
          if (!existing) {
            const actionMeta = JSON.stringify({
              action_label: 'נסה שוב',
              action_type: 'call',
              prefilled_text: `שיחת התעוררות עם ${customerName}:\n\n"שלום ${customerName}, זה ${name}. פנית אלינו לגבי ${serviceNeeded}. רצינו לבדוק אם אפשר לעזור — האם הנושא עדיין רלוונטי?"`,
              urgency_hours: 24,
              impact_reason: 'לידים קרים שנוצרו מחדש שווים פי 3 פחות — כדאי לנסות פעם אחת נוספת',
            });
            await prisma.proactiveAlert.create({
              data: {
                alert_type: 'retention_risk',
                title: alertTitle,
                description: `${customerName} לא ענה 7+ ימים. שירות: ${serviceNeeded}. ציון: ${lead.score || '?'}`,
                suggested_action: `שקול להתקשר ל${customerName} פעם אחת נוספת לפני סגירת הליד`,
                priority: (lead.score || 0) >= 70 ? 'high' : 'medium',
                source_agent: actionMeta,
                is_dismissed: false,
                is_acted_on: false,
                created_at: new Date().toISOString(),
                linked_business: businessProfileId,
              },
            });
          }
        } else {
          // 48h–7d: generate follow-up message
          const followupCount = (lead.followup_count || 0) + 1;
          const angle = followupCount === 1 ? 'הוספת ערך — שאלה קצרה' : 'הזכרה קצרה וידידותית';

          const messageResult = await invokeLLM({
            model: 'sonnet',
            maxTokens: 300,
            profile,
            prompt: `You are a sales communication expert for Israeli small businesses.
Write a follow-up WhatsApp message that will prompt ${customerName} to respond — human, non-pushy, interest-sparking.
The message must feel like it comes from a real person who genuinely wants to help, not a template.

Lead: ${customerName} | Interested in: ${serviceNeeded}
Follow-up attempt: ${followupCount} | Days since first contact: ${followupCount === 1 ? '2-3' : '5-7'}
Required approach: ${angle}
Style: ${toneInstruction}
${valuePropsBlock}
${templateBlock}
${bestContactTime ? `שעת פנייה מומלצת לסקטור זה: ${bestContactTime}` : ''}
${sectorPeakDemand ? `זמני ביקוש שיא בסקטור: ${sectorPeakDemand}` : ''}

Message rules:
- Line 1: personal address by name + the specific thing they needed (not generic)
- Line 2: one concrete reason to respond now — specific to THIS business's sector and value props
- Line 3: one short, easy yes/no question that opens dialogue
- Maximum 3 lines total. No pressure. No "just wanted to check in". No unnecessary emojis.
- The message must reference the specific service, not just "our services"
Write ONLY the message text in Hebrew.`,
          });

          const followupMsg = typeof messageResult === 'string' ? messageResult.trim() : '';
          if (!followupMsg) continue;
          nurtured++;

          // OTX-004: validate message against business constraints
          const validation = await validateAction(businessProfileId, {
            type: 'whatsapp_send',
            content: followupMsg,
            platform: 'whatsapp',
            scheduledHour: new Date().getHours(),
          });
          const validatedMsg = validation.action.content || followupMsg;

          const phone = lead.contact_phone || '';
          const waUrl = phone
            ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(followupMsg)}`
            : null;

          // Update lead followup metadata
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              followup_count: followupCount,
              next_followup_date: new Date(Date.now() + 3 * 24 * 3600000).toISOString(),
              last_contact_at: new Date().toISOString(),
            },
          });

          // Leads always require manual approval (isLead: true)
          const { autoActionId } = await executeOrQueue({
            businessProfileId,
            agentName: 'smartLeadNurture',
            actionType: 'whatsapp_send',
            description: `מעקב ליד: ${customerName} — ניסיון ${followupCount}`,
            payload: { phone, message: validatedMsg, customerName, leadId: lead.id },
            revenueImpact: 500,
            isLead: true,
            confidenceScore: followupCount === 1 ? 85 : 70,
            predictedImpact: followupCount === 1 ? 'high' : 'medium',
            constraintNotes: validation.constraintNotes,
          });

          // ProactiveAlert with ActionPopup metadata
          const alertTitle = `מעקב ליד: ${customerName} — ניסיון ${followupCount}`;
          const existing = await prisma.proactiveAlert.findFirst({
            where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
          });
          if (!existing) {
            const actionMeta = JSON.stringify({
              action_label: `שלח מעקב ל${customerName}`,
              action_type: 'social_post',
              prefilled_text: followupMsg,
              urgency_hours: 12,
              impact_reason: 'ליד שלא ענה בפעם הראשונה — 40% מגיבים להודעת מעקב שנייה',
              auto_action_id: autoActionId,
            });
            await prisma.proactiveAlert.create({
              data: {
                alert_type: 'hot_lead',
                title: alertTitle,
                description: `${customerName} לא ענה ${followupCount === 1 ? '48 שעות' : `${followupCount} ניסיונות`}. שירות: ${serviceNeeded}`,
                suggested_action: `שלח הודעת מעקב ל${customerName} בוואטסאפ`,
                priority: (lead.score || 0) >= 70 ? 'high' : 'medium',
                source_agent: actionMeta,
                is_dismissed: false,
                is_acted_on: false,
                created_at: new Date().toISOString(),
                linked_business: businessProfileId,
              },
            });
          }
        }

      } catch (_) {}
    }

    const total = nurtured + markedCold;
    await writeAutomationLog('smartLeadNurture', businessProfileId, startTime, total);
    console.log(`smartLeadNurture done: ${nurtured} nurtured, ${markedCold} marked cold`);
    return res.json({ leads_processed: total, nurtured, marked_cold: markedCold });
  } catch (err: any) {
    console.error('smartLeadNurture error:', err.message);
    await writeAutomationLog('smartLeadNurture', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
