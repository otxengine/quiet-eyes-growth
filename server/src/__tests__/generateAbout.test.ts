import router from '../routes/onboarding';
import { prisma } from '../db';
import { invokeLLM } from '../lib/llm';

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
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

const findUnique = prisma.businessProfile.findUnique as jest.Mock;
const update     = prisma.businessProfile.update     as jest.Mock;
const llm        = invokeLLM as jest.Mock;

function post(body: Record<string, any>): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req: any = { method: 'POST', url: '/generate-about', originalUrl: '/generate-about', params: {}, headers: {}, body };
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { resolve({ statusCode: this.statusCode, body: data }); return this; },
    };
    router(req, res, (err?: any) => err ? reject(err) : resolve({ statusCode: 200, body: null }));
  });
}

const BASE_PROFILE = {
  id: 'bp1', name: 'Test Biz', category: 'beauty', city: 'Tel Aviv',
  description: 'Hair salon', website_url: null, instagram_url: null,
  facebook_url: null, tiktok_url: null, google_place_id: null, channels_website: null,
};

const VALID_DRAFT = {
  business_name: 'Test Biz', sector_key: 'beauty', sub_sector_key: 'hair_salon',
  business_type: 'B2C', service_model: 'appointment', target_audience: 'Women 25-45',
  relevant_topics: ['hair care', 'styling'], content_tone: 'friendly',
  business_description: 'A hair salon in Tel Aviv.',
};

beforeEach(() => { jest.clearAllMocks(); update.mockResolvedValue({}); });

describe('POST /api/onboarding/generate-about', () => {
  it('AC4: returns needs_seed when no source available', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, description: null, category: null });
    const { body } = await post({ businessProfileId: 'bp1' });
    expect(body.ok).toBe(false);
    expect(body.needs_seed).toBe(true);
    expect(llm).not.toHaveBeenCalled();
  });

  it('AC1: draft contains all 9 required keys', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    const { body } = await post({ businessProfileId: 'bp1' });
    expect(body.ok).toBe(true);
    const NINE = ['business_name','sector_key','sub_sector_key','business_type','service_model','target_audience','relevant_topics','content_tone','business_description'];
    for (const k of NINE) expect(body.draft).toHaveProperty(k);
  });

  it('AC2: writes only about_draft + about_status=pending, not canonical fields', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    await post({ businessProfileId: 'bp1' });
    const data = update.mock.calls[0][0].data;
    expect(data).toHaveProperty('about_draft');
    expect(data).toHaveProperty('about_status', 'pending');
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('category');
    expect(data).not.toHaveProperty('sector_profile');
  });

  it('AC1: writes about_sources + about_generated_at provenance', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    await post({ businessProfileId: 'bp1' });
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_sources)).toContain('profile_description');
    expect(data.about_generated_at).toBeTruthy();
  });

  it('rejects a malformed (non-object) LLM response instead of silently persisting it', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(['topic one', 'topic two']));
    const { statusCode, body } = await post({ businessProfileId: 'bp1' });
    expect(statusCode).toBe(500);
    expect(body.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('AC2: response includes about_status=pending', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    const { body } = await post({ businessProfileId: 'bp1' });
    expect(body.about_status).toBe('pending');
  });

  it('returns 400 when businessProfileId missing', async () => {
    const { statusCode } = await post({});
    expect(statusCode).toBe(400);
  });

  it('AC4: seed_info counts as a source — skips needs_seed', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, description: null, category: null });
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    const { body } = await post({ businessProfileId: 'bp1', seed_info: 'A hair salon' });
    expect(body.ok).toBe(true);
    expect(llm).toHaveBeenCalled();
  });
});
