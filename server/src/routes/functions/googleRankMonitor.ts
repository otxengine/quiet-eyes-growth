import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 7): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: 'basic', max_results: maxResults }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

/**
 * googleRankMonitor — estimates the business's Google local ranking vs competitors
 * by searching Tavily for the business category+city and inspecting results.
 * Updates HealthScore with seo_score, google_rank_estimate, reviews_needed_for_top3.
 */
export async function googleRankMonitor(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    // Search for local business results
    const searchQuery = `${category} ${city} גוגל ביקורות מומלצים`;
    const results = await tavilySearch(searchQuery, 10);

    // Try to find business position in results
    let rankEstimate = 10; // default: not in top 10
    for (let i = 0; i < results.length; i++) {
      const text = `${results[i].title || ''} ${results[i].content || ''}`.toLowerCase();
      if (text.includes(name.toLowerCase())) {
        rankEstimate = i + 1;
        break;
      }
    }

    // Count current business reviews
    const businessReviewCount = await prisma.review.count({
      where: { linked_business: businessProfileId },
    });

    // Get competitors with their review counts
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      select: { name: true, rating: true, review_count: true },
      take: 10,
    });

    // Find top competitor review counts
    const competitorReviewCounts = competitors
      .map(c => c.review_count || 0)
      .sort((a, b) => b - a);

    const top3MinReviews = competitorReviewCounts.length >= 3
      ? competitorReviewCounts[2]
      : competitorReviewCounts[0] || 10;

    const reviewsNeededForTop3 = Math.max(0, top3MinReviews - businessReviewCount + 1);

    // Use LLM to analyze the search results and estimate SEO health
    let seoAnalysis: any = null;
    if (results.length > 0) {
      try {
        const resultsText = results.slice(0, 5).map((r, i) =>
          `${i + 1}. ${r.title || ''}: ${(r.content || '').substring(0, 100)}`
        ).join('\n');

        seoAnalysis = await invokeLLM({
          prompt: `נתח את תוצאות החיפוש הבאות עבור "${category} ${city}" בגוגל.
העסק שלנו: "${name}" (${businessReviewCount} ביקורות).

תוצאות חיפוש:
${resultsText}

מתחרים ידועים: ${competitors.slice(0, 5).map(c => `${c.name} (${c.review_count || '?'} ביקורות, ${c.rating || '?'}⭐)`).join(', ')}

החזר JSON: {
  "seo_score": (0-100, ציון SEO מקומי — מבוסס על נוכחות בתוצאות),
  "top_competitor": "שם המתחרה המוביל",
  "key_gap": "מה חסר לנו להגיע לראש",
  "quick_win": "פעולה אחת שתשפר את הדירוג הכי מהר"
}`,
          response_json_schema: { type: 'object' },
        });
      } catch (_) {}
    }

    const seoScore = seoAnalysis?.seo_score ?? Math.max(10, 100 - rankEstimate * 10);

    // Upsert HealthScore
    const existingHealth = await prisma.healthScore.findFirst({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
    });

    if (existingHealth) {
      await prisma.healthScore.update({
        where: { id: existingHealth.id },
        data: {
          seo_score: seoScore,
          google_rank_estimate: String(rankEstimate),
          reviews_needed_for_top3: reviewsNeededForTop3,
          snapshot_date: new Date().toISOString(),
        },
      });
    } else {
      await prisma.healthScore.create({
        data: {
          linked_business: businessProfileId,
          overall_score: seoScore,
          seo_score: seoScore,
          google_rank_estimate: String(rankEstimate),
          reviews_needed_for_top3: reviewsNeededForTop3,
          snapshot_date: new Date().toISOString(),
        },
      });
    }

    // Alert if rank is bad or we need many reviews to reach top 3
    const previousRank = existingHealth?.google_rank_estimate
      ? parseInt(existingHealth.google_rank_estimate, 10)
      : null;

    const rankDropped = previousRank !== null && rankEstimate > previousRank;
    const needsManyReviews = reviewsNeededForTop3 > 5;

    if (rankDropped || needsManyReviews) {
      const alertTitle = rankDropped
        ? `ירידה בדירוג Google — כעת במקום ${rankEstimate}`
        : `נדרשות ${reviewsNeededForTop3} ביקורות נוספות לטופ 3`;

      const existingAlert = await prisma.proactiveAlert.findFirst({
        where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
      });

      if (!existingAlert) {
        const actionMeta = JSON.stringify({
          action_label: 'שלח בקשת ביקורת',
          action_type: 'task',
          prefilled_text: seoAnalysis?.quick_win
            ? `פעולה מומלצת לשיפור דירוג Google:\n${seoAnalysis.quick_win}\n\nמתחרה מוביל: ${seoAnalysis.top_competitor || 'לא זוהה'}\nחסרות ${reviewsNeededForTop3} ביקורות לטופ 3`
            : `הוסף ${reviewsNeededForTop3} ביקורות Google כדי להגיע לטופ 3 בחיפוש ${category} ${city}`,
          urgency_hours: 72,
          impact_reason: 'כל ביקורת Google מגדילה את הנראות המקומית ומביאה בממוצע 5 לקוחות פוטנציאליים נוספים',
        });

        await prisma.proactiveAlert.create({
          data: {
            alert_type: 'market_opportunity',
            title: alertTitle,
            description: seoAnalysis?.key_gap
              ? seoAnalysis.key_gap.substring(0, 150)
              : `דירוג Google מקומי: מקום ${rankEstimate}. ${reviewsNeededForTop3} ביקורות לטופ 3.`,
            suggested_action: seoAnalysis?.quick_win || `שלח בקשות ביקורת ל${reviewsNeededForTop3} לקוחות מרוצים`,
            priority: rankDropped ? 'high' : 'medium',
            source_agent: actionMeta,
            is_dismissed: false,
            is_acted_on: false,
            created_at: new Date().toISOString(),
            linked_business: businessProfileId,
          },
        });
      }
    }

    await writeAutomationLog('googleRankMonitor', businessProfileId, startTime, 1);
    console.log(`googleRankMonitor done: rank=${rankEstimate}, seo=${seoScore}, reviews_needed=${reviewsNeededForTop3}`);
    return res.json({ rank_estimate: rankEstimate, seo_score: seoScore, reviews_needed_for_top3: reviewsNeededForTop3 });
  } catch (err: any) {
    console.error('googleRankMonitor error:', err.message);
    await writeAutomationLog('googleRankMonitor', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
