import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { event, data } = body;

  if (!data || data.impact_level !== 'high') {
    return Response.json({ skipped: true, reason: 'Not high impact' });
  }

  // Get the business profile to find the owner
  const profileId = data.linked_business;
  if (!profileId) {
    return Response.json({ skipped: true, reason: 'No linked business' });
  }

  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) {
    return Response.json({ skipped: true, reason: 'Business profile not found' });
  }

  // Find the user who owns this business
  const users = await base44.asServiceRole.entities.User.filter({ email: profile.created_by });
  const owner = users[0];
  if (!owner) {
    return Response.json({ skipped: true, reason: 'Owner not found' });
  }

  const categoryLabels = {
    threat: '⚠️ איום',
    opportunity: '🟢 הזדמנות',
    trend: '📈 מגמה',
    competitor_move: '🏪 מהלך מתחרה',
  };

  const categoryLabel = categoryLabels[data.category] || 'התראה';

  const subject = `${categoryLabel} בהשפעה גבוהה — ${profile.name}`;
  const body_html = `
<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #111; color: white; padding: 20px; border-radius: 12px 12px 0 0;">
    <h2 style="margin: 0;">🔔 התראה דחופה</h2>
    <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">${profile.name}</p>
  </div>
  <div style="background: #fff; border: 1px solid #eee; padding: 24px; border-radius: 0 0 12px 12px;">
    <div style="background: #fef2f2; border-right: 4px solid #dc2626; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
      <strong style="color: #dc2626; font-size: 13px;">${categoryLabel} — השפעה גבוהה</strong>
      <p style="margin: 8px 0 0; color: #333; font-size: 15px; line-height: 1.6;">${data.summary}</p>
    </div>
    ${data.recommended_action ? `
    <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
      <strong style="color: #555; font-size: 12px;">🎯 פעולה מומלצת:</strong>
      <p style="margin: 6px 0 0; color: #333; font-size: 14px; line-height: 1.5;">${data.recommended_action}</p>
    </div>` : ''}
    <p style="color: #999; font-size: 12px; margin-top: 20px;">התראה זו נשלחה אוטומטית ממערכת המודיעין העסקי שלך.</p>
  </div>
</div>`;

  await base44.asServiceRole.integrations.Core.SendEmail({
    to: owner.email,
    subject,
    body: body_html,
  });

  console.log(`Alert sent to ${owner.email} for signal: ${data.summary}`);

  return Response.json({ sent: true, to: owner.email, signal: data.summary });
});