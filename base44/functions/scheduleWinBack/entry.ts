import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));

  const { businessProfileId } = body;

  let profile: any;
  if (businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === businessProfileId);
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No profile' }, { status: 404 });

  // לקוחות שסיימו לפני 60-90 יום ולא חזרו
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600000).toISOString();

  const allLeads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id });

  const winBackCandidates = allLeads.filter((l: any) => {
    const completedAt = l.closed_at || l.lifecycle_updated_at || l.created_at || '';
    return (l.lifecycle_stage === 'closed_won' || l.status === 'completed')
      && completedAt >= ninetyDaysAgo
      && completedAt < sixtyDaysAgo;
  });

  let sent = 0;
  const errors: string[] = [];

  for (const lead of winBackCandidates.slice(0, 10)) {
    const phoneMatch = lead.contact_info?.match(/[\d\-+()]{7,}/);
    const phone = phoneMatch?.[0];
    if (!phone) continue;

    try {
      const message = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `כתוב הודעת WhatsApp קצרה ואישית ל-${lead.name} מהעסק "${profile.name}".
הלקוח קיבל שירות לפני כ-60 יום (${lead.service_needed || 'שירות'}).
המטרה: לחזור לקשר, להציע שירות נוסף, לא להיות לחצן.
סגנון: ${profile.tone_preference || 'ידידותי'}, לא יותר מ-3 שורות.
אל תמציא פרטים. אל תבטיח הנחות שלא מאושרות.`
      });

      if (!message) continue;

      await base44.asServiceRole.functions.invoke('sendWhatsAppAlert', {
        alert_type: 'win_back',
        linked_business: profile.id,
        data: { phone, message, lead_name: lead.name },
      });

      // עדכן lead שנשלחה הודעת win-back
      await base44.asServiceRole.entities.Lead.update(lead.id, {
        notes: (lead.notes || '') + `\n[${new Date().toLocaleDateString('he-IL')}] נשלחה הודעת חזרה`,
      });
      sent++;
    } catch (err) {
      console.error(`Win-back error for ${lead.name}:`, err.message);
      errors.push(lead.name);
    }
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'scheduleWinBack',
      start_time: new Date(Date.now() - 3000).toISOString(),
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: sent,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`scheduleWinBack: ${sent} הודעות נשלחו מתוך ${winBackCandidates.length} מועמדים`);
  return Response.json({
    win_back_sent: sent,
    candidates_found: winBackCandidates.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});
