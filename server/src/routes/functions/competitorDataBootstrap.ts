import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';

const TAVILY_KEY = process.env.TAVILY_API_KEY || '';

/**
 * competitorDataBootstrap
 * For new businesses with 0 competitors: bulk-discovers up to 10 competitors
 * via Tavily + LLM extraction. Triggered after onboarding when competitor count = 0.
 *
 * Body: { businessProfileId }
 */
export async function competitorDataBootstrap(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business profile not found' });

    const existingCount = await prisma.competitor.count({ where: { linked_business: businessProfileId } });

    if (existingCount >= 3) {
      return res.json({ success: true, message: 'Competitors already exist', existingCount, added: 0 });
    }

    const businessName = profile.name || 'the business';
    const city = (profile as any).city || (profile as any).location || 'Israel';
    const category = profile.category || 'business';

    let searchResults = '';

    // Tavily search for competitors
    if (TAVILY_KEY) {
      try {
        const query = `${category} businesses competitors ${city} Israel reviews`;
        const resp = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: 10, search_depth: 'basic' }),
        });
        const data: any = await resp.json();
        searchResults = (data.results || [])
          .slice(0, 10)
          .map((r: any) => `${r.title}: ${r.content?.slice(0, 200)}`)
          .join('\n');
      } catch (e) {
        console.warn('Tavily search failed in competitorDataBootstrap:', e);
      }
    }

    // LLM extraction
    const prompt = `Extract up to 10 competitor businesses from this search data for a ${category} business in ${city}.

Search results:
${searchResults || `Typical ${category} competitors in ${city}`}

Respond with ONLY this JSON array:
[
  {
    "name": "Business Name",
    "platform": "google",
    "url": "https://...",
    "estimated_rating": 4.2,
    "notes": "Brief description"
  }
]

Rules:
- Only include real businesses, not directories
- Max 10 items
- Exclude "${businessName}" itself
- If no clear results, return []`;

    const result = await invokeLLM({ prompt, model: 'haiku', maxTokens: 800 });
    let competitors: any[] = [];
    try {
      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      competitors = Array.isArray(parsed) ? parsed.slice(0, 10) : [];
    } catch {
      competitors = [];
    }

    let added = 0;
    for (const comp of competitors) {
      if (!comp.name) continue;
      try {
        await prisma.competitor.create({
          data: {
            linked_business: businessProfileId,
            name: comp.name,
            website_url: comp.url || null,
            rating: comp.estimated_rating || null,
            notes: comp.notes ? `${comp.notes} [מקור: ${comp.platform || 'google'}]` : null,
          },
        });
        added++;
      } catch {
        // Skip duplicates
      }
    }

    await writeAutomationLog('competitorDataBootstrap', businessProfileId, startTime, added);

    return res.json({ success: true, added, total: added + existingCount });
  } catch (err: any) {
    console.error('competitorDataBootstrap error:', err.message);
    await writeAutomationLog('competitorDataBootstrap', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
