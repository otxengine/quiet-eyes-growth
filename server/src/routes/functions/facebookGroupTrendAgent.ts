/**
 * facebookGroupTrendAgent — Scans Facebook groups and pages for sector trends.
 *
 * Facebook groups are often where consumers discuss products/services before
 * they trend elsewhere — useful "word of mouth" early signal.
 *
 * Sources:
 *   • Tavily searches targeting Facebook groups + pages
 *   • US groups (leading indicator) + IL groups
 *
 * Memory: URL-based checkpoint — never re-fetches the same post/thread.
 *
 * Universal: generates relevant Facebook group queries from business
 *   profile using Claude Haiku — no hardcoded sector assumptions.
 *
 * Output: MarketSignal with category='facebook_trend'
 *         platform_trend record
 *
 * Schedule: every 24h
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';
import { tavilyAdvancedSearch } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import {
  loadCheckpoint, saveCheckpoint, shouldSkipByTime, filterNewUrls,
} from '../../lib/trendMemory';
import { getTrendContext, isSignalIrrelevant } from '../../lib/trendContext';

const MIN_INTERVAL = 20 * 60 * 60 * 1000; // 20h

// ── Build Facebook search queries (universal) ─────────────────────────────────

function buildFBQueries(
  category: string,
  city: string,
  services: string,
  country: string,
): string[] {
  const svcTerms = (services || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
  const year = new Date().getFullYear();

  return [
    // Facebook groups in sector
    `site:facebook.com/groups "${category}" ${country} חדש פופולרי ${year}`,
    `site:facebook.com/groups "${category}" ${country} trending popular ${year}`,
    // Facebook pages discussion
    `site:facebook.com "${category}" ${city} ${country} מגמה חדשה`,
    // Service-specific group discussions
    ...svcTerms.map(s => `site:facebook.com/groups "${s}" ${country}`),
    // Broader: what's being talked about in this sector on FB
    `facebook.com "${category}" ${country} ממליץ מומלץ חדש ${year}`,
    `"${category}" facebook group ${country} popular growing trend`,
  ];
}

// ── Main agent ─────────────────────────────────────────────────────────────────

export async function facebookGroupTrendAgent(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const { name, category, city, relevant_services = '' } = profile;

    // ── Load AI intelligence context ───────────────────────────────────────
    const trendCtx = await getTrendContext(businessProfileId, 'facebookGroupTrendAgent');

    // ── Checkpoint ────────────────────────────────────────────────────────
    const cpIL = await loadCheckpoint('facebookGroupTrendAgent', businessProfileId, 'facebook', 'IL');
    const cpUS = await loadCheckpoint('facebookGroupTrendAgent', businessProfileId, 'facebook', 'US');
    if (shouldSkipByTime(cpIL, MIN_INTERVAL) && shouldSkipByTime(cpUS, MIN_INTERVAL)) {
      return res.json({ signals_created: 0, skipped: true, reason: 'ran_recently' });
    }

    let signalsCreated = 0;

    for (const region of ['IL', 'US'] as const) {
      const cp = region === 'IL' ? cpIL : cpUS;
      if (shouldSkipByTime(cp, MIN_INTERVAL)) continue;

      const country = region === 'IL' ? 'Israel ישראל' : 'United States';
      const queries  = buildFBQueries(category, city, relevant_services, country);

      // Fetch results
      const rawResults = (
        await Promise.all(queries.slice(0, 5).map(q => tavilyAdvancedSearch(q, 3, 7).catch(() => [])))
      ).flat();

      // Only new URLs
      const allUrls = rawResults.map(r => r.url).filter(Boolean);
      const newUrls = filterNewUrls(allUrls, cp);
      const newResults = rawResults.filter(r => r.url && newUrls.includes(r.url)).slice(0, 15);

      if (newResults.length === 0) {
        await saveCheckpoint(cp, { region, scanned_at: new Date().toISOString(), note: 'no_new_urls' });
        continue;
      }

      const context = newResults
        .map(r => `[${r.url}]\n${(r.content || r.title || '').slice(0, 300)}`)
        .join('\n---\n');

      // ── AI analysis ───────────────────────────────────────────────────
      const result = await callAIJson<{ trends: any[] }>('classify_sector',
        `You are a social media trend analyst. Identify 1-3 rising trends on Facebook for this business.
Business: "${name}" — ${category} in ${city}
Region: ${region === 'US' ? 'United States (leading indicator — arrives in Israel ~3 weeks later)' : 'Israel'}
Services: ${relevant_services || 'not specified'}

${trendCtx.sectorBlock}
${trendCtx.deepProfileBlock}

Facebook content (groups + pages):
${context.slice(0, 2400)}

${trendCtx.trendTypesBlock}

Rules:
• Only include trends backed by specific content above
• Must be relevant to this business's actual confirmed services
• Facebook-specific: note if it's a group discussion, page engagement, or community recommendation
• Detect ALL 10 trend types: new language/slang, content formats, cultural shifts, not just purchase intent

Return ONLY valid JSON. ALL string values in Hebrew:
{"trends":[{
  "name": "שם הטרנד — עד 6 מילים",
  "trend_type": "purchase_intent|content_format|ad_method|language_shift|new_product_service|cultural_value|pricing_trend|sound_music|viral_challenge|seasonal_early",
  "description": "מה אנשים מדברים עליו ולמה — עד 12 מילה",
  "fb_context": "מה ספציפית מדברים בפייסבוק (קבוצה/דף/המלצות)",
  "evidence_url": "URL ספציפי מהנתונים",
  "sentiment": "positive|mixed|negative",
  "engagement_type": "shares|comments|recommendations|group_discussion",
  "opportunity": "מה העסק יכול לעשות עם זה — ספציפי",
  "urgency": "high|medium",
  "confidence": 55
}]}`
      ).catch(() => ({ trends: [] }));

      const rawTrends: any[] = result?.trends || [];
      const validTrends = rawTrends.filter(t => {
        if (!t.name || !t.evidence_url || (t.confidence || 0) < 55 || t.sentiment === 'negative') return false;
        if (isSignalIrrelevant(`${t.name} ${t.description}`, trendCtx.irrelevantTopics)) return false;
        return true;
      });

      // Dedup against recent signals
      const existing = await prisma.marketSignal.findMany({
        where: {
          linked_business: businessProfileId,
          category: 'facebook_trend',
          detected_at: { gte: new Date(Date.now() - 24 * 3600000).toISOString() },
        },
        select: { summary: true },
      });
      const existingNames = new Set(existing.map(s => s.summary));

      for (const trend of validTrends) {
        const prefix = region === 'US' ? '🇺🇸 Facebook US: ' : 'Facebook: ';
        const summaryKey = `${prefix}${trend.name}`;
        if (existingNames.has(summaryKey)) continue;

        const meta = JSON.stringify({
          action_type:             'content_opportunity',
          action_label:            trend.opportunity || trend.name,
          platform:                'facebook',
          trend_type:              trend.trend_type || 'purchase_intent',
          region,
          is_us_leading_indicator: region === 'US',
          fb_context:              trend.fb_context,
          engagement_type:         trend.engagement_type,
          sentiment:               trend.sentiment,
          evidence_url:            trend.evidence_url,
          source_agent:            'facebookGroupTrendAgent',
        });

        await prisma.marketSignal.create({
          data: {
            linked_business:    businessProfileId,
            summary:            summaryKey,
            impact_level:       trend.urgency === 'high' ? 'high' : 'medium',
            category:           'facebook_trend',
            recommended_action: trend.opportunity || '',
            confidence:         trend.confidence || 65,
            source_urls:        trend.evidence_url || '',
            source_description: meta,
            is_read:            false,
            is_dismissed:       false,
            detected_at:        new Date().toISOString(),
          },
        });

        // Save to platform_trend
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO platform_trend
               (id, platform, region, trend_type, trend_name, applicable_sectors,
                stage, evidence_urls, is_us_leading_indicator, first_detected_at,
                last_seen_at, confidence, linked_business, source_agent)
             VALUES (gen_random_uuid()::text, 'facebook', $1, 'community_discussion', $2, $3,
                     'growing', $4, $5, NOW(), NOW(), $6, $7, 'facebookGroupTrendAgent')`,
            region,
            trend.name,
            JSON.stringify([category]),
            JSON.stringify([trend.evidence_url].filter(Boolean)),
            region === 'US',
            trend.confidence || 65,
            businessProfileId,
          );
        } catch {}

        existingNames.add(summaryKey);
        signalsCreated++;
      }

      // Update checkpoint
      newUrls.forEach(u => cp.scannedUrls.add(u));
      await saveCheckpoint(cp, {
        region,
        urls_scanned: newUrls.length,
        trends_saved: signalsCreated,
        scanned_at: new Date().toISOString(),
      });
    }

    await writeAutomationLog('facebookGroupTrendAgent', businessProfileId, startTime, signalsCreated);
    console.log(`[facebookGroupTrendAgent] done: ${signalsCreated} signals`);
    return res.json({ signals_created: signalsCreated });

  } catch (err: any) {
    console.error('[facebookGroupTrendAgent] error:', err.message);
    await writeAutomationLog('facebookGroupTrendAgent', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
