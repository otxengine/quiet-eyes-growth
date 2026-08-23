import router from '../routes/onboarding';
import { prisma } from '../db';

jest.mock('../db', () => ({
  prisma: {
    businessProfile: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
  },
}));
jest.mock('../lib/llm',            () => ({ invokeLLM:             jest.fn() }));
jest.mock('../lib/automationLog',  () => ({ writeAutomationLog:    jest.fn() }));
jest.mock('../lib/missionPlanner', () => ({ generateAgentMissions: jest.fn() }));
jest.mock('../routes/functions/stubs', () => ({ autoConfigOsint: jest.fn() }));
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

const findUnique         = prisma.businessProfile.findUnique as jest.Mock;
const update             = prisma.businessProfile.update     as jest.Mock;
const generateAgentMissions = require('../lib/missionPlanner').generateAgentMissions as jest.Mock;
const autoConfigOsint       = require('../routes/functions/stubs').autoConfigOsint as jest.Mock;

function post(url: string, body: Record<string, any>): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = { method: 'POST', url, originalUrl: url, params: {}, headers: {}, body };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    router(req, res, (err?: any) => err ? reject(err) : resolve({ statusCode: 200, body: null }));
  });
}

const DRAFT_JSON = JSON.stringify({ business_name: 'Test Biz', sector_key: 'beauty' });

const NINE_KEY_DRAFT = {
  business_name: 'Test Biz', sector_key: 'beauty', sub_sector_key: 'hair_salon',
  business_type: 'B2C', service_model: 'appointment', target_audience: 'Women 25-45',
  relevant_topics: ['hair care'], content_tone: 'friendly',
  business_description: 'A hair salon in Tel Aviv.',
};

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({});
  generateAgentMissions.mockResolvedValue({});
  autoConfigOsint.mockResolvedValue(undefined);
});

describe('POST /api/onboarding/approve-about', () => {
  it('AC3: promotes about_draft to about_approved and stamps about_approved_at', async () => {
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: DRAFT_JSON, about_status: 'pending' });
    const { body } = await post('/approve-about', { businessProfileId: 'bp1' });
    expect(body.ok).toBe(true);
    expect(body.about_status).toBe('approved');
    const data = update.mock.calls[0][0].data;
    expect(data.about_approved).toBe(DRAFT_JSON);
    expect(data.about_status).toBe('approved');
    expect(data.about_approved_at).toBeTruthy();
  });

  it('KAN-198 AC2/AC5: an edited draft in the body overrides the stored about_draft', async () => {
    const editedDraft = { ...NINE_KEY_DRAFT, business_description: 'OWNER-EDITED description' };
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: JSON.stringify(NINE_KEY_DRAFT), about_status: 'pending' });
    const { body } = await post('/approve-about', { businessProfileId: 'bp1', draft: editedDraft });
    expect(body.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_approved).business_description).toBe('OWNER-EDITED description');
    expect(body.approved.business_description).toBe('OWNER-EDITED description');
  });

  it('KAN-198 AC1: 400s when an edited draft is missing a required key', async () => {
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: DRAFT_JSON, about_status: 'pending' });
    const { statusCode } = await post('/approve-about', { businessProfileId: 'bp1', draft: { business_name: 'x' } });
    expect(statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('400s when there is no draft to approve', async () => {
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: null });
    const { statusCode } = await post('/approve-about', { businessProfileId: 'bp1' });
    expect(statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('400s when businessProfileId missing', async () => {
    const { statusCode } = await post('/approve-about', {});
    expect(statusCode).toBe(400);
  });

  it('KAN-204 AC1: mirrors the approved identity onto description/name/tone_preference/target_market/sector_profile', async () => {
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: JSON.stringify(NINE_KEY_DRAFT), about_status: 'pending', sector_profile: JSON.stringify({ irrelevant_topics: ['sports'] }) });
    await post('/approve-about', { businessProfileId: 'bp1' });
    const data = update.mock.calls[0][0].data;
    expect(data.description).toBe(NINE_KEY_DRAFT.business_description);
    expect(data.name).toBe(NINE_KEY_DRAFT.business_name);
    expect(data.tone_preference).toBe(NINE_KEY_DRAFT.content_tone);
    expect(data.target_market).toBe(NINE_KEY_DRAFT.target_audience);
    const mergedSectorProfile = JSON.parse(data.sector_profile);
    expect(mergedSectorProfile.sector_key).toBe(NINE_KEY_DRAFT.sector_key);
    expect(mergedSectorProfile.irrelevant_topics).toEqual(['sports']); // pre-existing parse-profile keys survive the merge
  });

  it('KAN-204 AC2: refreshes autoConfigOsint + generateMissions on approve', async () => {
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: JSON.stringify(NINE_KEY_DRAFT), about_status: 'pending' });
    await post('/approve-about', { businessProfileId: 'bp1' });
    expect(autoConfigOsint).toHaveBeenCalledTimes(1);
    expect(autoConfigOsint.mock.calls[0][0].body.businessProfileId).toBe('bp1');
    expect(generateAgentMissions).toHaveBeenCalledWith('bp1');
  });

  it('KAN-204 AC2: a refresh failure does not fail the approve response', async () => {
    autoConfigOsint.mockRejectedValue(new Error('osint down'));
    findUnique.mockResolvedValue({ id: 'bp1', about_draft: JSON.stringify(NINE_KEY_DRAFT), about_status: 'pending' });
    const { body } = await post('/approve-about', { businessProfileId: 'bp1' });
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/onboarding/reject-about', () => {
  it('AC4: sets about_status=rejected without touching about_approved', async () => {
    const { body } = await post('/reject-about', { businessProfileId: 'bp1' });
    expect(body.ok).toBe(true);
    expect(body.about_status).toBe('rejected');
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ about_status: 'rejected' });
    expect(data).not.toHaveProperty('about_approved');
  });

  it('400s when businessProfileId missing', async () => {
    const { statusCode } = await post('/reject-about', {});
    expect(statusCode).toBe(400);
  });
});
