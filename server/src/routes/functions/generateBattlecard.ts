import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';

export async function generateBattlecard(req: Request, res: Response) {
  const { competitorId, businessProfileId } = req.body;
  if (!competitorId) return res.status(400).json({ error: 'Missing competitorId' });

  try {
    const competitor = await prisma.competitor.findUnique({ where: { id: competitorId } });
    if (!competitor) return res.status(404).json({ error: 'Competitor not found' });

    const bpId = businessProfileId || competitor.linked_business;
    const profiles = await prisma.businessProfile.findMany({ where: { id: bpId } });
    const bp = profiles[0];
    if (!bp) return res.status(404).json({ error: 'Business profile not found' });

    const reviews = await prisma.review.findMany({ where: { linked_business: bpId } });
    const positiveReviews = reviews.filter(r => r.sentiment === 'positive' || (r.rating && r.rating >= 4));
    const reviewThemes = positiveReviews.slice(0, 5).map(r => r.text).join('; ');

    const ourGoogleInfo = bp.google_rating
      ? `Google Rating: ${bp.google_rating}/5 (${bp.google_review_count || 0} reviews)`
      : 'Google Rating: unknown';

    const prompt = `You are a sales strategist for an Israeli small business.
OUR BUSINESS:
Name: ${bp.name}
Category: ${bp.category}
City: ${bp.city}
Services: ${bp.relevant_services || 'unknown'}
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

    const result = await invokeLLM({ prompt, response_json_schema: { type: 'object' } });
    if (!result) return res.status(500).json({ error: 'Failed to generate battlecard' });

    const confidence = result.confidence_score || 50;

    await prisma.competitor.update({
      where: { id: competitorId },
      data: {
        battlecard_headline: result.headline || '',
        battlecard_content: JSON.stringify(result),
        battlecard_updated_at: new Date().toISOString(),
      },
    });

    return res.json({ success: true, battlecard: result, confidence });
  } catch (err: any) {
    console.error('generateBattlecard error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
