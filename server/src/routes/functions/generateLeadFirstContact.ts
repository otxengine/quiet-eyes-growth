import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

export async function generateLeadFirstContact(req: Request, res: Response) {
  const { leadId, businessProfileId } = req.body;
  if (!leadId) return res.status(400).json({ error: 'Missing leadId' });

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const bpId = businessProfileId || lead.linked_business;
    const profiles = await prisma.businessProfile.findMany({ where: { id: bpId } });
    const bp = profiles[0];

    const prompt = `כתוב הודעת WhatsApp ראשונה קצרה ואישית ל-${lead.name}.
עסק: ${bp?.name || 'העסק שלנו'}
שירות שמבקש: ${lead.service_needed || 'לא צוין'}
עיר: ${lead.city || bp?.city || ''}
סגנון: ${bp?.tone_preference || 'ידידותי'}, לא יותר מ-3 שורות.
אל תבטיח הנחות. אל תמציא פרטים. היה אנושי ומקצועי.
החזר את ההודעה בלבד, ללא הסברים.`;

    const message = await invokeLLM({ prompt });

    return res.json({ message: typeof message === 'string' ? message : JSON.stringify(message) });
  } catch (err: any) {
    console.error('generateLeadFirstContact error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
