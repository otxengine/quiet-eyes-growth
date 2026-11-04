import { Request, Response } from 'express';
import { writeAutomationLog } from '../../lib/automationLog';
import { prisma } from '../../db';

export async function calculateHealthScore(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [reviews, leads, competitors, signals, outcomes, compList] = await Promise.all([
      prisma.review.findMany({ where: { linked_business: businessProfileId } }),
      prisma.lead.findMany({ where: { linked_business: businessProfileId } }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId } }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 50 }),
      prisma.outcomeLog.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 30 }),
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, select: { rating: true, review_count: true } }),
    ]);

    const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;
    const pendingReviews = reviews.filter(r => r.response_status === 'pending').length;
    const negativeRatio = reviews.length > 0 ? reviews.filter(r => r.sentiment === 'negative').length / reviews.length : 0;
    let reputationScore = Math.min(100, Math.round(
      (avgRating / 5 * 40) + (Math.max(0, 1 - pendingReviews / 5) * 30) + (Math.max(0, 1 - negativeRatio) * 30)
    ));
    if (reviews.length === 0) reputationScore = 50;

    const recentLeads = leads.filter(l => (l.created_at || '') >= weekAgo);
    const hotLeads = leads.filter(l => l.status === 'hot');
    const conversionRate = leads.length > 0 ? hotLeads.length / leads.length : 0;
    let leadsScore = Math.min(100, Math.round(
      (Math.min(recentLeads.length, 10) / 10 * 40) + (conversionRate * 30) + (Math.min(hotLeads.length, 5) / 5 * 30)
    ));
    if (leads.length === 0) leadsScore = 30;

    const compAvgRating = competitors.length > 0 ? competitors.reduce((s, c) => s + (c.rating || 0), 0) / competitors.length : 0;
    const ratingAdvantage = avgRating > 0 ? Math.max(0, (avgRating - compAvgRating + 1) / 2) : 0.5;
    let competitionScore = Math.min(100, Math.round((ratingAdvantage * 50) + (Math.min(competitors.length, 5) / 5 * 25) + 25));
    if (competitors.length === 0) competitionScore = 50;

    const recentSignals = signals.filter(s => (s.detected_at || '') >= weekAgo);
    const opportunities = signals.filter(s => s.category === 'opportunity');
    const threats = signals.filter(s => s.category === 'threat');
    let marketScore = Math.min(100, Math.round(
      (Math.min(recentSignals.length, 10) / 10 * 30) + (Math.min(opportunities.length, 5) / 5 * 40) +
      (Math.max(0, 1 - threats.length / Math.max(signals.length, 1)) * 30)
    ));
    if (signals.length === 0) marketScore = 40;

    const actedOutcomes = outcomes.filter(o => o.was_accepted === true);
    const engagementRate = outcomes.length > 0 ? actedOutcomes.length / outcomes.length : 0;
    const channelsEnabled = ['whatsapp', 'instagram', 'facebook', 'tiktok', 'website']
      .filter(ch => (profile as any)[`channels_${ch}_enabled`]).length;
    let engagementScore = Math.min(100, Math.round(
      (engagementRate * 40) + (channelsEnabled / 5 * 30) + (profile.bot_enabled ? 30 : 10)
    ));

    // ── P1: Local SEO Score ──────────────────────────────────────────────────
    // Composite: rating (40pts) + review count (40pts) + recency (20pts)
    const googleRating      = profile.google_rating ?? avgRating;
    const googleReviewCount = profile.google_review_count ?? reviews.length;

    const ratingPts  = Math.min(40, Math.round((googleRating / 5) * 40));
    const reviewPts  = Math.min(40, Math.round(Math.log10(1 + googleReviewCount) / Math.log10(201) * 40));
    const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const recentReviewCount = reviews.filter(r => (r.created_at || '') >= oneMonthAgo).length;
    const recencyPts = Math.min(20, recentReviewCount * 4);
    const seoScore   = ratingPts + reviewPts + recencyPts;

    // Estimate competitor review median to determine gap to top-3
    const compReviewCounts = compList.map(c => c.review_count ?? 0).sort((a, b) => b - a);
    const top3CompMedian   = compReviewCounts.slice(0, 3).reduce((s, v) => s + v, 0) /
      (Math.min(3, compReviewCounts.length) || 1);
    const reviewsNeeded    = Math.max(0, Math.round(top3CompMedian - googleReviewCount));
    const googleRankEst    = googleReviewCount >= top3CompMedian ? 'Top 3' : `~${reviewsNeeded} ביקורות לTop 3`;

    const overallScore = Math.round(
      reputationScore * 0.25 + leadsScore * 0.25 + competitionScore * 0.15 + marketScore * 0.2 + engagementScore * 0.15
    );

    const improvements: any[] = [];
    if (pendingReviews > 2) improvements.push({ area: 'reputation', text: `יש ${pendingReviews} ביקורות ממתינות לתגובה`, priority: 'high' });
    if (hotLeads.length === 0) improvements.push({ area: 'leads', text: 'אין לידים חמים — שקול להפעיל קמפיין', priority: 'high' });
    if (channelsEnabled < 2) improvements.push({ area: 'engagement', text: 'חבר עוד ערוצים תקשורת', priority: 'medium' });
    if (competitors.length === 0) improvements.push({ area: 'competition', text: 'הפעל סריקת מתחרים', priority: 'medium' });
    if (!profile.bot_enabled) improvements.push({ area: 'engagement', text: 'הפעל את הבוט לטיפול אוטומטי בלידים', priority: 'medium' });
    if (negativeRatio > 0.3) improvements.push({ area: 'reputation', text: 'שיעור גבוה של ביקורות שליליות — נדרש טיפול', priority: 'critical' });
    if (seoScore < 50) improvements.push({ area: 'seo', text: `ציון SEO מקומי נמוך (${seoScore}/100) — הוסף ביקורות Google`, priority: 'high' });
    if (reviewsNeeded > 0) improvements.push({ area: 'seo', text: `${reviewsNeeded} ביקורות נוספות לTop 3 בGoogle`, priority: 'medium' });

    // Competitive positioning rank
    if (competitors.length > 0) {
      const sortedRatings = competitors.map(c => c.rating || 0).sort((a, b) => b - a);
      const rank = sortedRatings.filter(r => r > avgRating).length + 1;
      const total = competitors.length + 1;
      improvements.unshift({ area: 'rank', text: `דירוג תחרותי: #${rank} מתוך ${total} בתחום`, priority: 'info', rank, total });
    }

    const scoreData = {
      linked_business: businessProfileId,
      overall_score: overallScore,
      reputation_score: reputationScore,
      leads_score: leadsScore,
      competition_score: competitionScore,
      market_score: marketScore,
      engagement_score: engagementScore,
      improvements: JSON.stringify(improvements),
      snapshot_date: new Date().toISOString(),
      seo_score: seoScore,
      google_rank_estimate: googleRankEst,
      reviews_needed_for_top3: reviewsNeeded,
    };

    const existing = await prisma.healthScore.findMany({ where: { linked_business: businessProfileId } });
    if (existing.length > 0) {
      await prisma.healthScore.update({ where: { id: existing[0].id }, data: scoreData });
    } else {
      await prisma.healthScore.create({ data: scoreData });
    }

    await writeAutomationLog('calculateHealthScore', businessProfileId, startTime, 1);
    console.log(`calculateHealthScore done: overall=${overallScore}`);
    return res.json({ ...scoreData, improvements });
  } catch (err: any) {
    console.error('calculateHealthScore error:', err.message);
    await writeAutomationLog('calculateHealthScore', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
