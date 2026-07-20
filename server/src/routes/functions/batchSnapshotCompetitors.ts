import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';
import { writeAutomationLog } from '../../lib/automationLog';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * batchSnapshotCompetitors — daily agent that:
 * 1. Takes a fresh Tavily snapshot for every competitor of a business
 * 2. Saves to otx_competitor_snapshots for diff detection (diffCompetitorSnapshot)
 * 3. Updates competitor.last_scanned + price/promotion fields from latest data
 * 4. Discovers social page URLs (Instagram/Facebook/TikTok/website) if not known or stale (7d)
 * 5. Publishes event to agent_data_bus so downstream agents can react
 *
 * Called by scheduler at 06:00 + 18:00 UTC (alongside detectCompetitorChanges).
 */
export async function batchSnapshotCompetitors(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let snapshotsTaken = 0;

  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { last_scanned: 'asc' }, // least-recently scanned first
      take: 6,
    });

    if (competitors.length === 0) {
      await writeAutomationLog('batchSnapshotCompetitors', businessProfileId, startTime, 0);
      return res.json({ snapshots_taken: 0, note: 'No competitors' });
    }

    const { category, city } = profile;

    for (const comp of competitors) {
      if (isTavilyRateLimited()) break;

      // Skip if scanned recently (6h guard per competitor)
      const lastScannedMs = comp.last_scanned ? new Date(comp.last_scanned).getTime() : 0;
      if (Date.now() - lastScannedMs < SIX_HOURS_MS) {
        console.log(`[batchSnapshotCompetitors] skipping ${comp.name} — scanned recently`);
        continue;
      }

      try {
        // ── Search for fresh data ──────────────────────────────────────────────
        const queries = [
          `"${comp.name}" ${city} מחיר מבצע שירות חדש`,
          `"${comp.name}" ${category} ${city} ביקורות 2025 2026`,
        ];

        let webData = '';
        for (const q of queries) {
          if (isTavilyRateLimited()) break;
          const results = await tavilySearch(q, 3);
          webData += results
            .map(r => `[${r.url || ''}] ${r.title || ''}: ${(r.content || '').slice(0, 250)}`)
            .join('\n');
        }

        if (!webData.trim()) continue;

        // ── LLM extraction ────────────────────────────────────────────────────
        const snap: any = await invokeLLM({
          model: 'sonnet',
          maxTokens: 500,
          prompt: `Extract structured business intelligence about "${comp.name}" (${category} in ${city}) from the data below. Report ONLY explicitly mentioned facts.

Data:
${webData.slice(0, 3000)}

Previously known: rating ${comp.rating || '?'}, promotions: ${comp.current_promotions || 'none'}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{
  "prices": [{"item": "product/service name", "price": "specific price with ₪"}],
  "promotions": ["specific active promotion with details"],
  "rating": null,
  "review_count": null,
  "services": "what the business offers — comma-separated list of services/products, up to 60 chars",
  "new_service": "new service/product found recently, or null",
  "negative_reviews": "main complaint theme from reviews, or null"
}`,
          response_json_schema: { type: 'object' },
        });

        if (!snap) continue;

        // ── Save snapshot ──────────────────────────────────────────────────────
        await prisma.$executeRawUnsafe(
          `INSERT INTO otx_competitor_snapshots (competitor_id, business_id, snapshot_json) VALUES ($1, $2, $3::jsonb)`,
          comp.id, businessProfileId, JSON.stringify(snap)
        ).catch(() => {});

        // ── Update competitor fields from snapshot ─────────────────────────────
        const updateData: Record<string, any> = {
          last_scanned: new Date().toISOString(),
        };
        if (snap.promotions?.length)      updateData.current_promotions = snap.promotions[0];
        if (snap.negative_reviews)        updateData.recent_reviews_summary = snap.negative_reviews;
        // services: fill if empty, or prepend new_service discovered
        if (snap.services && !comp.services) updateData.services = snap.services;
        if (snap.new_service) {
          const existing = comp.menu_highlights || '';
          updateData.menu_highlights = `${snap.new_service}${existing ? ' | ' + existing : ''}`.slice(0, 300);
        }
        if (snap.rating != null) {
          updateData.rating = snap.rating;
          // Track trend_direction from rating delta
          if (comp.rating != null) {
            const delta = Number(snap.rating) - Number(comp.rating);
            if (delta >= 0.15)       updateData.trend_direction = 'up';
            else if (delta <= -0.15) updateData.trend_direction = 'down';
            else                     updateData.trend_direction = 'stable';
          }
        }
        if (snap.review_count != null)    updateData.review_count = snap.review_count;
        if (snap.prices?.length) {
          updateData.price_snapshot     = JSON.stringify(snap.prices);
          updateData.price_changed_at   = new Date().toISOString();
          updateData.last_known_prices  = snap.prices.map((p: any) => `${p.item}: ${p.price}`).slice(0, 3).join(' | ');
        }

        await prisma.competitor.update({
          where: { id: comp.id },
          data: updateData,
        }).catch(() => {});

        // ── Publish to agent_data_bus ──────────────────────────────────────────
        await prisma.$executeRawUnsafe(
          `INSERT INTO agent_data_bus (event_type, source_agent, payload) VALUES ($1, $2, $3::jsonb)`,
          'competitor_snapshot_taken',
          'batchSnapshotCompetitors',
          JSON.stringify({
            businessProfileId,
            competitorId:   comp.id,
            competitorName: comp.name,
            hasPromotion:   (snap.promotions?.length || 0) > 0,
            hasNewService:  !!snap.new_service,
            hasPriceData:   (snap.prices?.length || 0) > 0,
          })
        ).catch(() => {});

        snapshotsTaken++;
      } catch (e: any) {
        console.warn(`[batchSnapshotCompetitors] competitor ${comp.name} failed:`, e.message);
      }
    }

    await writeAutomationLog('batchSnapshotCompetitors', businessProfileId, startTime, snapshotsTaken);
    return res.json({ snapshots_taken: snapshotsTaken, competitors_checked: competitors.length });
  } catch (err: any) {
    console.error('[batchSnapshotCompetitors] error:', err.message);
    await writeAutomationLog('batchSnapshotCompetitors', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
