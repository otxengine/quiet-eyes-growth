import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const FACEBOOK_API_BASE = 'https://graph.facebook.com/v19.0';
const APIFY_KEY         = process.env.APIFY_API_KEY || '';

async function fbGet(path: string, token: string): Promise<any> {
  const res = await fetch(`${FACEBOOK_API_BASE}${path}?access_token=${token}`);
  if (!res.ok) return null;
  return res.json();
}

// ── Apify helper — run actor and wait for result ──────────────────────────────
async function apifyRun(actor: string, input: any): Promise<any[]> {
  if (!APIFY_KEY) return [];
  try {
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    );
    if (!startRes.ok) { console.warn(`[Apify] start failed (${actor}):`, startRes.status); return []; }
    const runId = (await startRes.json())?.data?.id;
    if (!runId) return [];

    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusData: any = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`).then(r => r.json());
      const status = statusData?.data?.status;
      if (status === 'SUCCEEDED') {
        const datasetId = statusData?.data?.defaultDatasetId;
        const items: any = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_KEY}&limit=50`).then(r => r.json());
        return Array.isArray(items) ? items : [];
      }
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) { console.warn(`[Apify] run ended with ${status}`); return []; }
    }
    return [];
  } catch (e: any) { console.warn(`[Apify] exception (${actor}):`, e.message); return []; }
}

// ── Shared sentiment analysis + signal creation ───────────────────────────────
async function analyzeAndSave(
  profile: any,
  businessProfileId: string,
  allComments: string[],
): Promise<{ signalsCreated: number; analysis: any }> {
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
    maxTokens: 800,
  }) as any;

  if (!analysis) return { signalsCreated: 0, analysis: null };

  let signalsCreated = 0;

  if (analysis.has_crisis || analysis.negative_count > 3 || analysis.urgent_issues?.length > 0) {
    const urgentText     = analysis.urgent_issues?.length ? `בעיות דחופות: ${analysis.urgent_issues.join(', ')}.` : '';
    const complaintsText = analysis.top_complaints?.length ? `תלונות נפוצות: ${analysis.top_complaints.join(', ')}.` : '';
    await prisma.marketSignal.create({
      data: {
        summary: analysis.has_crisis
          ? `משבר תגובות ב-Facebook: ${profile.name}`
          : `${analysis.negative_count} תגובות שליליות ב-Facebook`,
        category: 'alert',
        impact_level: analysis.has_crisis ? 'high' : 'medium',
        recommended_action: `${urgentText} ${complaintsText}\n\nהמלצה: ${analysis.recommended_response || 'הגב באופן אישי לתגובות השליליות'}`,
        confidence: 85,
        source_urls: '',
        is_read: false,
        detected_at: new Date().toISOString(),
        linked_business: businessProfileId,
      },
    }).catch(() => {});
    signalsCreated++;
  }

  if (analysis.positive_count >= 5 && analysis.top_praise?.length > 0) {
    await prisma.marketSignal.create({
      data: {
        summary: `${analysis.positive_count} תגובות חיוביות — שתף ובנה סוציאל פרוף`,
        category: 'opportunity',
        impact_level: 'medium',
        recommended_action: `שבחים נפוצים: ${analysis.top_praise.join(', ')}.\n\nהמלצה: שתף ביקורות חיוביות כ-Story, בקש מלקוחות מרוצים להשאיר ביקורת ב-Google`,
        confidence: 80,
        source_urls: '',
        is_read: false,
        detected_at: new Date().toISOString(),
        linked_business: businessProfileId,
      },
    }).catch(() => {});
    signalsCreated++;
  }

  return { signalsCreated, analysis };
}

export async function analyzeSocialComments(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const fbAccount = await prisma.socialAccount.findFirst({
      where: { linked_business: businessProfileId, platform: 'facebook_page', is_connected: true },
    });

    // ── Path A: Facebook Graph API (OAuth connected) ──────────────────────────
    if (fbAccount?.access_token && fbAccount?.page_id) {
      const pageToken = fbAccount.access_token;
      const pageId    = fbAccount.page_id;

      const postsData = await fbGet(`/${pageId}/posts?fields=id,message,created_time&limit=10`, pageToken);
      const posts: any[] = postsData?.data || [];

      if (posts.length === 0) {
        await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
        return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: true });
      }

      const commentFetches = await Promise.all(
        posts.slice(0, 5).map(p =>
          fbGet(`/${p.id}/comments?fields=message,from,created_time&limit=20`, pageToken),
        ),
      );

      const allComments: string[] = [];
      for (const result of commentFetches) {
        if (!result?.data) continue;
        for (const comment of result.data) { if (comment.message) allComments.push(comment.message); }
      }

      if (allComments.length === 0) {
        await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
        return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: true });
      }

      const { signalsCreated, analysis } = await analyzeAndSave(profile, businessProfileId, allComments);

      await prisma.socialAccount.update({
        where: { id: fbAccount.id },
        data: { last_sync: new Date().toISOString() },
      }).catch(() => {});

      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, signalsCreated);
      return res.json({
        comments_analyzed: allComments.length,
        signals_created:   signalsCreated,
        page_connected:    true,
        sentiment:         analysis?.overall_sentiment,
        positive_count:    analysis?.positive_count,
        negative_count:    analysis?.negative_count,
      });
    }

    // ── Path B: Apify scraper — uses facebook_url entered during onboarding ───
    const facebookUrl: string | null = (profile as any).facebook_url || null;
    if (APIFY_KEY && facebookUrl) {
      console.log(`[analyzeSocialComments] No OAuth — falling back to Apify for ${facebookUrl}`);
      const items = await apifyRun('apify~facebook-posts-scraper', {
        startUrls: [{ url: facebookUrl }],
        maxPosts: 10,
        maxPostComments: 20,
        maxPostReactions: 0,
      });

      const allComments: string[] = [];
      for (const item of items) {
        const comments: any[] = item.comments || item.topComments || [];
        for (const c of comments) {
          const text = c.text || c.message || '';
          if (text.length > 3) allComments.push(text);
        }
      }

      if (allComments.length === 0) {
        await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
        console.log(`analyzeSocialComments done (Apify): no comments found for ${facebookUrl}`);
        return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: false, note: 'No comments found via Apify', source: 'apify' });
      }

      const { signalsCreated, analysis } = await analyzeAndSave(profile, businessProfileId, allComments);
      await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, signalsCreated);
      console.log(`analyzeSocialComments done (Apify): ${allComments.length} comments, ${signalsCreated} signals`);
      return res.json({
        comments_analyzed: allComments.length,
        signals_created:   signalsCreated,
        page_connected:    false,
        sentiment:         analysis?.overall_sentiment,
        positive_count:    analysis?.positive_count,
        negative_count:    analysis?.negative_count,
        source:            'apify',
      });
    }

    // ── No data source available ──────────────────────────────────────────────
    await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0);
    return res.json({ comments_analyzed: 0, signals_created: 0, page_connected: false, message: 'Facebook לא מחובר ולא הוזן URL' });

  } catch (err: any) {
    console.error('[analyzeSocialComments] error:', err.message);
    await writeAutomationLog('analyzeSocialComments', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
