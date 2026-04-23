/**
 * Learning Engine API
 * GET  /api/learning/dashboard/:businessProfileId  — learning center data
 * POST /api/learning/run/:businessProfileId        — run full learning cycle
 *
 * The learning engine:
 * 1. Aggregates all feedback for the last 30 days
 * 2. Computes per-agent accuracy scores
 * 3. Detects recurring patterns (accepted / rejected)
 * 4. Updates BusinessMemory with learned weights
 * 5. Updates AgentLearningProfiles
 * 6. Generates a human-readable learning summary
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/learning/dashboard/:businessProfileId
router.get('/dashboard/:businessProfileId', async (req: Request, res: Response) => {
  const businessProfileId = String(req.params.businessProfileId);
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [feedback, profiles, signals, memory, recentOutputs] = await Promise.all([
      prisma.feedbackEvent.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: thirtyDaysAgo } },
        orderBy: { created_date: 'desc' },
      }),
      prisma.agentLearningProfile.findMany({ where: { linked_business: businessProfileId } }),
      prisma.learningSignal.findMany({
        where: { linked_business: businessProfileId },
        orderBy: { occurrence_count: 'desc' },
        take: 30,
      }),
      prisma.businessMemory.findUnique({ where: { linked_business: businessProfileId } }),
      prisma.aIOutput.findMany({
        where: { linked_business: businessProfileId, created_date: { gte: thirtyDaysAgo } },
        orderBy: { created_date: 'desc' },
        take: 20,
      }),
    ]);

    const totalFeedback = feedback.length;
    const positiveCount = feedback.filter(f => (f.score ?? 0) > 0).length;
    const negativeCount = feedback.filter(f => (f.score ?? 0) < 0).length;
    const overallAccuracy = totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 100) : null;

    // Tag frequency analysis
    const tagFreq: Record<string, number> = {};
    for (const f of feedback) {
      if (!f.tags) continue;
      for (const tag of f.tags.split(',')) {
        const t = tag.trim();
        if (t) tagFreq[t] = (tagFreq[t] || 0) + 1;
      }
    }
    const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Improvements: signals with high occurrence count
    const improvements = signals
      .filter(s => (s.occurrence_count ?? 0) >= 3)
      .map(s => ({
        pattern: s.pattern_label,
        count: s.occurrence_count,
        type: s.signal_type,
        agent: s.agent_name,
      }));

    // Recent accepted / rejected
    const recentAccepted = feedback.filter(f => (f.score ?? 0) > 0).slice(0, 5);
    const recentRejected = feedback.filter(f => (f.score ?? 0) < 0).slice(0, 5);

    // Business preferences from memory
    let preferences: Record<string, any> = {};
    if (memory) {
      preferences = {
        preferred_tone: memory.preferred_tone,
        preferred_channels: safeParseArr(memory.preferred_channels),
        top_accepted: safeParseArr(memory.accepted_patterns).slice(0, 5),
        top_rejected: safeParseArr(memory.rejected_patterns).slice(0, 5),
        learning_version: memory.learning_version,
        last_updated: memory.last_updated,
      };
    }

    return res.json({
      overview: {
        total_feedback: totalFeedback,
        positive_count: positiveCount,
        negative_count: negativeCount,
        overall_accuracy: overallAccuracy,
        total_agents_tracked: profiles.length,
        total_patterns_learned: signals.length,
      },
      agent_profiles: profiles.map(p => ({
        agent: p.agent_name,
        accuracy: Math.round((p.accuracy_score ?? 0.5) * 100),
        total_outputs: p.total_outputs,
        positive: p.positive_count,
        negative: p.negative_count,
        accepted_types: safeParseArr(p.accepted_types).slice(0, 3),
        rejected_types: safeParseArr(p.rejected_types).slice(0, 3),
      })),
      improvements,
      top_tags: topTags,
      preferences,
      recent_accepted: recentAccepted,
      recent_rejected: recentRejected,
    });
  } catch (err: any) {
    console.error('[learning/dashboard]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/learning/run/:businessProfileId
router.post('/run/:businessProfileId', async (req: Request, res: Response) => {
  const businessProfileId = String(req.params.businessProfileId);
  const startTime = Date.now();
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const feedback = await prisma.feedbackEvent.findMany({
      where: { linked_business: businessProfileId, created_date: { gte: thirtyDaysAgo } },
    });

    if (feedback.length === 0) {
      return res.json({ message: 'אין משוב מספיק להרצת מנוע הלמידה', feedback_count: 0 });
    }

    // Group by agent
    const byAgent = new Map<string, typeof feedback>();
    for (const f of feedback) {
      const name = f.agent_name || 'unknown';
      if (!byAgent.has(name)) byAgent.set(name, []);
      byAgent.get(name)!.push(f);
    }

    let agentsUpdated = 0;
    const agentWeights: Record<string, number> = {};

    for (const [agentName, events] of byAgent) {
      const pos = events.filter(e => (e.score ?? 0) > 0).length;
      const neg = events.filter(e => (e.score ?? 0) < 0).length;
      const total = events.length;
      const accuracy = total > 0 ? pos / total : 0.5;

      agentWeights[agentName] = accuracy;

      // Collect rejected/accepted output types
      const rejectedTypes = [...new Set(
        events.filter(e => (e.score ?? 0) < 0).map(e => e.output_type).filter(Boolean) as string[]
      )].slice(0, 10);
      const acceptedTypes = [...new Set(
        events.filter(e => (e.score ?? 0) > 0).map(e => e.output_type).filter(Boolean) as string[]
      )].slice(0, 10);

      await prisma.agentLearningProfile.upsert({
        where: { linked_business_agent_name: { linked_business: businessProfileId, agent_name: agentName } },
        update: {
          total_outputs:  total,
          positive_count: pos,
          negative_count: neg,
          accuracy_score: Math.round(accuracy * 1000) / 1000,
          rejected_types: JSON.stringify(rejectedTypes),
          accepted_types: JSON.stringify(acceptedTypes),
          last_updated:   new Date().toISOString(),
        },
        create: {
          linked_business: businessProfileId,
          agent_name:      agentName,
          total_outputs:   total,
          positive_count:  pos,
          negative_count:  neg,
          accuracy_score:  Math.round(accuracy * 1000) / 1000,
          rejected_types:  JSON.stringify(rejectedTypes),
          accepted_types:  JSON.stringify(acceptedTypes),
          last_updated:    new Date().toISOString(),
        },
      });
      agentsUpdated++;
    }

    // Tag frequency
    const tagFreq: Record<string, number> = {};
    for (const f of feedback) {
      if (!f.tags) continue;
      for (const tag of f.tags.split(',')) {
        const t = tag.trim();
        if (t) tagFreq[t] = (tagFreq[t] || 0) + 1;
      }
    }
    const topNegTag = Object.entries(tagFreq)
      .filter(([t]) => ['irrelevant', 'inaccurate', 'too_generic', 'wrong_priority', 'bad_timing'].includes(t))
      .sort((a, b) => b[1] - a[1])[0];
    const topPosTag = Object.entries(tagFreq)
      .filter(([t]) => ['useful', 'accurate', 'actionable', 'good_insight', 'highly_relevant'].includes(t))
      .sort((a, b) => b[1] - a[1])[0];

    // Compute preferred channels from accepted feedback
    const channelVotes: Record<string, number> = {};
    for (const f of feedback.filter(e => (e.score ?? 0) > 0)) {
      if (f.tags?.includes('instagram')) channelVotes.instagram = (channelVotes.instagram || 0) + 1;
      if (f.tags?.includes('facebook'))  channelVotes.facebook  = (channelVotes.facebook  || 0) + 1;
      if (f.tags?.includes('whatsapp'))  channelVotes.whatsapp  = (channelVotes.whatsapp  || 0) + 1;
    }
    const preferredChannels = Object.entries(channelVotes).sort((a, b) => b[1] - a[1]).map(([c]) => c);

    // Build rejected/accepted pattern lists
    const rejectedPatterns = [...new Set(
      feedback.filter(e => (e.score ?? 0) < 0).map(e => `${e.agent_name}:${e.output_type || 'general'}`)
    )].slice(0, 30);
    const acceptedPatterns = [...new Set(
      feedback.filter(e => (e.score ?? 0) > 0).map(e => `${e.agent_name}:${e.output_type || 'general'}`)
    )].slice(0, 30);

    const feedbackSummary = {
      common_rejection: topNegTag?.[0] || null,
      common_positive:  topPosTag?.[0] || null,
      tag_counts:       tagFreq,
      last_run:         new Date().toISOString(),
    };

    // Upsert BusinessMemory
    await prisma.businessMemory.upsert({
      where: { linked_business: businessProfileId },
      update: {
        agent_weights:     JSON.stringify(agentWeights),
        rejected_patterns: JSON.stringify(rejectedPatterns),
        accepted_patterns: JSON.stringify(acceptedPatterns),
        preferred_channels: preferredChannels.length > 0 ? JSON.stringify(preferredChannels) : undefined,
        feedback_summary:  JSON.stringify(feedbackSummary),
        last_updated:      new Date().toISOString(),
        learning_version:  { increment: 1 } as any,
      },
      create: {
        linked_business:   businessProfileId,
        agent_weights:     JSON.stringify(agentWeights),
        rejected_patterns: JSON.stringify(rejectedPatterns),
        accepted_patterns: JSON.stringify(acceptedPatterns),
        preferred_channels: preferredChannels.length > 0 ? JSON.stringify(preferredChannels) : null,
        feedback_summary:  JSON.stringify(feedbackSummary),
        last_updated:      new Date().toISOString(),
        learning_version:  1,
      },
    });

    const elapsed = Date.now() - startTime;
    return res.json({
      ok: true,
      message: `מנוע הלמידה הושלם — ${feedback.length} אירועים, ${agentsUpdated} סוכנים עודכנו`,
      feedback_analyzed: feedback.length,
      agents_updated: agentsUpdated,
      elapsed_ms: elapsed,
    });
  } catch (err: any) {
    console.error('[learning/run]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function safeParseArr(val: string | null | undefined): string[] {
  try { const r = val ? JSON.parse(val) : []; return Array.isArray(r) ? r : []; } catch { return []; }
}

export default router;
