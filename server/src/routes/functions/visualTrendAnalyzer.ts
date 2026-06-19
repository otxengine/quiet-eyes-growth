/**
 * visualTrendAnalyzer — Learns from actual social media images using Gemini Flash Vision.
 *
 * This agent processes thumbnail/image URLs collected by other trend agents
 * (instagramTrendAgent, tiktokSectorTrendAgent, detectViralSignals) and performs
 * visual analysis to detect:
 *   • Products and services visible in the content
 *   • Visual aesthetic and style trends
 *   • Content formats and presentation styles
 *   • Emerging product categories from visual evidence
 *
 * Why this matters:
 *   Often, rising trends appear visually BEFORE they appear in text/hashtags.
 *   By analyzing what products/aesthetics are dominating trending content,
 *   we can detect demand shifts earlier than text-based analysis.
 *
 * Sources:
 *   1. visual_trend_item records queued by other agents (thumbnails not yet analyzed)
 *   2. Recent MarketSignal source_urls (if they contain image/thumbnail URLs)
 *
 * Memory: only processes items not yet analyzed (analyzed_at + visual_analysis check)
 *
 * Output:
 *   • Updates visual_trend_item with visual_analysis JSON
 *   • If 2+ images show the same product/service → creates MarketSignal
 *     with category='visual_trend' (product/service rising visually)
 *
 * Schedule: every 24h (after instagramTrendAgent / tiktokSectorTrendAgent)
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { callGemini } from '../../lib/gemini';
import { callAIJson } from '../../lib/ai_router';
import { writeAutomationLog } from '../../lib/automationLog';
import {
  loadCheckpoint, saveCheckpoint, shouldSkipByTime, filterNewUrls,
} from '../../lib/trendMemory';

const MIN_INTERVAL   = 20 * 60 * 60 * 1000; // 20h
const MAX_IMAGES     = 15; // max per run (Gemini Flash has generous limits)
const MIN_CONFIDENCE = 55;

// ── Fetch image as base64 ─────────────────────────────────────────────────────
// Tries to download a public thumbnail URL and convert to base64 for Gemini.

async function fetchImageBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch { return null; }
}

// ── Analyze single image via Gemini Flash Vision ──────────────────────────────

interface VisualAnalysisResult {
  detected_products:  string[];
  detected_services:  string[];
  detected_keywords:  string[];
  aesthetic_tags:     string[];
  content_format:     string;
  visual_style:       string;
  trend_signals:      string; // brief summary of what trend this image signals
  confidence:         number;
}

async function analyzeImageWithGemini(
  imageBase64: string,
  businessCategory: string,
): Promise<VisualAnalysisResult | null> {
  try {
    const prompt = `Analyze this social media image from a business in the "${businessCategory}" sector.
You are identifying TREND SIGNALS — what products, services, aesthetics, and formats are shown.

Identify:
1. What specific products or items are VISIBLE (be very specific — not "food" but "avocado toast")
2. What services are being shown or implied
3. The visual aesthetic (minimalist/colorful/rustic/luxury/casual/etc)
4. The content format (before-after/tutorial/showcase/lifestyle/testimonial/etc)
5. Any rising trend this image signals

Return ONLY valid JSON:
{
  "detected_products": ["specific product 1", "specific product 2"],
  "detected_services": ["service 1"],
  "detected_keywords": ["keyword1", "keyword2", "keyword3"],
  "aesthetic_tags": ["minimalist", "warm-tones"],
  "content_format": "before-after|tutorial|showcase|lifestyle|testimonial|product-flat-lay|other",
  "visual_style": "1-sentence description of the visual style",
  "trend_signals": "1 sentence: what trend does this image signal?",
  "confidence": 70
}`;

    const raw = await callGemini(prompt, 'gemini-flash', 400, {
      jsonMode:    true,
      imageBase64,
    });

    const clean = raw.replace(/```json?|```/g, '').trim();
    const result = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean);
    return result as VisualAnalysisResult;
  } catch { return null; }
}

// ── Detect recurring product/service patterns across images ──────────────────
// If 2+ images show the same product → rising visual trend.

function detectRisingPatterns(
  analyses: VisualAnalysisResult[],
): Array<{ term: string; count: number; type: 'product' | 'service' | 'aesthetic' }> {
  const freq = new Map<string, { count: number; type: 'product' | 'service' | 'aesthetic' }>();

  for (const a of analyses) {
    const add = (terms: string[], type: 'product' | 'service' | 'aesthetic') => {
      for (const t of terms) {
        const key = t.toLowerCase().trim();
        if (key.length < 3) continue;
        const existing = freq.get(key);
        if (existing) existing.count++;
        else freq.set(key, { count: 1, type });
      }
    };
    add(a.detected_products, 'product');
    add(a.detected_services, 'service');
    add(a.aesthetic_tags,    'aesthetic');
  }

  return Array.from(freq.entries())
    .filter(([, v]) => v.count >= 2) // appears in 2+ images = pattern
    .map(([term, { count, type }]) => ({ term, count, type }))
    .sort((a, b) => b.count - a.count);
}

// ── Main agent ─────────────────────────────────────────────────────────────────

export async function visualTrendAnalyzer(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const { name, category } = profile;

    // ── Checkpoint: 20h minimum between runs ──────────────────────────────
    const cp = await loadCheckpoint('visualTrendAnalyzer', businessProfileId, 'visual', 'ALL');
    if (shouldSkipByTime(cp, MIN_INTERVAL)) {
      return res.json({ analyzed: 0, skipped: true, reason: 'ran_recently' });
    }

    // ── Collect image URLs to analyze ─────────────────────────────────────
    // 1. visual_trend_item records not yet analyzed
    let itemsToAnalyze: Array<{ id: string; url: string; platform: string }> = [];
    try {
      itemsToAnalyze = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, url, platform FROM visual_trend_item
         WHERE linked_business = $1
           AND (visual_analysis IS NULL OR visual_analysis = '')
           AND analyzed_at > NOW() - INTERVAL '48 hours'
         ORDER BY analyzed_at DESC
         LIMIT $2`,
        businessProfileId, MAX_IMAGES,
      );
    } catch {}

    // 2. Recent MarketSignals with image-like source_urls (thumbnails from Apify)
    if (itemsToAnalyze.length < MAX_IMAGES) {
      const signals = await prisma.marketSignal.findMany({
        where: {
          linked_business: businessProfileId,
          detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
        },
        select: { id: true, source_urls: true, category: true },
        take: 30,
      });

      const imageUrls = signals
        .map(s => s.source_urls || '')
        .filter(u => u && (
          u.includes('cdninstagram') || u.includes('tiktokcdn') ||
          u.includes('.jpg') || u.includes('.jpeg') || u.includes('.webp') ||
          u.includes('.png')
        ));

      const newImageUrls = filterNewUrls(imageUrls, cp);
      for (const url of newImageUrls.slice(0, MAX_IMAGES - itemsToAnalyze.length)) {
        itemsToAnalyze.push({ id: `signal_img_${Date.now()}`, url, platform: 'mixed' });
      }
    }

    if (itemsToAnalyze.length === 0) {
      await saveCheckpoint(cp, { note: 'no_images_to_analyze', scanned_at: new Date().toISOString() });
      return res.json({ analyzed: 0, note: 'no_images_queued' });
    }

    console.log(`[visualTrendAnalyzer] Analyzing ${itemsToAnalyze.length} images for ${name}`);

    // ── Analyze each image ────────────────────────────────────────────────
    const analyses: Array<{ item: typeof itemsToAnalyze[0]; result: VisualAnalysisResult }> = [];

    for (const item of itemsToAnalyze) {
      const base64 = await fetchImageBase64(item.url);
      if (!base64) {
        cp.scannedUrls.add(item.url); // mark as seen even if fetch failed
        continue;
      }

      const analysis = await analyzeImageWithGemini(base64, category);
      if (!analysis || (analysis.confidence || 0) < MIN_CONFIDENCE) {
        cp.scannedUrls.add(item.url);
        continue;
      }

      // Update visual_trend_item if it has a DB record
      if (item.id && !item.id.startsWith('signal_img_')) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE visual_trend_item SET
               visual_analysis   = $1,
               detected_products = $2,
               detected_services = $3,
               detected_keywords = $4,
               aesthetic_tags    = $5,
               analyzed_at       = NOW()
             WHERE id = $6`,
            JSON.stringify(analysis),
            JSON.stringify(analysis.detected_products),
            JSON.stringify(analysis.detected_services),
            JSON.stringify(analysis.detected_keywords),
            JSON.stringify(analysis.aesthetic_tags),
            item.id,
          );
        } catch {}
      }

      cp.scannedUrls.add(item.url);
      analyses.push({ item, result: analysis });
      console.log(`[visualTrendAnalyzer] Analyzed: ${analysis.trend_signals}`);
    }

    // ── Detect rising patterns across all analyzed images ────────────────
    let signalsCreated = 0;
    if (analyses.length >= 2) {
      const patterns = detectRisingPatterns(analyses.map(a => a.result));

      if (patterns.length > 0) {
        // Use Claude Haiku to synthesize patterns into actionable insights
        const patternSummary = patterns.slice(0, 8).map(p =>
          `${p.term} (${p.type}, appears in ${p.count}/${analyses.length} images)`
        ).join('\n');

        const insight = await callAIJson<{
          trend_name: string;
          insight: string;
          action: string;
          confidence: number;
        }>('classify_sector',
          `Visual trend analysis for a ${category} business in Israel.
The following items appeared repeatedly in ${analyses.length} trending social media images:

${patternSummary}

Synthesize this into one actionable business insight.
Return ONLY valid JSON. ALL strings in Hebrew:
{
  "trend_name": "שם הטרנד הויזואלי — עד 5 מילים",
  "insight": "מה הניתוח הויזואלי מגלה — שורה אחת",
  "action": "מה העסק צריך לעשות עם זה — ספציפי",
  "confidence": 70
}`
        ).catch(() => null);

        if (insight && insight.trend_name && (insight.confidence || 0) >= 60) {
          const summaryKey = `ויזואלי: ${insight.trend_name}`;
          const alreadyExists = await prisma.marketSignal.findFirst({
            where: {
              linked_business: businessProfileId,
              summary: summaryKey,
              detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
            },
          });

          if (!alreadyExists) {
            await prisma.marketSignal.create({
              data: {
                linked_business:    businessProfileId,
                summary:            summaryKey,
                impact_level:       'medium',
                category:           'visual_trend',
                recommended_action: insight.action || '',
                confidence:         insight.confidence || 70,
                source_description: JSON.stringify({
                  action_type:       'content_opportunity',
                  action_label:      insight.action,
                  patterns_detected: patterns.slice(0, 5),
                  images_analyzed:   analyses.length,
                  analyses_summary:  analyses.slice(0, 3).map(a => a.result.trend_signals),
                  source_agent:      'visualTrendAnalyzer',
                }),
                is_read:     false,
                is_dismissed: false,
                detected_at: new Date().toISOString(),
              },
            });
            signalsCreated++;
          }
        }
      }
    }

    await saveCheckpoint(cp, {
      images_analyzed: analyses.length,
      signals_created: signalsCreated,
      scanned_at: new Date().toISOString(),
    });

    await writeAutomationLog('visualTrendAnalyzer', businessProfileId, startTime, signalsCreated);
    console.log(`[visualTrendAnalyzer] done: analyzed=${analyses.length} signals=${signalsCreated}`);

    return res.json({
      analyzed: analyses.length,
      signals_created: signalsCreated,
      patterns_found: detectRisingPatterns(analyses.map(a => a.result)).length,
    });

  } catch (err: any) {
    console.error('[visualTrendAnalyzer] error:', err.message);
    await writeAutomationLog('visualTrendAnalyzer', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
