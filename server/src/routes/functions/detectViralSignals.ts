/**
 * detectViralSignals — Agent that tracks viral content and rising hashtags
 * across TikTok, Instagram, YouTube Shorts, and Israeli social communities.
 *
 * Goal: detect content formats + topics going viral RIGHT NOW in the business's
 * niche — so the business can ride the wave within hours, not days.
 *
 * Outputs:
 *   • MarketSignal with category="viral_signal", source_description includes:
 *     - viral_platform, hashtags, content_format, estimated_views_velocity
 *   • Each signal includes a ready-to-use content template
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 6): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        max_results: maxResults,
        include_answer: false,
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

function buildViralQueries(category: string, city: string): string[] {
  return [
    // TikTok viral content
    `TikTok viral video ${category} Israel this week trending`,
    `TikTok hashtag #${category.replace(/\s/g, '')} Israel viral 2025`,
    // Instagram Reels
    `Instagram Reels viral ${category} Israel trending now`,
    `Instagram trending hashtag ${category} this week Israel`,
    // YouTube Shorts
    `YouTube Shorts viral ${category} Israel 2025 trending`,
    // Israeli social/news coverage of viral content
    `${category} ${city} ויראלי טיקטוק אינסטגרם 2025`,
    `${category} ישראל ויראלי רשתות חברתיות השבוע`,
    // Content going viral in niche (Hebrew)
    `פוסט ויראלי ${category} ${city} אינסטגרם טיקטוק`,
    // Cross-platform signals
    `"${category}" Israel social media viral challenge trend`,
  ];
}

export async function detectViralSignals(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const { name, category, city, relevant_services = '', tone_preference = 'friendly' } = profile;

    // ── Scan social platforms ────────────────────────────────────────────────
    const queries = buildViralQueries(category, city);
    const rawResults = await Promise.all(queries.map(q => tavilySearch(q, 5)));
    const allResults = rawResults.flat();

    // De-duplicate
    const seen = new Set<string>();
    const unique = allResults.filter(r => {
      if (!r.url || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    if (unique.length === 0) {
      return res.json({ signals_created: 0, results_scanned: 0, note: 'No results — check TAVILY_API_KEY' });
    }

    const context = unique.slice(0, 20)
      .map(r => `[${r.url}]\n${(r.content || r.title || '').slice(0, 300)}`)
      .join('\n---\n');

    // ── AI viral analysis ────────────────────────────────────────────────────
    const result = await invokeLLM({
      prompt: `אתה מומחה וירליות ברשתות חברתיות. נתח מה הולך ויראלי עכשיו ואיך העסק יכול לנצל את זה.

עסק: "${name}" — ${category} ב${city}
שירותים: ${relevant_services || 'לא צוינו'}
טון: ${tone_preference}

תוצאות חיפוש:
${context.slice(0, 3500)}

מצא 2-4 סיגנלים ויראלים שרלוונטיים לעסק. לכל אחד — כתוב תוכן מוכן לפרסום.

הוראות:
• כלול רק מה שנתמך על ידי הנתונים
• הפלטפורם חייב להיות ברור (TikTok / Instagram / YouTube)
• הפורמט חייב להיות ספציפי (Reel / Story / Short / Post)
• ready_to_post_text — טקסט גמור בעברית, מוכן להעתקה ופרסום

JSON בלבד:
{"signals":[{
  "title": "שם הסיגנל הויראלי — עד 6 מילים",
  "description": "מה הולך ויראלי ולמה — עד 12 מילה",
  "platform": "tiktok|instagram|youtube|multiple",
  "content_format": "reel|story|short|post|challenge",
  "hashtags": ["#tag1","#tag2","#tag3"],
  "velocity": "exploding|fast|steady",
  "window_hours": 24,
  "evidence_url": "URL ספציפי מהנתונים",
  "ready_to_post_text": "טקסט פוסט מוכן בעברית עם אמוג'י ו-hashtags — עד 80 מילה",
  "visual_direction": "תיאור קצר מה להצלם — עד 8 מילה",
  "relevance": "high|medium",
  "confidence": 50-95
}]}`,
      response_json_schema: { type: 'object' },
    });

    const rawSignals: any[] = result?.signals || [];
    const validSignals = rawSignals.filter(s => s.title && s.platform && s.evidence_url && s.relevance !== 'low');

    // ── Save signals ─────────────────────────────────────────────────────────
    const existing = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId, category: 'viral_signal' },
      select: { summary: true },
    });
    const existingNames = new Set(existing.map(s => s.summary));

    let created = 0;
    for (const signal of validSignals) {
      const summaryKey = `ויראלי: ${signal.title}`;
      if (existingNames.has(summaryKey)) continue;

      const meta = JSON.stringify({
        action_type: 'social_post',
        action_label: `צור תוכן: ${signal.content_format} ב-${signal.platform}`,
        platform: signal.platform,
        content_format: signal.content_format,
        hashtags: signal.hashtags,
        velocity: signal.velocity,
        window_hours: signal.window_hours,
        ready_to_post_text: signal.ready_to_post_text,
        visual_direction: signal.visual_direction,
        prefilled_text: signal.ready_to_post_text,
        is_viral_signal: true,
        time_minutes: 20,
      });

      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: summaryKey,
          impact_level: signal.velocity === 'exploding' ? 'high' : 'medium',
          category: 'viral_signal',
          recommended_action: `פרסם ${signal.content_format} ב-${signal.platform} תוך ${signal.window_hours} שעות`,
          confidence: signal.confidence || 70,
          source_urls: signal.evidence_url || '',
          source_description: meta,
          is_read: false,
          detected_at: new Date().toISOString(),
        },
      });

      existingNames.add(summaryKey);
      created++;
    }

    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, created);

    return res.json({
      signals_created: created,
      results_scanned: unique.length,
      exploding: validSignals.filter(s => s.velocity === 'exploding').length,
      platforms: [...new Set(validSignals.map(s => s.platform))],
    });

  } catch (err: any) {
    console.error('[detectViralSignals] error:', err.message);
    await writeAutomationLog('detectViralSignals', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
