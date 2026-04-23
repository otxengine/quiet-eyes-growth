import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Support both user-triggered and automation (service role) calls
    let profile;
    const body = await req.json().catch(() => ({}));

    if (body.businessProfileId) {
      const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
      profile = all.find(p => p.id === body.businessProfileId);
    }

    if (!profile) {
      try {
        const user = await base44.auth.me();
        if (user) {
          const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
          profile = profiles[0];
        }
      } catch (_) { /* automation mode */ }
    }

    if (!profile) {
      const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
      profile = allProfiles[0];
    }

    if (!profile) {
      return Response.json({ error: 'No business profile found', updated: false }, { status: 404 });
    }

    const sector = profile.category;
    const region = profile.city;

    // Step 1: Gather all intelligence (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const allSignals = await base44.asServiceRole.entities.MarketSignal.filter({ linked_business: profile.id }, '-detected_at', 200);
    const recentSignals = allSignals.filter(s => (s.detected_at || s.created_date) >= thirtyDaysAgo);

    const competitors = await base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id });
    const reviews = await base44.asServiceRole.entities.Review.filter({ linked_business: profile.id });
    const hotLeads = await base44.asServiceRole.entities.Lead.filter({ linked_business: profile.id });
    const hotOnly = hotLeads.filter(l => l.status === 'hot');

    const signalSummaries = recentSignals.slice(0, 30).map(s => s.summary).join('\n- ');
    const competitorList = competitors.map(c => `${c.name} (דירוג: ${c.rating || '?'}, מגמה: ${c.trend_direction || '?'})`).join('\n');
    const posReviews = reviews.filter(r => r.sentiment === 'positive').length;
    const negReviews = reviews.filter(r => r.sentiment === 'negative').length;
    const neutReviews = reviews.filter(r => r.sentiment === 'neutral').length;
    const serviceNeeds = hotOnly.map(l => l.service_needed).filter(Boolean).join(', ');

    // Step 2: Call LLM to synthesize
    const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a market research analyst for ${sector} businesses in ${region}, Israel.

DATA COLLECTED OVER THE PAST 30 DAYS:

Market Signals (${recentSignals.length} total):
- ${signalSummaries || 'אין נתונים'}

Competitors Tracked (${competitors.length}):
${competitorList || 'אין'}

Reviews Analyzed (${reviews.length}):
Positive: ${posReviews}, Negative: ${negReviews}, Neutral: ${neutReviews}

Hot Leads (${hotOnly.length}):
Most requested services: ${serviceNeeds || 'אין'}

Provide sector analysis:
- common_complaints: top 3 customer complaints in this sector/area (Hebrew, comma separated)
- trending_services: top 3 rising services/products (Hebrew, comma separated)
- avg_rating: average rating across tracked businesses (number, 1 decimal)
- price_range: typical price range (Hebrew, e.g. '200-500₪ לשירות בסיסי')
- competitor_count: active competitors in area
- key_insight: one powerful insight about the sector now (1-2 sentences, Hebrew)

Return ONLY JSON.`,
      model: 'gemini_3_flash',
      add_context_from_internet: true,
      response_json_schema: {
        type: 'object',
        properties: {
          common_complaints: { type: 'string' },
          trending_services: { type: 'string' },
          avg_rating: { type: 'number' },
          price_range: { type: 'string' },
          competitor_count: { type: 'number' },
          key_insight: { type: 'string' },
        }
      },
    });

    // Step 3: Save or update SectorKnowledge
    const existing = await base44.asServiceRole.entities.SectorKnowledge.filter({ sector, region });
    const updateData = {
      sector, region,
      common_complaints: analysis.common_complaints,
      trending_services: analysis.trending_services,
      avg_rating: analysis.avg_rating,
      price_range: analysis.price_range,
      competitor_count: analysis.competitor_count,
      last_updated: new Date().toISOString(),
    };

    if (existing.length > 0) {
      updateData.total_signals_analyzed = (existing[0].total_signals_analyzed || 0) + recentSignals.length;
      await base44.asServiceRole.entities.SectorKnowledge.update(existing[0].id, updateData);
    } else {
      updateData.total_signals_analyzed = recentSignals.length;
      await base44.asServiceRole.entities.SectorKnowledge.create(updateData);
    }

    // Step 4: Create MarketSignal with key insight
    if (analysis.key_insight) {
      await base44.asServiceRole.entities.MarketSignal.create({
        summary: 'עדכון סקטוריאלי: ' + (analysis.key_insight || '').slice(0, 40),
        impact_level: 'medium',
        category: 'trend',
        recommended_action: analysis.key_insight,
        confidence: 85,
        is_read: false,
        detected_at: new Date().toISOString(),
        linked_business: profile.id,
      });
    }

    try {
      await base44.asServiceRole.entities.AutomationLog.create({
        automation_name: 'updateSectorKnowledge',
        start_time: new Date(Date.now() - 5000).toISOString(),
        end_time: new Date().toISOString(),
        status: 'success',
        items_processed: recentSignals.length,
        linked_business: profile.id,
      });
    } catch (_) {}

    console.log(`updateSectorKnowledge complete for ${sector}/${region}: ${recentSignals.length} signals analyzed`);
    return Response.json({ updated: true, signals_analyzed: recentSignals.length, sector, region });
  } catch (error) {
    console.error('updateSectorKnowledge error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});