import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { businessProfileId, name, category, city } = await req.json();

  const prompt = `You are a business intelligence analyst specializing in Israeli small businesses.
Business: ${name}
Category: ${category}
City: ${city}

Research the current market for ${category} businesses in ${city}, Israel. Then generate exactly 3 market insights in Hebrew:

1. THREAT: A specific competitive threat or market risk. Be specific — mention actual patterns, not generic statements.
2. OPPORTUNITY: A specific unmet demand or market gap. Reference actual trends if possible.
3. TREND: A rising pattern in customer behavior or the sector. Include data points if available.

For EACH insight provide:
- title: clear Hebrew title (1 line, max 60 characters)
- description: why this matters (2-3 sentences in Hebrew)
- recommended_action: what the business owner should do (1 sentence)
- confidence: number between 65 and 95

CRITICAL: All text must be in natural Hebrew. Do not transliterate English terms.
Return as JSON array with exactly 3 objects:
[
  {"category": "threat", "title": "...", "description": "...", "recommended_action": "...", "confidence": 85},
  {"category": "opportunity", "title": "...", "description": "...", "recommended_action": "...", "confidence": 80},
  {"category": "trend", "title": "...", "description": "...", "recommended_action": "...", "confidence": 75}
]`;

  const llmResponse = await base44.integrations.Core.InvokeLLM({
    prompt,
    model: 'gemini_3_pro',
    add_context_from_internet: true,
    response_json_schema: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              title: { type: "string" },
              description: { type: "string" },
              recommended_action: { type: "string" },
              confidence: { type: "number" }
            },
            required: ["category", "title", "description", "recommended_action", "confidence"]
          }
        }
      },
      required: ["insights"]
    }
  });

  const insights = llmResponse.insights || llmResponse;
  const insightsArray = Array.isArray(insights) ? insights : [insights];
  
  const now = new Date().toISOString();
  const createdSignals = [];

  for (const insight of insightsArray) {
    const impactLevel = insight.category === 'threat' ? 'high' : 'medium';
    
    const signal = await base44.asServiceRole.entities.MarketSignal.create({
      summary: insight.title,
      impact_level: impactLevel,
      category: insight.category,
      recommended_action: insight.recommended_action,
      confidence: insight.confidence,
      is_read: false,
      detected_at: now,
      linked_business: businessProfileId
    });
    
    createdSignals.push(signal);
  }

  return Response.json({ signals: createdSignals });
});