import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { searchAllAds, hasSearchApiKey, AdResult } from '../../lib/searchapi';

function adContentHash(a: AdResult) {
  return createHash('sha256')
    .update(`${a.platform}|${a.title}|${a.body}|${a.cta}`)
    .digest('hex');
}

async function upsertAdHistory(competitorId: string, businessProfileId: string, ads: AdResult[]) {
  const now = new Date();
  for (const ad of ads) {
    const content_hash    = adContentHash(ad);
    const external_ad_id  = ad.external_ad_id || null;
    const where = external_ad_id
      ? { competitor_id_platform_external_ad_id: { competitor_id: competitorId, platform: ad.platform, external_ad_id } }
      : { competitor_id_platform_content_hash:   { competitor_id: competitorId, platform: ad.platform, content_hash: content_hash } };
    await prisma.competitorAdHistory.upsert({
      where,
      create: {
        competitor_id:   competitorId,
        linked_business: businessProfileId,
        platform:        ad.platform,
        external_ad_id,
        content_hash,
        title:           ad.title   || null,
        body:            ad.body    || null,
        cta:             ad.cta     || null,
        link:            ad.link    || null,
        is_active:       true,
        first_seen_at:   now,
        last_seen_at:    now,
      },
      update: {
        is_active:    true,
        last_seen_at: now,
        title:        ad.title || null,
        body:         ad.body  || null,
        cta:          ad.cta   || null,
      },
    }).catch(() => {});
  }
}

const MIN_INTERVAL_MS     = 48 * 60 * 60 * 1000; // 48h between full runs (saves API credits)
const PER_COMP_INTERVAL_MS = 48 * 60 * 60 * 1000; // skip individual competitor if scanned within 48h

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
      where: { linked_business: businessProfileId },
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
        await upsertAdHistory(comp.id, businessProfileId, ads);

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
