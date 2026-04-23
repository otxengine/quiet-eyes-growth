import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { leadId, businessProfileId } = body;
  if (!leadId) return Response.json({ error: 'Missing leadId' }, { status: 400 });

  const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
  const profile = profiles[0];
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const leads = await base44.entities.Lead.filter({ linked_business: profile.id });
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });

  const tone = profile.tone_preference || 'friendly';
  const toneGuide = {
    friendly: 'casual, warm, use name, maybe an emoji',
    formal: 'professional but approachable',
    direct: 'straight to the offer, clear next step',
    humorous: 'light and friendly opening',
  };

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Write a first-contact WhatsApp message from ${profile.name} to a potential customer.
Business: ${profile.name}, Category: ${profile.category}
Tone: ${tone}

Lead details:
Name: ${lead.name}
Looking for: ${lead.service_needed || 'שירות כללי'}
Budget: ${lead.budget_range || 'לא צוין'}
Urgency: ${lead.urgency || 'לא צוין'}

The message should:
- Be warm and personal (not salesy)
- Mention their specific need
- Show you understand what they're looking for
- Offer to help / invite for a consultation
- Include a question to start a conversation
- Be suitable for WhatsApp (short, casual)

Tone guidelines: ${toneGuide[tone] || toneGuide.friendly}
3-4 lines max. Hebrew only. Return ONLY the message text.`
  });

  return Response.json({ message: result?.trim() || '' });
});