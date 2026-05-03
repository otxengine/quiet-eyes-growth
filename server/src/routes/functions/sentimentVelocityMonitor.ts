import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * sentimentVelocityMonitor — detects rapid changes in sentiment velocity.
 * Compares last 7 days vs previous 7 days. Alerts on significant drops.
 * Stores velocity data in ProactiveAlert + updates BusinessMemory.
 */
export async function sentimentVelocityMonitor(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

    const [recentReviews, previousReviews, recentSignals, previousSignals] = await Promise.all([
      prisma.review.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(sevenDaysAgo) } },
        select: { rating: true, sentiment: true },
      }),
      prisma.review.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(fourteenDaysAgo), lt: new Date(sevenDaysAgo) } },
        select: { rating: true, sentiment: true },
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(sevenDaysAgo) } },
        select: { category: true, impact_level: true },
      }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: new Date(fourteenDaysAgo), lt: new Date(sevenDaysAgo) } },
        select: { category: true, impact_level: true },
      }),
    ]);

    const calcSentimentScore = (reviews: { rating: number | null; sentiment: string | null }[]) => {
      if (reviews.length === 0) return null;
      const avgRating = reviews.reduce((s, r) => s + (r.rating || 4), 0) / reviews.length;
      const negRatio = reviews.filter(r => r.sentiment === 'negative' || (r.rating && r.rating <= 2)).length / reviews.length;
      return Math.round((avgRating / 5 * 70) + ((1 - negRatio) * 30));
    };

    const calcSignalScore = (signals: { category: string | null; impact_level: string | null }[]) => {
      if (signals.length === 0) return null;
      const threats = signals.filter(s => s.category === 'threat').length;
      const opps = signals.filter(s => s.category === 'opportunity').length;
      return Math.round(50 + (opps - threats) * 10);
    };

    const recentSentiment = calcSentimentScore(recentReviews);
    const prevSentiment = calcSentimentScore(previousReviews);
    const recentSignalScore = calcSignalScore(recentSignals);
    const prevSignalScore = calcSignalScore(previousSignals);

    // Calculate velocity
    const sentimentVelocity = (recentSentiment !== null && prevSentiment !== null)
      ? recentSentiment - prevSentiment
      : null;
    const signalVelocity = (recentSignalScore !== null && prevSignalScore !== null)
      ? recentSignalScore - prevSignalScore
      : null;

    const velocityData = {
      sentiment_now: recentSentiment,
      sentiment_prev: prevSentiment,
      sentiment_velocity: sentimentVelocity,
      signal_score_now: recentSignalScore,
      signal_score_prev: prevSignalScore,
      signal_velocity: signalVelocity,
      reviews_this_week: recentReviews.length,
      threats_this_week: recentSignals.filter(s => s.category === 'threat').length,
      measured_at: now.toISOString(),
    };

    // Update BusinessMemory with velocity snapshot
    const existingMemory = await prisma.businessMemory.findFirst({ where: { linked_business: businessProfileId } });
    const velocityJson = JSON.stringify(velocityData);
    if (existingMemory) {
      await prisma.businessMemory.update({
        where: { id: existingMemory.id },
        data: { channel_preferences: velocityJson }, // repurpose field for velocity data
      });
    } else {
      await prisma.businessMemory.create({
        data: { linked_business: businessProfileId, channel_preferences: velocityJson },
      });
    }

    let alertsCreated = 0;

    // Alert if significant sentiment drop (> -10 points)
    if (sentimentVelocity !== null && sentimentVelocity <= -10) {
      const severity = sentimentVelocity <= -20 ? 'critical' : 'high';
      const existingDropAlert = await prisma.proactiveAlert.findFirst({
        where: {
          linked_business: businessProfileId,
          alert_type: 'sentiment_drop',
          is_dismissed: false,
          is_acted_on: false,
        },
      });

      if (!existingDropAlert) {
        await prisma.proactiveAlert.create({
          data: {
            linked_business: businessProfileId,
            alert_type: 'sentiment_drop',
            title: `ירידת סנטימנט חדה: ${sentimentVelocity} נקודות ב-7 ימים`,
            description: `הסנטימנט ירד מ-${prevSentiment} ל-${recentSentiment}/100 בשבוע האחרון. ${recentReviews.filter(r => r.sentiment === 'negative').length} ביקורות שליליות החלשבוע.`,
            suggested_action: 'בדוק ביקורות שליליות חדשות, זהה את הבעיה המשותפת, הגב אישית לכל אחת',
            priority: severity,
            source_agent: JSON.stringify({
              action_label: 'בדוק ביקורות',
              action_type: 'respond',
              urgency_hours: severity === 'critical' ? 4 : 12,
              impact_reason: `ירידה מהירה בסנטימנט פוגעת בדירוג Google ובאמון לקוחות חדשים`,
            }),
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
          },
        });
        alertsCreated++;
      }
    }

    // Alert if threat spike
    if (recentSignals.filter(s => s.category === 'threat').length >= 3) {
      const existingThreatAlert = await prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, alert_type: 'threat_spike', is_dismissed: false, is_acted_on: false },
      });
      if (!existingThreatAlert) {
        await prisma.proactiveAlert.create({
          data: {
            linked_business: businessProfileId,
            alert_type: 'threat_spike',
            title: `${recentSignals.filter(s => s.category === 'threat').length} איומי שוק זוהו השבוע`,
            description: 'ריכוז חריג של איומים — שינוי בשוק עשוי להתרחש',
            suggested_action: 'בדוק את אותות השוק האחרונים ועדכן את האסטרטגיה',
            priority: 'high',
            source_agent: JSON.stringify({ action_label: 'נתח שוק', action_type: 'task', urgency_hours: 24 }),
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
          },
        });
        alertsCreated++;
      }
    }

    await writeAutomationLog('sentimentVelocityMonitor', businessProfileId, startTime, alertsCreated);
    return res.json({ velocity: velocityData, alerts_created: alertsCreated, items_created: alertsCreated });
  } catch (err: any) {
    console.error('sentimentVelocityMonitor error:', err.message);
    await writeAutomationLog('sentimentVelocityMonitor', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
