import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { alert_type, data, linked_business } = body;

  if (!linked_business || !alert_type) {
    return Response.json({ error: 'Missing alert_type or linked_business' }, { status: 400 });
  }

  // Fetch business profile
  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === linked_business);
  if (!profile) {
    return Response.json({ skipped: true, reason: 'profile not found' });
  }
  if (!profile.wa_alert_phone && alert_type !== 'win_back') {
    return Response.json({ skipped: true, reason: 'no WhatsApp number configured' });
  }

  // Check if this alert type is enabled
  if (alert_type === 'negative_review' && profile.wa_alert_negative_review === false) {
    return Response.json({ skipped: true, reason: 'negative review alerts disabled' });
  }
  if (alert_type === 'hot_lead' && profile.wa_alert_hot_lead === false) {
    return Response.json({ skipped: true, reason: 'hot lead alerts disabled' });
  }
  if (alert_type === 'high_impact_signal' && !profile.wa_alert_high_impact) {
    return Response.json({ skipped: true, reason: 'high impact alerts disabled' });
  }

  let message = '';

  if (alert_type === 'negative_review' && data) {
    message = `⚠️ ביקורת שלילית חדשה ב-${data.platform || 'לא ידוע'}\n${data.reviewer_name || 'לקוח'} נתן ${data.rating} כוכבים:\n'${(data.text || '').substring(0, 80)}...'\n→ כנס ל-QuietEyes כדי להגיב`;
  } else if (alert_type === 'hot_lead' && data) {
    message = `🔥 ליד חם חדש!\n${data.name || 'לקוח'} מחפש ${data.service_needed || 'שירות'}\nתקציב: ${data.budget_range || 'לא ידוע'} · דחיפות: ${data.urgency || 'לא ידוע'}\n→ כנס ל-QuietEyes לפרטים`;
  } else if (alert_type === 'high_impact_signal' && data) {
    message = `📊 תובנה חשובה:\n${data.summary || ''}\n${data.recommended_action || ''}\n→ כנס ל-QuietEyes`;
  } else if (alert_type === 'win_back' && data) {
    message = data.message || `שלום ${data.lead_name || 'לקוח'}, מתגעגעים אליך! אנחנו כאן אם תצטרך שירות נוסף.`;
  } else {
    return Response.json({ skipped: true, reason: 'unknown alert type or missing data' });
  }

  // Format phone — win_back uses recipient's phone, others use owner's alert phone
  const rawPhone = (alert_type === 'win_back' && data?.phone) ? data.phone : profile.wa_alert_phone;
  if (!rawPhone) return Response.json({ skipped: true, reason: 'no phone available' });
  const phone = rawPhone.replace(/[\s\-]/g, '');
  const waPhone = phone.startsWith('0') ? '972' + phone.substring(1) : phone.startsWith('+972') ? phone.substring(1) : phone;
  const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;

  // Save pending alert
  await base44.asServiceRole.entities.PendingAlert.create({
    alert_type,
    message,
    whatsapp_url: waUrl,
    phone: rawPhone,
    is_sent: false,
    linked_business: profile.id,
  });

  console.log(`WhatsApp alert created: ${alert_type} for ${profile.name}`);
  return Response.json({ created: true, alert_type, whatsapp_url: waUrl });
});