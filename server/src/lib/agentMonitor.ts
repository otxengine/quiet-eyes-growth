/**
 * agentMonitor.ts — Agent health tracking via agent_heartbeat table.
 *
 * Usage:
 *   import { writeHeartbeat } from '../lib/agentMonitor';
 *   await writeHeartbeat('myAgent', businessId, 'ok');
 *
 * Expected heartbeat intervals per agent:
 *   daily agents:   > 26h without ping → stale
 *   weekly agents:  > 200h without ping → stale
 */

import { prisma } from '../db';

type HeartbeatStatus = 'ok' | 'failed' | 'skipped';

/** Update (or insert) a heartbeat record for an agent. */
export async function writeHeartbeat(
  agentName: string,
  businessId: string,
  status: HeartbeatStatus = 'ok',
  errorMessage?: string,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO agent_heartbeat (agent_name, last_ping_utc, last_ingestion_utc, status, error_message)
      VALUES ($1, NOW(), NOW(), $2, $3)
      ON CONFLICT (agent_name)
      DO UPDATE SET
        last_ping_utc      = NOW(),
        last_ingestion_utc = NOW(),
        status             = $2,
        error_message      = $3
    `, `${agentName}:${businessId}`, status, errorMessage ?? null);
  } catch (err: any) {
    // Non-fatal — heartbeat failure must never crash agents
    console.warn(`[agentMonitor] writeHeartbeat failed for ${agentName}:`, err.message);
  }
}

/** Returns health summary for all tracked agents. */
export async function getAgentHealth(): Promise<AgentHealthRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        agent_name,
        last_ping_utc,
        last_ingestion_utc,
        status,
        error_message,
        EXTRACT(EPOCH FROM (NOW() - last_ping_utc)) / 3600 AS hours_since_ping
      FROM agent_heartbeat
      ORDER BY last_ping_utc DESC
    `);
    return rows.map(r => ({
      agent_name:          r.agent_name,
      last_ping_utc:       r.last_ping_utc,
      last_ingestion_utc:  r.last_ingestion_utc,
      status:              r.status,
      error_message:       r.error_message,
      hours_since_ping:    parseFloat(r.hours_since_ping ?? '0'),
      is_stale:            parseFloat(r.hours_since_ping ?? '0') > 26,
    }));
  } catch {
    return [];
  }
}

/** Returns count of agents in each status bucket (ok / failed / stale). */
export async function getAgentStatusSummary(): Promise<{
  total: number;
  ok: number;
  failed: number;
  stale: number;
  agents: AgentHealthRow[];
}> {
  const agents = await getAgentHealth();
  return {
    total:  agents.length,
    ok:     agents.filter(a => a.status === 'ok' && !a.is_stale).length,
    failed: agents.filter(a => a.status === 'failed').length,
    stale:  agents.filter(a => a.is_stale).length,
    agents,
  };
}

export interface AgentHealthRow {
  agent_name:         string;
  last_ping_utc:      Date;
  last_ingestion_utc: Date | null;
  status:             string;
  error_message:      string | null;
  hours_since_ping:   number;
  is_stale:           boolean;
}
