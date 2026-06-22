/**
 * metaAdsApi.ts — Meta Marketing API client
 *
 * Covers Facebook Ads, Instagram Ads, and Click-to-WhatsApp (CTWA) ads.
 * All three use the same Meta Marketing API — placement + call_to_action
 * determine which surface the ad appears on.
 *
 * Auth: Bearer {access_token} in Authorization header.
 * Budget: smallest currency unit (ILS → agorot: 1 ILS = 100).
 * Flow: Campaign → Ad Set → Ad Creative → Ad (all PAUSED on creation).
 */

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

function adsHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function metaPost(path: string, accessToken: string, body: object): Promise<any> {
  const url = `${GRAPH_BASE}${path}`;
  console.log(`[Meta Ads] POST ${url}`);
  const res = await fetch(url, {
    method:  'POST',
    headers: adsHeaders(accessToken),
    body:    JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) {
    console.error('[Meta Ads] Error body:', JSON.stringify(data).slice(0, 800));
    const msg =
      data?.error?.error_user_msg ||
      data?.error?.message ||
      JSON.stringify(data).slice(0, 300);
    throw new Error(`[Meta Ads] ${res.status}: ${msg}`);
  }
  return data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type MetaAdPlacement = 'facebook' | 'instagram' | 'all';
export type MetaAdType      = 'standard' | 'whatsapp_ctwa';

export interface CreateMetaAdsCampaignInput {
  accessToken:    string;
  adAccountId:    string;   // "act_XXXXXXXXXX"
  pageId:         string;   // Facebook Page ID (required for creative)
  name:           string;
  objective:      'awareness' | 'traffic' | 'leads' | 'conversions';
  dailyBudgetIls: number;
  startDate:      string;   // ISO date string e.g. "2024-01-01"
  endDate:        string;   // ISO date string e.g. "2024-01-08"
  adText:         string;   // main ad body text
  headline:       string;   // ad title / link name
  description:    string;   // short description below headline
  linkUrl:        string;   // destination URL
  placement:      MetaAdPlacement;
  adType?:        MetaAdType; // defaults to 'standard'
  whatsappPhone?: string;   // E.164 format — required for whatsapp_ctwa
}

export interface CreateMetaAdsCampaignResult {
  campaignId:    string;
  adSetId:       string;
  creativeId:    string;
  adId:          string;
  adsManagerLink: string;
}

// ── Objective + billing mappings ──────────────────────────────────────────────

const OBJECTIVE_MAP: Record<string, string> = {
  awareness:   'OUTCOME_AWARENESS',
  traffic:     'OUTCOME_TRAFFIC',
  leads:       'OUTCOME_LEADS',
  conversions: 'OUTCOME_SALES',
};

const OPTIMIZATION_MAP: Record<string, string> = {
  awareness:   'REACH',
  traffic:     'LINK_CLICKS',
  leads:       'LINK_CLICKS',   // lead forms need pixel — fall back to clicks
  conversions: 'LINK_CLICKS',
};

// ── Main export ───────────────────────────────────────────────────────────────

export async function createMetaAdsCampaign(
  input: CreateMetaAdsCampaignInput,
): Promise<CreateMetaAdsCampaignResult> {
  const { accessToken, adAccountId, pageId, name, dailyBudgetIls, startDate, endDate } = input;
  const adType = input.adType || 'standard';

  // Step 1 — Campaign
  const campaignRes = await metaPost(`/${adAccountId}/campaigns`, accessToken, {
    name,
    objective:                      OBJECTIVE_MAP[input.objective] || 'OUTCOME_TRAFFIC',
    status:                         'PAUSED',
    special_ad_categories:          [],
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId: string = campaignRes.id;
  console.log(`[Meta Ads] Campaign created: ${campaignId}`);

  // Step 2 — Ad Set
  // Budget in agorot (smallest ILS unit). Minimum is ~100 (1 ILS).
  const dailyBudget = Math.max(100, Math.round(dailyBudgetIls * 100));

  const targeting: Record<string, any> = {
    geo_locations: { countries: ['IL'] },
    age_min: 18,
    age_max: 65,
  };
  if (input.placement === 'instagram') {
    targeting.publisher_platforms   = ['instagram'];
    targeting.instagram_positions   = ['stream', 'explore', 'reels'];
  } else if (input.placement === 'facebook') {
    targeting.publisher_platforms   = ['facebook'];
    targeting.facebook_positions    = ['feed', 'marketplace'];
  }
  // placement === 'all' → no restriction = Meta Advantage+ placements

  const adSetRes = await metaPost(`/${adAccountId}/adsets`, accessToken, {
    name:              `${name} — Ad Set`,
    campaign_id:       campaignId,
    daily_budget:      dailyBudget,
    billing_event:     'IMPRESSIONS',
    optimization_goal: OPTIMIZATION_MAP[input.objective] || 'LINK_CLICKS',
    bid_strategy:      'LOWEST_COST_WITHOUT_CAP',
    targeting,
    start_time:        new Date(startDate).toISOString(),
    end_time:          new Date(endDate).toISOString(),
    status:            'PAUSED',
  });
  const adSetId: string = adSetRes.id;
  console.log(`[Meta Ads] Ad Set created: ${adSetId}`);

  // Step 3 — Ad Creative
  let linkData: Record<string, any>;

  if (adType === 'whatsapp_ctwa' && input.whatsappPhone) {
    // Click-to-WhatsApp: ad appears in FB/IG feed, tap opens WhatsApp chat
    const waLink = `https://wa.me/${input.whatsappPhone.replace(/\D/g, '')}`;
    linkData = {
      link:    waLink,
      message: input.adText,
      name:    input.headline,
      call_to_action: {
        type:  'WHATSAPP_MESSAGE',
        value: { app_destination: 'WHATSAPP' },
      },
    };
  } else {
    linkData = {
      link:        input.linkUrl,
      message:     input.adText,
      name:        input.headline,
      description: input.description,
      call_to_action: {
        type:  'LEARN_MORE',
        value: { link: input.linkUrl },
      },
    };
  }

  const creativeRes = await metaPost(`/${adAccountId}/adcreatives`, accessToken, {
    name:               `${name} — Creative`,
    object_story_spec:  { page_id: pageId, link_data: linkData },
  });
  const creativeId: string = creativeRes.id;
  console.log(`[Meta Ads] Creative created: ${creativeId}`);

  // Step 4 — Ad
  const adRes = await metaPost(`/${adAccountId}/ads`, accessToken, {
    name:    `${name} — Ad`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status:  'PAUSED',
  });
  const adId: string = adRes.id;
  console.log(`[Meta Ads] Ad created: ${adId}`);

  return {
    campaignId,
    adSetId,
    creativeId,
    adId,
    adsManagerLink: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace('act_', '')}`,
  };
}