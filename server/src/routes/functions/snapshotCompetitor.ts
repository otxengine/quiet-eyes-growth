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
      model: 'sonnet',
      maxTokens: 500,
      prompt: `Extract structured business information about the competitor "${competitor.name}" (${category} in ${city}) from the data found online.

Data found:
${webData.slice(0, 2500) || 'no specific data found'}
${competitor.notes ? `Previously known information: ${competitor.notes}` : ''}
Current rating: ${competitor.rating || 'unknown'}

Extract only information that appears explicitly. Do not invent data.

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "prices": [{"item": "specific service/product name", "price": "specific price"}],
  "promotions": ["specific active promotion"],
  "rating": null,
  "review_count": null,
  "description": "short description of what the business offers",
  "last_activity": "description of the latest activity found"
}`,
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
