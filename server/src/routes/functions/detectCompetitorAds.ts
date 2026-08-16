import { createHash, randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { searchAllAds, hasSearchApiKey, AdResult } from '../../lib/searchapi';
import { uploadImageFromUrl, isS3Configured } from '../../lib/s3';
import { analyzePostCreative } from '../../lib/analyzePostCreative';
import { findDonorCandidates, DonorCandidate, DonorPlatform } from '../../lib/competitorDonor';

function adContentHash(a: AdResult) {
  return createHash('sha256')
    .update(`${a.platform}|${a.title}|${a.body}|${a.cta}`)
    .digest('hex');
}

async function upsertAdHistory(competitorId: string, businessProfileId: string, ads: AdResult[]) {
  const s3 = isS3Configured();
  // Rows needing creative analysis — newly inserted, or existing-but-never-analyzed
  // (backfills ads that were scraped before this feature existed).
  const rowsNeedingAnalysis: Array<{ id: string; media_url: string | null; caption: string; cta: string | null; platform: string }> = [];
  for (const ad of ads) {
    const content_hash   = adContentHash(ad);
    const external_ad_id = ad.external_ad_id || null;

    // Upload media to S3 for permanent URLs; fall back to CDN URL if S3 not configured
    const media_url = ad.media_url && s3
      ? (await uploadImageFromUrl(ad.media_url, 'competitor-ads') ?? ad.media_url)
      : ad.media_url || null;
    const video_url = ad.video_url && s3
      ? (await uploadImageFromUrl(ad.video_url, 'competitor-ads') ?? ad.video_url)
      : ad.video_url || null;

    // Lookup existing by external_ad_id if available, else by content_hash
    const lookup = external_ad_id
      ? `"competitor_id"=$1 AND "platform"=$2 AND "external_ad_id"=$3`
      : `"competitor_id"=$1 AND "platform"=$2 AND "content_hash"=$3`;
    const existing = await (prisma as any).$queryRawUnsafe(
      `SELECT id, analyzed_at FROM "competitor_ad_history" WHERE ${lookup} LIMIT 1`,
      competitorId, ad.platform, external_ad_id ?? content_hash,
    ).catch(() => []) as { id: string; analyzed_at: string | null }[];

    const caption = [ad.title, ad.body].filter(Boolean).join(' — ');

    if (existing?.length > 0) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE "competitor_ad_history" SET
          is_active=$1, last_seen_at=NOW(),
          title=$2, body=$3, cta=$4, link=$5,
          media_url=$6, video_url=$7, page_name=$8, end_date=$9
         WHERE id=$10`,
        true,
        ad.title || null, ad.body || null, ad.cta || null, ad.link || null,
        media_url, video_url, ad.page_name || null, ad.end_date || null,
        existing[0].id,
      ).catch(() => {});
      if (!existing[0].analyzed_at && media_url) {
        rowsNeedingAnalysis.push({ id: existing[0].id, media_url, caption, cta: ad.cta || null, platform: ad.platform });
      }
    } else {
      const newId = randomUUID();
      await (prisma as any).$executeRawUnsafe(
        `INSERT INTO "competitor_ad_history"
          (id, competitor_id, linked_business, platform, external_ad_id, content_hash,
           title, body, cta, link, media_url, video_url, page_name, start_date, end_date,
           is_active, first_seen_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,NOW(),NOW())`,
        newId, competitorId, businessProfileId, ad.platform,
        external_ad_id, content_hash,
        ad.title || null, ad.body || null, ad.cta || null, ad.link || null,
        media_url, video_url, ad.page_name || null,
        ad.start_date || null, ad.end_date || null,
      ).catch(() => {});
      rowsNeedingAnalysis.push({ id: newId, media_url, caption, cta: ad.cta || null, platform: ad.platform });
    }
  }
  return rowsNeedingAnalysis;
}

const MIN_INTERVAL_MS     = 48 * 60 * 60 * 1000; // 48h between full runs (saves API credits)
const PER_COMP_INTERVAL_MS = 48 * 60 * 60 * 1000; // skip individual competitor if scanned within 48h

// Cross-business cache: another business may already have a fresh ad scan of this
// exact real-world competitor. Checks google_place_id + each set social URL (ads
// aren't tied to one platform the way posts are, so no single platform to match on).
async function findAdsDonor(comp: any, businessProfileId: string): Promise<(DonorCandidate & { sponsored_ads_updated_at: string }) | null> {
  const platforms: DonorPlatform[] = ['instagram', 'facebook', 'tiktok'];
  const byId = new Map<string, DonorCandidate>();
  for (const platform of platforms) {
    const urlValue = comp[`${platform}_url`] ?? null;
    if (!comp.google_place_id && !urlValue) continue;
    const found = await findDonorCandidates(comp.id, businessProfileId, {
      googlePlaceId: comp.google_place_id ?? null, platform, urlValue,
    });
    for (const d of found) byId.set(d.id, d);
  }
  if (byId.size === 0) return null;

  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id, sponsored_ads_updated_at FROM competitors
     WHERE id = ANY($1::text[]) AND sponsored_ads_updated_at IS NOT NULL
     ORDER BY sponsored_ads_updated_at DESC LIMIT 1`,
    Array.from(byId.keys()),
  ) as { id: string; sponsored_ads_updated_at: string }[];
  if (rows.length === 0) return null;
  if (Date.now() - new Date(rows[0].sponsored_ads_updated_at).getTime() >= PER_COMP_INTERVAL_MS) return null;

  return { ...byId.get(rows[0].id)!, sponsored_ads_updated_at: rows[0].sponsored_ads_updated_at };
}

async function cloneAdsFromDonor(competitorId: string, businessProfileId: string, donorCompetitorId: string) {
  const clonedCount = await (prisma as any).$executeRawUnsafe(
    `INSERT INTO "competitor_ad_history"
       (id, competitor_id, linked_business, platform, external_ad_id, content_hash,
        title, body, cta, link, media_url, video_url, page_name, start_date, end_date,
        is_active, first_seen_at, last_seen_at, analysis, analyzed_at, has_offer, has_cta)
     SELECT gen_random_uuid()::text, $1, $2, d.platform, d.external_ad_id, d.content_hash,
            d.title, d.body, d.cta, d.link, d.media_url, d.video_url, d.page_name, d.start_date, d.end_date,
            d.is_active, NOW(), NOW(), d.analysis, d.analyzed_at, d.has_offer, d.has_cta
     FROM "competitor_ad_history" d
     WHERE d.competitor_id = $3
       AND NOT EXISTS (
         SELECT 1 FROM "competitor_ad_history" o
         WHERE o.competitor_id = $1 AND o.platform = d.platform
           AND ( (d.external_ad_id IS NOT NULL AND o.external_ad_id = d.external_ad_id)
              OR (d.content_hash IS NOT NULL AND o.content_hash = d.content_hash) )
       )`,
    competitorId, businessProfileId, donorCompetitorId,
  );

  const donorComp = await prisma.competitor.findUnique({ where: { id: donorCompetitorId } });
  if (donorComp) {
    await prisma.competitor.update({
      where: { id: competitorId },
      data: {
        sponsored_ads_detected:   donorComp.sponsored_ads_detected,
        sponsored_ads_updated_at: new Date().toISOString(),
        active_ad_platforms:      donorComp.active_ad_platforms,
        active_ad_count:          donorComp.active_ad_count,
        active_ads_summary:       donorComp.active_ads_summary,
        ad_target_audience:       donorComp.ad_target_audience,
        ad_strategy_summary:      donorComp.ad_strategy_summary,
        ad_spend_signal:          donorComp.ad_spend_signal,
        ad_gaps:                  donorComp.ad_gaps,
        ad_intel_updated_at:      donorComp.ad_intel_updated_at,
      },
    }).catch(() => {});
  }
  return clonedCount as number;
}

/**
 * detectCompetitorAds — scans Meta Ads Library, TikTok Ads Library and Google Ads
 * for every known competitor, then:
 *
 * 1. Detects active paid campaigns across all three platforms
 * 2. LLM extracts: what product/service is being promoted, messaging angle, CTA
 * 3. Updates Competitor record: sponsored_ads_detected, last_promo_detected,
 *    active_ad_platforms, active_ad_count, active_ads_summary
 * 4. Creates ProactiveAlert (alert_type='competitor_ads') when active campaign found
 *
 * Requires: SEARCHAPI_API_KEY env var
 */
export async function detectCompetitorAds(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  if (!hasSearchApiKey()) {
    await writeAutomationLog('detectCompetitorAds', businessProfileId, startTime, 0);
    return res.json({ processed: 0, skipped: true, reason: 'SEARCHAPI_API_KEY not set' });
  }

  if (!req.body.force && shouldSkipAgent(businessProfileId, 'detectCompetitorAds', MIN_INTERVAL_MS)) {
    return res.json({ processed: 0, skipped: true, reason: 'ran_recently' });
  }

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId, not_relevant: false, tracking_status: 'approved' },
      orderBy: { last_scanned: 'asc' },
      take: 6,
    });

    if (competitors.length === 0) {
      await writeAutomationLog('detectCompetitorAds', businessProfileId, startTime, 0);
      return res.json({ processed: 0, note: 'No competitors' });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    let processed = 0;
    let alertsCreated = 0;

    for (const comp of competitors) {
      try {
        // Per-competitor 48h guard — skip if scanned recently
        const c = comp as any;
        const lastScanned = c.sponsored_ads_updated_at
          ? new Date(c.sponsored_ads_updated_at).getTime() : 0;
        if (!req.body.force && Date.now() - lastScanned < PER_COMP_INTERVAL_MS) {
          console.log(`[detectCompetitorAds] skipping ${comp.name} — scanned recently`);
          continue;
        }

        if (!req.body.force) {
          const donor = await findAdsDonor(c, businessProfileId);
          if (donor) {
            const cloned = await cloneAdsFromDonor(comp.id, businessProfileId, donor.id);
            console.log(`[detectCompetitorAds] cloned ${cloned} ads for ${comp.name} from donor ${donor.id} (business ${donor.linked_business}) — skipped SearchAPI/LLM`);
            processed++;
            continue;
          }
        }

        console.log(`[detectCompetitorAds] scanning ads for: ${comp.name}`);

        const fbHandle  = c.facebook_url
          ? c.facebook_url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split(/[/?#]/)[0].replace(/^@/, '') || null
          : null;
        const tikHandle = c.tiktok_url
          ? c.tiktok_url.replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').split(/[/?#]/)[0].replace(/^@/, '') || null
          : null;

        const ads = await searchAllAds(comp.name, profile.category || '', profile.city || '', fbHandle, tikHandle);

        // ── Update competitor record ─────────────────────────────────────────
        const platforms = [...new Set(ads.map(a => a.platform))];
        const compUpdate: Record<string, any> = {
          sponsored_ads_detected:   ads.length > 0,
          sponsored_ads_updated_at: new Date().toISOString(),
        };
        if (ads.length > 0) {
          compUpdate.active_ad_platforms = platforms.join(', ');
          compUpdate.active_ad_count     = ads.length;
          // Store compact summary of active ads
          compUpdate.active_ads_summary  = JSON.stringify(
            ads.slice(0, 5).map(a => ({
              platform: a.platform,
              title:    a.title?.slice(0, 80),
              body:     a.body?.slice(0, 120),
              cta:      a.cta,
              start:    a.start_date,
            }))
          );
        } else {
          compUpdate.active_ad_platforms      = null;
          compUpdate.active_ad_count          = 0;
          compUpdate.active_ads_summary       = null;
          compUpdate.last_promo_detected      = null;
          compUpdate.last_promo_detected_at   = null;
          compUpdate.ad_target_audience       = null;
          compUpdate.ad_strategy_summary      = null;
          compUpdate.ad_spend_signal          = null;
          compUpdate.ad_gaps                  = null;
          compUpdate.ad_intel_updated_at      = null;
        }

        await prisma.competitor.update({ where: { id: comp.id }, data: compUpdate }).catch(() => {});

        if (ads.length === 0) {
          // Mark all history rows for this competitor inactive
          await prisma.competitorAdHistory.updateMany({
            where: { competitor_id: comp.id },
            data:  { is_active: false },
          }).catch(() => {});
          processed++;
          continue;
        }

        // Persist ad history (append-only upsert)
        const adRowsNeedingAnalysis = await upsertAdHistory(comp.id, businessProfileId, ads);

        // Analyze ad creatives (topic/offer/hooks/style/cta) — new ads, plus a
        // backfill for existing ads never analyzed. Best-effort, never blocks the agent.
        for (const row of adRowsNeedingAnalysis) {
          if (!row.media_url) continue;
          try {
            const creative = await analyzePostCreative({
              caption: row.caption, cta: row.cta, platform: row.platform, mediaUrl: row.media_url,
            });
            if (creative) {
              await (prisma as any).$executeRawUnsafe(
                `UPDATE "competitor_ad_history" SET analysis=$1, analyzed_at=NOW(), has_offer=$2, has_cta=$3 WHERE id=$4`,
                JSON.stringify(creative), creative.has_offer, creative.has_cta, row.id,
              ).catch(() => {});
            }
          } catch (analysisErr: any) {
            console.warn('[detectCompetitorAds] creative analysis failed:', analysisErr.message);
          }
        }

        // ── LLM analysis ─────────────────────────────────────────────────────
        const adSummary = ads
          .map(a =>
            `[${a.platform.toUpperCase()}] ${a.title ? `כותרת: ${a.title} | ` : ''}` +
            `${a.body ? `טקסט: ${a.body} | ` : ''}` +
            `${a.cta ? `CTA: ${a.cta} | ` : ''}` +
            `${a.audience_est ? `קהל: ${a.audience_est} | ` : ''}` +
            `${a.start_date ? `פעיל מ: ${a.start_date?.slice(0,10)}` : ''}`
          )
          .join('\n');

        const analysis = await invokeLLM({
          model: 'haiku',
          maxTokens: 500,
          prompt: `You are a competitive intelligence analyst. My business is "${profile.name}" (${profile.category}, ${profile.city}).
The competitor "${comp.name}" is currently running paid ad campaigns.

Active campaigns found:
${adSummary.slice(0, 2000)}

Analyze and return ONLY valid JSON. ALL string values MUST be in Hebrew:
{
  "platforms_summary": "פייסבוק / אינסטגרם / טיקטוק / גוגל — פירוט קצר",
  "promoted_product": "מה הם מקדמים — מוצר/שירות ספציפי",
  "messaging_angle": "מה הזווית השיווקית — מחיר/רגש/מבצע/חדשנות",
  "cta_action": "מה קוראים לעשות — 'הזמן עכשיו' / 'קבל הצעה' / וכו'",
  "urgency": "high|medium|low",
  "our_counter_action": "פעולה ספציפית שאנחנו צריכים לעשות עכשיו כדי להתמודד"
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (!analysis) { processed++; continue; }

        // Save promo description to competitor
        if (analysis.promoted_product) {
          await (prisma.competitor.update as any)({
            where: { id: comp.id },
            data: {
              last_promo_detected:    `${analysis.platforms_summary}: ${analysis.promoted_product}`,
              last_promo_detected_at: new Date().toISOString(),
            },
          }).catch(() => {});
        }

        // ── Claude Sonnet deep intel analysis ────────────────────────────────
        // Extracts strategic signals: target audience, spend level, gaps = our opportunities
        const deepIntel: any = await invokeLLM({
          model: 'sonnet',
          maxTokens: 600,
          prompt: `You are a senior competitive intelligence analyst for Israeli businesses.
My business: "${profile.name}" (${profile.category}, ${profile.city}).
Competitor "${comp.name}" is running ${ads.length} paid ad campaigns across ${platforms.join(', ')}.

Campaign data:
${adSummary.slice(0, 2500)}

Based on the ad creatives, targeting signals, and messaging — perform a deep strategic analysis.
Return ONLY valid JSON. ALL string values MUST be in Hebrew:
{
  "ad_target_audience": "מי הם מנסים להגיע אליו — גיל/מגדר/תחומי עניין/בולטת גיאוגרפית",
  "ad_strategy_summary": "מה האסטרטגיה הכוללת שלהם ב-1-2 משפטים — מותג/מחיר/רגש/נישה",
  "ad_spend_signal": "low|medium|high",
  "ad_gaps": "מה הם לא מפרסמים — מוצרים/שירותים/קהלים שפנויים לנו לתפוס"
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (deepIntel) {
          await (prisma.competitor.update as any)({
            where: { id: comp.id },
            data: {
              ad_target_audience:  deepIntel.ad_target_audience  || null,
              ad_strategy_summary: deepIntel.ad_strategy_summary || null,
              ad_spend_signal:     deepIntel.ad_spend_signal     || null,
              ad_gaps:             deepIntel.ad_gaps             || null,
              ad_intel_updated_at: new Date().toISOString(),
            },
          }).catch(() => {});
        }

        // ── ProactiveAlert ───────────────────────────────────────────────────
        const existingAlert = await prisma.proactiveAlert.findFirst({
          where: {
            linked_business: businessProfileId,
            alert_type:      'competitor_ads',
            title:           { contains: comp.name },
            is_dismissed:    false,
            created_at:      { gte: sevenDaysAgo },
          },
          select: { id: true },
        });

        if (!existingAlert) {
          const platformEmojis: Record<string, string> = {
            facebook: '📘', instagram: '📸', tiktok: '🎵', google: '🔍',
          };
          const platformBadges = platforms.map(p => `${platformEmojis[p] || '📣'}${p}`).join(' + ');

          const alertTitle  = `${comp.name}: קמפיין ממומן פעיל — ${platformBadges}`;
          const description = [
            `📍 פלטפורמות: ${analysis.platforms_summary}`,
            `🎯 מקדמים: ${analysis.promoted_product}`,
            `💬 זווית: ${analysis.messaging_angle}`,
            `👆 CTA: ${analysis.cta_action}`,
          ].join('\n');

          await prisma.proactiveAlert.create({
            data: {
              linked_business:  businessProfileId,
              alert_type:       'competitor_ads',
              title:            alertTitle,
              description,
              suggested_action: analysis.our_counter_action || '',
              priority:         analysis.urgency === 'high' ? 'high' : 'medium',
              source_agent:     JSON.stringify({
                action_label:    'צור תגובה שיווקית',
                action_type:     'social_post',
                prefilled_text:  `${comp.name} מריץ קמפיין:\n\n${description}\n\n💡 המלצה: ${analysis.our_counter_action}`,
                urgency_hours:   analysis.urgency === 'high' ? 24 : 48,
                impact_reason:   `${comp.name} מפרסם ממומן ב-${platforms.join('/')}`,
                competitor_id:   comp.id,
                competitor_name: comp.name,
                ad_platforms:    platforms,
                ad_count:        ads.length,
              }),
              is_dismissed: false,
              is_acted_on:  false,
              created_at:   new Date().toISOString(),
            },
          }).catch(() => {});

          alertsCreated++;
        }

        // ── MarketSignal ─────────────────────────────────────────────────────
        await prisma.marketSignal.create({
          data: {
            linked_business:    businessProfileId,
            summary:            `${comp.name} מריץ ${ads.length} מודעות ממומנות (${platforms.join(', ')})`,
            impact_level:       analysis.urgency === 'high' ? 'high' : 'medium',
            category:           'competitor_ads',
            recommended_action: analysis.our_counter_action || '',
            confidence:         0.9,
            source_type:        'agent',
            agent_name:         'detectCompetitorAds',
            source_description: `${analysis.promoted_product} | ${analysis.messaging_angle}`,
            is_dismissed:       false,
            detected_at:        new Date().toISOString(),
          },
        }).catch(() => {});

        processed++;
      } catch (e: any) {
        console.warn(`[detectCompetitorAds] ${comp.name}:`, e.message);
      }
    }

    setLastRun(businessProfileId, 'detectCompetitorAds');
    await writeAutomationLog('detectCompetitorAds', businessProfileId, startTime, processed);
    return res.json({ processed, alerts_created: alertsCreated });
  } catch (err: any) {
    console.error('[detectCompetitorAds]', err.message);
    await writeAutomationLog('detectCompetitorAds', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
