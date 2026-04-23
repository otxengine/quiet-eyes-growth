import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const { event, data } = body;

  // Only handle new review creation
  if (!event || event.type !== 'create' || !data) {
    return Response.json({ skipped: true, reason: 'not a create event' });
  }

  const review = data;
  if (!review.linked_business) {
    return Response.json({ skipped: true, reason: 'no linked business' });
  }

  // Fetch business profile
  const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
  const profile = profiles.find(p => p.id === review.linked_business);
  if (!profile) {
    return Response.json({ skipped: true, reason: 'profile not found' });
  }

  // NEVER auto-respond to negative reviews
  if (review.sentiment === 'negative' || (review.rating && review.rating <= 3)) {
    // But trigger WhatsApp alert for negative reviews (1-2 stars)
    if ((review.rating && review.rating <= 2) && profile.wa_alert_negative_review !== false && profile.wa_alert_phone) {
      const alertMsg = `⚠️ ביקורת שלילית חדשה ב-${review.platform || 'לא ידוע'}\n${review.reviewer_name || 'לקוח'} נתן ${review.rating} כוכבים:\n'${(review.text || '').substring(0, 80)}...'\n→ כנס ל-QuietEyes כדי להגיב`;
      const phone = profile.wa_alert_phone.replace(/[\s\-]/g, '');
      const waPhone = phone.startsWith('0') ? '972' + phone.substring(1) : phone.startsWith('+972') ? phone.substring(1) : phone;
      const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(alertMsg)}`;
      await base44.asServiceRole.entities.PendingAlert.create({
        alert_type: 'negative_review',
        message: alertMsg,
        whatsapp_url: waUrl,
        phone: profile.wa_alert_phone,
        is_sent: false,
        linked_business: profile.id,
      });
    }
    return Response.json({ skipped: true, reason: 'negative review — manual response required' });
  }

  // Check if auto-respond is enabled
  if (!profile.auto_respond_enabled) {
    return Response.json({ skipped: true, reason: 'auto-respond disabled' });
  }

  // Check rating threshold
  const minRating = profile.auto_respond_min_rating || 5;
  if (!review.rating || review.rating < minRating) {
    return Response.json({ skipped: true, reason: `rating ${review.rating} below threshold ${minRating}` });
  }

  // Already responded
  if (review.response_status === 'responded' || review.response_status === 'auto_responded') {
    return Response.json({ skipped: true, reason: 'already responded' });
  }

  // Generate auto-response
  const tone = profile.tone_preference || 'friendly';
  const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are writing a thank-you response for a positive review.
Business: ${profile.name}, Category: ${profile.category}
Tone: ${tone}
Reviewer: ${review.reviewer_name || 'לקוח'}
Rating: ${review.rating} stars
Review: ${review.text}

Write a warm thank-you response in Hebrew that:
- Thanks the reviewer by name
- References something SPECIFIC from their review
- Invites them to visit again or try something new
- Feels genuine, not template-like

Tone guidelines:
If tone is 'friendly': warm, personal, with emojis
If tone is 'formal': professional, respectful
If tone is 'direct': short, to the point
If tone is 'humorous': light humor, fun

2 sentences max. Hebrew only. Return ONLY the response text.`,
  });

  const responseText = response.trim();
  if (!responseText) {
    return Response.json({ skipped: true, reason: 'empty LLM response' });
  }

  // Save response
  await base44.asServiceRole.entities.Review.update(event.entity_id, {
    suggested_response: responseText,
    response_status: 'auto_responded',
  });

  // Notify if enabled
  if (profile.auto_respond_notify !== false) {
    await base44.asServiceRole.entities.MarketSignal.create({
      summary: `תגובה אוטומטית נשלחה ל-${review.reviewer_name || 'לקוח'} (${review.rating}⭐)`,
      category: 'trend',
      impact_level: 'low',
      recommended_action: `בדוק את התגובה האוטומטית בעמוד המוניטין`,
      confidence: 90,
      is_read: false,
      detected_at: new Date().toISOString(),
      linked_business: profile.id,
    });
  }

  console.log(`Auto-responded to review by ${review.reviewer_name}, rating: ${review.rating}`);
  return Response.json({ auto_responded: true, reviewer: review.reviewer_name });
});