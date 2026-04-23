/**
 * runMLLearning — Lead Feedback Loop / Winner DNA (P1 Upgrade 4)
 *
 * Analyzes all closed_won leads for a business and derives a "Winner DNA":
 * common service types, budget ranges, urgency levels, cities, sources, and
 * avg score. Stores result in SectorKnowledge.winner_lead_dna as JSON.
 *
 * The winner DNA is later used by the AI lead-scoring prompt to bias scoring
 * toward profiles that resemble past winners.
 */

import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';

function topN<T>(items: T[], n = 3): T[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = String(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v as unknown as T);
}

export async function runMLLearning(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    // All closed-won leads for this business
    const winners = await prisma.lead.findMany({
      where: { linked_business: businessProfileId, status: 'closed_won' },
      select: {
        score: true,
        service_needed: true,
        budget_range: true,
        urgency: true,
        city: true,
        source: true,
        source_origin: true,
        closed_value: true,
        followup_count: true,
      },
    });

    if (winners.length === 0) {
      await writeAutomationLog('runMLLearning', businessProfileId, startTime, 0);
      return res.json({ message: 'No closed_won leads yet — nothing to learn from', deals_analyzed: 0 });
    }

    const avgScore = winners.reduce((s, l) => s + (l.score ?? 0), 0) / winners.length;
    const avgValue = winners.filter(l => l.closed_value).reduce((s, l) => s + (l.closed_value ?? 0), 0) /
      (winners.filter(l => l.closed_value).length || 1);
    const avgFollowups = winners.reduce((s, l) => s + (l.followup_count ?? 0), 0) / winners.length;

    const dna = {
      deals_analyzed:    winners.length,
      avg_score:         Math.round(avgScore),
      avg_closed_value:  Math.round(avgValue),
      avg_followups_to_close: Math.round(avgFollowups * 10) / 10,
      top_services:      topN(winners.map(l => l.service_needed).filter(Boolean) as string[]),
      top_budget_ranges: topN(winners.map(l => l.budget_range).filter(Boolean) as string[]),
      top_urgencies:     topN(winners.map(l => l.urgency).filter(Boolean) as string[]),
      top_cities:        topN(winners.map(l => l.city).filter(Boolean) as string[]),
      top_sources:       topN(winners.map(l => l.source_origin ?? l.source).filter(Boolean) as string[]),
      generated_at:      new Date().toISOString(),
    };

    // Upsert into SectorKnowledge for this sector+region
    const existing = await prisma.sectorKnowledge.findFirst({
      where: { sector: profile.category, region: profile.city },
    });

    if (existing) {
      await prisma.sectorKnowledge.update({
        where: { id: existing.id },
        data: { winner_lead_dna: JSON.stringify(dna), last_updated: new Date().toISOString() },
      });
    } else {
      await prisma.sectorKnowledge.create({
        data: {
          sector:          profile.category,
          region:          profile.city,
          winner_lead_dna: JSON.stringify(dna),
          last_updated:    new Date().toISOString(),
        },
      });
    }

    await writeAutomationLog('runMLLearning', businessProfileId, startTime, winners.length);
    console.log(`runMLLearning done: analyzed ${winners.length} won deals`);
    return res.json({ deals_analyzed: winners.length, dna });
  } catch (err: any) {
    console.error('runMLLearning error:', err.message);
    await writeAutomationLog('runMLLearning', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
