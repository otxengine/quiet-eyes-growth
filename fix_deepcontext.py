path = 'C:/Users/tal89/Downloads/quiet-eyes-growth/server/src/routes/functions/layer7Agents.ts'
content = open(path, encoding='utf-8').read()

# Add tavilySearch import
old_import = "import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';"
new_import = (
    "import { shouldSkipAgent, setLastRun } from '../../lib/agentCache';\n"
    "import { tavilySearch } from '../../lib/tavily';"
)
# Only add if not already there
if 'tavilySearch' not in content:
    content = content.replace(old_import, new_import, 1)

# Replace the DeepContextVision implementation with one that does real menu/web scraping
old_agent = '''export async function runDeepContextVision(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (shouldSkipAgent(businessProfileId, 'runDeepContextVision', COOLDOWNS.runDeepContextVision)) {
    return res.json({ items_created: 0, skipped: true, reason: 'ran_recently' });
  }
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 5,
    });
    const compSummary = competitors.map(c => c.name).join(', ') || 'אין מתחרים ידועים';

    const result = await invokeLLM({
      prompt: `You are a business analysis expert. Create a strategic insight for the business "${profile.name}" (${profile.category}, ${profile.city}).
Return ONLY valid JSON. ALL string values must be in Hebrew.
Competitors: ${compSummary}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{"business_insight":"...in Hebrew...","unmet_demand_detected":true,"demand_description":"...in Hebrew...","sentiment_visual":"positive","recommended_action":"...in Hebrew..."}
sentiment_visual must be one of: positive/neutral/negative/urgent`,
      response_json_schema: { type: 'object' },
    });'''

new_agent = '''export async function runDeepContextVision(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });
  if (shouldSkipAgent(businessProfileId, 'runDeepContextVision', COOLDOWNS.runDeepContextVision)) {
    return res.json({ items_created: 0, skipped: true, reason: 'ran_recently' });
  }
  const startTime = new Date().toISOString();
  try {
    const biz = await ensureOtxBusiness(businessProfileId);
    if (!biz) return res.status(404).json({ error: 'Business profile not found' });
    const { otxId, profile } = biz;

    const competitors = await prisma.competitor.findMany({
      where: { linked_business: businessProfileId },
      take: 5,
    });
    const compSummary = competitors.map(c => c.name).join(', ') || '\u05d0\u05d9\u05df \u05de\u05ea\u05d7\u05e8\u05d9\u05dd \u05d9\u05d3\u05d5\u05e2\u05d9\u05dd';

    // ── Sector-specific OSINT context enrichment ────────────────────────────────
    // For B2B premium food importers: scan restaurant menus to find who's using premium products
    // For aviation: scan conference + demand signals
    // For trading: scan competitor platform complaints
    const catL = (profile.category || '').toLowerCase();
    let liveContext = '';

    const isPremiumFood = ['wagyu', '\u05d5\u05d0\u05d0\u05d2\u05d9\u05d5', '\u05d8\u05e8\u05d5\u05e4\u05dc', 'truffle', 'premium food', 'gourmet', '\u05d1\u05e9\u05e8 \u05e4\u05e8\u05d9\u05de\u05d9\u05d5\u05dd', '\u05d9\u05d1\u05d5\u05d0 \u05de\u05d6\u05d5\u05df'].some(k => catL.includes(k));
    const isAviation  = ['aviation', '\u05ea\u05e2\u05d5\u05e4\u05d4', 'private jet', '\u05de\u05d8\u05d5\u05e1'].some(k => catL.includes(k));
    const isTrading   = ['trading', '\u05de\u05e1\u05d7\u05e8', 'prop firm', 'forex', 'broker', 'fintech'].some(k => catL.includes(k));

    try {
      if (isPremiumFood) {
        // Scan restaurant menus for premium product usage in the target area
        const menuResults = await tavilySearch(
          `\u05de\u05e1\u05e2\u05d3\u05ea \u05e9\u05e3 ${profile.city} \u05ea\u05e4\u05e8\u05d9\u05d8 \u05d7\u05d3\u05e9 ${new Date().getFullYear()} wagyu \u05d1\u05e9\u05e8 \u05e4\u05e8\u05d9\u05de\u05d9\u05d5\u05dd`,
          4,
        );
        const menuContext = menuResults
          .map(r => `${r.title}: ${(r.content || '').slice(0, 200)}`)
          .join('\\n');
        if (menuContext) {
          liveContext = `\u05e1\u05e8\u05d9\u05e7\u05ea \u05ea\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05de\u05e1\u05e2\u05d3\u05d5\u05ea \u05e9\u05e3 \u05d1\u05e2\u05d9\u05e8:\\n${menuContext}`;
        }
        // Also scan for new restaurant openings that may need suppliers
        const newRestaurants = await tavilySearch(
          `\u05de\u05e1\u05e2\u05d3\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05e0\u05e4\u05ea\u05d7\u05d4 ${profile.city} \u05e9\u05e3 \u05e4\u05e8\u05d9\u05de\u05d9\u05d5\u05dd ${new Date().getFullYear()}`,
          3,
        );
        if (newRestaurants.length > 0) {
          liveContext += `\\n\\n\u05de\u05e1\u05e2\u05d3\u05d5\u05ea \u05d7\u05d3\u05e9\u05d5\u05ea \u05e9\u05e0\u05e4\u05ea\u05d7\u05d5 \u05dc\u05d0\u05d7\u05e8\u05d5\u05e0\u05d4 (\\u05dc\u05e7\u05d5\u05d7\u05d5\u05ea B2B \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc\u05d9\u05d9\u05dd):\\n${newRestaurants.map(r => r.title).join(', ')}`;
        }
      } else if (isAviation) {
        const confResults = await tavilySearch(
          `international conference summit ${profile.city} VIP executive ${new Date().getFullYear()} aviation private jet`,
          4,
        );
        liveContext = confResults.map(r => `${r.title}: ${(r.content || '').slice(0, 150)}`).join('\\n');
      } else if (isTrading) {
        const complaintResults = await tavilySearch(
          `trading platform broker complaint slow execution Israel ${new Date().getFullYear()} site:tapuz.co.il OR site:facebook.com`,
          4,
        );
        liveContext = complaintResults.map(r => `${r.title}: ${(r.content || '').slice(0, 150)}`).join('\\n');
      }
    } catch (_) {}

    const result = await invokeLLM({
      prompt: `You are a business analysis expert. Create a strategic insight for the business "${profile.name}" (${profile.category}, ${profile.city}).
Return ONLY valid JSON. ALL string values must be in Hebrew.
Competitors: ${compSummary}
${liveContext ? `\\nLive market context (use this for specific, data-backed insights):\\n${liveContext.slice(0, 800)}` : ''}

Return ONLY valid JSON. ALL string values must be in Hebrew:
{"business_insight":"...in Hebrew...","unmet_demand_detected":true,"demand_description":"...in Hebrew...","sentiment_visual":"positive","recommended_action":"...in Hebrew...","target_leads": [{"name": "target name or entity", "reason": "why this is a lead"}]}
sentiment_visual must be one of: positive/neutral/negative/urgent
target_leads: up to 3 specific B2B leads identified from context (empty array if none)`,
      response_json_schema: { type: 'object' },
    });'''

content = content.replace(old_agent, new_agent, 1)

# Also save target_leads as MarketSignals
old_unmet = (
    "    if (result?.unmet_demand_detected) {\n"
    "      await prisma.action.create({\n"
    "        data: {\n"
    "          linked_business: businessProfileId,\n"
    "          type: 'expansion',\n"
    "          title: `\u05d1\u05d9\u05e7\u05d5\u05e9 \u05dc\u05d0 \u05de\u05e1\u05d5\u05e4\u05e7 \u05d6\u05d5\u05d4\u05d4`,\n"
    "          reasoning: result?.demand_description || result?.business_insight,\n"
    "          impact_estimate: 'medium',\n"
    "          execution_plan: result?.recommended_action || '\u05d1\u05d7\u05df \u05d4\u05d5\u05e1\u05e4\u05ea \u05e9\u05d9\u05e8\u05d5\u05ea \u05d7\u05d3\u05e9 \u05dc\u05e7\u05d8\u05dc\u05d5\u05d2',\n"
    "          status: 'proposed',\n"
    "          created_at: new Date().toISOString(),\n"
    "        },\n"
    "      });\n"
    "    }"
)

new_unmet = (
    "    if (result?.unmet_demand_detected) {\n"
    "      await prisma.action.create({\n"
    "        data: {\n"
    "          linked_business: businessProfileId,\n"
    "          type: 'expansion',\n"
    "          title: `\u05d1\u05d9\u05e7\u05d5\u05e9 \u05dc\u05d0 \u05de\u05e1\u05d5\u05e4\u05e7 \u05d6\u05d5\u05d4\u05d4`,\n"
    "          reasoning: result?.demand_description || result?.business_insight,\n"
    "          impact_estimate: 'medium',\n"
    "          execution_plan: result?.recommended_action || '\u05d1\u05d7\u05df \u05d4\u05d5\u05e1\u05e4\u05ea \u05e9\u05d9\u05e8\u05d5\u05ea \u05d7\u05d3\u05e9 \u05dc\u05e7\u05d8\u05dc\u05d5\u05d2',\n"
    "          status: 'proposed',\n"
    "          created_at: new Date().toISOString(),\n"
    "        },\n"
    "      });\n"
    "    }\n\n"
    "    // Save B2B target leads discovered from live context\n"
    "    const targetLeads: any[] = Array.isArray(result?.target_leads) ? result.target_leads.slice(0, 3) : [];\n"
    "    for (const lead of targetLeads) {\n"
    "      if (!lead?.name) continue;\n"
    "      await prisma.lead.create({\n"
    "        data: {\n"
    "          name: lead.name,\n"
    "          status: 'new',\n"
    "          score: 70,\n"
    "          source_type: 'deep_context_vision',\n"
    "          source_origin: 'ai_osint',\n"
    "          notes: lead.reason || '',\n"
    "          created_date: new Date(),\n"
    "          linked_business: businessProfileId,\n"
    "        },\n"
    "      }).catch(() => {});\n"
    "    }"
)

content = content.replace(old_unmet, new_unmet, 1)

open(path, 'w', encoding='utf-8').write(content)
print('tavilySearch imported:', 'tavilySearch' in content)
print('isPremiumFood:', 'isPremiumFood' in content)
print('isAviation:', 'isAviation' in content)
print('target_leads saved:', 'targetLeads' in content)
