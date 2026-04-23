import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));

  // Called by entity automation when lead status changes to 'completed'
  const { event, data } = body;
  if (!data) return Response.json({ skipped: true, reason: 'no data' });

  const lead = data;
  if (lead.status !== 'completed') return Response.json({ skipped: true, reason: 'not completed' });
  if (!lead.linked_business) return Response.json({ skipped: true, reason: 'no business' });

  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === lead.linked_business);
  if (!profile) return Response.json({ skipped: true, reason: 'profile not found' });

  const phoneMatch = lead.contact_info?.match(/[\d\-+()]{7,}/);
  const phone = phoneMatch ? phoneMatch[0] : null;
  if (!phone) return Response.json({ skipped: true, reason: 'no phone' });

  const tone = profile.tone_preference || 'friendly';
  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `Write a WhatsApp message asking ${lead.name} to leave a review for ${profile.name} after they received ${lead.service_needed || 'שירות'}.
Tone: ${tone}

The message should:
- Thank them for choosing ${profile.name}
- Reference the specific service they got
- Ask nicely for a review
- Include a placeholder for the review link [LINK]
- Be 3-4 lines max, casual WhatsApp style

Hebrew only. Return ONLY the message text.`
  });

  const msg = (result || '').trim();
  if (!msg) return Response.json({ skipped: true, reason: 'no message generated' });

  const cleanPhone = phone.replace(/[\s\-]/g, '').replace(/^0/, '972');
  const triggerDate = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  await base44.asServiceRole.entities.PendingAlert.create({
    alert_type: 'review_request',
    customer_name: lead.name,
    phone: cleanPhone,
    message: msg,
    whatsapp_url: `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`,
    trigger_date: triggerDate,
    is_sent: false,
    linked_business: profile.id,
  });

  console.log(`Review request scheduled for ${lead.name} in 72h`);
  return Response.json({ scheduled: true, customer: lead.name, trigger_date: triggerDate });
});