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
jest.mock('../lib/websiteFetch',         () => ({ fetchWebsiteSource:    jest.fn() }));
jest.mock('../lib/googlePlaces',         () => ({ getPlaceDetails:       jest.fn() }));
jest.mock('../lib/fetchSocialPageAbout', () => ({ fetchSocialPageAbout:  jest.fn() }));
jest.mock('../infra/logger', () => ({
  createLogger: jest.fn(() => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })),
}));

import { fetchWebsiteSource } from '../lib/websiteFetch';
import { getPlaceDetails } from '../lib/googlePlaces';
import { fetchSocialPageAbout } from '../lib/fetchSocialPageAbout';

const findUnique   = prisma.businessProfile.findUnique as jest.Mock;
const update       = prisma.businessProfile.update     as jest.Mock;
const llm          = invokeLLM as jest.Mock;
const websiteFetch = fetchWebsiteSource as jest.Mock;
const placeDetails = getPlaceDetails as jest.Mock;
const socialFetch  = fetchSocialPageAbout as jest.Mock;

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
  facebook_url: null, google_place_id: null, channels_website: null,
};

const VALID_DRAFT = {
  business_name: 'Test Biz', sector_key: 'beauty', sub_sector_key: 'hair_salon',
  business_type: 'B2C', service_model: 'appointment', target_audience: 'Women 25-45',
  relevant_topics: ['hair care', 'styling'], content_tone: 'friendly',
  business_description: 'A hair salon in Tel Aviv.',
};

beforeEach(() => {
  jest.clearAllMocks();
  update.mockResolvedValue({});
  websiteFetch.mockResolvedValue(null);
  placeDetails.mockResolvedValue({ editorialSummary: '' });
  socialFetch.mockResolvedValue([]);
});

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

// KAN-202: website multi-source discovery + Google Places editorial about
describe('POST /api/onboarding/generate-about — KAN-202 sources', () => {
  it('AC1: fetches website content and includes the excerpt + provenance', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, website_url: 'https://biz.co.il' });
    websiteFetch.mockResolvedValue({ text: 'We cut hair beautifully.', sourceUrl: 'https://biz.co.il/about' });
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    expect(websiteFetch).toHaveBeenCalledWith('https://biz.co.il');
    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('We cut hair beautifully.');
    expect(prompt).toContain('https://biz.co.il/about');

    const data = update.mock.calls[0][0].data;
    const excerpts = JSON.parse(data.about_source_excerpts);
    expect(excerpts.website).toEqual({ url: 'https://biz.co.il/about', excerpt: 'We cut hair beautifully.' });
  });

  it('AC4: degrades gracefully when the website fetch fails (SPA/thin site) — generation still succeeds', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, website_url: 'https://spa.co.il' });
    websiteFetch.mockResolvedValue(null);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    const { body } = await post({ businessProfileId: 'bp1' });

    expect(body.ok).toBe(true);
    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('Website: https://spa.co.il');
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_source_excerpts).website).toBeUndefined();
  });

  it('AC2: pulls the Places editorial summary when google_place_id is present', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, google_place_id: 'place123' });
    placeDetails.mockResolvedValue({ editorialSummary: 'A cozy neighborhood salon.' });
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    expect(placeDetails).toHaveBeenCalledWith('place123');
    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('A cozy neighborhood salon.');
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_source_excerpts).google_place).toEqual({ excerpt: 'A cozy neighborhood salon.' });
  });

  it('AC2: no google_place_id — Places is never called, nothing invented', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    expect(placeDetails).not.toHaveBeenCalled();
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_source_excerpts).google_place).toBeUndefined();
  });

  it('AC2: place present but editorial summary empty — nothing invented, ID label used instead', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, google_place_id: 'place123' });
    placeDetails.mockResolvedValue({ editorialSummary: '' });
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('Google Place ID: place123');
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_source_excerpts).google_place).toBeUndefined();
  });
});

// KAN-203: social source integration, TTL cache, soft-fail
describe('POST /api/onboarding/generate-about — KAN-203 social sources', () => {
  it('AC1/AC3: social bio appears in prompt and about_source_excerpts', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, instagram_url: 'https://instagram.com/testbiz' });
    socialFetch.mockResolvedValue([{ platform: 'instagram', aboutText: 'Best hair in town.', profileUrl: 'https://instagram.com/testbiz' }]);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt).toContain('Best hair in town.');
    const data = update.mock.calls[0][0].data;
    const excerpts = JSON.parse(data.about_source_excerpts);
    expect(excerpts.instagram).toEqual({ url: 'https://instagram.com/testbiz', excerpt: 'Best hair in town.' });
    expect(JSON.parse(data.about_sources)).toContain('social');
  });

  it('AC4: no force flag → fetchSocialPageAbout called with forceRegenerate=false (cache preserved)', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, instagram_url: 'https://instagram.com/testbiz' });
    socialFetch.mockResolvedValue([]);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    await post({ businessProfileId: 'bp1' });

    expect(socialFetch).toHaveBeenCalledWith(
      expect.objectContaining({ instagramUrl: 'https://instagram.com/testbiz' }),
      expect.objectContaining({ forceRegenerate: false }),
    );
  });

  it('AC5: social scrape fails → generation still succeeds from remaining sources', async () => {
    findUnique.mockResolvedValue({ ...BASE_PROFILE, instagram_url: 'https://instagram.com/testbiz' });
    socialFetch.mockResolvedValue([]); // soft-fail: returns empty, not throws
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));

    const { body } = await post({ businessProfileId: 'bp1' });

    expect(body.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(JSON.parse(data.about_sources)).not.toContain('social');
  });
});

// Regression guard: the LLM truncates its JSON output when it runs out of tokens, and the
// truncation-recovery logic in lib/llm.ts drops any bare string field that comes after the
// last fully-closed array/object. business_description must be ordered before the
// relevant_topics array, and given enough token budget, so it doesn't come back empty.
describe('POST /api/onboarding/generate-about — truncation regression guard', () => {
  it('orders business_description before relevant_topics in the schema, to survive output truncation', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    await post({ businessProfileId: 'bp1' });
    const prompt = llm.mock.calls[0][0].prompt;
    expect(prompt.indexOf('"business_description"')).toBeLessThan(prompt.indexOf('"relevant_topics"'));
  });

  it('requests enough token budget for Hebrew output to avoid truncation', async () => {
    findUnique.mockResolvedValue(BASE_PROFILE);
    llm.mockResolvedValue(JSON.stringify(VALID_DRAFT));
    await post({ businessProfileId: 'bp1' });
    expect(llm.mock.calls[0][0].maxTokens).toBeGreaterThanOrEqual(1500);
  });
});
