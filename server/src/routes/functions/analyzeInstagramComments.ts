import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { runApifyActor, hasApifyKey } from '../../lib/apify';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { tavilySearch } from '../../lib/tavily';
import { hasSearchApiKey, searchInstagramPosts } from '../../lib/searchapi';

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// ── Shared sentiment analysis + signal creation ───────────────────────────────
async function analyzeAndSave(
  profile: any,
  businessProfileId: string,
  allComments: string[],
): Promise<{ commentsAnalyzed: number; negativeCount: number; urgentAlerts: number }> {
  let commentsAnalyzed = 0;
  let negativeCount = 0;
  const negativeComments: string[] = [];

  const CHUNK = 20;
  for (let i = 0; i < allComments.length; i += CHUNK) {
    const batch = allComments.slice(i, i + CHUNK).filter(t => t.length > 3);
    if (batch.length === 0) continue;
    try {
      const analysis = await invokeLLM({
        model: 'haiku',
        prompt: `Analyze the sentiment of the following Instagram comments. For each comment return: positive/negative/neutral.

Business name: "${profile.name}"
Comments:
${batch.map((t, idx) => `${idx + 1}. "${t.substring(0, 150)}"`).join('\n')}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{ "sentiments": ["positive","negative","neutral",...], "urgent_negative": ["comment text if urgent to handle"] }`,
        response_json_schema: { type: 'object' },
        maxTokens: 800,
      });
      const sentiments: string[] = (analysis as any)?.sentiments || [];
      const urgentNegatives: string[] = (analysis as any)?.urgent_negative || [];
      for (const s of sentiments) { if (s === 'negative') negativeCount++; }
      negativeComments.push(...urgentNegatives);
      commentsAnalyzed += batch.length;
    } catch (_) {}
  }

  if (negativeCount >= 3) {
    await prisma.marketSignal.create({
      data: {
        linked_business: businessProfileId,
        category: 'threat',
        summary: negativeComments.length > 0
          ? `${negativeCount} תגובות שליליות ב-Instagram | דחופות: ${negativeComments.slice(0, 2).join(' | ')}`
          : `נמצאו ${negativeCount} תגובות שליליות בפוסטים האחרונים ב-Instagram`,
        source_description: 'instagram_comments',
        impact_level: negativeCount >= 5 ? 'high' : 'medium',
        detected_at: new Date().toISOString(),
        created_date: new Date(),
      },
    }).catch(() => {});
  }

  if (negativeComments.length > 0 || negativeCount >= 3) {
    await prisma.proactiveAlert.create({
      data: {
        linked_business: businessProfileId,
        alert_type: 'negative_comment',
        title: negativeComments.length > 0
          ? `${negativeComments.length} תגובות שליליות דחופות ב-Instagram`
          : `${negativeCount} תגובות שליליות ב-Instagram`,
        description: negativeComments.length > 0
          ? negativeComments.slice(0, 2).join(' | ')
          : `נמצאו ${negativeCount} תגובות שליליות`,
        suggested_action: 'היכנס לאינסטגרם וענה לתגובות — תגובה תוך שעה מגדילה אמון',
        priority: 'high',
        source_agent: 'analyzeInstagramComments',
        is_dismissed: false,
        is_acted_on: false,
        created_at: new Date().toISOString(),
      },
    }).catch(() => {});
  }

  return { commentsAnalyzed, negativeCount, urgentAlerts: negativeComments.length };
}

export async function analyzeInstagramComments(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (shouldSkipAgent(businessProfileId, 'analyzeInstagramComments', MIN_INTERVAL_MS)) {
    return res.json({ comments_analyzed: 0, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const igAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'instagram_business', is_connected: true },
    });

    // ── Path A: Instagram Graph API (OAuth connected) ─────────────────────────
    if (igAccount?.access_token && igAccount?.page_id) {
      const igUserId = igAccount.page_id;
      const token    = igAccount.access_token;

      const mediaRes = await fetch(
        `${GRAPH_BASE}/${igUserId}/media?fields=id,timestamp,like_count,comments_count,caption&limit=10&access_token=${token}`,
      );
      if (!mediaRes.ok) {
        await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
        return res.json({ comments_analyzed: 0, note: 'Could not fetch Instagram media' });
      }
      const posts: any[] = ((await mediaRes.json()) as any).data || [];
      const postsWithComments = posts.filter(p => (p.comments_count || 0) > 0).slice(0, 5);

      const allComments: string[] = [];
      for (const post of postsWithComments) {
        try {
          const commentsData: any = await fetch(
            `${GRAPH_BASE}/${post.id}/comments?fields=text,timestamp,username&limit=20&access_token=${token}`,
          ).then(r => r.json());
          for (const c of (commentsData.data || [])) { if (c.text) allComments.push(c.text); }
        } catch (_) {}
      }

      const result = await analyzeAndSave(profile, businessProfileId, allComments);

      await prisma.socialAccount.update({
        where: { id: igAccount.id },
        data: { last_sync: new Date().toISOString() },
      }).catch(() => {});

      setLastRun(businessProfileId, 'analyzeInstagramComments');
      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, result.commentsAnalyzed);
      console.log(`analyzeInstagramComments done (OAuth): ${result.commentsAnalyzed} comments, ${result.negativeCount} negative`);
      return res.json({ comments_analyzed: result.commentsAnalyzed, negative_count: result.negativeCount, urgent_alerts: result.urgentAlerts });
    }

    // ── Path B: Apify scraper — uses instagram_url entered during onboarding ──
    const instagramUrl: string | null = (profile as any).instagram_url || null;
    if (hasApifyKey() && instagramUrl) {
      console.log(`[analyzeInstagramComments] No OAuth — falling back to Apify for ${instagramUrl}`);
      const items = await runApifyActor('apify~instagram-scraper', {
        directUrls: [instagramUrl],
        resultsType: 'posts',
        resultsLimit: 10,
        addParentData: false,
      });

      const allComments: string[] = [];
      for (const item of items) {
        // Apify instagram-scraper returns latestComments array on each post
        const comments: any[] = item.latestComments || item.comments || [];
        for (const c of comments) {
          const text = c.text || c.ownerUsername || '';
          if (text.length > 3) allComments.push(text);
        }
      }

      if (allComments.length === 0) {
        await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
        console.log(`analyzeInstagramComments done (Apify): no comments found for ${instagramUrl}`);
        return res.json({ comments_analyzed: 0, note: 'No comments found via Apify', source: 'apify' });
      }

      const result = await analyzeAndSave(profile, businessProfileId, allComments);
      setLastRun(businessProfileId, 'analyzeInstagramComments');
      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, result.commentsAnalyzed);
      console.log(`analyzeInstagramComments done (Apify): ${result.commentsAnalyzed} comments, ${result.negativeCount} negative`);
      return res.json({ comments_analyzed: result.commentsAnalyzed, negative_count: result.negativeCount, urgent_alerts: result.urgentAlerts, source: 'apify' });
    }

    // ── Path C: SearchAPI + Tavily — when Apify unavailable ──────────────────
    if (instagramUrl) {
      const username = instagramUrl
        ? (instagramUrl.match(/instagram\.com\/@?([\w.]+)/)?.[1] || '')
        : '';

      const texts: string[] = [];

      // SearchAPI: get recent post captions
      if (hasSearchApiKey() && username) {
        const posts = await searchInstagramPosts(username).catch(() => []);
        texts.push(...posts.map(p => p.caption).filter(Boolean));
      }

      // Tavily: web mentions and reviews about this business on Instagram
      const mentionQuery = `"${profile.name}" instagram ביקורות תגובות`;
      const mentions = await tavilySearch(mentionQuery, 5).catch(() => []);
      texts.push(...mentions.map(r => (r.content || r.title || '').slice(0, 200)).filter(t => t.length > 20));

      if (texts.length > 0) {
        const result = await analyzeAndSave(profile, businessProfileId, texts);
        setLastRun(businessProfileId, 'analyzeInstagramComments');
        await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, result.commentsAnalyzed);
        console.log(`analyzeInstagramComments done (SearchAPI+Tavily): ${texts.length} texts, ${result.negativeCount} negative`);
        return res.json({ comments_analyzed: result.commentsAnalyzed, negative_count: result.negativeCount, urgent_alerts: result.urgentAlerts, source: 'searchapi_tavily' });
      }
    }

    // ── No data source available ──────────────────────────────────────────────
    console.log(`[analyzeInstagramComments] no-op: no IG connection or URL for ${businessProfileId}`);
    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
    return res.json({ comments_analyzed: 0, note: 'Instagram not connected and no URL provided' });

  } catch (err: any) {
    console.error('analyzeInstagramComments error:', err.message);
    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
