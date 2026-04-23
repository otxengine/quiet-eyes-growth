import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  let profile;

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
    } catch (_) {}
  }
  if (!profile) {
    const allProfiles = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = allProfiles[0];
  }
  if (!profile) return Response.json({ error: 'No business profile' }, { status: 404 });

  const bpId = profile.id;
  const { name, category, city } = profile;

  // Gather existing knowledge
  const [knowledge, signals, competitors, reviews, leads, sector] = await Promise.all([
    base44.asServiceRole.entities.BusinessKnowledge.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.MarketSignal.filter({ linked_business: bpId }, '-detected_at', 30),
    base44.asServiceRole.entities.Competitor.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Review.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.Lead.filter({ linked_business: bpId }),
    base44.asServiceRole.entities.SectorKnowledge.filter({}),
  ]);

  const knowledgeTypes = knowledge.map(k => k.knowledge_type);
  const knowledgeTitles = knowledge.map(k => k.title);

  // Identify gaps and cross-reference
  const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are a business intelligence analyst examining knowledge completeness.

BUSINESS: ${name}, Category: ${category}, City: ${city}

EXISTING KNOWLEDGE BASE:
${knowledge.length > 0 ? knowledge.map(k => `- [${k.knowledge_type}] ${k.title}: ${(k.content || '').slice(0, 100)}`).join('\n') : 'ריק'}

EXISTING DATA:
- ${signals.length} market signals
- ${competitors.length} competitors tracked
- ${reviews.length} reviews
- ${leads.length} leads
- Sector knowledge: ${sector[0] ? 'exists' : 'missing'}
- Knowledge types covered: ${[...new Set(knowledgeTypes)].join(', ') || 'none'}

CROSS-REFERENCES FOUND IN SIGNALS:
${signals.slice(0, 10).map(s => s.summary).join('; ')}

TASK:
1. Identify KNOWLEDGE GAPS — what important information is missing about this business/market
2. Suggest CROSS-LINKS — connections between existing data that provide new insights
3. Suggest specific SEARCH QUERIES to fill gaps

Return:
- gaps: array of { topic, importance (high/medium/low), search_query }
- cross_links: array of { insight, source_a, source_b } — where two data points combine for a new insight
- auto_searches: array of search queries to run automatically

ALL TEXT IN HEBREW.`,
    model: 'gemini_3_flash',
    add_context_from_internet: true,
    response_json_schema: {
      type: "object",
      properties: {
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              importance: { type: "string" },
              search_query: { type: "string" }
            }
          }
        },
        cross_links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              insight: { type: "string" },
              source_a: { type: "string" },
              source_b: { type: "string" }
            }
          }
        },
        auto_searches: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  });

  const gaps = llmResult?.gaps || [];
  const crossLinks = llmResult?.cross_links || [];
  const autoSearches = llmResult?.auto_searches || [];

  // Create market signals for important cross-links
  let signalsCreated = 0;
  for (const link of crossLinks.slice(0, 3)) {
    await base44.asServiceRole.entities.MarketSignal.create({
      summary: `תובנה מוצלבת: ${(link.insight || '').slice(0, 45)}`,
      impact_level: 'medium',
      category: 'trend',
      recommended_action: link.insight,
      confidence: 70,
      source_signals: `${link.source_a} + ${link.source_b}`,
      is_read: false,
      detected_at: new Date().toISOString(),
      linked_business: bpId,
    });
    signalsCreated++;
  }

  // Auto-search for high-importance gaps
  let gapsFilled = 0;
  for (const gap of gaps.filter(g => g.importance === 'high').slice(0, 2)) {
    try {
      const searchResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `חפש מידע על: "${gap.search_query}" עבור עסק בתחום ${category} ב${city}. סכם את הממצאים ב-3-4 משפטים בעברית.`,
        model: 'gemini_3_flash',
        add_context_from_internet: true,
      });

      if (searchResult && searchResult.length > 20) {
        await base44.asServiceRole.entities.BusinessKnowledge.create({
          linked_business: bpId,
          source_url: '',
          knowledge_type: 'general',
          title: gap.topic,
          content: searchResult.slice(0, 500),
          keywords: gap.search_query,
          confidence: 65,
          last_scanned: new Date().toISOString(),
        });
        gapsFilled++;
      }
    } catch (err) {
      console.error(`Gap search failed: ${err.message}`);
    }
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'identifyKnowledgeGaps',
      start_time: new Date(Date.now() - 5000).toISOString(),
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: gapsFilled,
      linked_business: bpId,
    });
  } catch (_) {}

  console.log(`identifyKnowledgeGaps: ${gaps.length} gaps, ${crossLinks.length} cross-links, ${gapsFilled} filled`);
  return Response.json({
    gaps_found: gaps.length,
    cross_links_found: crossLinks.length,
    signals_created: signalsCreated,
    gaps_auto_filled: gapsFilled,
    auto_searches_suggested: autoSearches.length,
  });
});