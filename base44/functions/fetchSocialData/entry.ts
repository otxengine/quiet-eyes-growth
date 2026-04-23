import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

// Run Apify actor and wait for results
async function runApifyActor(actorId, input) {
  const runRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!runRes.ok) {
    const err = await runRes.text();
    throw new Error(`Apify run failed for ${actorId}: ${err}`);
  }
  const runData = await runRes.json();
  const runId = runData.data?.id;
  const datasetId = runData.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error('No run ID or dataset ID');

  // Poll for completion
  let attempts = 0;
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`);
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      const status = statusData.data?.status;
      if (status === 'SUCCEEDED') break;
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${status}`);
      }
    }
    attempts++;
  }

  const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=25`);
  if (!dataRes.ok) return [];
  return await dataRes.json();
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (!APIFY_API_KEY) {
    return Response.json({ error: 'APIFY_API_KEY not configured', fetched: 0 }, { status: 500 });
  }

  const { businessProfileId, platform } = await req.json().catch(() => ({}));
  if (!businessProfileId) return Response.json({ error: 'Missing businessProfileId' }, { status: 400 });

  // Get social accounts
  const filter = { linked_business: businessProfileId };
  if (platform) filter.platform = platform;
  const accounts = await base44.asServiceRole.entities.SocialAccount.filter(filter);

  if (accounts.length === 0) {
    return Response.json({ error: 'No connected social accounts', fetched: 0 }, { status: 404 });
  }

  let totalFetched = 0;
  const results = [];

  for (const account of accounts) {
    const accountName = account.account_name || account.page_id || '';
    if (!accountName) continue;

    try {
      let posts = [];

      if (account.platform === 'facebook') {
        posts = await fetchFacebookViaApify(accountName, account);
      } else if (account.platform === 'instagram') {
        posts = await fetchInstagramViaApify(accountName);
      } else if (account.platform === 'tiktok') {
        posts = await fetchTiktokViaApify(accountName);
      }

      // Save as SocialSignals
      for (const post of posts) {
        const existing = await base44.asServiceRole.entities.SocialSignal.filter({
          linked_business: businessProfileId,
          post_id: post.post_id,
        });
        if (existing.length > 0) continue;

        await base44.asServiceRole.entities.SocialSignal.create({
          linked_business: businessProfileId,
          platform: account.platform,
          post_id: post.post_id,
          content: (post.content || '').substring(0, 500),
          post_url: post.post_url || '',
          likes: post.likes || 0,
          comments: post.comments || 0,
          shares: post.shares || 0,
          views: post.views || 0,
          post_date: post.post_date || '',
          media_type: post.media_type || 'text',
          sentiment: 'unknown',
          fetched_at: new Date().toISOString(),
        });
        totalFetched++;
      }

      // Update sync status
      await base44.asServiceRole.entities.SocialAccount.update(account.id, {
        is_connected: true,
        last_sync: new Date().toISOString(),
        last_error: '',
      });
      results.push({ platform: account.platform, posts_fetched: posts.length });

    } catch (err) {
      console.error(`Error fetching ${account.platform} (${accountName}):`, err.message);
      await base44.asServiceRole.entities.SocialAccount.update(account.id, {
        is_connected: false,
        last_error: err.message,
        last_sync: new Date().toISOString(),
      });
      results.push({ platform: account.platform, error: err.message });
    }
  }

  return Response.json({ fetched: totalFetched, results });
});

async function fetchFacebookViaApify(pageNameOrUrl, account) {
  const url = pageNameOrUrl.startsWith('http') ? pageNameOrUrl : `https://www.facebook.com/${pageNameOrUrl}`;

  // If account has access_token, try Graph API first
  if (account.access_token) {
    try {
      return await fetchFacebookGraphAPI(account);
    } catch (err) {
      console.log(`Facebook Graph API failed, falling back to Apify: ${err.message}`);
    }
  }

  const items = await runApifyActor('apify~facebook-posts-scraper', {
    startUrls: [{ url }],
    resultsLimit: 20,
  });

  return items.map(post => ({
    post_id: post.postId || post.id || `fb_${Date.now()}_${Math.random()}`,
    content: post.text || post.message || '',
    post_url: post.url || post.postUrl || '',
    likes: post.likes || post.reactionsCount || 0,
    comments: post.comments || post.commentsCount || 0,
    shares: post.shares || post.sharesCount || 0,
    views: 0,
    post_date: post.time || post.timestamp || '',
    media_type: post.type === 'photo' ? 'image' : post.type === 'video' ? 'video' : 'text',
  }));
}

async function fetchFacebookGraphAPI(account) {
  const token = account.access_token;
  const pageId = account.page_id || 'me';
  const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares,type&limit=25&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Facebook Graph API error ${res.status}`);
  const data = await res.json();
  return (data.data || []).map(post => ({
    post_id: post.id,
    content: post.message || '',
    post_url: `https://facebook.com/${post.id}`,
    likes: post.likes?.summary?.total_count || 0,
    comments: post.comments?.summary?.total_count || 0,
    shares: post.shares?.count || 0,
    post_date: post.created_time || '',
    media_type: post.type === 'photo' ? 'image' : post.type === 'video' ? 'video' : 'text',
  }));
}

async function fetchInstagramViaApify(username) {
  const cleanUsername = username.replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\//g, '').replace('@', '');
  const items = await runApifyActor('apify~instagram-post-scraper', {
    username: [cleanUsername],
    resultsLimit: 20,
  });

  return items.map(post => ({
    post_id: post.id || post.shortCode || `ig_${Date.now()}_${Math.random()}`,
    content: post.caption || '',
    post_url: post.url || (post.shortCode ? `https://instagram.com/p/${post.shortCode}` : ''),
    likes: post.likesCount || 0,
    comments: post.commentsCount || 0,
    shares: 0,
    views: post.videoViewCount || 0,
    post_date: post.timestamp || '',
    media_type: post.type === 'Video' ? 'video' : post.type === 'Sidecar' ? 'carousel' : 'image',
  }));
}

async function fetchTiktokViaApify(username) {
  const cleanUsername = username.replace(/https?:\/\/(www\.)?tiktok\.com\/@?/, '').replace(/\//g, '').replace('@', '');
  const items = await runApifyActor('clockworks~free-tiktok-scraper', {
    profiles: [cleanUsername],
    resultsPerPage: 20,
    shouldDownloadVideos: false,
  });

  return items.map(video => ({
    post_id: video.id || `tt_${Date.now()}_${Math.random()}`,
    content: video.text || video.desc || '',
    post_url: video.webVideoUrl || video.url || '',
    likes: video.diggCount || video.likes || 0,
    comments: video.commentCount || video.comments || 0,
    shares: video.shareCount || video.shares || 0,
    views: video.playCount || video.views || 0,
    post_date: video.createTime ? new Date(video.createTime * 1000).toISOString() : '',
    media_type: 'video',
  }));
}