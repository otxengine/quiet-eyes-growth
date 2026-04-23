import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { searchNearbyCompetitors, getPlaceDetails } from '../_shared/googlePlaces.ts';
import {
  readEpisodes, readPromptScores,
  buildEpisodeUpdate, buildMessageUpdate, buildPromptScoreUpdate,
  parseMessages,
  Episode, AgentMessage,
} from '../_shared/agentMemory.ts';

const AGENT_NAME = 'הצופה';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

  if (body.businessProfileId) {
    const profiles = await base44.asServiceRole.entities.BusinessProfile.filter({ id: body.businessProfileId });
    profile = profiles[0];
  }
  if (!profile) {
    try {
      const user = await base44.auth.me();
      if (user) {
        const profiles = await base44.entities.BusinessProfile.filter({ created_by: user.email });
        profile = profiles[0];
      }
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) {
    return Response.json({ error: 'No business profile found', competitors_found: 0 }, { status: 404 });
  }

  const { name, category, city, full_address, relevant_services, target_market } = profile;
  const locationContext = full_address || city;

  // ===== PRIMARY SOURCE: Google Places nearby search =====
  let googleNearbyContext = '';
  try {
    const nearbyPlaces = await searchNearbyCompetitors(category, city, name, 8);
    if (nearbyPlaces.length > 0) {
      // Fetch details for top 5 to get ratings
      const enriched = await Promise.all(
        nearbyPlaces.slice(0, 5).map(async (p) => {
          const details = await getPlaceDetails(p.placeId);
          return details ? { ...p, ...details } : p;
        })
      );
      googleNearbyContext = `\nGOOGLE PLACES NEARBY COMPETITORS (real data, city: ${city}):\n` +
        enriched.map(p => `- ${p.name}: rating=${p.rating || 'N/A'}, reviews=${p.reviewCount || 'N/A'}, address=${p.address || 'N/A'}`).join('\n');
      console.log(`runCompetitorIdentification: ${nearbyPlaces.length} מתחרים נמצאו ב-Google Places`);
    }
  } catch (err) {
    console.error('Google Places nearby search failed:', err.message);
  }

  const [rawSignals, existingCompetitors, sectorKnowledge] = await Promise.all([
    base44.asServiceRole.entities.RawSignal.filter({ linked_business: profile.id }, '-detected_at', 20),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id }),
    base44.asServiceRole.entities.SectorKnowledge.filter({}),
  ]);
  const existingNames = existingCompetitors.map(c => c.name);
  const sectorInfo = sectorKnowledge.find(s => s.sector === category && s.region === city) || sectorKnowledge.find(s => s.sector === category) || null;

  // Separate social signals about competitors for richer context
  const competitorSocialSignals = rawSignals.filter(s => s.signal_type === 'competitor_social');
  const socialSignals = rawSignals.filter(s => ['social_mention', 'social_review', 'social_trend'].includes(s.signal_type));

  // Search for competitors — with social media, groups, and sector context
  const searchQueries = [
    `${category} ${locationContext} ביקורות מומלצים`,
    `${category} ליד ${locationContext} מומלצים חדשים 2026`,
    `${category} אזור ${city} שירותים מחירים השוואה`,
    `${category} ${city} פייסבוק אינסטגרם פופולרי נוכחות חברתית`,
    `${category} ${city} קבוצות פייסבוק המלצות מתחרים`,
  ];

  // Add service-specific competitor queries
  if (relevant_services) {
    const services = relevant_services.split(',').map(s => s.trim()).filter(Boolean);
    for (const svc of services.slice(0, 2)) {
      searchQueries.push(`${svc} ${city} עסקים מובילים`);
    }
  }

  // Add sector-aware queries
  if (sectorInfo?.trending_services) {
    searchQueries.push(`${sectorInfo.trending_services} ${city} עסקים חדשים`);
  }

  let webSearchResults = '';
  for (const query of searchQueries) {
    try {
      const searchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `חפש באינטרנט: "${query}". החזר רשימה של שמות עסקים ופרטים שמצאת, כולל נוכחות ברשתות חברתיות. כתוב הכל בעברית.`,
        model: 'gemini_3_flash',
        add_context_from_internet: true,
      });
      webSearchResults += `\nחיפוש: "${query}"\n${searchResult}\n---\n`;
    } catch (err) {
      console.error(`Search failed for "${query}":`, err.message);
    }
  }

  const rawSignalContext = rawSignals.slice(0, 10).map(s => 
    `[${s.signal_type}${s.platform ? '/' + s.platform : ''}] Source: ${s.source}\nContent: ${s.content}\nURL: ${s.url}`
  ).join('\n---\n');

  const competitorSocialContext = competitorSocialSignals.length > 0
    ? `\n\nCOMPETITOR SOCIAL MEDIA SIGNALS:\n${competitorSocialSignals.map(s => `[${s.platform}] ${s.content}`).join('\n')}`
    : '';

  let competitors = [];
  try {
    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a competitive intelligence analyst for Israeli small businesses with expertise in social media analysis and sector-specific market dynamics.

BUSINESS: ${name}, Category: ${category}, Location: ${locationContext} (City: ${city})
Target Market: ${target_market || 'N/A'}
Services: ${relevant_services || 'N/A'}
${sectorInfo ? `\nSECTOR CONTEXT:\n- Avg rating in sector: ${sectorInfo.avg_rating || 'N/A'}\n- Trending services: ${sectorInfo.trending_services || 'N/A'}\n- Common complaints: ${sectorInfo.common_complaints || 'N/A'}\n- Price range: ${sectorInfo.price_range || 'N/A'}` : ''}

RAW DATA FROM WEB:
${rawSignalContext}
${competitorSocialContext}
${googleNearbyContext}

TARGETED SEARCH RESULTS:
${webSearchResults}

EXISTING COMPETITORS TRACKED:
${existingNames.length > 0 ? existingNames.join(', ') : 'none'}

Identify real competitor businesses (max 5, exclude "${name}" and already tracked: ${existingNames.join(', ')}).
Focus on competitors NEAR the location "${locationContext}" — prioritize geographic proximity.

For each:
- name: exact business name in Hebrew
- category: business type in Hebrew
- rating: Google/Facebook rating (1.0-5.0), 0 if unknown
- review_count: estimated reviews, 0 if unknown
- trend_direction: up / down / stable
- strengths: what customers praise (Hebrew, 1-2 sentences)
- weaknesses: what customers complain about (Hebrew, 1-2 sentences)
- services: main services offered (Hebrew, comma-separated)
- price_range: estimated price range in ₪ (Hebrew)
- address: approximate address/area if known (Hebrew)
- social_presence: brief description of their social media activity (Hebrew, 1 sentence). e.g. "פעיל באינסטגרם עם 5K עוקבים" or "אין נוכחות חברתית בולטת"
- social_platforms: comma-separated list of active platforms (facebook, instagram, tiktok, etc.)
- source_url: a REAL working URL where info about this competitor was found (Google Maps, Facebook page, website, review site). Must be a real, verifiable URL. If unknown, use empty string.
- website_url: the competitor's own website URL if known, otherwise empty string.

Only include businesses that ACTUALLY EXIST. ALL text in Hebrew.`,
      model: 'gemini_3_flash',
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          competitors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                rating: { type: "number" },
                review_count: { type: "number" },
                trend_direction: { type: "string" },
                strengths: { type: "string" },
                weaknesses: { type: "string" },
                services: { type: "string" },
                price_range: { type: "string" },
                address: { type: "string" },
                social_presence: { type: "string" },
                social_platforms: { type: "string" },
                source_url: { type: "string" },
                website_url: { type: "string" }
              }
            }
          }
        }
      }
    });
    competitors = llmResult?.competitors || [];
  } catch (err) {
    console.error('LLM call failed:', err.message);
    return Response.json({ error: 'LLM call failed', details: err.message }, { status: 500 });
  }

  let newCreated = 0;
  let existingUpdated = 0;
  let signalsCreated = 0;
  const now = new Date().toISOString();
  const startTime = now;

  for (const comp of competitors) {
    if (!comp.name || comp.name === name) continue;

    // FIX 3: Deep research on each competitor — menu, prices, promotions
    let enrichedData = {};
    try {
      const enrichResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `חפש באינטרנט מידע מפורט על העסק "${comp.name}" ב${city} (קטגוריה: ${category}).

חיפושים לביצוע:
- "${comp.name} תפריט"
- "${comp.name} מחירון מחירים"
- "${comp.name} מבצעים"
- "${comp.name} שעות פתיחה"
- "${comp.name} ${city} ביקורות"

בהתבסס על מה שמצאת, מלא את השדות הבאים.
אם לא מצאת מידע לשדה מסוים — החזר null.
אל תמציא מידע! רק מה שנמצא באמת ברשת.

Return JSON:
{
  "menu_highlights": "מוצרים/שירותים עיקריים שמצאת (בעברית, עד 200 תווים)",
  "price_points": "מחירים ספציפיים שמצאת עם ₪ (בעברית, עד 200 תווים)",
  "current_promotions": "מבצעים פעילים שמצאת (בעברית, עד 150 תווים)",
  "opening_hours": "שעות פתיחה אם מצאת",
  "recent_reviews_summary": "מה לקוחות אומרים — סיכום ב-2 משפטים (בעברית)"
}`,
        model: 'gemini_3_flash',
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            menu_highlights: { type: "string" },
            price_points: { type: "string" },
            current_promotions: { type: "string" },
            opening_hours: { type: "string" },
            recent_reviews_summary: { type: "string" }
          }
        }
      });
      enrichedData = enrichResult || {};
    } catch (err) {
      console.error(`Enrich failed for ${comp.name}:`, err.message);
    }

    const existing = existingCompetitors.find(e => e.name === comp.name || e.name.includes(comp.name) || comp.name.includes(e.name));
    const tagsArray = [comp.social_platforms, comp.social_presence].filter(Boolean);
    const tags = tagsArray.join(' | ');

    const noteParts = [];
    if (comp.social_presence) noteParts.push(`נוכחות חברתית: ${comp.social_presence}`);
    if (comp.source_url) noteParts.push(`מקור מידע: ${comp.source_url}`);
    if (comp.website_url) noteParts.push(`אתר: ${comp.website_url}`);
    const notesStr = noteParts.join(' | ');

    const enrichFields = {
      menu_highlights: enrichedData.menu_highlights || '',
      price_points: enrichedData.price_points || '',
      current_promotions: enrichedData.current_promotions || '',
      opening_hours: enrichedData.opening_hours || '',
      recent_reviews_summary: enrichedData.recent_reviews_summary || '',
    };

    if (existing) {
      const ratingChanged = comp.rating > 0 && Math.abs((existing.rating || 0) - comp.rating) > 0.3;
      await base44.asServiceRole.entities.Competitor.update(existing.id, {
        rating: comp.rating || existing.rating,
        review_count: comp.review_count || existing.review_count,
        trend_direction: comp.trend_direction || existing.trend_direction,
        strengths: comp.strengths || existing.strengths,
        weaknesses: comp.weaknesses || existing.weaknesses,
        services: comp.services || existing.services || '',
        price_range: comp.price_range || existing.price_range || '',
        address: comp.address || existing.address || '',
        tags: tags || existing.tags || '',
        notes: notesStr || existing.notes || '',
        last_scanned: now,
        ...enrichFields,
      });
      existingUpdated++;

      // Generate SPECIFIC signals instead of "go check" signals
      if (ratingChanged) {
        await base44.asServiceRole.entities.MarketSignal.create({
          summary: `שינוי בדירוג: ${comp.name} (${existing.rating || '?'} → ${comp.rating})`,
          impact_level: 'medium', category: 'competitor_move',
          recommended_action: enrichedData.recent_reviews_summary || `הדירוג של ${comp.name} השתנה`,
          confidence: 75, is_read: false, detected_at: now, linked_business: profile.id,
        });
        signalsCreated++;
      }
      if (enrichedData.current_promotions) {
        await base44.asServiceRole.entities.MarketSignal.create({
          summary: `מבצע פעיל אצל ${comp.name}: ${enrichedData.current_promotions}`,
          impact_level: 'medium', category: 'competitor_move',
          recommended_action: `שקול להציע מבצע מתחרה — ${comp.name} מציע: ${enrichedData.current_promotions}`,
          confidence: 70, is_read: false, detected_at: now, linked_business: profile.id,
        });
        signalsCreated++;
      }
      if (enrichedData.price_points && existing.price_points !== enrichedData.price_points) {
        await base44.asServiceRole.entities.MarketSignal.create({
          summary: `מחירים חדשים אצל ${comp.name}: ${enrichedData.price_points}`,
          impact_level: 'medium', category: 'competitor_move',
          recommended_action: `השווה את המחירים שלך מול ${comp.name}`,
          confidence: 65, is_read: false, detected_at: now, linked_business: profile.id,
        });
        signalsCreated++;
      }
    } else {
      await base44.asServiceRole.entities.Competitor.create({
        name: comp.name, category: comp.category || category,
        rating: comp.rating || 0, review_count: comp.review_count || 0,
        trend_direction: comp.trend_direction || 'stable',
        strengths: comp.strengths || '', weaknesses: comp.weaknesses || '',
        services: comp.services || '', price_range: comp.price_range || '',
        address: comp.address || '',
        tags: tags || '', notes: notesStr || '',
        last_scanned: now, linked_business: profile.id,
        ...enrichFields,
      });
      newCreated++;
      await base44.asServiceRole.entities.MarketSignal.create({
        summary: `מתחרה חדש זוהה: ${comp.name}${enrichedData.price_points ? ` — מחירים: ${enrichedData.price_points}` : ''}`,
        impact_level: 'medium', category: 'competitor_move',
        recommended_action: enrichedData.recent_reviews_summary || `${comp.name} — ${comp.strengths || 'מתחרה חדש באזור שלך'}`,
        confidence: 75, is_read: false, detected_at: now, linked_business: profile.id,
      });
      signalsCreated++;
    }
  }

  // === B+C: WRITE EPISODIC MEMORY + SEND AGENT MESSAGES ===
  try {
    const sectorAll2 = await base44.asServiceRole.entities.SectorKnowledge.filter({});
    const sk2 = sectorAll2.find((s: any) =>
      s.linked_business === profile.id || s.sector === category
    ) || null;

    if (sk2) {
      const risingCompetitors = competitors.filter((c: any) => c.trend_direction === 'up');
      const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString();
      const priceChangers: any[] = [];
      // Check existing competitors for recent price changes
      for (const comp of competitors) {
        const existing = existingCompetitors?.find((e: any) => e.name === comp.name);
        if (existing?.price_changed_at && existing.price_changed_at >= weekAgoStr) {
          priceChangers.push(comp);
        }
      }

      const outMessages: AgentMessage[] = [];
      const expires48h = new Date(Date.now() + 48 * 3600000).toISOString();
      const expires24h = new Date(Date.now() + 24 * 3600000).toISOString();

      if (risingCompetitors.length > 0) {
        outMessages.push({
          from_agent: AGENT_NAME,
          to_agent: 'המנתח',
          priority: 'high',
          subject: `${risingCompetitors.length} מתחרים במגמת עלייה`,
          body: `${risingCompetitors.map((c: any) => c.name).join(', ')} מציגים צמיחה. בדוק אם יש ביקורות חדשות או מבצעים.`,
          timestamp: now,
          expires_at: expires48h,
          acted_on: false,
        });
      }

      if (priceChangers.length > 0) {
        outMessages.push({
          from_agent: AGENT_NAME,
          to_agent: 'all',
          priority: 'critical',
          subject: `שינוי מחירים: ${priceChangers.map((c: any) => c.name).join(', ')}`,
          body: `מתחרים שינו מחירים השבוע. זה יכול להשפיע על לידים — בדוק כוונת מעבר בין מתחרים.`,
          timestamp: now,
          expires_at: expires24h,
          acted_on: false,
        });
      }

      const currentEpisodes2 = readEpisodes(sk2);
      const currentMessages2 = parseMessages(sk2.agent_message_queue || '[]');
      const currentScores2 = readPromptScores(sk2);

      const newEpisode2: Episode = {
        agent: AGENT_NAME,
        timestamp: now,
        run_summary: `עקבתי אחרי ${competitors.length} מתחרים — ${newCreated} חדשים, ${existingUpdated} עודכנו`,
        key_findings: [
          risingCompetitors.length > 0 ? `עולים: ${risingCompetitors.map((c: any) => c.name).join(', ')}` : 'אין מתחרים עולים',
          priceChangers.length > 0 ? `שינו מחיר: ${priceChangers.map((c: any) => c.name).join(', ')}` : 'אין שינויי מחיר',
        ],
        watch_next: [
          `בדוק ביקורות ל: ${risingCompetitors[0]?.name || 'מתחרה מוביל'}`,
          `עקוב אחרי מבצעים של: ${competitors.slice(0, 2).map((c: any) => c.name).join(', ')}`,
        ],
        data_quality: newCreated > 0 ? 75 : 50,
        signals_count: competitors.length,
      };

      await base44.asServiceRole.entities.SectorKnowledge.update(sk2.id, {
        agent_episodic_memory: buildEpisodeUpdate(currentEpisodes2, newEpisode2),
        agent_message_queue: buildMessageUpdate(currentMessages2, outMessages),
        agent_prompt_scores: buildPromptScoreUpdate(currentScores2, AGENT_NAME, newEpisode2.data_quality),
      });
    }
  } catch (_) {}

  // Log automation
  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'runCompetitorIdentification',
      start_time: startTime, end_time: new Date().toISOString(),
      status: 'success', items_processed: newCreated + existingUpdated,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`runCompetitorIdentification: ${newCreated} new, ${existingUpdated} updated, enriched with menu/prices`);
  return Response.json({ competitors_found: competitors.length, new_competitors_created: newCreated, existing_competitors_updated: existingUpdated, signals_created: signalsCreated });
});