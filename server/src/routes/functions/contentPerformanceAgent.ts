/**
 * contentPerformanceAgent — analyses which content types, formats, and topics
 * actually drive leads and engagement for this business.
 *
 * Flow:
 *  1. Pull OrganicPosts from last 30 days
 *  2. For each post, count leads created within 48h of publishing (attribution window)
 *  3. Cross-reference with SocialSignals (engagement counts)
 *  4. LLM: identify top-performing patterns vs. underperformers
 *  5. Save MarketSignal with content performance insights
 *  6. ProactiveAlert: specific content recommendation based on what's working
 *
 * Delta guard: 24h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export async function contentPerformanceAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (shouldSkipAgent(businessProfileId, 'contentPerformanceAgent', MIN_INTERVAL_MS)) {
    return res.json({ insights_created: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // ── 1. Pull recent organic posts ──────────────────────────────────────────
    const posts = await prisma.organicPost.findMany({
      where: {
        linked_business: businessProfileId,
        created_date: { gte: thirtyDaysAgo },
        status: { in: ['published', 'draft'] },
      },
      orderBy: { created_date: 'desc' },
      take: 30,
    });

    if (posts.length < 3) {
      setLastRun(businessProfileId, 'contentPerformanceAgent');
      await writeAutomationLog('contentPerformanceAgent', businessProfileId, startTime, 0);
      return res.json({ insights_created: 0, note: 'Not enough posts to analyse (need 3+)' });
    }

    // ── 2. For each post, count leads created within 48h after publishing ─────
    const enrichedPosts = await Promise.all(posts.map(async (post) => {
      const postTime = post.published_at || post.created_date;
      if (!postTime) return { ...post, attributedLeads: 0 };
      const windowEnd = new Date(new Date(postTime).getTime() + 48 * 3600000);
      const leadCount = await prisma.lead.count({
        where: {
          linked_business: businessProfileId,
          created_date: { gte: new Date(postTime), lte: windowEnd },
        },
      });
      return { ...post, attributedLeads: leadCount };
    }));

    // ── 3. Aggregate by post_type and platform ────────────────────────────────
    type PerfBucket = { posts: number; leads: number; types: string[] };
    const byType = new Map<string, PerfBucket>();
    const byPlatform = new Map<string, PerfBucket>();
    const byFormat = new Map<string, PerfBucket>();

    for (const p of enrichedPosts) {
      const pType = p.post_type || 'unknown';
      const platform = p.platform || 'unknown';
      const format = (p.signal_summary || '').match(/ריל|קרוסל|תמונה|סטורי/)?.[0] || 'unknown';

      const addToMap = (map: Map<string, PerfBucket>, key: string) => {
        const b = map.get(key) || { posts: 0, leads: 0, types: [] };
        b.posts++;
        b.leads += p.attributedLeads;
        if (p.post_type && !b.types.includes(p.post_type)) b.types.push(p.post_type);
        map.set(key, b);
      };
      addToMap(byType, pType);
      addToMap(byPlatform, platform);
      addToMap(byFormat, format);
    }

    const sortByLeadsPerPost = (map: Map<string, PerfBucket>) =>
      [...map.entries()]
        .sort((a, b) => (b[1].leads / b[1].posts) - (a[1].leads / a[1].posts))
        .map(([key, v]) => ({
          name: key,
          posts: v.posts,
          leads: v.leads,
          leads_per_post: parseFloat((v.leads / v.posts).toFixed(2)),
        }));

    const typeRanking = sortByLeadsPerPost(byType);
    const platformRanking = sortByLeadsPerPost(byPlatform);
    const formatRanking = sortByLeadsPerPost(byFormat);

    const totalLeads = enrichedPosts.reduce((s, p) => s + p.attributedLeads, 0);
    const topPostsByLeads = enrichedPosts
      .sort((a, b) => b.attributedLeads - a.attributedLeads)
      .slice(0, 3);

    const worstPosts = enrichedPosts
      .filter(p => p.attributedLeads === 0)
      .slice(0, 3);

    // ── 4. Build context for LLM ──────────────────────────────────────────────
    const contextLines = [
      `עסק: ${profile.name} | ${profile.category} | ${profile.city}`,
      `פוסטים שנותחו: ${posts.length} | לידים מיוחסים (48h): ${totalLeads}`,
      '',
      'ביצועים לפי סוג תוכן:',
      ...typeRanking.map(r => `  ${r.name}: ${r.posts} פוסטים → ${r.leads} לידים (${r.leads_per_post} לפוסט)`),
      '',
      'ביצועים לפי פלטפורמה:',
      ...platformRanking.map(r => `  ${r.name}: ${r.posts} פוסטים → ${r.leads} לידים`),
      '',
      'ביצועים לפי פורמט:',
      ...formatRanking.map(r => `  ${r.name}: ${r.posts} פוסטים → ${r.leads} לידים`),
      '',
      `הפוסטים הכי טובים:`,
      ...topPostsByLeads.map(p => `  "${(p.content || '').slice(0, 80)}" → ${p.attributedLeads} לידים (${p.platform})`),
      '',
      `פוסטים ללא לידים (דוגמאות):`,
      ...worstPosts.map(p => `  "${(p.content || '').slice(0, 80)}" (${p.platform}, ${p.post_type || '?'})`),
    ];

    // ── 5. LLM analysis ───────────────────────────────────────────────────────
    const analysis: any = await invokeLLM({
      model: 'haiku',
      maxTokens: 500,
      prompt: `נתח את ביצועי התוכן של העסק ותן המלצה ספציפית.

${contextLines.join('\n')}

זהה:
1. מה עובד הכי טוב ולמה
2. מה לא עובד ולמה
3. פעולה ספציפית אחת לשיפור מיידי

החזר JSON בלבד:
{
  "top_performing_type": "סוג התוכן שמייצר הכי הרבה לידים",
  "top_performing_platform": "הפלטפורמה הכי אפקטיבית",
  "winning_pattern": "מה משותף לפוסטים שהצליחו — תבנית ספציפית",
  "underperforming_pattern": "מה גרם לפוסטים לכשול — דפוס ספציפי",
  "recommendation": "פעולה ספציפית אחת לשיפור — פועל + ערוץ + תוכן",
  "quick_win": "דבר אחד שאפשר לשנות עכשיו בלוח התוכן",
  "impact": "high|medium"
}`,
      response_json_schema: { type: 'object' },
    });

    if (!analysis?.recommendation) {
      setLastRun(businessProfileId, 'contentPerformanceAgent');
      await writeAutomationLog('contentPerformanceAgent', businessProfileId, startTime, 0);
      return res.json({ insights_created: 0, note: 'LLM returned no recommendation' });
    }

    // ── 6. Save MarketSignal ──────────────────────────────────────────────────
    const signalSummary = `ביצועי תוכן: ${analysis.top_performing_type || '?'} ב-${analysis.top_performing_platform || '?'} — ${totalLeads} לידים ב-30 יום`;

    const existing = await prisma.marketSignal.findFirst({
      where: {
        linked_business: businessProfileId,
        category: 'content_performance',
        detected_at: { gte: new Date(Date.now() - 7 * 86400000).toISOString() },
      },
    });

    if (!existing) {
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: signalSummary,
          category: 'content_performance',
          impact_level: analysis.impact === 'high' ? 'high' : 'medium',
          confidence: 80,
          recommended_action: analysis.recommendation,
          source_description: JSON.stringify({
            action_type: 'social_post',
            action_label: analysis.quick_win || analysis.recommendation?.split(' ').slice(0, 4).join(' '),
            posts_analyzed: posts.length,
            total_attributed_leads: totalLeads,
            top_type: analysis.top_performing_type,
            top_platform: analysis.top_performing_platform,
            winning_pattern: analysis.winning_pattern,
            underperforming_pattern: analysis.underperforming_pattern,
            type_ranking: typeRanking.slice(0, 4),
            platform_ranking: platformRanking.slice(0, 3),
            urgency_hours: 72,
          }),
          is_read: false,
          detected_at: new Date().toISOString(),
        },
      });

      // ── 7. ProactiveAlert if high impact ───────────────────────────────────
      if (analysis.impact === 'high') {
        const alertTitle = `תובנת תוכן: ${analysis.top_performing_type || 'תוכן'} מייצר ${totalLeads} לידים`;
        const alertExists = await prisma.proactiveAlert.findFirst({
          where: { linked_business: businessProfileId, title: alertTitle, is_dismissed: false },
        });
        if (!alertExists) {
          await prisma.proactiveAlert.create({
            data: {
              alert_type: 'market_opportunity',
              title: alertTitle,
              description: `${analysis.winning_pattern || ''} — ${analysis.recommendation}`,
              suggested_action: analysis.quick_win || analysis.recommendation,
              priority: 'medium',
              source_agent: JSON.stringify({
                action_label: (analysis.quick_win || '').split(' ').slice(0, 4).join(' ') || 'עדכן לוח תוכן',
                action_type: 'social_post',
                urgency_hours: 72,
                impact_reason: analysis.winning_pattern || '',
              }),
              is_dismissed: false,
              is_acted_on: false,
              created_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});
        }
      }
    }

    setLastRun(businessProfileId, 'contentPerformanceAgent');
    await writeAutomationLog('contentPerformanceAgent', businessProfileId, startTime, 1);
    console.log(`[contentPerformanceAgent] done: ${posts.length} posts, ${totalLeads} attributed leads`);

    return res.json({
      posts_analyzed: posts.length,
      attributed_leads: totalLeads,
      top_type: analysis.top_performing_type,
      top_platform: analysis.top_performing_platform,
      recommendation: analysis.recommendation,
      insights_created: existing ? 0 : 1,
    });

  } catch (err: any) {
    console.error('[contentPerformanceAgent] error:', err.message);
    await writeAutomationLog('contentPerformanceAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
