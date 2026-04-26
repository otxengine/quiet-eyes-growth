import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * analyzeInstagramComments — fetches recent Instagram post comments via the
 * Instagram Graph API (using the token from instagram_business SocialAccount),
 * runs Hebrew sentiment analysis on each comment, and creates:
 *   - MarketSignal for negative comment clusters
 *   - ProactiveAlert for urgent negative comments that need a reply
 *   - Marks the SocialAccount last_sync timestamp
 */
export async function analyzeInstagramComments(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const igAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'instagram_business', is_connected: true },
    });

    if (!igAccount?.access_token || !igAccount?.page_id) {
      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
      return res.json({ comments_analyzed: 0, note: 'Instagram Business account not connected' });
    }

    const igUserId = igAccount.page_id;
    const token = igAccount.access_token;

    // Fetch recent media (last 10 posts)
    const mediaRes = await fetch(
      `${GRAPH_BASE}/${igUserId}/media?fields=id,timestamp,like_count,comments_count,caption&limit=10&access_token=${token}`,
    );
    if (!mediaRes.ok) {
      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
      return res.json({ comments_analyzed: 0, note: 'Could not fetch Instagram media' });
    }
    const mediaData: any = await mediaRes.json();
    const posts: any[] = mediaData.data || [];

    // Only process posts that have comments
    const postsWithComments = posts.filter(p => (p.comments_count || 0) > 0).slice(0, 5);

    let commentsAnalyzed = 0;
    let negativeCount = 0;
    const negativeComments: string[] = [];

    for (const post of postsWithComments) {
      try {
        const commentsRes = await fetch(
          `${GRAPH_BASE}/${post.id}/comments?fields=text,timestamp,username&limit=20&access_token=${token}`,
        );
        if (!commentsRes.ok) continue;
        const commentsData: any = await commentsRes.json();
        const comments: any[] = commentsData.data || [];

        if (comments.length === 0) continue;

        // Batch analyze sentiment for all comments in this post
        const commentTexts = comments.map(c => c.text || '').filter(t => t.length > 3);
        if (commentTexts.length === 0) continue;

        const analysis = await invokeLLM({
          prompt: `נתח את הסנטימנט של התגובות הבאות מ-Instagram. לכל תגובה החזר: positive/negative/neutral.

שם העסק: "${profile.name}"
תגובות:
${commentTexts.map((t, i) => `${i + 1}. "${t.substring(0, 150)}"`).join('\n')}

החזר JSON בלבד:
{ "sentiments": ["positive","negative","neutral",...], "urgent_negative": ["טקסט תגובה אם דחוף לטפל","..."] }`,
          response_json_schema: { type: 'object' },
        });

        const sentiments: string[] = (analysis as any)?.sentiments || [];
        const urgentNegatives: string[] = (analysis as any)?.urgent_negative || [];

        for (const s of sentiments) {
          if (s === 'negative') negativeCount++;
        }
        negativeComments.push(...urgentNegatives);
        commentsAnalyzed += commentTexts.length;
      } catch (_) {}
    }

    // Create MarketSignal if there's a notable negative comment cluster
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
      });
    }

    // Create ProactiveAlert for urgent negative comments
    if (negativeComments.length > 0) {
      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          alert_type: 'negative_comment',
          title: `${negativeComments.length} תגובות שליליות דחופות ב-Instagram`,
          description: negativeComments.slice(0, 2).join(' | '),
          suggested_action: 'היכנס לאינסטגרם וענה לתגובות — תגובה תוך שעה מגדילה אמון',
          priority: 'high',
          source_agent: 'analyzeInstagramComments',
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
        },
      });
    }

    // Update last_sync
    await prisma.socialAccount.update({
      where: { id: igAccount.id },
      data: { last_sync: new Date().toISOString() },
    });

    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, commentsAnalyzed);
    console.log(`analyzeInstagramComments done: ${commentsAnalyzed} comments, ${negativeCount} negative`);
    return res.json({ comments_analyzed: commentsAnalyzed, negative_count: negativeCount, urgent_alerts: negativeComments.length });
  } catch (err: any) {
    console.error('analyzeInstagramComments error:', err.message);
    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
