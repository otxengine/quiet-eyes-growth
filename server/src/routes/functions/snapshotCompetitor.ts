import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

export async function snapshotCompetitor(req: Request, res: Response) {
  const { businessProfileId, competitorId } = req.body;
  if (!businessProfileId || !competitorId) return res.status(400).json({ error: 'Missing businessProfileId or competitorId' });

  try {
    const competitor = await prisma.competitor.findFirst({ where: { id: competitorId, linked_business: businessProfileId } });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    const category = profile?.category || '';
    const city = profile?.city || '';

    let webData = '';
    if (!isTavilyRateLimited()) {
      const queries = [
        `${competitor.name} ${city} מחיר מבצע`,
        `${competitor.name} ${category} ביקורות`,
      ];
      for (const q of queries) {
        if (isTavilyRateLimited()) break;
        const results = await tavilySearch(q, 3);
        webData += results.map(r => `${r.title}: ${(r.content || '').slice(0, 200)}`).join('\n');
      }
    }

    const res2 = await invokeLLM({
      model: 'haiku',
      prompt: `נתח את המידע הבא על המתחרה "${competitor.name}" (${category} ב${city}).
מידע שנמצא:
${webData.slice(0, 2000) || 'לא נמצא מידע ספציפי'}
${competitor.notes ? `מידע ידוע: ${competitor.notes}` : ''}
דירוג נוכחי: ${competitor.rating || 'לא ידוע'}.

החזר JSON בלבד:
{
  "prices": [{"item": "שם שירות", "price": "מחיר"}],
  "promotions": ["מבצע פעיל 1"],
  "rating": null,
  "review_count": null,
  "description": "תיאור קצר של העסק",
  "last_activity": "תיאור פעילות אחרונה"
}
אם אין מידע ספציפי על מחיר/מבצע — החזר מערכים ריקים. אל תמציא נתונים.`,
      response_json_schema: { type: 'object' },
    });

    const snapshot = {
      prices: res2?.prices || [],
      promotions: res2?.promotions || [],
      rating: res2?.rating ?? (competitor.rating || null),
      review_count: res2?.review_count ?? null,
      description: res2?.description || '',
      last_activity: res2?.last_activity || '',
    };

    await prisma.$executeRawUnsafe(
      `INSERT INTO otx_competitor_snapshots (competitor_id, business_id, snapshot_json) VALUES ($1, $2, $3::jsonb)`,
      competitorId, businessProfileId, JSON.stringify(snapshot)
    );

    return res.json({ ok: true, snapshot });
  } catch (err: any) {
    console.error('[snapshotCompetitor] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
