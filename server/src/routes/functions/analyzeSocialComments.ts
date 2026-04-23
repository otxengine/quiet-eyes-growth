import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const FACEBOOK_API_BASE = 'https://graph.facebook.com/v19.0';

async function fbGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${FACEBOOK_API_BASE}${path}?access_token=${token}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * analyzeSocialComments — Social Comments Sentiment Agent
 *
 * Reads the Facebook Page access token from the SocialAccount table.
 * Fetches recent post comments, runs Haiku sentiment analysis, creates signals
 * for negative comment clusters.
 *
 * Body: { businessProfileId }
 * Returns: { comments_analyzed, signals_created, page_connected }
 */
export async function analyzeSocialComments(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    // Look up connected Facebook Page in SocialAccount table
    const fbAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'facebook_page', is_connected: true },
    });

    if (!fbAccount?.access_token || !fbAccount?.page_id) {
      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
      return res.json({
        comments_analyzed: 0,
        signals_created: 0,
        page_connected: false,
        message: 'Facebook לא מחובר — הגדר חיבור בעמוד האינטגרציות',
      });
    }

    const pageToken = fbAccount.access_token;
    const pageId    = fbAccount.page_id;

    // Fetch recent posts
    const postsData = await fbGet(`/${pageId}/posts?fields=id,message,created_time&limit=10`, pageToken);
    const posts: any[] = postsData?.data || [];

    if (posts.length === 0) {
      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
      return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: true });
    }

    // Fetch comments for each post (parallel, max 5 posts)
    const commentFetches = await Promise.all(
      posts.slice(0, 5).map(p =>
        fbGet(`/${p.id}/comments?fields=message,from,created_time&limit=20`, pageToken),
      ),
    );

    const allComments: string[] = [];
    for (const result of commentFetches) {
      if (!result?.data) continue;
      for (const comment of result.data) {
        if (comment.message) allComments.push(comment.message);
      }
    }

    if (allComments.length === 0) {
      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
      return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: true });
    }

    // Analyze sentiment with Haiku
    const analysis: any = await invokeLLM({
      model: 'haiku',
      prompt: `נתח סנטימנט של תגובות מהרשת החברתית של "${profile.name}".

תגובות (${allComments.length}):
${allComments.slice(0, 30).map((c, i) => `${i + 1}. ${c}`).join('\n')}

החזר JSON בלבד:
{
  "overall_sentiment": "positive|mixed|negative",
  "positive_count": 0,
  "negative_count": 0,
  "neutral_count": 0,
  "top_complaints": ["תלונה 1", "תלונה 2"],
  "top_praise": ["שבח 1", "שבח 2"],
  "urgent_issues": ["בעיה דחופה אם יש"],
  "recommended_response": "המלצה לתגובה",
  "has_crisis": false
}`,
      response_json_schema: { type: 'object' },
    }) as any;

    if (!analysis) {
      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
      return res.json({ comments_analyzed: allComments.length, signals_created: 0, page_connected: true });
    }

    let signalsCreated = 0;

    // Signal for negative cluster or crisis
    if (analysis.has_crisis || analysis.negative_count > 3 || analysis.urgent_issues?.length > 0) {
      const urgentText    = analysis.urgent_issues?.length ? `בעיות דחופות: ${analysis.urgent_issues.join(', ')}.` : '';
      const complaintsText = analysis.top_complaints?.length ? `תלונות נפוצות: ${analysis.top_complaints.join(', ')}.` : '';

      await prisma.marketSignal.create({
        data: {
          summary: analysis.has_crisis
            ? `משבר תגובות ב-Facebook: ${profile.name}`
            : `${analysis.negative_count} תגובות שליליות ב-Facebook`,
          category: 'alert',
          impact_level: analysis.has_crisis ? 'high' : 'medium',
          recommended_action:
            `${urgentText} ${complaintsText}\n\nהמלצה: ${analysis.recommended_response || 'הגב באופן אישי לתגובות השליליות'}`,
          confidence: 85,
          source_urls: '',
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});
      signalsCreated++;
    }

    // Signal for praise cluster (amplification opportunity)
    if (analysis.positive_count >= 5 && analysis.top_praise?.length > 0) {
      await prisma.marketSignal.create({
        data: {
          summary: `${analysis.positive_count} תגובות חיוביות — שתף ובנה סוציאל פרוף`,
          category: 'opportunity',
          impact_level: 'medium',
          recommended_action:
            `שבחים נפוצים: ${analysis.top_praise.join(', ')}.\n\nהמלצה: שתף ביקורות חיוביות כ-Story, בקש מלקוחות מרוצים להשאיר ביקורת ב-Google`,
          confidence: 80,
          source_urls: '',
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});
      signalsCreated++;
    }

    // Update last_sync on SocialAccount
    await prisma.socialAccount.update({
      where: { id: fbAccount.id },
      data: { last_sync: new Date().toISOString() },
    }).catch(() => {});

    await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, signalsCreated);
    return res.json({
      comments_analyzed: allComments.length,
      signals_created:   signalsCreated,
      page_connected:    true,
      sentiment:         analysis.overall_sentiment,
      positive_count:    analysis.positive_count,
      negative_count:    analysis.negative_count,
    });
  } catch (err: any) {
    console.error('[analyzeSocialComments] error:', err.message);
    await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
