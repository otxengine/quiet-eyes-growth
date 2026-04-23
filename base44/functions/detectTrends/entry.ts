import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import {
  readEpisodes, readPromptScores,
  buildEpisodeUpdate, buildPromptScoreUpdate,
  Episode,
} from '../_shared/agentMemory.ts';

const AGENT_NAME = 'הזיכרון';

const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY') || '';

async function searchTrendData(query: string): Promise<string> {
  if (!TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const results = data.results || [];
    const answer = data.answer || '';
    return [answer, ...results.map((r: any) => r.content || '')].join('\n').substring(0, 1500);
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const startTime = new Date().toISOString();

  let profile: any;
  if (body.businessProfileId) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all.find((p: any) => p.id === body.businessProfileId);
  }
  if (!profile) {
    const all = await base44.asServiceRole.entities.BusinessProfile.filter({});
    profile = all[0];
  }
  if (!profile) return Response.json({ error: 'No profile' }, { status: 404 });

  const { name, category, city, relevant_services } = profile;
  const competitors = await base44.asServiceRole.entities.Competitor.filter({ linked_business: profile.id });
  const sectorKnowledge = await base44.asServiceRole.entities.SectorKnowledge.filter({});
  const sector = sectorKnowledge.find((s: any) =>
    s.linked_business === profile.id || s.sector === category
  ) || null;

  // === E: READ SELF-IMPROVEMENT SCORES ===
  const pastEpisodes = readEpisodes(sector);
  const promptScores = readPromptScores(sector);
  const myScore = promptScores[AGENT_NAME];

  const selfImprovementInstructions = myScore?.improvement_notes?.length > 0 ? `
SELF-IMPROVEMENT (apply from previous runs):
${myScore.improvement_notes.slice(-3).map((n: string) => `- ${n}`).join('\n')}
Previous avg quality: ${myScore.avg_quality}/100
` : '';

  const trendMemory = pastEpisodes
    .filter((e: Episode) => e.agent === AGENT_NAME)
    .slice(0, 3)
    .map((e: Episode) => `Previously watching: ${e.watch_next.join(', ')}`)
    .join('\n');

  console.log(`[detectTrends] Gathering real trend data for ${category} in ${city}`);

  const trendDataSources = await Promise.all([
    searchTrendData(`"${category}" google trends rising Israel 2025 2026 growth`),
    searchTrendData(`${category} Israel rising demand statistics data 2026`),
    searchTrendData(`${category} Israel trending viral social media 2026`),
    searchTrendData(`${category} ישראל מגמות עולות 2026 נתונים`),
    searchTrendData(`${category} ${city} חדש פתח נפתח 2026`),
    searchTrendData(`what do customers want from ${category} 2025 2026 Israel preferences`),
  ]);

  const combinedTrendData = trendDataSources.filter(Boolean).join('\n\n---\n\n').substring(0, 6000);

  const rawSignals = await base44.asServiceRole.entities.RawSignal.filter(
    { linked_business: profile.id }, '-detected_at', 50
  );
  const recentContent = rawSignals
    .map((s: any) => s.content || '')
    .filter(Boolean)
    .join(' ')
    .substring(0, 2000);

  const analysisPrompt = `אתה אנליסט מגמות המתמחה בעסקים קטנים בישראל.
${selfImprovementInstructions}
TRENDS I WAS WATCHING FROM PREVIOUS RUNS:
${trendMemory || 'First run — no prior context'}

עסק: "${name}" — ${category} ב${city}
שירותים: ${relevant_services || category}
מתחרים: ${competitors.slice(0, 5).map((c: any) => c.name).join(', ') || 'לא ידוע'}
ידע ענפי: ${sector?.trending_services || 'לא זמין'}

נתוני מגמות אמיתיים מחיפושי רשת וחדשות:
${combinedTrendData || 'נתונים מוגבלים — השתמש בידע שוק כללי'}

אותות אחרונים ממערכת שלנו:
${recentContent || 'אין אותות אחרונים'}

משימה: זהה 2-4 מגמות עולות ב"${category}" בישראל שעדיין אינן עיקריות אך מראות אותות צמיחה מוקדמים ברורים.

לכל מגמה חייב להיות ראיה מהנתונים למעלה.

קריטריונים למגמה תקפה:
- עלייה בנפח חיפושים או עלייה באזכורים ברשתות חברתיות או דוחות ענף המראים צמיחה
- עוד לא עיקרית לחלוטין (מאמצים מוקדמים, לא שיא)
- רלוונטית לעסקי "${category}" בישראל
- ניתנת לפעולה על ידי עסק מקומי תוך 1-3 חודשים

החזר JSON בלבד:
{
  "trends": [
    {
      "trend_name": "שם קצר בעברית",
      "description": "מה קורה ולמה — 2-3 משפטים בעברית",
      "evidence": "נקודת נתונים ספציפית שמאשרת את המגמה",
      "growth_stage": "early|growing|peaking",
      "timeframe_to_peak": "לדוגמה 2-3 חודשים",
      "opportunity_for_business": "פעולה ספציפית לעסק — משפט אחד בעברית",
      "confidence": 55,
      "source_type": "search_volume|social_trend|news|competitor_behavior|customer_feedback"
    }
  ]
}

אם לא מצאת ראיה אמיתית — אל תכלול את המגמה. עדיף מערך ריק מאשר ניחוש.
כל הטקסט בעברית מלבד שמות שדות.`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: analysisPrompt,
    model: 'gemini_3_flash',
    add_context_from_internet: true,
    response_json_schema: {
      type: 'object',
      properties: {
        trends: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              trend_name: { type: 'string' },
              description: { type: 'string' },
              evidence: { type: 'string' },
              growth_stage: { type: 'string' },
              timeframe_to_peak: { type: 'string' },
              opportunity_for_business: { type: 'string' },
              confidence: { type: 'number' },
              source_type: { type: 'string' },
              what_to_watch: { type: 'string' },
              improvement_note: { type: 'string' },
            }
          }
        }
      }
    }
  });

  const trends = result?.trends || [];
  let saved = 0;

  for (const trend of trends) {
    if (!trend.trend_name || !trend.evidence) continue;

    await base44.asServiceRole.entities.MarketSignal.create({
      summary: `מגמה עולה: ${trend.trend_name}`,
      impact_level: trend.growth_stage === 'early' ? 'medium' : 'high',
      category: 'trend',
      recommended_action: `${trend.opportunity_for_business}\n\nראיה: ${trend.evidence}\nשיא צפוי: ${trend.timeframe_to_peak}\nשלב: ${trend.growth_stage}`,
      confidence: trend.confidence || 60,
      source_signals: `trend_real_data_${trend.source_type}`,
      source_description: 'ניתוח נתוני חיפוש אמיתיים ומידע ענפי',
      is_read: false,
      detected_at: new Date().toISOString(),
      linked_business: profile.id,
    });
    saved++;
  }

  if (saved > 0 && sector) {
    await base44.asServiceRole.entities.SectorKnowledge.update(sector.id, {
      trending_services: trends.map((t: any) => t.trend_name).join(', '),
      last_updated: new Date().toISOString(),
    });
  }

  // === E: WRITE EPISODIC MEMORY + SELF-SCORE ===
  if (sector) {
    try {
      const currentEpisodes = readEpisodes(sector);
      const currentScores = readPromptScores(sector);
      const avgTrendConfidence = trends.length > 0
        ? Math.round(trends.reduce((s: number, t: any) => s + (t.confidence || 60), 0) / trends.length)
        : 40;

      const newEpisode: Episode = {
        agent: AGENT_NAME,
        timestamp: new Date().toISOString(),
        run_summary: `זיהיתי ${saved} מגמות עם ממוצע ביטחון ${avgTrendConfidence}%`,
        key_findings: trends.slice(0, 3).map((t: any) => `${t.trend_name}: ${t.evidence || 'אין ראיה ספציפית'}`),
        watch_next: trends.slice(0, 3).map((t: any) => t.what_to_watch || t.trend_name || ''),
        data_quality: avgTrendConfidence,
        signals_count: saved,
      };

      // Extract improvement note from first trend if available
      const improvementNote = trends[0]?.improvement_note;

      await base44.asServiceRole.entities.SectorKnowledge.update(sector.id, {
        agent_episodic_memory: buildEpisodeUpdate(currentEpisodes, newEpisode),
        agent_prompt_scores: buildPromptScoreUpdate(currentScores, AGENT_NAME, avgTrendConfidence, improvementNote),
      });
    } catch (_) {}
  }

  try {
    await base44.asServiceRole.entities.AutomationLog.create({
      automation_name: 'detectTrends',
      start_time: startTime,
      end_time: new Date().toISOString(),
      status: 'success',
      items_processed: saved,
      linked_business: profile.id,
    });
  } catch (_) {}

  console.log(`[detectTrends] Saved ${saved} evidence-based trends for ${name}`);
  return Response.json({ trends_found: saved, trends });
});
