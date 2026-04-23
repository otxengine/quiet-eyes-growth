import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/agents/status — Returns latest heartbeat per OTX agent + bus stats
router.get('/', async (_req, res) => {
  try {
    const [heartbeats, busStats, recentEvents] = await Promise.all([
      prisma.$queryRaw<Array<{
        agent_name: string;
        last_ping_utc: string;
        last_ingestion_utc: string | null;
        status: string;
        error_message: string | null;
      }>>`
        SELECT DISTINCT ON (agent_name)
          agent_name,
          last_ping_utc,
          last_ingestion_utc,
          status,
          error_message
        FROM agent_heartbeat
        ORDER BY agent_name, last_ping_utc DESC
        LIMIT 30
      `,
      prisma.$queryRaw<Array<{
        total: number;
        pending: number;
        processed: number;
        last_event_at: string | null;
      }>>`
        SELECT
          COUNT(*)::int                                             AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int          AS pending,
          COUNT(*) FILTER (WHERE status = 'processed')::int        AS processed,
          MAX(created_at)                                           AS last_event_at
        FROM agent_data_bus
        WHERE created_at > NOW() - INTERVAL '1 hour'
      `,
      prisma.$queryRaw<Array<{ event_type: string; source_agent: string; created_at: string }>>`
        SELECT event_type, source_agent, created_at
        FROM agent_data_bus
        ORDER BY created_at DESC
        LIMIT 10
      `,
    ]);

    res.json({
      heartbeats,
      busStats: (busStats as any[])[0] ?? { total: 0, pending: 0, processed: 0, last_event_at: null },
      recentEvents,
    });
  } catch (_err) {
    // Tables may not exist yet — return empty payload instead of 500
    res.json({
      heartbeats: [],
      busStats: { total: 0, pending: 0, processed: 0, last_event_at: null },
      recentEvents: [],
    });
  }
});

export default router;
