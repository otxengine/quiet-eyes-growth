/**
 * campaigns.ts — Campaign publishing routes
 *
 * POST /api/campaigns/publish-google-ads  — publish a saved campaign to Google Ads API
 * POST /api/campaigns/sync-stats          — pull actual spend/clicks from Google Ads
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { createGoogleAdsCampaign, getGoogleAdsCampaignStats } from '../lib/googleAdsApi';
import { createMetaAdsCampaign } from '../lib/metaAdsApi';
import type { MetaAdPlacement, MetaAdType } from '../lib/metaAdsApi';
import { createTikTokAdsCampaign } from '../lib/tiktokAdsApi';

const router = Router();

// ── Publish campaign to Google Ads ───────────────────────────────────────────
router.post('/publish-google-ads', async (req: Request, res: Response) => {
  const { campaignId, businessId } = req.body;
  if (!campaignId || !businessId) {
    return res.status(400).json({ error: 'Missing campaignId or businessId' });
  }

  try {
    // 1. Load campaign from DB
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, linked_business: businessId },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.platform !== 'google') {
      return res.status(400).json({ error: 'Campaign platform is not Google Ads' });
    }

    // 2. Load Google Ads credentials for this business
    const rows = await prisma.$queryRawUnsafe<Array<{
      access_token: string; refresh_token: string | null; page_id: string | null;
    }>>(
      `SELECT access_token, refresh_token, page_id FROM social_accounts
       WHERE linked_business=$1 AND platform='google_ads' AND is_connected=true
       LIMIT 1`,
      businessId,
    );
    const adsAccount = rows[0];
    if (!adsAccount) {
      return res.status(400).json({ error: 'Google Ads not connected — go to Integrations and connect first' });
    }
    if (!adsAccount.page_id) {
      return res.status(400).json({ error: 'Google Ads Customer ID missing — set it in Integrations' });
    }

    // Refresh token if expired (Google tokens last 1 hour)
    let accessToken = adsAccount.access_token;
    if (adsAccount.refresh_token) {
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({
            client_id:     process.env.GOOGLE_CLIENT_ID     || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            refresh_token: adsAccount.refresh_token,
            grant_type:    'refresh_token',
          }).toString(),
        });
        if (tokenRes.ok) {
          const td: any = await tokenRes.json();
          if (td.access_token) {
            accessToken = td.access_token;
            await prisma.$executeRawUnsafe(
              `UPDATE social_accounts SET access_token=$1 WHERE linked_business=$2 AND platform='google_ads'`,
              accessToken, businessId,
            );
          }
        }
      } catch (_) {}
    }

    // 3. Build headlines + descriptions from post_content
    const content = campaign.post_content || campaign.title || 'Check us out';
    const sentences = content.split(/[.!?\n]+/).map((s: string) => s.trim()).filter(Boolean);

    const rawHeadlines = sentences.slice(0, 5).map((s: string) => s.slice(0, 30));
    while (rawHeadlines.length < 3) rawHeadlines.push(campaign.title?.slice(0, 30) || 'Learn More');

    const rawDescriptions = sentences.slice(0, 2).map((s: string) => s.slice(0, 90));
    while (rawDescriptions.length < 2) rawDescriptions.push(content.slice(0, 90));

    // 4. Build date range
    const start = new Date();
    const end   = new Date(start.getTime() + (campaign.campaign_days || 7) * 86400000);
    const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

    // 5. Create campaign in Google Ads
    const result = await createGoogleAdsCampaign({
      accessToken:    accessToken,
      customerId:     adsAccount.page_id,
      name:           campaign.title,
      objective:      (campaign.objective as any) || 'traffic',
      dailyBudgetIls: campaign.daily_budget_ils || 50,
      startDate:      fmt(start),
      endDate:        fmt(end),
      finalUrl:       `https://www.google.com`, // placeholder — user should update in Ads Manager
      headlines:      rawHeadlines,
      descriptions:   rawDescriptions,
    });

    // 6. Save Google campaign IDs + update status
    await prisma.$executeRawUnsafe(
      `UPDATE campaigns
       SET status='active', external_campaign_id=$1, external_ad_group_id=$2, external_budget_id=$3, published_at=now()
       WHERE id=$4`,
      result.campaignId, result.adGroupId, result.budgetId, campaignId,
    );

    console.log(`[google_ads] Campaign published: ${result.campaignId} for business ${businessId}`);

    return res.json({
      success:       true,
      campaignId:    result.campaignId,
      adGroupId:     result.adGroupId,
      customerLink:  result.customerLink,
    });

  } catch (err: any) {
    console.error('[publish-google-ads]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Publish campaign to Meta Ads ─────────────────────────────────────────────
router.post('/publish-meta-ads', async (req: Request, res: Response) => {
  const { campaignId, businessId } = req.body;
  if (!campaignId || !businessId) {
    return res.status(400).json({ error: 'Missing campaignId or businessId' });
  }

  try {
    // 1. Load campaign
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, linked_business: businessId },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['facebook', 'instagram', 'whatsapp'].includes(campaign.platform || '')) {
      return res.status(400).json({ error: 'Campaign platform is not Meta (facebook/instagram/whatsapp)' });
    }

    // 2. Load Meta Ads credentials (access_token + ad_account_id)
    const adsRows = await prisma.$queryRawUnsafe<Array<{
      access_token: string; page_id: string | null;
    }>>(
      `SELECT access_token, page_id FROM social_accounts
       WHERE linked_business=$1 AND platform='meta_ads' AND is_connected=true LIMIT 1`,
      businessId,
    );
    const adsAccount = adsRows[0];
    if (!adsAccount) {
      return res.status(400).json({ error: 'Meta Ads not connected — go to Integrations and connect first' });
    }
    if (!adsAccount.page_id) {
      return res.status(400).json({ error: 'Meta Ads Account ID missing' });
    }

    // 3. Load Facebook Page ID (needed for ad creative)
    const pageRows = await prisma.$queryRawUnsafe<Array<{ page_id: string | null }>>(
      `SELECT page_id FROM social_accounts
       WHERE linked_business=$1 AND platform='facebook_page' AND is_connected=true LIMIT 1`,
      businessId,
    );
    const facebookPageId = pageRows[0]?.page_id || '';
    if (!facebookPageId) {
      return res.status(400).json({
        error: 'Facebook Page not connected — connect your Facebook Page in Integrations first (required for ad creative)',
      });
    }

    // 4. Load WhatsApp phone number (for CTWA ads)
    let whatsappPhone = '';
    if (campaign.platform === 'whatsapp') {
      const waRows = await prisma.$queryRawUnsafe<Array<{ page_id: string | null }>>(
        `SELECT page_id FROM social_accounts
         WHERE linked_business=$1 AND platform='whatsapp_business' AND is_connected=true LIMIT 1`,
        businessId,
      );
      // page_id on whatsapp_business stores the phone_number_id — fetch the display number via BP
      const bpRows = await prisma.$queryRawUnsafe<Array<{ whatsapp_phone_number_id: string | null }>>(
        `SELECT whatsapp_phone_number_id FROM business_profiles WHERE id=$1 LIMIT 1`,
        businessId,
      );
      whatsappPhone = bpRows[0]?.whatsapp_phone_number_id || waRows[0]?.page_id || '';
    }

    // 5. Determine placement from campaign platform
    const placementMap: Record<string, MetaAdPlacement> = {
      meta:       'facebook',
      facebook:   'facebook',
      instagram:  'instagram',
      whatsapp:   'all',       // CTWA appears in FB + IG feed
    };
    const placement: MetaAdPlacement = placementMap[campaign.platform || 'facebook'] || 'facebook';
    const adType: MetaAdType = campaign.platform === 'whatsapp' ? 'whatsapp_ctwa' : 'standard';

    // 6. Build ad copy from campaign content
    const content   = campaign.post_content || campaign.title || '';
    const sentences = content.split(/[.!?\n]+/).map((s: string) => s.trim()).filter(Boolean);
    const headline    = (campaign.title || sentences[0] || 'גלה עוד').slice(0, 40);
    const adText      = sentences.slice(0, 3).join('. ').slice(0, 600) || content.slice(0, 600);
    const description = sentences[1]?.slice(0, 90) || headline;

    // 7. Build date range
    const start = new Date();
    const end   = new Date(start.getTime() + (campaign.campaign_days || 7) * 86400000);

    // 8. Publish to Meta Ads
    const result = await createMetaAdsCampaign({
      accessToken:    adsAccount.access_token,
      adAccountId:    adsAccount.page_id,
      pageId:         facebookPageId,
      name:           campaign.title || 'OTX Campaign',
      objective:      (campaign.objective as any) || 'traffic',
      dailyBudgetIls: campaign.daily_budget_ils || 50,
      startDate:      start.toISOString().slice(0, 10),
      endDate:        end.toISOString().slice(0, 10),
      adText,
      headline,
      description,
      linkUrl:        'https://www.example.com', // placeholder — update in Ads Manager
      placement,
      adType,
      ...(whatsappPhone ? { whatsappPhone } : {}),
    });

    // 9. Save external IDs + update status
    await prisma.$executeRawUnsafe(
      `UPDATE campaigns
       SET status='active', external_campaign_id=$1, external_ad_group_id=$2, external_budget_id=$3, published_at=now()
       WHERE id=$4`,
      result.campaignId, result.adSetId, result.creativeId, campaignId,
    );

    console.log(`[meta_ads] Campaign published: ${result.campaignId} for business ${businessId}`);

    return res.json({
      success:        true,
      campaignId:     result.campaignId,
      adSetId:        result.adSetId,
      adsManagerLink: result.adsManagerLink,
    });

  } catch (err: any) {
    console.error('[publish-meta-ads]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Publish campaign to TikTok Ads ───────────────────────────────────────────
router.post('/publish-tiktok-ads', async (req: Request, res: Response) => {
  const { campaignId, businessId } = req.body;
  if (!campaignId || !businessId) {
    return res.status(400).json({ error: 'Missing campaignId or businessId' });
  }

  try {
    // 1. Load campaign
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, linked_business: businessId },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.platform !== 'tiktok') {
      return res.status(400).json({ error: 'Campaign platform is not TikTok' });
    }

    // 2. Load TikTok Ads credentials
    const rows = await prisma.$queryRawUnsafe<Array<{
      access_token: string; page_id: string | null;
    }>>(
      `SELECT access_token, page_id FROM social_accounts
       WHERE linked_business=$1 AND platform='tiktok_ads' AND is_connected=true LIMIT 1`,
      businessId,
    );
    const adsAccount = rows[0];
    if (!adsAccount) {
      return res.status(400).json({ error: 'TikTok Ads not connected — go to Integrations and connect first' });
    }
    if (!adsAccount.page_id) {
      return res.status(400).json({ error: 'TikTok Advertiser ID missing' });
    }

    // 3. Build date range
    const start = new Date();
    const end   = new Date(start.getTime() + (campaign.campaign_days || 7) * 86400000);

    // 4. Publish to TikTok Ads
    const result = await createTikTokAdsCampaign({
      accessToken:    adsAccount.access_token,
      advertiserId:   adsAccount.page_id,
      name:           campaign.title || 'OTX Campaign',
      objective:      (campaign.objective as any) || 'traffic',
      dailyBudgetIls: campaign.daily_budget_ils || 50,
      startDate:      start.toISOString().slice(0, 10),
      endDate:        end.toISOString().slice(0, 10),
    });

    // 5. Save external IDs + update status
    await prisma.$executeRawUnsafe(
      `UPDATE campaigns
       SET status='active', external_campaign_id=$1, external_ad_group_id=$2, published_at=now()
       WHERE id=$3`,
      result.campaignId, result.adGroupId, campaignId,
    );

    console.log(`[tiktok_ads] Campaign published: ${result.campaignId} for business ${businessId}`);

    return res.json({
      success:        true,
      campaignId:     result.campaignId,
      adGroupId:      result.adGroupId,
      adsManagerLink: result.adsManagerLink,
      note:           'Campaign and Ad Group created (paused). Upload a video in TikTok Ads Manager to activate.',
    });

  } catch (err: any) {
    console.error('[publish-tiktok-ads]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Sync actual stats from Google Ads ────────────────────────────────────────
router.post('/sync-stats', async (req: Request, res: Response) => {
  const { campaignId, businessId } = req.body;
  if (!campaignId || !businessId) {
    return res.status(400).json({ error: 'Missing campaignId or businessId' });
  }

  try {
    const campaignRow = await prisma.$queryRawUnsafe<Array<{
      external_campaign_id: string | null;
      published_at: string | null;
      campaign_days: number | null;
    }>>(
      `SELECT external_campaign_id, published_at, campaign_days FROM campaigns WHERE id=$1`,
      campaignId,
    );
    const campaign = campaignRow[0];
    if (!campaign?.external_campaign_id) {
      return res.status(400).json({ error: 'Campaign not published to Google Ads yet' });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ access_token: string; page_id: string }>>(
      `SELECT access_token, page_id FROM social_accounts
       WHERE linked_business=$1 AND platform='google_ads' AND is_connected=true LIMIT 1`,
      businessId,
    );
    const adsAccount = rows[0];
    if (!adsAccount) return res.status(400).json({ error: 'Google Ads not connected' });

    const startDate = campaign.published_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const endDate   = new Date().toISOString().slice(0, 10);

    const stats = await getGoogleAdsCampaignStats(
      adsAccount.access_token,
      adsAccount.page_id,
      campaign.external_campaign_id,
      startDate,
      endDate,
    );

    await prisma.$executeRawUnsafe(
      `UPDATE campaigns SET actual_spend_ils=$1, actual_clicks=$2, actual_reach=$3 WHERE id=$4`,
      stats.spendIls, stats.clicks, stats.impressions, campaignId,
    );

    return res.json({ success: true, stats });
  } catch (err: any) {
    console.error('[sync-stats]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;