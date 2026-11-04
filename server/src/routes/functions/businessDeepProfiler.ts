/**
 * businessDeepProfiler — Scrapes the business's own digital presence and
 * extracts deep business DNA that all agents can use.
 *
 * Sources (in priority order):
 *  1. website_url — Tavily fetch of the actual website content
 *  2. instagram_url — searches for the IG profile on Google/Tavily
 *  3. tiktok_url — searches for TikTok presence
 *  4. facebook_url — fetches Facebook page content via Tavily
 *
 * Output: business_deep_profile JSON stored on BusinessProfile.
 * This gives agents confirmed services, actual prices, real USPs, audience,
 * and content themes — not just what was typed at signup.
 *
 * Schedule: run once at onboarding, then refresh every 30 days.
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callAIJson } from '../../lib/ai_router';
import { tavilyAdvancedSearch } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';
import { type BusinessDeepProfile } from '../../lib/trendContext';

const REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function businessDeepProfiler(req: Request, res: Response) {
  const { businessProfileId, force = false } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({
      where: { id: businessProfileId },
    });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    // Skip if already profiled recently (unless forced)
    const existingRaw = (profile as any).business_deep_profile;
    if (existingRaw && !force) {
      try {
        const existing = JSON.parse(existingRaw) as BusinessDeepProfile;
        const lastScraped = existing.last_scraped_at
          ? new Date(existing.last_scraped_at).getTime()
          : 0;
        if (Date.now() - lastScraped < REFRESH_INTERVAL_MS) {
          return res.json({ skipped: true, reason: 'profiled_recently', last_scraped_at: existing.last_scraped_at });
        }
      } catch {}
    }

    const {
      name,
      category,
      city,
      relevant_services = '',
      website_url,
      instagram_url,
      tiktok_url,
      facebook_url,
    } = profile;

    const urlsToScrape: Array<{ type: string; url: string | null }> = [
      { type: 'website',   url: website_url   || null },
      { type: 'instagram', url: instagram_url || null },
      { type: 'tiktok',    url: tiktok_url    || null },
      { type: 'facebook',  url: facebook_url  || null },
    ];

    // ── Collect raw content from all sources ──────────────────────────────────
    const contentChunks: string[] = [];

    for (const { type, url } of urlsToScrape) {
      if (!url) continue;

      try {
        // Tavily can fetch the page content directly
        const results = await tavilyAdvancedSearch(`site:${extractDomain(url)} ${name}`, 3, 8).catch(() => []);
        const directFetch = await tavilyAdvancedSearch(url, 1, 8).catch(() => []);

        const combined = [...directFetch, ...results].slice(0, 3);
        if (combined.length > 0) {
          const chunk = combined
            .map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 400)}`)
            .join('\n');
          contentChunks.push(`=== ${type.toUpperCase()}: ${url} ===\n${chunk}`);
        } else {
          // Even if fetch fails, record the URL
          contentChunks.push(`=== ${type.toUpperCase()}: ${url} === (fetch failed — URL recorded)`);
        }
      } catch (e: any) {
        console.warn(`[businessDeepProfiler] scrape failed for ${type} (${url}): ${e.message}`);
      }
    }

    // If no URLs were provided, do a Google search for the business
    if (contentChunks.length === 0) {
      const searchResults = await tavilyAdvancedSearch(
        `"${name}" ${category} ${city} ישראל`, 4, 8,
      ).catch(() => []);
      if (searchResults.length > 0) {
        contentChunks.push(
          '=== GOOGLE SEARCH (no URLs provided) ===\n' +
          searchResults.slice(0, 4).map(r => `[${r.url}] ${(r.content || r.title || '').slice(0, 300)}`).join('\n'),
        );
      }
    }

    if (contentChunks.length === 0) {
      await writeAutomationLog('businessDeepProfiler', businessProfileId, startTime, 0);
      return res.json({ skipped: true, reason: 'no_content_found' });
    }

    const combinedContent = contentChunks.join('\n\n').slice(0, 4000);

    // ── LLM: extract deep business DNA ────────────────────────────────────────
    const extracted = await callAIJson<BusinessDeepProfile>('classify_sector',
      `You are a business intelligence analyst. Extract the precise DNA of this business
from their website and social media content.

Business registered as: "${name}" — ${category} in ${city}
Services declared at signup: "${relevant_services || 'not specified'}"

Content scraped from their digital presence:
${combinedContent}

Extract ONLY what is CONFIRMED in the content above — no guessing.
If you can't confirm something, use an empty array or empty string.

Return ONLY valid JSON:
{
  "actual_services": ["specific service 1", "specific service 2"],
  "actual_products": ["product name 1"],
  "price_range": "budget|mid|premium|luxury|unknown",
  "tone_from_website": "professional|friendly|warm|casual|luxury|technical",
  "target_audience_detected": "one sentence describing who their real customers are",
  "content_themes_detected": ["before_after", "educational", "testimonial", "humor", "behind_scenes"],
  "unique_selling_points": ["specific USP 1", "specific USP 2"],
  "brand_keywords": ["keyword1", "keyword2", "keyword3"],
  "social_presence": {
    "instagram": {"followers_approx": "1000-5000", "post_frequency": "daily|few_per_week|weekly", "content_style": "description"},
    "tiktok": {"active": true, "content_style": "description"},
    "facebook": {"active": true, "page_type": "business_page|group|both"}
  },
  "website_content_summary": "2-sentence summary of what their website communicates",
  "sector_specific_insights": ["insight 1 specific to this business type", "insight 2"],
  "last_scraped_at": "${new Date().toISOString()}"
}`,
    );

    if (!extracted || !extracted.actual_services) {
      await writeAutomationLog('businessDeepProfiler', businessProfileId, startTime, 0);
      return res.json({ skipped: true, reason: 'llm_extraction_failed' });
    }

    // Ensure last_scraped_at is set
    extracted.last_scraped_at = new Date().toISOString();

    // ── Save to business_profiles ─────────────────────────────────────────────
    await prisma.$executeRawUnsafe(
      `UPDATE business_profiles SET business_deep_profile = $1 WHERE id = $2`,
      JSON.stringify(extracted),
      businessProfileId,
    );

    console.log(
      `[businessDeepProfiler] Profiled "${name}": ` +
      `${extracted.actual_services.length} services, ` +
      `${extracted.unique_selling_points.length} USPs, ` +
      `tone=${extracted.tone_from_website}`,
    );

    await writeAutomationLog('businessDeepProfiler', businessProfileId, startTime, 1);
    return res.json({
      profiled: true,
      services_found: extracted.actual_services.length,
      usps_found: extracted.unique_selling_points.length,
      sources_scraped: contentChunks.length,
      price_range: extracted.price_range,
      tone: extracted.tone_from_website,
    });

  } catch (err: any) {
    console.error('[businessDeepProfiler] error:', err.message);
    await writeAutomationLog('businessDeepProfiler', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}
