import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { getSectorContext } from '../../lib/sectorPrompts';

/**
 * demandGapEngine — scans local demand signals to find unmet needs in the area.
 * "200 people in your city searched for X but no one provides it locally."
 * Creates MarketSignal records with category='demand_gap'.
 */
export async function demandGapEngine(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profiles = await prisma.businessProfile.findMany({ where: { id: businessProfileId } });
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const [competitors, signals, sectorKnowledge, existingGaps] = await Promise.all([
      prisma.competitor.findMany({ where: { linked_business: businessProfileId }, take: 10 }),
      prisma.marketSignal.findMany({ where: { linked_business: businessProfileId }, orderBy: { created_date: 'desc' }, take: 20 }),
      prisma.sectorKnowledge.findFirst({ where: { sector: profile.category }, orderBy: { created_date: 'desc' } }),
      prisma.marketSignal.findMany({
        where: { linked_business: businessProfileId, source_type: 'demand_gap' },
        select: { summary: true },
        take: 20,
      }),
    ]);

    const existingGapTexts = new Set(existingGaps.map(g => g.summary.substring(0, 50)));

    const competitorServices = competitors.map(c => `${c.name}: ${c.services || c.category}`).join('\n');
    const recentSignals = signals.slice(0, 8).map(s => `- ${s.summary}`).join('\n');
    const sectorCtx = getSectorContext(profile.category);

    const result = await invokeLLM({
      model: 'sonnet',
      maxTokens: 1600,
      skipCache: true,
      prompt: `You are a demand-gap analysis engine for Israeli small businesses.

Business: "${profile.name}" (${profile.category}, ${profile.city})
${profile.description ? `Description: ${profile.description}` : ''}
Current services: ${profile.relevant_services || 'not specified'}

Local competitors:
${competitorServices || 'none identified'}

Recent market signals:
${recentSignals || 'none'}

Identify 3-5 concrete demand gaps — real unmet local demand. Return ONLY a JSON object. ALL string values must be in Hebrew except "time_to_capture":
{
  "gaps": [
    {
      "demand": "Hebrew description of unmet demand",
      "evidence": "Hebrew evidence pointing to this demand",
      "estimated_monthly_demand": "estimated monthly searches/requests (number as string)",
      "opportunity_score": 75,
      "action": "Hebrew concrete action to capture this opportunity",
      "time_to_capture": "immediate|weeks|months"
    }
  ]
}`,
      response_json_schema: { type: 'object' },
    });

    const gaps: any[] = result?.gaps || [];
    let created = 0;

    for (const gap of gaps.sort((a: any, b: any) => (b.opportunity_score || 0) - (a.opportunity_score || 0))) {
      if (!gap.demand) continue;
      const key = gap.demand.substring(0, 50);
      if (existingGapTexts.has(key)) continue;

      await prisma.marketSignal.create({
        data: {
          linked_business: businessProfileId,
          summary: gap.demand,
          category: 'demand_gap',
          source_type: 'demand_gap',
          impact_level: gap.opportunity_score >= 70 ? 'high' : gap.opportunity_score >= 40 ? 'medium' : 'low',
          recommended_action: gap.action || '',
          confidence: (gap.opportunity_score || 50) / 100,
          source_description: gap.evidence || '',
          tags: `demand_gap,${gap.time_to_capture || 'weeks'},score:${gap.opportunity_score || 50}`,
          detected_at: new Date().toISOString(),
          is_read: false,
          is_dismissed: false,
          agent_name: 'demandGapEngine',
        },
      });
      existingGapTexts.add(key);
      created++;
    }

    await writeAutomationLog('demandGapEngine', businessProfileId, startTime, created);
    console.log(`demandGapEngine: ${created} demand gaps found for ${profile.name}`);
    return res.json({ gaps_found: created, items_created: created });
  } catch (err: any) {
    console.error('demandGapEngine error:', err.message);
    await writeAutomationLog('demandGapEngine', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
