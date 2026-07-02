/**
 * Shared Apify client — single source of truth for all agent Apify calls.
 *
 * Usage:
 *   import { runApifyActor, hasApifyKey } from '../../lib/apify';
 *
 *   const items = await runApifyActor('clockworks~tiktok-profile-scraper', { profiles: [username] });
 */

const APIFY_API_KEY = process.env.APIFY_API_KEY || '';

/** Returns true if the APIFY_API_KEY env var is set. */
export function hasApifyKey(): boolean {
  return !!APIFY_API_KEY;
}

/**
 * Starts an Apify actor run, polls until completion, and returns the dataset items.
 *
 * @param actorId   Apify actor ID, e.g. 'clockworks~tiktok-hashtag-scraper'
 * @param input     Actor input JSON object
 * @param maxWaitMs Maximum time to wait for completion (default 90 seconds)
 * @param itemLimit Maximum dataset items to fetch (default 50)
 * @returns         Array of result items, or [] on error / key missing / timeout
 */
export async function runApifyActor(
  actorId: string,
  input: Record<string, any>,
  maxWaitMs = 90_000,
  itemLimit = 50,
): Promise<any[]> {
  if (!APIFY_API_KEY) return [];

  try {
    const apifyHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${APIFY_API_KEY}`,
    };

    // ── Start the actor run ─────────────────────────────────────────────────
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs`,
      {
        method:  'POST',
        headers: apifyHeaders,
        body:    JSON.stringify(input),
      },
    );

    if (!startRes.ok) {
      console.warn(`[Apify] ${actorId} start failed: HTTP ${startRes.status}`);
      return [];
    }

    const runData: any = await startRes.json();
    const runId = runData?.data?.id;
    if (!runId) {
      console.warn(`[Apify] ${actorId} — no run ID in response`);
      return [];
    }

    // ── Poll for completion ─────────────────────────────────────────────────
    const maxPolls = Math.floor(maxWaitMs / 5000);
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes  = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: apifyHeaders });
      const statusData: any = await statusRes.json();
      const status = statusData?.data?.status;

      if (status === 'SUCCEEDED') {
        const datasetId = statusData?.data?.defaultDatasetId;
        const itemsRes  = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?limit=${itemLimit}`,
          { headers: apifyHeaders },
        );
        const items: any = await itemsRes.json();
        return Array.isArray(items) ? items : [];
      }

      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        console.warn(`[Apify] ${actorId} run ${runId} ended with status: ${status}`);
        return [];
      }
    }

    console.warn(`[Apify] ${actorId} polling timed out after ${maxWaitMs}ms`);
    return [];

  } catch (e: any) {
    console.warn(`[Apify] ${actorId} exception:`, e.message);
    return [];
  }
}
