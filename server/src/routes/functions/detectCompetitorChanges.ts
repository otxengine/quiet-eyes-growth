import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { businessLocale } from '../../lib/businessLocale';
import { EN_JSON_SYSTEM } from '../../lib/locale';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilySearch(query: string, maxResults = 3): Promise<any[]> {
  if (!TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return data.results || [];
  } catch { return []; }
}

/**
 * detectCompetitorChanges — competitor change detection.
 * Scans competitor online presence via Tavily+LLM for 6 change types:
 *   price_change | new_menu_item | new_promotion | website_change | review_delta | new_post
 * Writes results to market_signals (category='competitor_move').
 *
 * Rate-limiting is handled by the 48h MarketSignal dedup below, not last_scanned,
 * to avoid a race with batchSnapshotCompetitors which shares that field.
 *
 * Body: { businessProfileId }
 * Returns: { competitors_checked, changes_detected }
 */
export async function detectCompetitorChanges(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let changesDetected = 0;

  try {
    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
    });

    // Load context for personalized action suggestions
    const bizCtx = await loadBusinessContext(businessProfileId);
    const preferredChannel = bizCtx?.preferredChannels?.[0] || 'instagram';
    // Search queries, the analysis and every stored text follow the business's language.
    const en = (await businessLocale(businessProfileId)).lang === 'en';

    for (const comp of competitors) {

      try {
        const instagramHandle = (comp as any).instagram_handle
          ? `@${((comp as any).instagram_handle).replace('@', '')} ` : '';
        const queries = [
          en ? `"${comp.name}" new deal discount` : `"${comp.name}" מבצע הנחה חדש`,
          en ? `"${comp.name}" prices menu services` : `"${comp.name}" מחיר תפריט שירות`,
          `${instagramHandle}"${comp.name}" site:facebook.com OR site:instagram.com`,
          en ? `"${comp.name}" new customer reviews` : `"${comp.name}" ביקורות חדשות לקוחות`,
        ];

        const results: any[] = [];
        for (const q of queries) {
          const r = await tavilySearch(q, 3);
          results.push(...r);
        }

        if (results.length === 0) continue;

        const textBlob = results
          .map(r => `[${r.url || ''}] ${r.title || ''} — ${(r.content || '').slice(0, 300)}`)
          .join('\n\n');

        const analysis = await invokeLLM({
          model: 'sonnet',
          maxTokens: 500,
          ...(en && { systemPrompt: EN_JSON_SYSTEM }),
          prompt: `You are a competitive intelligence analyst. Analyze the information gathered about the competitor "${comp.name}" and identify real business changes.

${textBlob.slice(0, 3000)}

Report only on concrete changes that appear in the data. Return ONLY valid JSON. ALL string values must be in ${en ? 'English' : 'Hebrew'}:
{
  "changes_found": true,
  "price_change":    { "found": false, "summary": "specific description with numbers if found" },
  "new_promotion":   { "found": false, "summary": "exact promotion details" },
  "new_menu_item":   { "found": false, "summary": "name of new dish/service" },
  "new_post":        { "found": false, "summary": "post topic + engagement" },
  "review_delta":    { "found": false, "summary": "review quote + rating" },
  "overall_summary": "one competitive insight — specific and precise, up to 15 words"
}`,
          response_json_schema: { type: 'object' },
        }) as any;

        if (!analysis || !analysis.changes_found) continue;

        const updateData: Record<string, any> = {};

        if (analysis.price_change?.found) {
          updateData.price_range = analysis.price_change.summary;
          updateData.price_changed_at = new Date().toISOString();
          changesDetected++;
        }
        if (analysis.new_promotion?.found) {
          updateData.current_promotions = analysis.new_promotion.summary;
          changesDetected++;
        }
        if (analysis.new_menu_item?.found) {
          const existing = comp.menu_highlights || '';
          updateData.menu_highlights = `${analysis.new_menu_item.summary}${existing ? '\n' + existing : ''}`.slice(0, 500);
          changesDetected++;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.competitor.update({
            where: { id: comp.id },
            data: updateData,
          }).catch(() => {});
        }

        // Create a MarketSignal for significant changes — with dedup check
        if (analysis.overall_summary && analysis.changes_found) {
          // Dedup: skip if similar signal for this competitor exists in last 48h
          const signalSummary = `${en ? 'Change at' : 'שינוי אצל'} ${comp.name}: ${analysis.overall_summary}`;
          const existingSignal = await prisma.marketSignal.findFirst({
            where: {
              linked_business: businessProfileId,
              category: 'competitor_move',
              summary: { contains: comp.name },
              detected_at: { gte: new Date(Date.now() - 48 * 3600000).toISOString() },
            },
            select: { id: true },
          });
          if (existingSignal) continue;

          // Build a specific action based on change type
          let actionLabel = en ? `Check updates at ${comp.name}` : `בדוק עדכונים אצל ${comp.name}`;
          let actionType  = 'task';
          let prefillText = en
            ? `Update at ${comp.name}:\n\n${analysis.overall_summary}\n\nRecommended action: `
            : `עדכון אצל ${comp.name}:\n\n${analysis.overall_summary}\n\nפעולה מומלצת: `;

          if (analysis.new_promotion?.found) {
            actionLabel = en ? `Post your own offer on ${preferredChannel}` : `פרסם מבצע משלך ב${preferredChannel}`;
            actionType  = 'promote';
            prefillText += en
              ? `${comp.name} is running an offer: "${analysis.new_promotion.summary}". Post a matching offer that highlights what makes you different.`
              : `${comp.name} מציע מבצע: "${analysis.new_promotion.summary}". פרסם מבצע מקביל שמבליט את הערך הייחודי שלך.`;
          } else if (analysis.price_change?.found) {
            actionLabel = en ? 'Review your pricing' : `בדוק תמחור`;
            actionType  = 'task';
            prefillText += en
              ? `${comp.name} changed prices (${analysis.price_change.summary}) — check that yours are still competitive.`
              : `${comp.name} עדכן מחירים (${analysis.price_change.summary}) — בדוק האם המחירים שלך עדיין תחרותיים.`;
          } else if (analysis.new_post?.found) {
            actionLabel = en ? `Post content on ${preferredChannel}` : `פרסם תוכן ב${preferredChannel}`;
            actionType  = 'social_post';
            prefillText += en
              ? `${comp.name} posted: "${analysis.new_post.summary}". Create a post that shows what makes you different.`
              : `${comp.name} פרסם: "${analysis.new_post.summary}". צור פוסט שמציג את היתרון הייחודי שלך.`;
          }

          const sourceDesc = JSON.stringify({
            action_label:   actionLabel,
            action_type:    actionType,
            prefilled_text: prefillText,
            time_minutes:   15,
            urgency_hours:  analysis.price_change?.found ? 12 : 24,
            impact_reason:  analysis.new_promotion?.found
              ? (en ? 'A competitor with a live offer can pull your customers away' : 'מתחרה עם מבצע פעיל עלול למשוך לקוחות שלך')
              : analysis.price_change?.found
              ? (en ? "A competitor's price change can sway your customers' decisions" : 'שינוי מחירים אצל מתחרה עשוי להשפיע על ההחלטות של לקוחותיך')
              : (en ? "A quick answer to a competitor's post keeps you visible" : 'תגובה מהירה לפרסום מתחרה שומרת על נוכחותך בשוק'),
          });

          const sourceUrls = results
            .slice(0, 3)
            .map(r => r.url)
            .filter(Boolean)
            .join(' | ');

          await prisma.marketSignal.create({
            data: {
              summary:            signalSummary,
              category:           'competitor_move',
              impact_level:       analysis.price_change?.found ? 'high' : 'medium',
              recommended_action: actionLabel,
              source_description: sourceDesc,
              source_signals:     sourceUrls || undefined,
              confidence:         75,
              is_read:            false,
              linked_business:    businessProfileId,
              detected_at:        new Date().toISOString(),
            },
          }).catch(() => {});
        }
      } catch (_) { /* skip this competitor, continue */ }
    }

    await writeAutomationLog('detectCompetitorChanges', businessProfileId, startTime, changesDetected);
    return res.json({ competitors_checked: competitors.length, changes_detected: changesDetected });
  } catch (err: any) {
    console.error('[detectCompetitorChanges] error:', err.message);
    await writeAutomationLog('detectCompetitorChanges', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
