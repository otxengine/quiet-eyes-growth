import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // This function is called by entity automation when a lead is created
    const { event, data } = body;

    if (!data || !data.linked_business) {
      return Response.json({ skipped: true, reason: 'No linked business' });
    }

    // Get the business profile
    let profile;
    try {
      const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: data.linked_business });
      profile = profiles?.[0];
    } catch (e) {
      return Response.json({ skipped: true, reason: 'Could not fetch business profile' });
    }

    if (!profile) {
      return Response.json({ skipped: true, reason: 'Business profile not found' });
    }

    // Check if push alerts are enabled
    const emailEnabled = profile.push_email_alerts === true;
    const whatsappEnabled = profile.push_whatsapp_alerts === true;

    if (!emailEnabled && !whatsappEnabled) {
      return Response.json({ skipped: true, reason: 'Push alerts not enabled' });
    }

    // Check minimum score threshold
    const minScore = profile.push_min_score || 80;
    const leadScore = data.score || 0;

    if (leadScore < minScore) {
      return Response.json({ skipped: true, reason: `Score ${leadScore} below threshold ${minScore}` });
    }

    // Check if lead is hot
    if (data.status !== 'hot') {
      return Response.json({ skipped: true, reason: 'Lead is not hot' });
    }

    const results = { email: null, whatsapp: null };

    // Send email alert
    if (emailEnabled) {
      const ownerEmail = profile.created_by;
      if (ownerEmail) {
        const phoneMatch = data.contact_info?.match(/[\d\-+()]{7,}/);
        const phone = phoneMatch ? phoneMatch[0] : null;
        const phoneLink = phone ? `<a href="tel:${phone}" style="color:#10b981;font-weight:bold;">📞 ${phone}</a>` : '';
        const whatsappLink = phone
          ? `<a href="https://wa.me/${phone.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(`שלום ${data.name}, פונה אליך בנוגע ל${data.service_needed || 'שירות שביקשת'}. אשמח לעזור!`)}" style="color:#10b981;font-weight:bold;">💬 שלח וואטסאפ</a>`
          : '';

        const emailBody = `
          <div style="font-family:Arial,sans-serif;direction:rtl;max-width:500px;margin:0 auto;padding:20px;">
            <div style="background:#f0fdf8;border:1px solid #d1fae5;border-radius:10px;padding:16px;margin-bottom:16px;">
              <h2 style="margin:0 0 8px 0;color:#111;font-size:18px;">🔥 ליד חם חדש!</h2>
              <p style="margin:0;color:#666;font-size:14px;">ליד עם ניקוד ${leadScore} נכנס למערכת — צור קשר עכשיו</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#999;width:100px;">שם:</td><td style="padding:8px 0;color:#222;font-weight:bold;">${data.name || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#999;">ניקוד:</td><td style="padding:8px 0;color:#10b981;font-weight:bold;font-size:18px;">${leadScore}</td></tr>
              ${data.service_needed ? `<tr><td style="padding:8px 0;color:#999;">שירות:</td><td style="padding:8px 0;color:#222;">${data.service_needed}</td></tr>` : ''}
              ${data.budget_range ? `<tr><td style="padding:8px 0;color:#999;">תקציב:</td><td style="padding:8px 0;color:#222;">${data.budget_range}</td></tr>` : ''}
              ${data.city ? `<tr><td style="padding:8px 0;color:#999;">עיר:</td><td style="padding:8px 0;color:#222;">${data.city}</td></tr>` : ''}
              ${data.urgency ? `<tr><td style="padding:8px 0;color:#999;">דחיפות:</td><td style="padding:8px 0;color:#222;">${data.urgency}</td></tr>` : ''}
              ${data.source ? `<tr><td style="padding:8px 0;color:#999;">מקור:</td><td style="padding:8px 0;color:#222;">${data.source}</td></tr>` : ''}
              ${phone ? `<tr><td style="padding:8px 0;color:#999;">טלפון:</td><td style="padding:8px 0;">${phoneLink}</td></tr>` : ''}
            </table>
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid #f0f0f0;text-align:center;">
              ${phone ? `<div style="margin-bottom:8px;">${whatsappLink}</div>` : ''}
              <p style="color:#ccc;font-size:11px;margin:8px 0 0 0;">QuietEyes · התראת ליד חם בזמן אמת</p>
            </div>
          </div>
        `;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: ownerEmail,
          subject: `🔥 ליד חם חדש: ${data.name} (ניקוד ${leadScore})`,
          body: emailBody,
          from_name: 'QuietEyes'
        });
        results.email = 'sent';
      }
    }

    // Prepare WhatsApp notification info
    if (whatsappEnabled && profile.push_whatsapp_number) {
      // We store that a WhatsApp notification should be sent — 
      // the actual WhatsApp message link is generated on the frontend
      results.whatsapp = 'ready';
    }

    return Response.json({ success: true, results, leadName: data.name, leadScore });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});