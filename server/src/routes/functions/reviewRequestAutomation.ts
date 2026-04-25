import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';

/**
 * reviewRequestAutomation — finds closed/won leads that haven't received a
 * review request in the last 30 days, generates a personalized Hebrew WhatsApp
 * message, creates a ReviewRequest record, and queues a PendingAlert.
 */
export async function reviewRequestAutomation(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    // Load business tone
    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = tone === 'casual'
      ? 'טון קליל וחברותי, תחושה אישית'
      : tone === 'warm'
      ? 'טון חם ואנושי, מבלי להיות מכירתי'
      : 'טון מקצועי ואמין';

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

    // Find recently closed leads with a phone number
    const closedLeads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: 'closed_won',
        contact_phone: { not: null },
      },
      orderBy: { created_date: 'desc' },
      take: 20,
    });

    // Find which leads already got a review request in last 30 days
    const existingRequests = await prisma.reviewRequest.findMany({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: new Date(thirtyDaysAgo) },
      },
      select: { lead_id: true },
    });
    const requestedLeadIds = new Set(existingRequests.map(r => r.lead_id).filter(Boolean));

    const eligible = closedLeads.filter(l => !requestedLeadIds.has(l.id)).slice(0, 5);

    // Determine Google review link if available
    const googlePlaceId = profile.google_place_id;
    const reviewLink = googlePlaceId
      ? `https://search.google.com/local/writereview?placeid=${googlePlaceId}`
      : null;

    let sent = 0;

    for (const lead of eligible) {
      try {
        const customerName = lead.name || 'לקוח יקר';
        const serviceUsed = lead.service_needed || category;

        // Generate personalized review request message
        const messageResult = await invokeLLM({
          prompt: `כתוב הודעת WhatsApp קצרה בעברית (2-3 שורות) לבקשת ביקורת Google עבור העסק "${name}" (${category} ב${city}).

שם הלקוח: ${customerName}
שירות שקיבל: ${serviceUsed}
${reviewLink ? `קישור לביקורת: ${reviewLink}` : ''}

הנחיות: ${toneInstruction}. פנה בשם אם ידוע. תודה אישית על הבחירה בעסק. בקש ביקורת ב-Google בעדינות. ${reviewLink ? 'צרף את הקישור.' : ''}
כתוב רק את טקסט ההודעה בלבד.`,
        });

        const message = typeof messageResult === 'string' ? messageResult.trim() : '';
        if (!message) continue;

        const phone = lead.contact_phone || '';
        const waUrl = phone
          ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
          : null;

        // Create ReviewRequest record
        await prisma.reviewRequest.create({
          data: {
            linked_business: businessProfileId,
            customer_name: customerName,
            phone,
            platform: 'google',
            sent_via: 'whatsapp',
            status: 'sent',
            sent_at: new Date().toISOString(),
            review_link: reviewLink || null,
            lead_id: lead.id,
          },
        });

        // Queue a PendingAlert so the owner can send it with one tap
        await prisma.pendingAlert.create({
          data: {
            linked_business: businessProfileId,
            alert_type: 'review_request',
            message,
            customer_name: customerName,
            whatsapp_url: waUrl || null,
            phone,
            trigger_date: new Date().toISOString(),
            is_sent: false,
          },
        });

        // Create ProactiveAlert for the dashboard
        const actionMeta = JSON.stringify({
          action_label: `שלח ל${customerName}`,
          action_type: 'social_post',
          prefilled_text: message,
          urgency_hours: 48,
          impact_reason: 'ביקורת Google נוספת מגדילה את הנראות המקומית וממיר 15% יותר לקוחות',
        });

        await prisma.proactiveAlert.create({
          data: {
            alert_type: 'market_opportunity',
            title: `בקשת ביקורת: ${customerName}`,
            description: `${customerName} סיים טיפול — שלח בקשת ביקורת Google`,
            suggested_action: `שלח הודעת WhatsApp ל${customerName}`,
            priority: 'medium',
            source_agent: actionMeta,
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });

        sent++;
      } catch (_) {}
    }

    await writeAutomationLog('reviewRequestAutomation', businessProfileId, startTime, sent);
    console.log(`reviewRequestAutomation done: ${sent} review requests queued`);
    return res.json({ requests_sent: sent });
  } catch (err: any) {
    console.error('reviewRequestAutomation error:', err.message);
    await writeAutomationLog('reviewRequestAutomation', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
