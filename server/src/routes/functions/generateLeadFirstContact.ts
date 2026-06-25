import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { getAgentMission, getAllMissions } from '../../lib/missionPlanner';

export async function generateLeadFirstContact(req: Request, res: Response) {
  const { leadId, businessProfileId } = req.body;
  if (!leadId) return res.status(400).json({ error: 'Missing leadId' });

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const bpId = businessProfileId || lead.linked_business;
    const profiles = await prisma.businessProfile.findMany({ where: { id: bpId } });
    const bp = profiles[0];
    if (!bp) return res.status(404).json({ error: 'Business not found' });

    // Mission intelligence: get nurture + content templates
    const nurtureMission = getAgentMission<{
      tone_he?: string;
      value_propositions_he?: string[];
      qualify_criteria_he?: string;
      best_contact_time_he?: string;
    }>(bp, 'smartLeadNurture');
    const allMissions = getAllMissions(bp);
    const contentTemplates = allMissions?.content;
    const leadMission = getAgentMission<{
      qualify_criteria_he?: string;
    }>(bp, 'runLeadGeneration');

    // Channel-specific templates from GPT-4o content layer
    const whatsappTemplate = contentTemplates?.first_contact_templates_he?.whatsapp || '';
    const emailTemplate    = contentTemplates?.first_contact_templates_he?.email    || '';
    const linkedinTemplate = contentTemplates?.first_contact_templates_he?.linkedin || '';

    // Determine channel from lead source / request
    const channel = (req.body.channel || lead.source || '').toLowerCase().includes('linkedin')
      ? 'linkedin'
      : (req.body.channel || '').toLowerCase().includes('email')
      ? 'email'
      : 'whatsapp';

    const templateMap: Record<string, string> = { whatsapp: whatsappTemplate, email: emailTemplate, linkedin: linkedinTemplate };
    const channelTemplate = templateMap[channel] || whatsappTemplate;

    const missionTone = nurtureMission?.tone_he || bp.tone_preference || 'ידידותי ומקצועי';
    const valueProps = (nurtureMission?.value_propositions_he || []).join(' | ') || '';

    // Lead intelligence: score, urgency, source
    const scoreLabel = (lead.score || 0) >= 70 ? 'ליד איכותי מאוד' : (lead.score || 0) >= 40 ? 'ליד בינוני' : 'ליד ראשוני';
    const urgencyLabel = lead.urgency || '';
    const budgetLabel  = lead.budget_range || '';

    const prompt = `You are writing a first-contact ${channel} message for an Israeli business. This is the most important message — it sets the tone for the entire relationship.

Lead details:
- Name: ${lead.name || 'לקוח'}
- Service requested: ${lead.service_needed || 'לא צוין'}
- City: ${lead.city || bp.city}
- Lead quality: ${scoreLabel}${urgencyLabel ? ` | Urgency: ${urgencyLabel}` : ''}${budgetLabel ? ` | Budget: ${budgetLabel}` : ''}
- Source: ${lead.source || 'חיפוש אינטרנט'}

Communication requirements:
- Channel: ${channel}
- Tone: ${missionTone}
${valueProps ? `- Business value propositions (weave one in naturally): ${valueProps}` : ''}
${nurtureMission?.best_contact_time_he ? `- Best contact time for this sector: ${nurtureMission.best_contact_time_he}` : ''}
${channelTemplate ? `- Style baseline (DO NOT copy, use as inspiration only): "${channelTemplate}"` : ''}

Message rules:
1. Open with their name + the exact thing they wanted (not "שלום, ראיתי שאתם מתעניינים")
2. One sentence: why they should talk to THIS business specifically (sector-specific value, not generic)
3. One clear, easy next step (not "ניצור קשר" — be specific)
4. ${channel === 'whatsapp' ? 'Max 3 lines, conversational, no salesy language' : channel === 'email' ? 'Max 5 lines, clear subject line, professional but warm' : 'Max 4 lines, LinkedIn-professional, show expertise'}
5. Do NOT promise discounts. Do NOT invent details. Do NOT use generic phrases like "אשמח לעזור".

Return ONLY the final message text in Hebrew. No explanations.`;

    const message = await invokeLLM({ prompt, profile: bp, model: 'sonnet', maxTokens: 200, skipCache: true });

    const messageText = typeof message === 'string' ? message.trim() : JSON.stringify(message);
    return res.json({ message: messageText, channel });
  } catch (err: any) {
    console.error('generateLeadFirstContact error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
