import { Request, Response } from 'express';
import { prisma } from '../../db';
import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';
import { writeAutomationLog } from '../../lib/automationLog';
import { getOwnLocationInfo } from '../../lib/googleBusinessInfo';

// Own-business version of collectOwnSocialProfile.ts — syncs address/phone/category/website
// from the tenant's connected Google Business Profile (source of truth once connected).
// No-ops cleanly for businesses without a connected GBP account (manual entry stays as-is).
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h — profile metadata changes rarely

export async function collectOwnBusinessInfo(req: Request, res: Response) {
  const { businessProfileId, force } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  if (!force && shouldSkipAgent(businessProfileId, 'collectOwnBusinessInfo', MIN_INTERVAL_MS)) {
    return res.json({ updated: false, skipped: true, reason: 'ran_recently' });
  }

  const startTime = new Date().toISOString();
  try {
    const info = await getOwnLocationInfo(businessProfileId);
    if (!info) {
      await writeAutomationLog('collectOwnBusinessInfo', businessProfileId, startTime, 0, 'success', 'not_connected');
      return res.json({ updated: false, skipped: true, reason: 'not_connected' });
    }

    // GBP is the source of truth for fields it actually returns a value for; a field GBP
    // is silent on (e.g. no website set in Google) is left as-is rather than blanked out.
    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: {
        ...(info.address    ? { full_address: info.address } : {}),
        ...(info.phone      ? { phone: info.phone } : {}),
        ...(info.category   ? { category: info.category } : {}),
        ...(info.websiteUri ? { website_url: info.websiteUri } : {}),
      },
    });

    setLastRun(businessProfileId, 'collectOwnBusinessInfo');
    await writeAutomationLog('collectOwnBusinessInfo', businessProfileId, startTime, 1, 'success');
    return res.json({ updated: true });
  } catch (err: any) {
    await writeAutomationLog('collectOwnBusinessInfo', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
