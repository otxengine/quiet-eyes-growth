/**
 * missionPlanner.ts — Agent Mission Intelligence Layer
 *
 * Called once at onboarding completion (and can be re-triggered from settings).
 * Sends the full business profile to TWO LLMs in parallel:
 *   1. Claude Sonnet  → strategic layer: OSINT queries, competitor strategy, lead targeting, market watch
 *   2. GPT-4o         → content/copy layer: post hooks, message templates, review responses, content pillars
 *
 * The merged result is stored in BusinessProfile.agent_missions and read by every agent before running.
 * This is the "brain" that tells agents what to look for, how to qualify leads, what to write.
 */

import { invokeLLM } from './llm';
import { createLogger } from '../infra/logger';
import { prisma } from '../db';

const logger = createLogger('MissionPlanner');

// ── GPT-4o direct call (separate from invokeLLM's routing) ──────────────────
async function callGPT4o(prompt: string, maxTokens = 2000): Promise<any> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a marketing and content expert for Israeli small businesses. Return ONLY valid JSON. All string values must be in Hebrew unless they are URLs, hashtags, or field names.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`GPT-4o ${res.status}: ${res.statusText}`);
    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    try { return JSON.parse(text); } catch { return null; }
  } catch (err: any) {
    logger.warn(`GPT-4o call failed: ${err.message}`);
    return null;
  }
}

// ── Build the Claude Sonnet strategic prompt ────────────────────────────────
function buildStrategicPrompt(profile: any, sp: any): string {
  const spBlock = sp ? `
תת-סקטור מדויק: ${sp.sub_sector} (${sp.sector_label_he})
סוג עסק: ${sp.business_type} | מודל: ${sp.service_model}
קהל יעד: ${sp.target_audience_he}
הקשר מחיר: ${sp.price_context_he}
נושאים רלוונטיים: ${(sp.relevant_topics || []).join(', ')}
נושאים לא רלוונטיים: ${(sp.irrelevant_topics || []).join(', ')}
סוג מתחרים: ${sp.competitor_type_he}
דחיפות לידים: ${sp.lead_urgency}
` : '';

  return `אתה אנליסט אסטרטגי מומחה לעסקים קטנים-בינוניים בישראל.
קיבלת פרטי עסק ואתה צריך לייצר תכנית משימות מקיפה לכל אחד מהסוכנים AI שיעבדו עבור העסק הזה.

=== פרטי העסק ===
שם: ${profile.name}
עיר: ${profile.city}
תיאור: ${profile.description || 'לא סופק'}
מטרה עסקית: ${profile.business_goal || 'לא צוין'}
רמת מחיר: ${profile.price_tier || 'לא צוין'}
מקורות לקוחות: ${profile.customer_sources || 'לא צוין'}
${spBlock}
=== סוף פרטים ===

צור תכנית משימות מפורטת ב-JSON עבור הסוכנים הבאים.
חשוב: כל המשימות חייבות להיות ספציפיות לסקטור המדויק — לא גנריות.
מעצב UI/UX לא צריך לחפש אירועי ספורט; מסעדה לא צריכה לחפש ב-LinkedIn.

החזר ONLY JSON תקין:
{
  "generated_at": "<ISO timestamp>",
  "business_summary": "<תמצית 1 משפט של העסק בעברית>",
  "osint_persona": "<תיאור 2 משפטים באנגלית: מי עסק זה, מה לחפש, אילו מקורות מידע רלוונטיים>",

  "collectWebSignals": {
    "priority_queries_en": ["<5-7 מחרוזות חיפוש באנגלית מדויקות לסקטור ולעיר>"],
    "priority_sources": ["<דומיינים רלוונטיים: linkedin.com / geektime.co.il / rest.co.il / etc>"],
    "include_topics": ["<5 נושאים לכלול>"],
    "exclude_topics": ["<5 נושאים לסנן>"]
  },

  "runCompetitorIdentification": {
    "search_terms_he": ["<4-5 מונחי חיפוש בעברית למציאת מתחרים מדויקים>"],
    "competitor_profile_he": "<תיאור קצר של מי המתחרים>",
    "differentiation_angles_he": ["<2-3 זוויות בידול שכדאי לנטר>"],
    "monitor_for_he": ["<מה לחפש אצל מתחרים: שינוי מחיר, שירות חדש, ביקורות>"]
  },

  "runLeadGeneration": {
    "intent_phrases_he": ["<5 ביטויי כוונת קנייה בעברית>"],
    "intent_phrases_en": ["<5 ביטויי כוונת קנייה באנגלית>"],
    "target_platforms_he": ["<פלטפורמות לחיפוש לידים: facebook groups / linkedin / yad2 / etc>"],
    "qualify_criteria_he": "<מי הוא ליד איכותי לעסק זה>",
    "disqualify_criteria_he": "<מי לא>",
    "lead_urgency_signals_he": ["<אותות שמעידים על דחיפות>"]
  },

  "generateProactiveAlerts": {
    "priority_alert_types": ["<סוגי התראות לפי עדיפות: hot_lead | negative_review | competitor_move | content_opportunity | demand_gap | retention_risk>"],
    "opportunity_triggers_he": ["<3-4 טריגרים להזדמנויות ספציפיות לסקטור>"],
    "ignore_signal_types": ["<אותות לדלג עליהם>"]
  },

  "findLocalEvents": {
    "relevant_event_types": ["<conference|community|exhibition|market>"],
    "irrelevant_event_types": ["<sports|concert|festival|weather_event>"],
    "event_opportunity_template_he": "<תבנית להזדמנות עסקית מאירוע>"
  },

  "runMarketIntelligence": {
    "market_context_he": "<הקשר שוק עדכני לסקטור זה בישראל — 2 משפטים>",
    "watch_signals_he": ["<4 אותות שוק שכדאי לנטר>"],
    "ignore_signals_he": ["<3 אותות לדלג עליהם>"]
  },

  "smartLeadNurture": {
    "tone_he": "<סגנון תקשורת: מקצועי / ידידותי / טכני / וכו>",
    "followup_interval_days": <מספר>,
    "value_propositions_he": ["<2-3 הצעות ערך ספציפיות לשלוח בפולואפ>"],
    "best_contact_time_he": "<מתי לפנות ללקוחות פוטנציאליים>"
  },

  "contentCalendarAgent": {
    "best_platforms": ["<instagram|linkedin|tiktok|facebook|website>"],
    "posting_frequency_he": "<כמה פעמים בשבוע ובאיזה ימים>",
    "content_pillars_he": ["<4-5 נושאי תוכן מרכזיים>"],
    "seasonal_opportunities_he": ["<2-3 הזדמנויות עונתיות קרובות>"]
  },

  "quick_wins_he": ["<3 פעולות שניתן לעשות היום ומייד>"],
  "weekly_focus_he": "<מה להתמקד בו השבוע>"
}`;
}

// ── Build the GPT-4o content prompt ─────────────────────────────────────────
function buildContentPrompt(profile: any, sp: any): string {
  const spBlock = sp ? `
סוג עסק: ${sp.business_type} | ${sp.sector_label_he}
קהל יעד: ${sp.target_audience_he}
טון: ${sp.content_tone}
נושאי תוכן: ${(sp.content_themes_he || []).join(', ')}
` : `קטגוריה: ${profile.category}`;

  return `אתה מומחה לשיווק תוכן ו-copywriting לעסקים קטנים-בינוניים בישראל.
צור ספריית תבניות תוכן מותאמות אישית לעסק הבא.

=== העסק ===
שם: ${profile.name}
עיר: ${profile.city}
${spBlock}
מטרה: ${profile.business_goal || 'צמיחה כללית'}
=== סוף ===

החזר ONLY JSON תקין עם תבניות תוכן ספציפיות לסקטור זה (לא גנריות):
{
  "post_hooks_he": [
    "<5 פתיחות פוסט ויראליות שעובדות בסקטור זה — Hook שמושך ב-3 שניות>"
  ],
  "first_contact_templates_he": {
    "whatsapp": "<תבנית WhatsApp לפנייה ראשונה לליד — עד 60 מילים, עם {שם} ו-{שירות}>",
    "email": "<תבנית מייל קצר לפנייה ראשונה — עד 80 מילים>",
    "linkedin": "<תבנית LinkedIn InMail — עד 70 מילים, טון מקצועי>"
  },
  "review_response_templates_he": {
    "positive": "<תגובה לביקורת חיובית — 2-3 משפטים, אישית ואמיתית>",
    "negative": "<תגובה לביקורת שלילית — 3-4 משפטים, אמפתיה + פתרון>",
    "neutral": "<תגובה לביקורת ניטרלית — 2 משפטים>"
  },
  "retention_message_templates_he": {
    "reactivation": "<הודעת WhatsApp לעידוד לקוח שלא חזר מעל X שבועות>",
    "upsell": "<הודעה להצעת שירות נוסף ללקוח קיים>",
    "referral": "<הודעה לבקשת הפניות מלקוח מרוצה>"
  },
  "seasonal_content_he": [
    "<3 רעיונות תוכן עונתיים ספציפיים לסקטור הזה — עם תאריך/עונה>"
  ],
  "content_calendar_week_he": [
    {"day": "ראשון", "type": "<סוג פוסט>", "topic": "<נושא ספציפי>", "platform": "<instagram|linkedin|etc>"},
    {"day": "שלישי", "type": "<סוג פוסט>", "topic": "<נושא ספציפי>", "platform": "<פלטפורמה>"},
    {"day": "חמישי", "type": "<סוג פוסט>", "topic": "<נושא ספציפי>", "platform": "<פלטפורמה>"}
  ],
  "hashtags": {
    "primary": ["<5 hashtags ראשיים לסקטור — באנגלית>"],
    "local": ["<3 hashtags מקומיים עם שם עיר>"],
    "trending": ["<3 hashtags טרנדיים שרלוונטיים>"]
  }
}`;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateAgentMissions(businessProfileId: string): Promise<any | null> {
  const profile = await prisma.businessProfile.findUnique({ where: { id: businessProfileId } });
  if (!profile) return null;

  const sp = profile.sector_profile ? (() => { try { return JSON.parse(profile.sector_profile!); } catch { return null; } })() : null;

  logger.info(`Generating agent missions for ${businessProfileId} (${profile.name})`);

  // ── Run Claude Sonnet + GPT-4o in parallel ───────────────────────────────
  const [strategicResult, contentResult] = await Promise.allSettled([
    invokeLLM({
      prompt: buildStrategicPrompt(profile, sp),
      model: 'sonnet',
      maxTokens: 2500,
      skipCache: true,
      response_json_schema: { type: 'object' },
    }),
    callGPT4o(buildContentPrompt(profile, sp), 2000),
  ]);

  const strategic = strategicResult.status === 'fulfilled' ? strategicResult.value : null;
  const content   = contentResult.status   === 'fulfilled' ? contentResult.value   : null;

  if (!strategic && !content) {
    logger.warn(`Both LLM calls failed for ${businessProfileId}`);
    return null;
  }

  // ── Merge both layers ──────────────────────────────────────────────────────
  const missions = {
    generated_at:    new Date().toISOString(),
    business_id:     businessProfileId,
    business_name:   profile.name,
    // Strategic layer (Claude Sonnet)
    ...(strategic || {}),
    // Content layer (GPT-4o) — nested under 'content'
    content: content || {},
  };

  // Persist to DB
  await prisma.businessProfile.update({
    where: { id: businessProfileId },
    data:  { agent_missions: JSON.stringify(missions) },
  });

  logger.info(`Agent missions saved for ${businessProfileId}`);
  return missions;
}

/**
 * Read a specific agent's mission section from the stored plan.
 * Returns null if not set yet (agents fall back to their own defaults).
 */
export function getAgentMission<T = any>(
  profile: { agent_missions?: string | null },
  agentName: string,
): T | null {
  if (!profile.agent_missions) return null;
  try {
    const missions = JSON.parse(profile.agent_missions);
    return (missions[agentName] as T) || null;
  } catch {
    return null;
  }
}

/**
 * Returns the full missions object, or null.
 */
export function getAllMissions(profile: { agent_missions?: string | null }): any | null {
  if (!profile.agent_missions) return null;
  try { return JSON.parse(profile.agent_missions); } catch { return null; }
}
