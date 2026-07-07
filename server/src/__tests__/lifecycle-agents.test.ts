jest.mock('../db', () => {
  const mk = () => ({
    findFirst:  jest.fn().mockResolvedValue(null),
    findMany:   jest.fn().mockResolvedValue([]),
    create:     jest.fn().mockResolvedValue({}),
    update:     jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    prisma: {
      lead: mk(), businessProfile: mk(), proactiveAlert: mk(),
      sectorKnowledge: mk(), rawSignal: mk(), socialSignal: mk(),
      marketSignal: mk(), prediction: mk(), action: mk(),
      pendingAlert: mk(), healthScore: mk(), weeklyReport: mk(),
      automationLog: mk(), outcomeLog: mk(),
    },
  };
});
jest.mock('../lib/llm',              () => ({ invokeLLM:        jest.fn() }));
jest.mock('../lib/automationLog',    () => ({ writeAutomationLog: jest.fn() }));
jest.mock('../lib/businessContext',  () => ({ loadBusinessContext: jest.fn().mockResolvedValue({}) }));
jest.mock('../lib/constraintValidator', () => ({
  validateAction: jest.fn().mockResolvedValue({ action: { content: 'msg' }, constraintNotes: [] }),
}));
jest.mock('../services/execution/executeOrQueue', () => ({
  executeOrQueue: jest.fn().mockResolvedValue({ autoActionId: 'act-1' }),
}));
jest.mock('../lib/missionPlanner', () => ({
  getAgentMission: jest.fn().mockReturnValue(null),
  getAllMissions:   jest.fn().mockReturnValue(null),
}));

import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';
import { writeAutomationLog } from '../lib/automationLog';
import { executeOrQueue } from '../services/execution/executeOrQueue';
import { intentClassification } from '../routes/functions/intentClassification';
import { lostLeadRecovery }      from '../routes/functions/lostLeadRecovery';
import { updateLeadFreshness }   from '../routes/functions/updateLeadFreshness';
import { smartLeadNurture }      from '../routes/functions/smartLeadNurture';

const lead = prisma.lead as any;
const bp   = prisma.businessProfile as any;
const pa   = prisma.proactiveAlert as any;

function fakeRes() {
  const r: any = {};
  r.json   = jest.fn().mockReturnValue(r);
  r.status = jest.fn().mockReturnValue(r);
  return r;
}

beforeEach(() => jest.clearAllMocks());

// ── AC1: intentClassification ────────────────────────────────────────────────
describe('intentClassification', () => {
  it('calls Haiku and writes intent_strength hot/warm/cool to lead', async () => {
    lead.findFirst.mockResolvedValue({ id: 'l1', name: 'Alice', score: 50, status: 'new', notes: null });
    (invokeLLM as jest.Mock).mockResolvedValue({ intent_level: 'hot', confidence: 0.9, score: 82, signals: ['budget'] });
    lead.update.mockResolvedValue({});

    const res = fakeRes();
    await intentClassification({ body: { leadId: 'l1', businessProfileId: 'b1' } } as any, res);

    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ model: 'haiku' }));
    expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ intent_strength: 'hot' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ intent_level: 'hot' }));
  });
});

// ── AC3: lostLeadRecovery ─────────────────────────────────────────────────────
describe('lostLeadRecovery', () => {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_001).toISOString();
  const coldLead = {
    id: 'l2', name: 'Bob', service_needed: 'design', score: 75, source: 'web',
    notes: null, last_contact_at: fourteenDaysAgo, created_date: new Date(fourteenDaysAgo),
  };
  const profile = { id: 'b1', name: 'Biz', category: 'design', tone_preference: 'professional', agent_missions: null };

  it('creates ProactiveAlert of type lost_lead_recovery', async () => {
    bp.findMany.mockResolvedValue([profile]);
    lead.findMany.mockResolvedValue([coldLead]);
    pa.findMany.mockResolvedValue([]);
    (invokeLLM as jest.Mock).mockResolvedValue({ message: 'hey Bob', subject: 'sub' });

    await lostLeadRecovery({ body: { businessProfileId: 'b1' } } as any, fakeRes());

    expect(pa.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'lost_lead_recovery' }),
    }));
    expect(writeAutomationLog).toHaveBeenCalledWith('lostLeadRecovery', 'b1', expect.any(String), 1);
  });

  it('skips duplicate recovery alert', async () => {
    bp.findMany.mockResolvedValue([profile]);
    lead.findMany.mockResolvedValue([coldLead]);
    pa.findMany.mockResolvedValue([{ title: `שחזר ליד: ${coldLead.name}` }]);
    (invokeLLM as jest.Mock).mockResolvedValue({ message: 'hey', subject: 'sub' });

    await lostLeadRecovery({ body: { businessProfileId: 'b1' } } as any, fakeRes());

    expect(pa.create).not.toHaveBeenCalled();
  });
});

// ── AC4: updateLeadFreshness ──────────────────────────────────────────────────
describe('updateLeadFreshness', () => {
  it('downgrades warm lead with stale score to cold and logs as updateLeadFreshness', async () => {
    // 30d-old lead → computeFreshness ≈ 5, below cold threshold of 20
    const staleDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const staleLead = {
      id: 'l3', discovered_at: staleDate, created_at: staleDate,
      last_contact_at: staleDate, status: 'warm', freshness_score: 100,
    };
    lead.findMany
      .mockResolvedValueOnce([staleLead])  // Phase 1 active leads
      .mockResolvedValueOnce([staleLead])  // Phase 2 archive check
      .mockResolvedValueOnce([]);          // Phase 3 dedup

    await updateLeadFreshness({ body: { businessProfileId: 'b1' } } as any, fakeRes());

    expect(lead.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ freshness_score: expect.any(Number), status: 'cold' }),
    }));
    expect(writeAutomationLog).toHaveBeenCalledWith('updateLeadFreshness', 'b1', expect.any(String), expect.any(Number));
  });
});

// ── AC2: smartLeadNurture ─────────────────────────────────────────────────────
describe('smartLeadNurture', () => {
  it('queues follow-up for a 48h–7d contacted lead', async () => {
    const profile = { id: 'b1', name: 'Biz', category: 'hair', city: 'TLV', tone_preference: 'professional', agent_missions: null };
    // lead created 72h ago → past 48h threshold, not yet 7d cold
    const staleLead = {
      id: 'l4', name: 'Carol', status: 'contacted', service_needed: 'haircut',
      contact_phone: '0501234567', score: 80, notes: null, followup_count: 0,
      created_date: new Date(Date.now() - 72 * 3_600_000),
    };

    bp.findMany.mockResolvedValue([profile]);
    lead.findMany.mockResolvedValue([staleLead]);
    (invokeLLM as jest.Mock).mockResolvedValue('הודעת מעקב');
    pa.findFirst.mockResolvedValue(null);

    await smartLeadNurture({ body: { businessProfileId: 'b1' } } as any, fakeRes());

    expect(executeOrQueue).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'smartLeadNurture',
      isLead: true,
    }));
    expect(writeAutomationLog).toHaveBeenCalledWith('smartLeadNurture', 'b1', expect.any(String), expect.any(Number));
  });
});
