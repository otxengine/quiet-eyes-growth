import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { callClaude, parseClaudeJson } from '../_shared/claudeApi.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));

  let competitorId = body.competitorId;
  let businessProfileId = body.businessProfileId;

  if (!competitorId && body.event?.entity_id) {
    competitorId = body.event.entity_id;
  }
  if (!businessProfileId && body.data?.linked_business) {
    businessProfileId = body.data.linked_business;
  }

  if (!competitorId) return Response.json({ error: 'Missing competitorId' }, { status: 400 });

  let profile: any;
  if (businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === businessProfileId);
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const competitors = await base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id });
  const competitor = competitors.find((c: any) => c.id === competitorId);
  if (!competitor) return Response.json({ error: 'Competitor not found' }, { status: 404 });

  const reviews = await base44.asServiceRole.entities.Review.filter({ linked_business: profile.id });
  const positiveReviews = reviews.filter((r: any) => r.sentiment === 'positive' || (r.rating && r.rating >= 4));
  const reviewThemes = positiveReviews.slice(0, 5).map((r: any) => r.text).join('; ');

  // Include Google rating for richer context
  const ourGoogleInfo = profile.google_rating
    ? `Google Rating: ${profile.google_rating}/5 (${profile.google_review_count || 0} reviews)`
    : 'Google Rating: unknown';

  const prompt = `You are a sales strategist for an Israeli small business.
OUR BUSINESS:
Name: ${profile.name}
Category: ${profile.category}
City: ${profile.city}
Services: ${profile.relevant_services || 'unknown'}
${ourGoogleInfo}

COMPETITOR:
Name: ${competitor.name}
Rating: ${competitor.rating || 'unknown'}/5 (${competitor.review_count || 0} reviews)
Strengths: ${competitor.strengths || 'unknown'}
Weaknesses: ${competitor.weaknesses || 'unknown'}
Known prices: ${competitor.price_points || competitor.last_known_prices || competitor.price_range || 'unknown'}
Services: ${competitor.services || 'unknown'}
Current promotions: ${competitor.current_promotions || 'unknown'}

OUR REVIEWS (positive themes):
${reviewThemes || 'No reviews yet'}

Create a competitive battlecard in Hebrew. Return ONLY valid JSON:
{
  "headline": "one-line positioning vs this competitor",
  "their_strengths": ["point1", "point2"],
  "our_advantages": ["point1", "point2", "point3"],
  "talking_points": [{"customer_says": "...", "you_respond": "..."}],
  "their_weaknesses": ["point1", "point2"],
  "our_usp": "1-2 sentences why choose us",
  "confidence_score": 75,
  "data_gaps": ["missing data item 1"]
}

ALL IN HEBREW. Practical, conversational tone.`;

  let result: any = null;

  // Try Claude first
  const claudeText = await callClaude(prompt, {
    systemPrompt: 'You are a sales strategist. Return ONLY valid JSON battlecard, no markdown.',
    prefill: '{',
    maxTokens: 1500,
  });
  if (claudeText) {
    result = parseClaudeJson(claudeText, null);
  }

  // Fall back to Gemini
  if (!result) {
    result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          headline: { type: "string" },
          their_strengths: { type: "array", items: { type: "string" } },
          our_advantages: { type: "array", items: { type: "string" } },
          talking_points: { type: "array", items: { type: "object", properties: { customer_says: { type: "string" }, you_respond: { type: "string" } } } },
          their_weaknesses: { type: "array", items: { type: "string" } },
          our_usp: { type: "string" },
          confidence_score: { type: "number" },
          data_gaps: { type: "array", items: { type: "string" } }
        }
      }
    });
  }

  if (!result) return Response.json({ error: 'Failed to generate battlecard' }, { status: 500 });

  const confidence = result.confidence_score || 50;
  console.log(`generateBattlecard: ${competitor.name}, confidence: ${confidence}%, gaps: ${(result.data_gaps || []).join(', ')}`);

  await base44.asServiceRole.entities.Competitor.update(competitorId, {
    battlecard_headline: result.headline || '',
    battlecard_content: JSON.stringify(result),
    battlecard_updated_at: new Date().toISOString(),
  });

  return Response.json({ success: true, battlecard: result, confidence });
});
