import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find(p => p.id === body.businessProfileId);
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const startTime = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Gather weekly data
  const [signals, competitors, reviews, leads] = await Promise.all([
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: profile.id }, '-detected_at', 100),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
    base44.asServiceRole.entities.Review.filter({ linked_business: profile.id }, '-created_date', 100),
    base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id }, '-created_date', 100),
  ]);

  const weekSignals = signals.filter(s => (s.detected_at || s.created_date) >= weekAgo);
  const weekReviews = reviews.filter(r => (r.created_at || r.created_date) >= weekAgo);
  const weekLeads = leads.filter(l => (l.created_at || l.created_date) >= weekAgo);

  const threats = weekSignals.filter(s => s.category === 'threat').length;
  const opportunities = weekSignals.filter(s => s.category === 'opportunity').length;
  const trends = weekSignals.filter(s => s.category === 'trend').length;
  const mentions = weekSignals.filter(s => s.category === 'mention').length;
  const compMoves = weekSignals.filter(s => s.category === 'competitor_move').length;

  const posReviews = weekReviews.filter(r => r.sentiment === 'positive').length;
  const negReviews = weekReviews.filter(r => r.sentiment === 'negative').length;
  const avgRating = weekReviews.length > 0 ? (weekReviews.reduce((s, r) => s + (r.rating || 0), 0) / weekReviews.length).toFixed(1) : 'אין';

  const hotLeads = weekLeads.filter(l => l.status === 'hot').length;
  const warmLeads = weekLeads.filter(l => l.status === 'warm').length;

  const topInsight = weekSignals.filter(s => s.impact_level === 'high')[0]?.summary || 'אין תובנות בהשפעה גבוהה';
  const topCompMove = weekSignals.filter(s => s.category === 'competitor_move')[0]?.summary || 'אין שינויים';

  // Price changes this week
  const priceChanges = competitors.filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);

  const services = weekLeads.map(l => l.service_needed).filter(Boolean);
  const topService = services.length > 0
    ? [...services].sort((a, b) => services.filter(s => s === b).length - services.filter(s => s === a).length)[0]
    : 'לא זוהה';

  let llmResult: any = null;
  try {
  llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `Create a weekly intelligence briefing for ${profile.name}, a ${profile.category} in ${profile.city}.

DATA FROM THIS WEEK:
Insights: ${weekSignals.length} total (${threats} threats, ${opportunities} opportunities, ${trends} trends, ${mentions} mentions, ${compMoves} competitor moves)
Top insight: ${topInsight}
Competitors: ${priceChanges.length} price changes
Top competitor move: ${topCompMove}
Reviews: ${weekReviews.length} new (${posReviews} positive, ${negReviews} negative)
Average rating this week: ${avgRating}
Leads: ${weekLeads.length} new (${hotLeads} hot, ${warmLeads} warm)
Most requested service: ${topService}

Write a concise weekly briefing in Hebrew with:
- headline: one-line summary of the week (bold)
- key_insights: the 3 most important things to know (array of strings)
- actions: 2-3 specific actions to take this week (array of strings)
- weekly_score: rate the week 1-10 for the business (10 = great week, 1 = urgent attention needed)

Keep it SHORT. Written like a personal briefing from an advisor.
Hebrew only. Natural tone.`,
    response_json_schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        key_insights: { type: "array", items: { type: "string" } },
        actions: { type: "array", items: { type: "string" } },
        weekly_score: { type: "number" }
      }
    }
  });
  } catch (err) {
    console.error('generateWeeklyReport LLM error:', err.message);
  }

  const { headline, key_insights = [], actions = [], weekly_score = 5 } = llmResult || {};

  // Build report text
  let reportText = `**${headline || 'דוח שבועי'}**\n\n`;
  reportText += `## 3 תובנות מרכזיות\n`;
  key_insights.forEach((ins, i) => { reportText += `${i + 1}. ${ins}\n`; });
  reportText += `\n## מה לעשות השבוע\n`;
  actions.forEach((act, i) => { reportText += `${i + 1}. ${act}\n`; });
  reportText += `\n**ציון שבועי: ${weekly_score}/10**`;

  // Save report
  await base44.asServiceRole.entities.WeeklyReport.create({
    report_text: reportText,
    headline: headline || 'דוח שבועי',
    week_start: weekStart.toISOString(),
    week_end: now.toISOString(),
    weekly_score: weekly_score,
    insights_count: weekSignals.length,
    reviews_count: weekReviews.length,
    leads_count: weekLeads.length,
    linked_business: profile.id,
  });

  // Create notification signal
  const impactLevel = weekly_score < 5 ? 'high' : weekly_score <= 7 ? 'medium' : 'low';
  await base44.asServiceRole.entities.MarketSignal.create({
    summary: `דוח שבועי מוכן — ציון: ${weekly_score}/10`,
    impact_level: impactLevel,
    category: 'trend',
    recommended_action: headline || '',
    confidence: 90,
    is_read: false,
    detected_at: now.toISOString(),
    linked_business: profile.id,
  });

  // WhatsApp alert if enabled
  if (profile.wa_alert_phone && profile.weekly_report) {
    const phone = profile.wa_alert_phone.replace(/[\s\-]/g, '').replace(/^0/, '972');
    const shortMsg = `📊 דוח שבועי — ${profile.name}\n${headline}\nציון: ${weekly_score}/10\n\n${key_insights.slice(0, 2).join('\n')}\n\nכנס ל-QuietEyes לדוח המלא ←`;
    await base44.asServiceRole.entities.PendingAlert.create({
      alert_type: 'high_impact_signal',
      message: shortMsg,
      whatsapp_url: `https://wa.me/${phone}?text=${encodeURIComponent(shortMsg)}`,
      phone,
      is_sent: false,
      linked_business: profile.id,
    });
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'generateWeeklyReport',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: 1,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`generateWeeklyReport: score=${weekly_score}, signals=${weekSignals.length}`);
  return Response.json({ weekly_score, insights_count: weekSignals.length, reviews_count: weekReviews.length, leads_count: weekLeads.length });
});