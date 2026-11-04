/**
 * tiktokAdsApi.ts — TikTok Marketing API client
 *
 * Auth: Access-Token header (NOT Authorization: Bearer).
 * Budget: USD — TikTok uses USD; minimum ~$20/day.
 * Flow: Campaign → Ad Group (both PAUSED/DISABLED).
 * Note: Ad creation requires a video uploaded in TikTok Ads Manager creative
 *       library first. Campaign + Ad Group are created as shells — user adds
 *       the video ad inside TikTok Ads Manager to activate the campaign.
 */

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function adsHeaders(accessToken: string): Record<string, string> {
  return {
    'Access-Token':  accessToken,
    'Content-Type':  'application/json',
  };
}

async function tiktokPost(path: string, accessToken: string, body: object): Promise<any> {
  const url = `${API_BASE}${path}`;
  console.log(`[TikTok Ads] POST ${url}`);
  const res  = await fetch(url, {
    method:  'POST',
    headers: adsHeaders(accessToken),
    body:    JSON.stringify(body),
  });
  const data: any = await res.json();
  if (data.code !== 0) {
    console.error('[TikTok Ads] Error:', JSON.stringify(data).slice(0, 400));
    throw new Error(`[TikTok Ads] ${data.code}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data.data;
}

// ── Objective mapping ─────────────────────────────────────────────────────────

const OBJECTIVE_MAP: Record<string, string> = {
  awareness:   'REACH',
  traffic:     'TRAFFIC',
  leads:       'LEAD_GENERATION',
  conversions: 'CONVERSIONS',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateTikTokAdsCampaignInput {
  accessToken:    string;
  advertiserId:   string;
  name:           string;
  objective:      'awareness' | 'traffic' | 'leads' | 'conversions';
  dailyBudgetIls: number;
  startDate:      string; // "YYYY-MM-DD"
  endDate:        string; // "YYYY-MM-DD"
}

export interface CreateTikTokAdsCampaignResult {
  campaignId:     string;
  adGroupId:      string;
  adsManagerLink: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function createTikTokAdsCampaign(
  input: CreateTikTokAdsCampaignInput,
): Promise<CreateTikTokAdsCampaignResult> {
  const { accessToken, advertiserId, name, dailyBudgetIls } = input;

  // TikTok budgets in USD — ₪1 ≈ $0.27, minimum $20/day
  const dailyBudgetUsd = Math.max(20, Math.round(dailyBudgetIls * 0.27));

  // Step 1 — Campaign
  const campaignData = await tiktokPost('/campaign/create/', accessToken, {
    advertiser_id:    advertiserId,
    campaign_name:    name,
    objective_type:   OBJECTIVE_MAP[input.objective] || 'TRAFFIC',
    budget_mode:      'BUDGET_MODE_DAY',
    budget:           dailyBudgetUsd,
    operation_status: 'DISABLE', // paused
  });
  const campaignId: string = campaignData.campaign_id;
  console.log(`[TikTok Ads] Campaign created: ${campaignId}`);

  // Step 2 — Ad Group
  // schedule times must be "YYYY-MM-DD HH:MM:SS" UTC
  const fmt = (d: string) =>
    new Date(d).toISOString().replace('T', ' ').slice(0, 19);

  const adGroupData = await tiktokPost('/adgroup/create/', accessToken, {
    advertiser_id:       advertiserId,
    campaign_id:         campaignId,
    adgroup_name:        `${name} — Ad Group`,
    placement_type:      'PLACEMENT_TYPE_AUTOMATIC',
    budget_mode:         'BUDGET_MODE_DAY',
    budget:              dailyBudgetUsd,
    schedule_type:       'SCHEDULE_START_END',
    schedule_start_time: fmt(input.startDate),
    schedule_end_time:   fmt(input.endDate),
    optimization_goal:   'CLICK',
    billing_event:       'CPC',
    bid_type:            'BID_TYPE_NO_BID',
    operation_status:    'DISABLE',
  });
  const adGroupId: string = adGroupData.adgroup_id;
  console.log(`[TikTok Ads] Ad Group created: ${adGroupId}`);

  return {
    campaignId,
    adGroupId,
    adsManagerLink: `https://ads.tiktok.com/i18n/dashboard?aadvid=${advertiserId}`,
  };
}