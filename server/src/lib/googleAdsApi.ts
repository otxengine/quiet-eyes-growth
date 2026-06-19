/**
 * googleAdsApi.ts — Google Ads API v18 REST client
 *
 * All calls require:
 *   - accessToken: the user's OAuth access token (from social_accounts)
 *   - customerId:  the user's Google Ads customer ID (from social_accounts.page_id)
 *   - developerToken: our app's developer token (from GOOGLE_ADS_DEVELOPER_TOKEN env var)
 *
 * Payment: Google charges the user's own billing on file in their Ads account.
 * We never handle money.
 */

const ADS_API_BASE = `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || 'v19'}`;

function adsHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization:     `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type':    'application/json',
  };
  const managerId = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID || '';
  if (managerId) headers['login-customer-id'] = managerId;
  return headers;
}

async function adsPost(path: string, accessToken: string, body: object): Promise<any> {
  const url = `${ADS_API_BASE}${path}`;
  console.log(`[Google Ads] POST ${url}`);
  const res = await fetch(url, {
    method:  'POST',
    headers: adsHeaders(accessToken),
    body:    JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`[Google Ads] ${res.status} non-JSON: ${text.slice(0, 400)}`);
  }

  const data: any = await res.json();
  if (!res.ok) {
    console.error('[Google Ads] Error body:', JSON.stringify(data).slice(0, 1000));
    const googleError = data?.error?.details?.[0]?.errors?.[0];
    const msg = googleError?.message
      || data?.error?.message
      || JSON.stringify(data).slice(0, 300);
    const fieldPath = googleError?.location?.fieldPathElements?.map((e: any) => e.fieldName).join('.') || '';
    throw new Error(`[Google Ads] ${res.status}: ${msg}${fieldPath ? ` (field: ${fieldPath})` : ''}`);
  }
  return data;
}

export interface CreateCampaignInput {
  accessToken:  string;
  customerId:   string;
  name:         string;
  objective:    'awareness' | 'traffic' | 'leads' | 'conversions';
  dailyBudgetIls: number;
  startDate:    string; // YYYYMMDD
  endDate:      string; // YYYYMMDD
  finalUrl:     string;
  headlines:    string[]; // 3–15 headlines, max 30 chars each
  descriptions: string[]; // 2–4 descriptions, max 90 chars each
}

export interface CreateCampaignResult {
  campaignId:   string;
  adGroupId:    string;
  adId:         string;
  budgetId:     string;
  customerLink: string; // link to campaign in Google Ads Manager
}

/**
 * Full campaign creation: Budget → Campaign → AdGroup → ResponsiveSearchAd
 */
export async function createGoogleAdsCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const { accessToken, customerId, name, dailyBudgetIls, startDate, endDate, finalUrl } = input;
  const cid = customerId.replace(/-/g, ''); // strip dashes if any

  // Step 1 — Create campaign budget (ILS → micros: 1 ILS = 1,000,000 micros)
  // amountMicros must be a string — Google Ads REST API represents int64 as string
  const budgetMicros = String(Math.round(dailyBudgetIls * 1_000_000));
  const budgetRes = await adsPost(
    `/customers/${cid}/campaignBudgets:mutate`,
    accessToken,
    {
      operations: [{
        create: {
          name:           `Budget ${name} ${Date.now()}`,
          deliveryMethod: 'STANDARD',
          amountMicros:   budgetMicros,
        },
      }],
    },
  );
  const budgetResourceName: string = budgetRes.results?.[0]?.resourceName;
  const budgetId = budgetResourceName?.split('/')?.[3] || '';

  // Step 2 — Create campaign
  const campaignRes = await adsPost(
    `/customers/${cid}/campaigns:mutate`,
    accessToken,
    {
      operations: [{
        create: {
          name:                          name,
          advertisingChannelType:        'SEARCH',
          status:                        'PAUSED',
          manualCpc:                     {},
          campaignBudget:                budgetResourceName,
          startDate,
          endDate,
          containsEuPoliticalAdvertising: 2,
          networkSettings: {
            targetGoogleSearch:   true,
            targetSearchNetwork:  false,
            targetContentNetwork: false,
          },
        },
      }],
    },
  );
  const campaignResourceName: string = campaignRes.results?.[0]?.resourceName;
  const campaignId = campaignResourceName?.split('/')?.[3] || '';

  // Step 3 — Create ad group
  const adGroupRes = await adsPost(
    `/customers/${cid}/adGroups:mutate`,
    accessToken,
    {
      operations: [{
        create: {
          name:          `${name} — Ad Group`,
          campaign:      campaignResourceName,
          status:        'ENABLED',
          type:          'SEARCH_STANDARD',
          cpcBidMicros:  '1000000',
        },
      }],
    },
  );
  const adGroupResourceName: string = adGroupRes.results?.[0]?.resourceName;
  const adGroupId = adGroupResourceName?.split('/')?.[3] || '';

  // Step 4 — Create responsive search ad
  const headlines    = input.headlines.slice(0, 15).map(text => ({ text: text.slice(0, 30) }));
  const descriptions = input.descriptions.slice(0, 4).map(text => ({ text: text.slice(0, 90) }));

  const adRes = await adsPost(
    `/customers/${cid}/adGroupAds:mutate`,
    accessToken,
    {
      operations: [{
        create: {
          adGroup: adGroupResourceName,
          status:  'ENABLED',
          ad: {
            responsiveSearchAd: { headlines, descriptions },
            finalUrls:          [finalUrl],
          },
        },
      }],
    },
  );
  const adResourceName: string = adRes.results?.[0]?.resourceName;
  const adId = adResourceName?.split('/')?.[4] || '';

  return {
    campaignId,
    adGroupId,
    adId,
    budgetId,
    customerLink: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&__e=${cid}`,
  };
}

/**
 * Fetch campaign performance stats for a given date range.
 * Returns spend (ILS), impressions, clicks, conversions.
 */
export async function getGoogleAdsCampaignStats(
  accessToken: string,
  customerId:  string,
  campaignId:  string,
  startDate:   string, // YYYY-MM-DD
  endDate:     string,
): Promise<{ spendIls: number; impressions: number; clicks: number; conversions: number }> {
  const cid = customerId.replace(/-/g, '');
  const res = await adsPost(
    `/customers/${cid}/googleAds:search`,
    accessToken,
    {
      query: `
        SELECT
          metrics.cost_micros,
          metrics.impressions,
          metrics.clicks,
          metrics.conversions
        FROM campaign
        WHERE campaign.id = ${campaignId}
          AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      `,
    },
  );

  const row = res.results?.[0]?.metrics || {};
  return {
    spendIls:    Math.round((Number(row.costMicros || 0) / 1_000_000) * 100) / 100,
    impressions: Number(row.impressions  || 0),
    clicks:      Number(row.clicks       || 0),
    conversions: Number(row.conversions  || 0),
  };
}

/**
 * Pause or enable a campaign.
 */
export async function setGoogleAdsCampaignStatus(
  accessToken: string,
  customerId:  string,
  campaignId:  string,
  status:      'ENABLED' | 'PAUSED',
): Promise<void> {
  const cid = customerId.replace(/-/g, '');
  await adsPost(
    `/customers/${cid}/campaigns:mutate`,
    accessToken,
    {
      operations: [{
        update:     { resourceName: `customers/${cid}/campaigns/${campaignId}`, status },
        updateMask: 'status',
      }],
    },
  );
}