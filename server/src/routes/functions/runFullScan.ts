import { Request, Response } from 'express';
import { prisma } from '../../db';
import { writeAutomationLog } from '../../lib/automationLog';
import { collectWebSignals } from './collectWebSignals';
import { collectSocialSignals } from './collectSocialSignals';
import { collectReviews } from './collectReviews';
import { runMarketIntelligence } from './runMarketIntelligence';
import { runCompetitorIdentification } from './runCompetitorIdentification';
import { runLeadGeneration } from './runLeadGeneration';
import { findSocialLeads } from './findSocialLeads';
import { detectTrends } from './detectTrends';
import { detectEarlyTrends } from './detectEarlyTrends';
import { detectViralSignals } from './detectViralSignals';
import { calculateHealthScore } from './calculateHealthScore';
import { generateMorningBriefing } from './generateMorningBriefing';
import { runPredictions } from './runPredictions';
import { generateProactiveAlerts } from './generateProactiveAlerts';
import { updateLeadFreshness as applyDataFreshness } from './updateLeadFreshness';
import { runMLLearning } from './learnFromClosedDeals';
import { runMLLearningCycle } from './runMLLearningCycle';
import { cleanupAndLearn } from './cleanupAndLearn';
import { analyzeInstagramComments } from './analyzeInstagramComments';
import { analyzeSocialComments } from './analyzeSocialComments';
import { analyzeTikTokContent } from './analyzeTikTokContent';

async function callHandler(fn: Function, businessProfileId: string): Promise<any> {
  return new Promise((resolve) => {
    const fakeReq = { body: { businessProfileId } } as Request;
    let done = false;
    const fakeRes: any = {
      json: (data: any) => { if (!done) { done = true; resolve(data); } return fakeRes; },
      status: (_: number) => fakeRes,
    };
    Promise.resolve(fn(fakeReq, fakeRes)).catch((e: any) => {
      if (!done) { done = true; resolve({ error: e.message }); }
    });
  });
}

export async function runFullScan(req: Request, res: Response) {
  let { businessProfileId } = req.body;

  if (!businessProfileId) {
    const profiles = await prisma.businessProfile.findMany({ orderBy: { created_date: 'desc' }, take: 1 });
    businessProfileId = profiles[0]?.id;
  }
  if (!businessProfileId) return res.json({ success: false, message: 'No business profile found' });

  const startTime = new Date().toISOString();
  const results: Record<string, any> = {};

  const profileRows = await prisma.businessProfile.findMany({ where: { id: businessProfileId }, take: 1 });
  const profile = profileRows[0];

  // Full pipeline — ordered from data collection → analysis → learning → cleanup
  const pipeline: Array<[string, Function]> = [
    // ── Data Collection ──────────────────────────────────────────
    ['collectWebSignals',           collectWebSignals],
    ['collectSocialSignals',        collectSocialSignals],
    ['analyzeInstagramComments',    analyzeInstagramComments],
    ['analyzeSocialComments',       analyzeSocialComments],
    ['analyzeTikTokContent',        analyzeTikTokContent],
    ['collectReviews',              collectReviews],
    // ── Analysis ────────────────────────────────────────────────
    ['runMarketIntelligence',       runMarketIntelligence],
    ['runCompetitorIdentification', runCompetitorIdentification],
    ['runLeadGeneration',           runLeadGeneration],
    ['findSocialLeads',             findSocialLeads],
    // ── Trend Intelligence ───────────────────────────────────────
    ['detectTrends',                detectTrends],
    ['detectEarlyTrends',           detectEarlyTrends],
    ['detectViralSignals',          detectViralSignals],
    // ── Predictive + Alerts ──────────────────────────────────────
    ['runPredictions',              runPredictions],
    ['applyDataFreshness',          applyDataFreshness],
    ['generateProactiveAlerts',     generateProactiveAlerts],
    // ── Learning + Optimization ──────────────────────────────────
    ['runMLLearning',               runMLLearning],
    ['runMLLearningCycle',          runMLLearningCycle],
    ['calculateHealthScore',        calculateHealthScore],
    // ── Cleanup (last — runs after learning) ────────────────────
    ['cleanupAndLearn',             cleanupAndLearn],
    // ── Briefing (always last) ───────────────────────────────────
    ['generateMorningBriefing',     generateMorningBriefing],
  ];

  for (const [name, fn] of pipeline) {
    try {
      results[name] = await callHandler(fn, businessProfileId);
    } catch (e: any) {
      results[name] = { error: e.message };
    }
  }

  await writeAutomationLog('runFullScan', businessProfileId, startTime, pipeline.length);
  return res.json({ success: true, profile_name: profile?.name, results });
}
