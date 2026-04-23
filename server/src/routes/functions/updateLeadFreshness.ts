/**
 * updateLeadFreshness (Cleaner Agent) — Full Data Hygiene
 *
 * Phase 1 — Lead freshness decay + status downgrade
 * Phase 2 — Archive stale leads (cold >30d, disqualified >14d, never contacted >60d, closed_lost >90d)
 * Phase 3 — Deduplicate leads by phone number
 * Phase 4 — Purge raw signals older than 30 days
 * Phase 5 — Purge old social signals (>60 days)
 * Phase 6 — Purge read market signals (>90 days) and unread stale market signals (>120 days)
 * Phase 7 — Purge dismissed/acted-on proactive alerts (>30 days)
 * Phase 8 — Purge read/expired predictions (>60 days)
 * Phase 9 — Purge completed/rejected actions (>30 days)
 * Phase 10 — Purge sent pending alerts (>14 days)
 * Phase 11 — Keep only last 30 health score snapshots
 * Phase 12 — Keep only last 12 weekly reports
 * Phase 13 — Purge automation logs older than 90 days
 * Phase 14 — Purge outcome logs older than 60 days
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

const DAYS = (d: number) => new Date(Date.now() - d * 86_400_000);

function computeFreshness(discoveredAt: string | null, lastContactAt: string | null): number {
  const referenceTime = lastContactAt || discoveredAt;
  if (!referenceTime) return 50;
  const hoursElapsed = (Date.now() - new Date(referenceTime).getTime()) / 3_600_000;
  const raw = 100 - 95 * Math.log10(1 + hoursElapsed / 6);
  return Math.round(Math.max(5, Math.min(100, raw)));
}

function ageMs(dateStr: string | Date | null | undefined): number {
  if (!dateStr) return Infinity;
  return Date.now() - new Date(dateStr).getTime();
}

export async function updateLeadFreshness(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  const stats: Record<string, number> = {};

  try {
    // ── Phase 1: Lead freshness decay ─────────────────────────────────────────
    const activeLeads = await prisma.lead.findMany({
      where: {
        linked_business: businessProfileId,
        status: { notIn: ['closed_won', 'closed_lost', 'disqualified', 'archived'] },
      },
      select: { id: true, discovered_at: true, created_at: true, last_contact_at: true, status: true, freshness_score: true },
    });

    let freshnessUpdated = 0;
    for (const lead of activeLeads) {
      const discoveredAt = lead.discovered_at || lead.created_at;
      const newScore = computeFreshness(discoveredAt, lead.last_contact_at);
      const newStatus =
        newScore < 20 && (lead.status === 'warm' || lead.status === 'hot') ? 'cold' : lead.status ?? undefined;
      const scoreChanged = Math.abs((lead.freshness_score ?? 100) - newScore) >= 2;
      const statusChanged = newStatus !== lead.status;
      if (!scoreChanged && !statusChanged) continue;
      await prisma.lead.update({
        where: { id: lead.id },
        data: { freshness_score: newScore, ...(statusChanged ? { status: newStatus } : {}) },
      });
      freshnessUpdated++;
    }
    stats.leads_freshness_updated = freshnessUpdated;

    // ── Phase 2: Archive stale leads ──────────────────────────────────────────
    const allLeads = await prisma.lead.findMany({
      where: { linked_business: businessProfileId, status: { notIn: ['closed_won', 'archived'] } },
      select: { id: true, status: true, created_at: true, created_date: true, last_contact_at: true, discovered_at: true },
    });

    const toArchive: string[] = [];
    for (const lead of allLeads) {
      const ref = lead.last_contact_at || lead.discovered_at || lead.created_at || lead.created_date?.toISOString();
      const age = ageMs(ref);
      if (lead.status === 'cold'        && age > 30 * 86_400_000) toArchive.push(lead.id);
      else if (lead.status === 'disqualified' && age > 14 * 86_400_000) toArchive.push(lead.id);
      else if ((lead.status === 'new' || lead.status === 'warm') && !lead.last_contact_at && age > 60 * 86_400_000) toArchive.push(lead.id);
      else if (lead.status === 'closed_lost' && age > 90 * 86_400_000) toArchive.push(lead.id);
    }
    if (toArchive.length > 0) {
      const r = await prisma.lead.updateMany({ where: { id: { in: toArchive } }, data: { status: 'archived' } });
      stats.leads_archived = r.count;
    } else stats.leads_archived = 0;

    // ── Phase 3: Deduplicate leads by phone ───────────────────────────────────
    const phonedLeads = await prisma.lead.findMany({
      where: { linked_business: businessProfileId, status: { notIn: ['closed_won', 'archived'] }, contact_phone: { not: null } },
      select: { id: true, contact_phone: true, score: true },
    });
    const phoneMap = new Map<string, typeof phonedLeads>();
    for (const l of phonedLeads) {
      const p = l.contact_phone!.replace(/[\s\-]/g, '');
      if (!p) continue;
      if (!phoneMap.has(p)) phoneMap.set(p, []);
      phoneMap.get(p)!.push(l);
    }
    const dupeIds: string[] = [];
    for (const [, grp] of phoneMap) {
      if (grp.length < 2) continue;
      grp.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      dupeIds.push(...grp.slice(1).map(l => l.id));
    }
    if (dupeIds.length > 0) {
      const r = await prisma.lead.updateMany({ where: { id: { in: dupeIds } }, data: { status: 'archived' } });
      stats.leads_deduplicated = r.count;
    } else stats.leads_deduplicated = 0;

    // ── Phase 4: Purge raw signals >30 days ───────────────────────────────────
    const r4 = await prisma.rawSignal.deleteMany({
      where: { linked_business: businessProfileId, created_date: { lt: DAYS(30) } },
    });
    stats.raw_signals_deleted = r4.count;

    // ── Phase 5: Purge social signals >60 days ────────────────────────────────
    const r5 = await prisma.socialSignal.deleteMany({
      where: { linked_business: businessProfileId, created_date: { lt: DAYS(60) } },
    });
    stats.social_signals_deleted = r5.count;

    // ── Phase 6: Purge old market signals ─────────────────────────────────────
    // Read signals: keep 14 days. Unread: keep 45 days.
    const r6a = await prisma.marketSignal.deleteMany({
      where: { linked_business: businessProfileId, is_read: true, created_date: { lt: DAYS(14) } },
    });
    const r6b = await prisma.marketSignal.deleteMany({
      where: { linked_business: businessProfileId, is_read: false, created_date: { lt: DAYS(45) } },
    });
    stats.market_signals_deleted = r6a.count + r6b.count;

    // ── Phase 7: Purge dismissed/acted-on proactive alerts >30 days ──────────
    const r7 = await prisma.proactiveAlert.deleteMany({
      where: {
        linked_business: businessProfileId,
        created_date: { lt: DAYS(30) },
        OR: [{ is_dismissed: true }, { is_acted_on: true }],
      },
    });
    stats.alerts_deleted = r7.count;

    // ── Phase 8: Purge read/expired predictions >60 days ─────────────────────
    const r8 = await prisma.prediction.deleteMany({
      where: {
        linked_business: businessProfileId,
        created_date: { lt: DAYS(60) },
        OR: [{ is_read: true }, { status: 'expired' }],
      },
    });
    stats.predictions_deleted = r8.count;

    // ── Phase 9: Purge completed/rejected actions >30 days ───────────────────
    const r9 = await prisma.action.deleteMany({
      where: {
        linked_business: businessProfileId,
        created_date: { lt: DAYS(30) },
        status: { in: ['completed', 'rejected', 'dismissed'] },
      },
    });
    stats.actions_deleted = r9.count;

    // ── Phase 10: Purge sent pending alerts >14 days ──────────────────────────
    const r10 = await prisma.pendingAlert.deleteMany({
      where: { linked_business: businessProfileId, is_sent: true, created_date: { lt: DAYS(14) } },
    });
    stats.pending_alerts_deleted = r10.count;

    // ── Phase 11: Keep only last 30 health score snapshots ───────────────────
    const healthScores = await prisma.healthScore.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      select: { id: true },
    });
    if (healthScores.length > 30) {
      const toDelete = healthScores.slice(30).map(h => h.id);
      const r11 = await prisma.healthScore.deleteMany({ where: { id: { in: toDelete } } });
      stats.health_scores_deleted = r11.count;
    } else stats.health_scores_deleted = 0;

    // ── Phase 12: Keep only last 12 weekly reports ───────────────────────────
    const weeklyReports = await prisma.weeklyReport.findMany({
      where: { linked_business: businessProfileId },
      orderBy: { created_date: 'desc' },
      select: { id: true },
    });
    if (weeklyReports.length > 12) {
      const toDelete = weeklyReports.slice(12).map(r => r.id);
      const r12 = await prisma.weeklyReport.deleteMany({ where: { id: { in: toDelete } } });
      stats.weekly_reports_deleted = r12.count;
    } else stats.weekly_reports_deleted = 0;

    // ── Phase 13: Purge automation logs older than 90 days ───────────────────
    const r13 = await prisma.automationLog.deleteMany({
      where: { linked_business: businessProfileId, created_date: { lt: DAYS(90) } },
    });
    stats.automation_logs_deleted = r13.count;

    // ── Phase 14: Purge outcome logs older than 60 days ──────────────────────
    const r14 = await prisma.outcomeLog.deleteMany({
      where: { linked_business: businessProfileId, created_date: { lt: DAYS(60) } },
    });
    stats.outcome_logs_deleted = r14.count;

    // ── Summary ───────────────────────────────────────────────────────────────
    const totalCleaned =
      stats.leads_archived + stats.leads_deduplicated +
      stats.raw_signals_deleted + stats.social_signals_deleted + stats.market_signals_deleted +
      stats.alerts_deleted + stats.predictions_deleted + stats.actions_deleted +
      stats.pending_alerts_deleted + stats.health_scores_deleted +
      stats.weekly_reports_deleted + stats.automation_logs_deleted + stats.outcome_logs_deleted;

    const parts: string[] = [];
    if (stats.leads_freshness_updated > 0) parts.push(`${stats.leads_freshness_updated} לידים עודכנו`);
    if (stats.leads_archived > 0)         parts.push(`${stats.leads_archived} לידים לארכיב`);
    if (stats.leads_deduplicated > 0)     parts.push(`${stats.leads_deduplicated} כפילויות`);
    if (stats.raw_signals_deleted > 0)    parts.push(`${stats.raw_signals_deleted} אותות ישנים`);
    if (stats.market_signals_deleted > 0) parts.push(`${stats.market_signals_deleted} תובנות ישנות`);
    if (stats.social_signals_deleted > 0) parts.push(`${stats.social_signals_deleted} פוסטים ישנים`);
    if (stats.alerts_deleted > 0)         parts.push(`${stats.alerts_deleted} התראות`);
    if (stats.predictions_deleted > 0)    parts.push(`${stats.predictions_deleted} תחזיות`);
    if (totalCleaned === 0) parts.push('המערכת נקייה');

    const message = parts.join(' · ');

    await writeAutomationLog('applyDataFreshness', businessProfileId, startTime, totalCleaned);
    console.log(`Cleaner done: ${JSON.stringify(stats)}`);

    return res.json({
      message,
      leads_updated: stats.leads_freshness_updated,
      leads_archived: stats.leads_archived,
      leads_deduplicated: stats.leads_deduplicated,
      total_cleaned: totalCleaned,
      details: stats,
    });
  } catch (err: any) {
    console.error('updateLeadFreshness error:', err.message);
    await writeAutomationLog('applyDataFreshness', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
