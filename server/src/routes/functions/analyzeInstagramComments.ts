import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const GRAPH_BASE  = 'https://graph.facebook.com/v19.0';
const APIFY_KEY   = process.env.APIFY_API_KEY || '';

// ── Apify helper — run actor and wait for result ─────────────────────────────
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
        prompt: `נתח את הסנטימנט של התגובות הבאות מ-Instagram. לכל תגובה החזר: positive/negative/neutral.

שם העסק: "${profile.name}"
תגובות:
${batch.map((t, idx) => `${idx + 1}. "${t.substring(0, 150)}"`).join('\n')}

החזר JSON בלבד:
{ "sentiments": ["positive","negative","neutral",...], "urgent_negative": ["טקסט תגובה אם דחוף לטפל"] }`,
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
    }).catch(() => {});
  }

  return { commentsAnalyzed, negativeCount, urgentAlerts: negativeComments.length };
}

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
      const posts: any[] = (await mediaRes.json()).data || [];
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

      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, result.commentsAnalyzed);
      console.log(`analyzeInstagramComments done (OAuth): ${result.commentsAnalyzed} comments, ${result.negativeCount} negative`);
      return res.json({ comments_analyzed: result.commentsAnalyzed, negative_count: result.negativeCount, urgent_alerts: result.urgentAlerts });
    }

    // ── Path B: Apify scraper — uses instagram_url entered during onboarding ──
    const instagramUrl: string | null = (profile as any).instagram_url || null;
    if (APIFY_KEY && instagramUrl) {
      console.log(`[analyzeInstagramComments] No OAuth — falling back to Apify for ${instagramUrl}`);
      const items = await apifyRun('apify~instagram-scraper', {
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
      await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, result.commentsAnalyzed);
      console.log(`analyzeInstagramComments done (Apify): ${result.commentsAnalyzed} comments, ${result.negativeCount} negative`);
      return res.json({ comments_analyzed: result.commentsAnalyzed, negative_count: result.negativeCount, urgent_alerts: result.urgentAlerts, source: 'apify' });
    }

    // ── No data source available ──────────────────────────────────────────────
    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0);
    return res.json({ comments_analyzed: 0, note: 'Instagram not connected and no URL provided' });

  } catch (err: any) {
    console.error('analyzeInstagramComments error:', err.message);
    await writeAutomationLog('analyzeInstagramComments', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
