import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

async function tavilyFetch(url: string): Promise<string> {
  if (!TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:      TAVILY_API_KEY,
        query:        `site:${url} תפריט מחירים שירותים`,
        search_depth: 'basic',
        max_results:  3,
        include_raw_content: true,
      }),
    });
    if (!res.ok) return '';
    const data: any = await res.json();
    const texts = (data.results || [])
      .map((r: any) => (r.raw_content || r.content || '').slice(0, 600))
      .join('\n---\n');
    return texts.slice(0, 1800);
  } catch {
    return '';
  }
}

/**
 * scanServicesAndPrices
 *
 * Scrapes the business website for services/menu/prices using Tavily,
 * extracts structured data with Haiku, and saves to BusinessProfile.services_json.
 *
 * Body: { businessProfileId }
 * Returns: { services_count, services }
 */
export async function scanServicesAndPrices(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  try {
    const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'Business not found' });

    const url = profile.website_url || '';
    if (!url) {
      return res.json({ services_count: 0, services: [], message: 'no_website_url' });
    }

    const rawText = await tavilyFetch(url);
    if (!rawText) {
      return res.json({ services_count: 0, services: [], message: 'no_content_found' });
    }

    const result = await invokeLLM({
      model:     'haiku',
      maxTokens: 500,
      prompt: `Extract services and prices from this website text for "${profile.name}" (${profile.category}).
Return ONLY JSON: {"services":[{"name":"","price":"","category":""}]}
Use empty string for unknown price. Max 15 items. Website text:
${rawText}`,
      response_json_schema: { type: 'object' },
    });

    const services: any[] = Array.isArray(result?.services) ? result.services.slice(0, 15) : [];

    await (prisma.businessProfile as any).update({
      where: { id: businessProfileId },
      data:  { services_json: JSON.stringify(services) },
    });

    return res.json({ services_count: services.length, services });
  } catch (err: any) {
    console.error('[scanServicesAndPrices]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
