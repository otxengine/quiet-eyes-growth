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

    const prompt = `Write a short, personal opening WhatsApp message to ${lead.name}.
Business: ${bp?.name || 'העסק שלנו'}
Service requested: ${lead.service_needed || 'לא צוין'}
City: ${lead.city || bp?.city || ''}
Style: ${bp?.tone_preference || 'ידידותי'}, no more than 3 lines.
Do not promise discounts. Do not invent details. Be human and professional.
Return the message text only, no explanations. ALL string values must be in Hebrew.`;

    const message = await invokeLLM({ prompt });

    return res.json({ message: typeof message === 'string' ? message : JSON.stringify(message) });
  } catch (err: any) {
    console.error('generateLeadFirstContact error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
