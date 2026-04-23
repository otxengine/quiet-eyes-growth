import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();
  let profile;

  if (body.businessProfileId) {
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: body.businessProfileId });
    profile = profiles[0];
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const bpId = profile.id;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [reviews, leads, competitors, signals, outcomes] = await Promise.all([
    base44.asServiceRole.entities.Review.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Lead.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 50),
    base44.asServiceRole.entities.OutcomeLog.filter({ linked_business: bpId }, '-created_at', 30),
  ]);

  // Reputation Score (0-100)
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;
  const pendingReviews = reviews.filter(r => r.response_status === 'pending').length;
  const negativeRatio = reviews.length > 0 ? reviews.filter(r => r.sentiment === 'negative').length / reviews.length : 0;
  let reputationScore = Math.min(100, Math.round(
    (avgRating / 5 * 40) + 
    (Math.max(0, 1 - pendingReviews / 5) * 30) + 
    (Math.max(0, 1 - negativeRatio) * 30)
  ));
  if (reviews.length === 0) reputationScore = 50;

  // Leads Score (0-100)
  const recentLeads = leads.filter(l => (l.created_at || l.created_date) >= weekAgo);
  const hotLeads = leads.filter(l => l.status === 'hot');
  const conversionRate = leads.length > 0 ? hotLeads.length / leads.length : 0;
  let leadsScore = Math.min(100, Math.round(
    (Math.min(recentLeads.length, 10) / 10 * 40) + 
    (conversionRate * 30) + 
    (Math.min(hotLeads.length, 5) / 5 * 30)
  ));
  if (leads.length === 0) leadsScore = 30;

  // Competition Score (0-100) — higher = better positioned
  const compAvgRating = competitors.length > 0 ? competitors.reduce((s, c) => s + (c.rating || 0), 0) / competitors.length : 0;
  const ratingAdvantage = avgRating > 0 ? Math.max(0, (avgRating - compAvgRating + 1) / 2) : 0.5;
  let competitionScore = Math.min(100, Math.round(
    (ratingAdvantage * 50) + 
    (Math.min(competitors.length, 5) / 5 * 25) + 
    25
  ));
  if (competitors.length === 0) competitionScore = 50;

  // Market Score (0-100)
  const recentSignals = signals.filter(s => (s.detected_at || s.created_date) >= weekAgo);
  const opportunities = signals.filter(s => s.category === 'opportunity');
  const threats = signals.filter(s => s.category === 'threat');
  let marketScore = Math.min(100, Math.round(
    (Math.min(recentSignals.length, 10) / 10 * 30) + 
    (Math.min(opportunities.length, 5) / 5 * 40) + 
    (Math.max(0, 1 - threats.length / Math.max(signals.length, 1)) * 30)
  ));
  if (signals.length === 0) marketScore = 40;

  // Engagement Score (0-100)
  const actedOutcomes = outcomes.filter(o => o.was_accepted === true);
  const engagementRate = outcomes.length > 0 ? actedOutcomes.length / outcomes.length : 0;
  const channelsEnabled = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'website']
    .filter(ch => profile[`channels_${ch}_enabled`]).length;
  let engagementScore = Math.min(100, Math.round(
    (engagementRate * 40) + 
    (channelsEnabled / 5 * 30) + 
    (profile.bot_enabled ? 30 : 10)
  ));

  // Overall
  const overallScore = Math.round(
    reputationScore * 0.25 + leadsScore * 0.25 + competitionScore * 0.15 + marketScore * 0.2 + engagementScore * 0.15
  );

  // Generate improvement suggestions
  const improvements = [];
  if (pendingReviews > 2) improvements.push({ area: 'reputation', text: `יש ${pendingReviews} ביקורות ממתינות לתגובה`, priority: 'high' });
  if (hotLeads.length === 0) improvements.push({ area: 'leads', text: 'אין לידים חמים — שקול להפעיל קמפיין', priority: 'high' });
  if (channelsEnabled < 2) improvements.push({ area: 'engagement', text: 'חבר עוד ערוצים תקשורת', priority: 'medium' });
  if (competitors.length === 0) improvements.push({ area: 'competition', text: 'הפעל סריקת מתחרים', priority: 'medium' });
  if (!profile.bot_enabled) improvements.push({ area: 'engagement', text: 'הפעל את הבוט לטיפול אוטומטי בלידים', priority: 'medium' });
  if (negativeRatio > 0.3) improvements.push({ area: 'reputation', text: 'שיעור גבוה של ביקורות שליליות — נדרש טיפול', priority: 'critical' });

  // Save snapshot
  const existing = await base44.asServiceRole.entities.HealthScore.filter({ linked_business: bpId });
  const scoreData = {
    linked_business: bpId,
    overall_score: overallScore,
    reputation_score: reputationScore,
    leads_score: leadsScore,
    competition_score: competitionScore,
    market_score: marketScore,
    engagement_score: engagementScore,
    improvements: JSON.stringify(improvements),
    snapshot_date: new Date().toISOString(),
  };

  if (existing.length > 0) {
    await base44.asServiceRole.entities.HealthScore.update(existing[0].id, scoreData);
  } else {
    await base44.asServiceRole.entities.HealthScore.create(scoreData);
  }

  console.log(`calculateHealthScore complete: overall=${overallScore}`);

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'calculateHealthScore',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: 1,
      linked_business: bpId,
    });
  } catch (_) {}

  return Response.json({ ...scoreData, improvements });
});