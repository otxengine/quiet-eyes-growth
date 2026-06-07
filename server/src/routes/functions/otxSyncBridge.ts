import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

/**
 * otxSyncBridge
 * Syncs OTX shadow table data (system_events, composite_signals) into Prisma-managed tables.
 * Run after Layer 7 agent executions.
 *
 * Body: { businessProfileId }
 */
export async function otxSyncBridge(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  let synced = 0;

  try {
    // Sync system_events → ProactiveAlert (for high-priority events not yet in Prisma)
    const recentCutoff = new Date(Date.now() - 6 * 3600000); // last 6h
    const existingAlertTitles = new Set<string>();

    const recentAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: recentCutoff } },
      select: { title: true },
    });
    recentAlerts.forEach(a => existingAlertTitles.add(a.title || ''));

    // Query OTX system_events via raw SQL (shadow table, not in Prisma schema)
    let otxEvents: any[] = [];
    try {
      otxEvents = await prisma.$queryRaw`
        SELECT * FROM system_events
        WHERE business_profile_id = ${businessProfileId}
          AND created_at > ${recentCutoff}
          AND priority IN ('critical', 'high')
        ORDER BY created_at DESC
        LIMIT 20
      `;
    } catch {
      // OTX table may not exist in all envs — graceful degradation
      otxEvents = [];
    }

    for (const event of otxEvents) {
      const title = event.title || event.event_type || 'OTX Event';
      if (existingAlertTitles.has(title)) continue;

      await prisma.proactiveAlert.create({
        data: {
          linked_business: businessProfileId,
          title,
          description: event.description || event.payload || null,
          alert_type: event.event_type || 'action_needed',
          priority: event.priority === 'critical' ? 'critical' : 'high',
          is_dismissed: false,
          is_acted_on: false,
          created_at: event.created_at || new Date().toISOString(),
        },
      });
      existingAlertTitles.add(title);
      synced++;
    }

    // Sync composite_signals → MarketSignal
    let compositeSignals: any[] = [];
    try {
      compositeSignals = await prisma.$queryRaw`
        SELECT * FROM composite_signals
        WHERE business_profile_id = ${businessProfileId}
          AND created_at > ${recentCutoff}
          AND confidence_score > 0.6
        ORDER BY created_at DESC
        LIMIT 20
      `;
    } catch {
      compositeSignals = [];
    }

    for (const sig of compositeSignals) {
      try {
        await prisma.marketSignal.create({
          data: {
            linked_business: businessProfileId,
            category: sig.signal_type || 'opportunity',
            summary: sig.summary || sig.signal_type || 'Composite signal',
            impact_level: sig.confidence_score > 0.8 ? 'high' : 'medium',
            recommended_action: sig.recommended_action || null,
            detected_at: sig.created_at || new Date().toISOString(),
          },
        });
        synced++;
      } catch {
        // Skip duplicates
      }
    }

    await writeAutomationLog('otxSyncBridge', businessProfileId, startTime, synced);

    return res.json({ success: true, synced, otxEvents: otxEvents.length, compositeSignals: compositeSignals.length });
  } catch (err: any) {
    console.error('otxSyncBridge error:', err.message);
    await writeAutomationLog('otxSyncBridge', businessProfileId, startTime, synced, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
