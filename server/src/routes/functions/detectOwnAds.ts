import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { searchAllAds, hasSearchApiKey, AdResult } from '../../lib/searchapi';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';

// Own-business twin of detectCompetitorAds.ts — same ad-library search + per-ad
// creative analysis, single target (the business itself, no competitor batching),
// LLM strategy summary reframed as a self-audit rather than competitive intel.
// business_ad_history uses TIMESTAMP(3) columns, so this uses plain typed Prisma
// calls with no pgHex/raw-SQL workarounds.

const MIN_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h

function adContentHash(a: AdResult) {
  return createHash('sha256').update(`${a.platform}|${a.title}|${a.body}|${a.cta}`).digest('hex');
}

async function upsertAdHistory(businessProfileId: string, ads: AdResult[]) {
  const s3 = isS3Configured();
  const rowsNeedingAnalysis: Array<{ id: string; media_url: string | null; caption: string; cta: string | null; platform: string }> = [];

  for (const ad of ads) {
    const content_hash = adContentHash(ad);
    const external_ad_id = ad.external_ad_id || null;

    const media_url = ad.media_url && s3
      ? (await uploadImageFromUrl(ad.media_url, 'business-ads') ?? ad.media_url)
      : ad.media_url || null;
    const video_url = ad.video_url && s3
      ? (await uploadImageFromUrl(ad.video_url, 'business-ads') ?? ad.video_url)
      : ad.video_url || null;

    const existing = await prisma.businessAdHistory.findFirst({
      where: external_ad_id
        ? { linked_business: businessProfileId, platform: ad.platform, external_ad_id }
        : { linked_business: businessProfileId, platform: ad.platform, content_hash },
      select: { id: true, analyzed_at: true },
    });

    const caption = [ad.title, ad.body].filter(Boolean).join(' — ');

    if (existing) {
      await prisma.businessAdHistory.update({
        where: { id: existing.id },
        data: {
          is_active: true,
          last_seen_at: new Date(),
          title: ad.title || null,
          body: ad.body || null,
          cta: ad.cta || null,
          link: ad.link || null,
          media_url,
          video_url,
          page_name: ad.page_name || null,
          end_date: ad.end_date || null,
        },
      }).catch(() => {});
      if (!existing.analyzed_at && media_url) {
        rowsNeedingAnalysis.push({ id: existing.id, media_url, caption, cta: ad.cta || null, platform: ad.platform });
      }
    } else {
      const created = await prisma.businessAdHistory.create({
        data: {
          linked_business: businessProfileId,
          platform: ad.platform,
          external_ad_id,
          content_hash,
          title: ad.title || null,
          body: ad.body || null,
          cta: ad.cta || null,
          link: ad.link || null,
          media_url,
          video_url,
          page_name: ad.page_name || null,
          start_date: ad.start_date || null,
          end_date: ad.end_date || null,
          is_active: true,
        },
      }).catch(() => null);
      if (created) rowsNeedingAnalysis.push({ id: created.id, media_url, caption, cta: ad.cta || null, platform: ad.platform });
    }
  }
  return rowsNeedingAnalysis;
}

/**
 * detectOwnAds — scans Meta Ads Library, TikTok Ads Library and Google Ads for the
 * business's own page/brand (catches any ad currently running, not just ones
 * created through this tool), then runs a self-audit LLM pass on the result:
 * is our own ad messaging coherent, who are we actually targeting, what's missing.
 * Persists a MarketSignal (category 'own_ad_audit') with the summary — no
 * ProactiveAlert, since "you are running your own ad" isn't an actionable alert
 * the way a competitor's new campaign is.
 *
 * Requires: SEARCHAPI_API_KEY env var
 */
export async function detectOwnAds(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  if (!hasSearchApiKey()) {
    await writeAutomationLog('detectOwnAds', businessProfileId, startTime, 0);
    return res.json({ processed: 0, skipped: true, reason: 'SEARCHAPI_API_KEY not set' });
  }

  if (!force && shouldSkipAgent(businessProfileId, 'detectOwnAds', MIN_INTERVAL_MS)) {
    return res.json({ processed: 0, skipped: true, reason: 'ran_recently' });
  }

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const fbHandle = profile.facebook_url
      ? profile.facebook_url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split(/[/?#]/)[0].replace(/^@/, '') || null
      : null;
    const tikHandle = profile.tiktok_url
      ? profile.tiktok_url.replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').split(/[/?#]/)[0].replace(/^@/, '') || null
      : null;

    const ads = await searchAllAds(profile.name, profile.category || '', profile.city || '', fbHandle, tikHandle);

    if (ads.length === 0) {
      await prisma.businessAdHistory.updateMany({
        where: { linked_business: businessProfileId },
        data: { is_active: false },
      }).catch(() => {});
      setLastRun(businessProfileId, 'detectOwnAds');
      await writeAutomationLog('detectOwnAds', businessProfileId, startTime, 0);
      return res.json({ processed: 0, note: 'No active ads found' });
    }

    const platforms = [...new Set(ads.map(a => a.platform))];
    const adRowsNeedingAnalysis = await upsertAdHistory(businessProfileId, ads);

    for (const row of adRowsNeedingAnalysis) {
      if (!row.media_url) continue;
      try {
        const creative = await analyzePostCreative({ caption: row.caption, cta: row.cta, platform: row.platform, mediaUrl: row.media_url });
        if (creative) {
          await prisma.businessAdHistory.update({
            where: { id: row.id },
            data: { analysis: JSON.stringify(creative), analyzed_at: new Date(), has_offer: creative.has_offer, has_cta: creative.has_cta },
          }).catch(() => {});
        }
      } catch (analysisErr: any) {
        console.warn('[detectOwnAds] creative analysis failed:', analysisErr.message);
      }
    }

    // ── Self-audit LLM pass ────────────────────────────────────────────────
    const adSummary = ads
      .map(a =>
        `[${a.platform.toUpperCase()}] ${a.title ? `כותרת: ${a.title} | ` : ''}` +
        `${a.body ? `טקסט: ${a.body} | ` : ''}` +
        `${a.cta ? `CTA: ${a.cta} | ` : ''}` +
        `${a.start_date ? `פעיל מ: ${a.start_date?.slice(0, 10)}` : ''}`
      )
      .join('\n');

    const audit: any = await invokeLLM({
      model: 'sonnet',
      maxTokens: 600,
      prompt: `You are a senior marketing strategist doing a self-audit for the business "${profile.name}" (${profile.category}, ${profile.city}).
This is OUR OWN ad activity, scraped from public ad libraries — not a competitor.
We are currently running ${ads.length} paid ad campaigns across ${platforms.join(', ')}.

Campaign data:
${adSummary.slice(0, 2500)}

Assess our own ad strategy. Return ONLY valid JSON. ALL string values MUST be in Hebrew:
{
  "target_audience": "מי אנחנו כרגע מכוונים אליו לפי המודעות — גיל/מגדר/תחומי עניין",
  "strategy_summary": "מה האסטרטגיה הכוללת שלנו כרגע ב-1-2 משפטים",
  "consistency_note": "האם המסרים עקביים בין הפלטפורמות, או שיש חוסר אחידות בטון/מיתוג",
  "gaps": "אילו קהלים/מוצרים/פלטפורמות אנחנו לא מפרסמים אליהם כרגע"
}`,
      response_json_schema: { type: 'object' },
    }) as any;

    if (audit) {
      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: `ביקורת עצמית: ${ads.length} מודעות פעילות (${platforms.join(', ')}) — ${audit.strategy_summary || ''}`,
          impact_level: 'medium',
          category: 'own_ad_audit',
          recommended_action: audit.gaps || '',
          confidence: 0.85,
          source_type: 'agent',
          agent_name: 'detectOwnAds',
          source_description: `קהל יעד: ${audit.target_audience || ''} | עקביות: ${audit.consistency_note || ''}`,
          is_dismissed: false,
          detected_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }

    setLastRun(businessProfileId, 'detectOwnAds');
    await writeAutomationLog('detectOwnAds', businessProfileId, startTime, adRowsNeedingAnalysis.length);
    return res.json({ processed: ads.length, platforms });
  } catch (err: any) {
    console.error('[detectOwnAds]', err.message);
    await writeAutomationLog('detectOwnAds', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
