import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

export async function diffCompetitorSnapshot(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const competitors = await prisma.competitor.findMany({ where: { linked_business: businessProfileId } });
    if (competitors.length === 0) return res.json({ changes_found: 0 });

    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    const category = profile?.category || '';
    const city = profile?.city || '';

    let totalChanges = 0;

    for (const competitor of competitors) {
      try {
        // Get the two most recent snapshots
        const snapshots: any[] = await prisma.$queryRawUnsafe(
          `SELECT snapshot_json, taken_at FROM otx_competitor_snapshots WHERE competitor_id = $1 ORDER BY taken_at DESC LIMIT 2`,
          competitor.id
        );

        if (snapshots.length < 2) {
          // No baseline — take a first snapshot and skip diff
          if (snapshots.length === 0 && !isTavilyRateLimited()) {
            const webData = (await tavilySearch(`${competitor.name} ${city} מחיר מבצע`, 3))
              .map(r => `${r.title}: ${(r.content || '').slice(0, 200)}`).join('\n');
            const snap = await invokeLLM({
              model: 'haiku',
              prompt: `נתח מידע על "${competitor.name}" (${category} ב${city}):\n${webData.slice(0, 1500) || 'אין מידע'}\nJSON: {"prices":[],"promotions":[],"rating":null,"review_count":null,"description":"","last_activity":""}`,
              response_json_schema: { type: 'object' },
            });
            await prisma.$executeRawUnsafe(
              `INSERT INTO otx_competitor_snapshots (competitor_id, business_id, snapshot_json) VALUES ($1, $2, $3::jsonb)`,
              competitor.id, businessProfileId, JSON.stringify(snap || {})
            );
          }
          continue;
        }

        const [newSnap, oldSnap] = snapshots;
        const oldJson = oldSnap.snapshot_json;
        const newJson = newSnap.snapshot_json;

        // Get fresh web data for the new snapshot
        let freshData = '';
        if (!isTavilyRateLimited()) {
          const results = await tavilySearch(`${competitor.name} ${city} מחיר מבצע חדש`, 3);
          freshData = results.map(r => `${r.title}: ${(r.content || '').slice(0, 200)}`).join('\n');
        }

        // Update the new snapshot with fresh data if available
        if (freshData) {
          const updatedSnap = await invokeLLM({
            model: 'haiku',
            prompt: `עדכן מידע על "${competitor.name}":\n${freshData.slice(0, 1500)}\nJSON: {"prices":[],"promotions":[],"rating":null,"review_count":null,"description":"","last_activity":""}`,
            response_json_schema: { type: 'object' },
          });
          if (updatedSnap) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO otx_competitor_snapshots (competitor_id, business_id, snapshot_json) VALUES ($1, $2, $3::jsonb)`,
              competitor.id, businessProfileId, JSON.stringify(updatedSnap)
            );
          }
        }

        // Diff old vs new
        const diffResult = await invokeLLM({
          model: 'haiku',
          prompt: `השווה בין שני מצבים של המתחרה "${competitor.name}":

ישן: ${JSON.stringify(oldJson).slice(0, 800)}
חדש: ${JSON.stringify(newJson).slice(0, 800)}

מצא שינויים קונקרטיים בלבד — מחיר שהשתנה, מבצע חדש, שינוי דירוג.
אם אין שינוי ממשי — החזר {"changes":[]}.
JSON בלבד:
{"changes":[{"change_type":"price_change|new_promo|rating_change|new_offering","old_value":"","new_value":"","description":"תיאור קצר בעברית"}]}`,
          response_json_schema: { type: 'object' },
        });

        const changes: any[] = diffResult?.changes || [];
        if (changes.length === 0) continue;

        // Save each real change as a market signal
        for (const change of changes.slice(0, 3)) {
          if (!change.description) continue;

          const changeLabels: Record<string, string> = {
            price_change: 'שינוי מחיר',
            new_promo: 'מבצע חדש',
            rating_change: 'שינוי דירוג',
            new_offering: 'שירות חדש',
          };
          const label = changeLabels[change.change_type] || 'שינוי';
          const summary = `${competitor.name}: ${label}${change.old_value && change.new_value ? ` (${change.old_value} → ${change.new_value})` : ''}`;

          await prisma.marketSignal.create({
            data: {
              summary,
              category: 'competitor_move',
              impact_level: 'medium',
              recommended_action: `בדוק את השינוי אצל ${competitor.name} ושקול תגובה`,
              confidence: 65,
              source_signals: 'competitor_diff',
              source_description: JSON.stringify({
                change_type: change.change_type,
                old_value: change.old_value,
                new_value: change.new_value,
                action_type: 'internal_task',
                action_label: `📊 שינוי: ${competitor.name}`,
              }),
              agent_name: `📊 ${competitor.name}`,
              is_read: false,
              detected_at: new Date().toISOString(),
              linked_business: businessProfileId,
            },
          }).catch(() => {});

          totalChanges++;
        }
      } catch (e: any) {
        console.warn(`[diffCompetitorSnapshot] competitor ${competitor.id} failed:`, e.message);
      }
    }

    return res.json({ changes_found: totalChanges });
  } catch (err: any) {
    console.error('[diffCompetitorSnapshot] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
