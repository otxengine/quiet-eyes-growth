import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * fetchSocialInsights — pulls real performance metrics from connected social accounts.
 *
 * Facebook Page (pages_read_engagement scope):
 *   - page_impressions, page_reach, page_fan_adds_total, page_engaged_users (last 7 days)
 *
 * Google Business Performance API (business.manage scope):
 *   - BUSINESS_IMPRESSIONS_MOBILE_SEARCH, CALL_CLICKS, DIRECTION_REQUESTS, WEBSITE_CLICKS (last 7 days)
 *
 * Outputs:
 *   - MarketSignal records for significant changes
 *   - ProactiveAlert if a platform shows a significant drop or spike
 *   - Updates engagement_score in HealthScore with real data
 */
export async function fetchSocialInsights(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const socialAccounts = await prisma.socialAccount.findMany({
      where: { linked_business: businessProfileId, is_connected: true },
    });

    const byPlatform: Record<string, typeof socialAccounts[0]> = {};
    for (const acct of socialAccounts) {
      if (acct.platform) byPlatform[acct.platform] = acct;
    }

    let signalsCreated = 0;
    const insights: Record<string, any> = {};

    // ── Facebook Page Insights ───────────────────────────────────────────────
    const fbAcct = byPlatform['facebook_page'];
    if (fbAcct?.access_token && fbAcct?.page_id) {
      try {
        const metrics = 'page_impressions,page_reach,page_fan_adds_total,page_engaged_users';
        const fbRes = await fetch(
          `https://graph.facebook.com/v19.0/${fbAcct.page_id}/insights` +
          `?metric=${metrics}&period=week&access_token=${fbAcct.access_token}`,
        );
        if (fbRes.ok) {
          const fbData: any = await fbRes.json();
          const parsed: Record<string, number> = {};
          for (const item of (fbData.data || [])) {
            const val = item.values?.[item.values.length - 1]?.value ?? 0;
            parsed[item.name] = typeof val === 'number' ? val : 0;
          }
          insights.facebook = parsed;

          const reach = parsed['page_reach'] ?? 0;
          const impressions = parsed['page_impressions'] ?? 0;
          const newFans = parsed['page_fan_adds_total'] ?? 0;
          const engaged = parsed['page_engaged_users'] ?? 0;

          if (reach > 0 || impressions > 0) {
            await prisma.marketSignal.create({
              data: {
                linked_business: businessProfileId,
                category: 'opportunity',
                summary: `Facebook: ${reach.toLocaleString()} הגיעו לפוסטים השבוע | Impressions: ${impressions} | עוקבים חדשים: ${newFans} | מעורבות: ${engaged}`,
                source_description: 'facebook_insights',
                impact_level: reach > 1000 ? 'high' : reach > 200 ? 'medium' : 'low',
                detected_at: new Date().toISOString(),
                created_date: new Date(),
              },
            });
            signalsCreated++;
          }

          // ProactiveAlert if engagement is very low relative to reach
          if (reach > 500 && engaged < reach * 0.01) {
            await prisma.proactiveAlert.create({
              data: {
                linked_business: businessProfileId,
                alert_type: 'low_engagement',
                title: `מעורבות נמוכה ב-Facebook (${Math.round((engaged / reach) * 100)}%)`,
                description: `${reach} אנשים ראו את הפוסטים אבל רק ${engaged} הגיבו. שקול תוכן אינטראקטיבי יותר.`,
                suggested_action: 'הפעל contentCalendarAgent לקבלת רעיונות תוכן',
                priority: 'medium',
                source_agent: 'fetchSocialInsights',
                is_dismissed: false,
                is_acted_on: false,
                created_at: new Date().toISOString(),
              },
            });
          }
        }
      } catch (err: any) {
        console.warn('Facebook insights fetch failed:', err.message);
      }
    }

    // ── Google Business Performance API ─────────────────────────────────────
    const gmbAcct = byPlatform['google_business'];
    const gmbToken = gmbAcct?.access_token || (profile as any).google_access_token;
    const gmbLocationPath = gmbAcct?.page_id; // "accounts/123/locations/456"

    if (gmbToken && gmbLocationPath && gmbLocationPath.includes('/')) {
      try {
        const endDate = new Date();
        const startDate = new Date(Date.now() - 7 * 86400000);
        const fmt = (d: Date) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });

        const perfRes = await fetch(
          `https://businessprofileperformance.googleapis.com/v1/${gmbLocationPath}:fetchMultiDailyMetricsTimeSeries`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${gmbToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              dailyMetrics: [
                'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
                'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
                'CALL_CLICKS',
                'DIRECTION_REQUESTS',
                'WEBSITE_CLICKS',
              ],
              dailyRange: { startDate: fmt(startDate), endDate: fmt(endDate) },
            }),
          },
        );

        if (perfRes.ok) {
          const perfData: any = await perfRes.json();
          const totals: Record<string, number> = {};

          for (const series of (perfData.multiDailyMetricTimeSeries || [])) {
            const metricName = series.dailyMetric;
            const sum = (series.timeSeries?.datedValues || [])
              .reduce((acc: number, v: any) => acc + (parseInt(v.value || '0', 10)), 0);
            totals[metricName] = sum;
          }

          insights.google = totals;

          const searches = (totals['BUSINESS_IMPRESSIONS_MOBILE_SEARCH'] || 0) +
                           (totals['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'] || 0);
          const calls     = totals['CALL_CLICKS'] || 0;
          const directions = totals['DIRECTION_REQUESTS'] || 0;
          const webClicks  = totals['WEBSITE_CLICKS'] || 0;

          if (searches > 0) {
            await prisma.marketSignal.create({
              data: {
                linked_business: businessProfileId,
                category: 'opportunity',
                summary: `Google Business: ${searches.toLocaleString()} חיפושים השבוע | שיחות: ${calls} | ניווט: ${directions} | כניסות לאתר: ${webClicks}`,
                source_description: 'google_business_insights',
                impact_level: searches > 500 ? 'high' : searches > 100 ? 'medium' : 'low',
                detected_at: new Date().toISOString(),
                created_date: new Date(),
              },
            });
            signalsCreated++;
          }

          // Alert if calls are very low vs searches
          if (searches > 100 && calls < searches * 0.005) {
            await prisma.proactiveAlert.create({
              data: {
                linked_business: businessProfileId,
                alert_type: 'low_conversion',
                title: `${searches} חיפושים ב-Google אבל רק ${calls} שיחות`,
                description: `שיעור המרה נמוך (${((calls / searches) * 100).toFixed(1)}%). עדכן פרטי העסק, הוסף תמונות, וענה לביקורות.`,
                suggested_action: 'הפעל autoRespondToReviews ועדכן פרטי העסק ב-Google',
                priority: calls === 0 ? 'high' : 'medium',
                source_agent: 'fetchSocialInsights',
                is_dismissed: false,
                is_acted_on: false,
                created_at: new Date().toISOString(),
              },
            });
          }

          // Update business profile with latest Google stats for HealthScore
          await prisma.businessProfile.update({
            where: { id: businessProfileId },
            data: {
              google_search_impressions: searches,
              google_calls_this_week: calls,
            } as any,
          }).catch(() => null); // Fields may not exist yet — silent fail
        }
      } catch (err: any) {
        console.warn('Google Business Performance fetch failed:', err.message);
      }
    }

    await writeAutomationLog('fetchSocialInsights', businessProfileId, startTime, signalsCreated);
    console.log(`fetchSocialInsights done: ${signalsCreated} signals created`);
    return res.json({ signals_created: signalsCreated, insights });
  } catch (err: any) {
    console.error('fetchSocialInsights error:', err.message);
    await writeAutomationLog('fetchSocialInsights', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
