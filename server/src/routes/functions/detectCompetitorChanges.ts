import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

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
 * detectCompetitorChanges
 * Scans competitor online presence for 6 change types:
 *   price_change | new_menu_item | new_promotion | website_change | review_delta | new_post
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

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    for (const comp of competitors) {
      try {
        const instagramHandle = (comp as any).instagram_handle
          ? `@${((comp as any).instagram_handle).replace('@', '')} ` : '';
        const queries = [
          `"${comp.name}" מבצע הנחה חדש`,
          `"${comp.name}" מחיר תפריט שירות`,
          `${instagramHandle}"${comp.name}" site:facebook.com OR site:instagram.com`,
          `"${comp.name}" ביקורות חדשות לקוחות`,
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
          model: 'haiku',
          prompt: `נתח מידע שנאסף על המתחרה "${comp.name}":

${textBlob.slice(0, 2500)}

זהה שינויים עסקיים. JSON בלבד:
{
  "changes_found": true|false,
  "price_change":    { "found": bool, "summary": "תיאור קצר מהאתר" },
  "new_promotion":   { "found": bool, "summary": "פרטי המבצע" },
  "new_menu_item":   { "found": bool, "summary": "שם המנה/שירות" },
  "new_post":        { "found": bool, "summary": "על מה הפוסט" },
  "review_delta":    { "found": bool, "summary": "מה אמרו לקוחות" },
  "overall_summary": "תובנה עיקרית — עד 15 מילה"
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

        // Create a MarketSignal for significant changes
        if (analysis.overall_summary && analysis.changes_found) {
          // Build a specific action based on change type
          let actionLabel = `בדוק שינויים אצל ${comp.name}`;
          let actionType  = 'task';
          let prefillText = `שינוי אצל המתחרה ${comp.name}:\n\n${analysis.overall_summary}\n\nפעולה מומלצת: `;

          if (analysis.new_promotion?.found) {
            actionLabel = `פרסם מבצע נגד ${comp.name}`;
            actionType  = 'promote';
            prefillText += `${comp.name} משיק מבצע — שקול מבצע מענה: `;
          } else if (analysis.price_change?.found) {
            actionLabel = `עדכן מחירים בתגובה ל${comp.name}`;
            actionType  = 'task';
            prefillText += `${comp.name} שינה מחירים (${analysis.price_change.summary}) — בדוק מול המחירים שלך.`;
          } else if (analysis.new_post?.found) {
            actionLabel = `פרסם תגובה ל${comp.name}`;
            actionType  = 'social_post';
            prefillText += `${comp.name} פרסם: ${analysis.new_post.summary}. שקול פרסום מקביל שמבליט את היתרונות שלך.`;
          }

          const sourceDesc = JSON.stringify({
            action_label:   actionLabel,
            action_type:    actionType,
            prefilled_text: prefillText,
            time_minutes:   15,
          });

          const sourceUrls = results
            .slice(0, 3)
            .map(r => r.url)
            .filter(Boolean)
            .join(' | ');

          await prisma.marketSignal.create({
            data: {
              summary:            `שינוי אצל ${comp.name}: ${analysis.overall_summary}`,
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
