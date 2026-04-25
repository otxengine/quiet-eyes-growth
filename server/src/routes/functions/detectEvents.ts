import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

// ── Event calendar entry ───────────────────────────────────────────────────────
interface CalendarEvent {
  name: string;
  nameEn: string;
  date: string;       // ISO YYYY-MM-DD of the event start
  type: 'holiday' | 'national' | 'cultural' | 'sports' | 'concert';
  businessBoost: string; // CSV of category keywords that benefit most
  leadDays: number;   // how many days before to start alerting
}

// ── Israeli Holiday Calendar ──────────────────────────────────────────────────
// Fixed dates for 2025–2027. All dates are the holiday start (erev).
const ISRAELI_HOLIDAYS: CalendarEvent[] = [
  // 2025
  { name: 'ראש השנה', nameEn: 'Rosh Hashana', date: '2025-09-22', type: 'holiday', businessBoost: 'restaurant,food,bakery,gift,retail,beauty,fashion,catering', leadDays: 21 },
  { name: 'יום כיפור', nameEn: 'Yom Kippur', date: '2025-10-01', type: 'holiday', businessBoost: 'restaurant,food,fashion,retail,clothing', leadDays: 14 },
  { name: 'סוכות', nameEn: 'Sukkot', date: '2025-10-06', type: 'holiday', businessBoost: 'restaurant,food,construction,garden,retail,catering', leadDays: 14 },
  { name: 'חנוכה', nameEn: 'Hanukkah', date: '2025-12-14', type: 'holiday', businessBoost: 'restaurant,food,retail,gift,children,education,entertainment,bakery', leadDays: 14 },
  // 2026
  { name: 'טו בשבט', nameEn: "Tu B'Shvat", date: '2026-02-13', type: 'cultural', businessBoost: 'restaurant,food,garden,nature,education', leadDays: 10 },
  { name: 'פורים', nameEn: 'Purim', date: '2026-03-05', type: 'holiday', businessBoost: 'restaurant,food,costume,entertainment,children,event,beauty,bakery', leadDays: 14 },
  { name: 'פסח', nameEn: 'Passover', date: '2026-04-01', type: 'holiday', businessBoost: 'restaurant,food,hotel,travel,tourism,retail,cleaning,beauty,catering', leadDays: 21 },
  { name: 'יום הזיכרון', nameEn: 'Memorial Day', date: '2026-04-29', type: 'national', businessBoost: 'restaurant,food,event,culture', leadDays: 7 },
  { name: 'יום העצמאות', nameEn: 'Independence Day', date: '2026-04-30', type: 'national', businessBoost: 'restaurant,food,bbq,entertainment,retail,tourism,event,catering,delivery', leadDays: 14 },
  { name: 'ל"ג בעומר', nameEn: "Lag B'Omer", date: '2026-05-17', type: 'cultural', businessBoost: 'food,bbq,outdoor,event,children,catering', leadDays: 10 },
  { name: 'שבועות', nameEn: 'Shavuot', date: '2026-05-21', type: 'holiday', businessBoost: 'restaurant,food,dairy,bakery,retail,catering', leadDays: 14 },
  { name: 'ראש השנה', nameEn: 'Rosh Hashana', date: '2026-09-11', type: 'holiday', businessBoost: 'restaurant,food,bakery,gift,retail,beauty,fashion,catering', leadDays: 21 },
  { name: 'יום כיפור', nameEn: 'Yom Kippur', date: '2026-09-20', type: 'holiday', businessBoost: 'restaurant,food,fashion,retail,clothing', leadDays: 14 },
  { name: 'סוכות', nameEn: 'Sukkot', date: '2026-09-25', type: 'holiday', businessBoost: 'restaurant,food,construction,garden,retail,catering', leadDays: 14 },
];

// ── Major Sports & Entertainment Events ───────────────────────────────────────
// International and Israeli sports/concert events with known dates.
const MAJOR_EVENTS: CalendarEvent[] = [
  // Football — UEFA 2026
  { name: 'גמר ליגת האלופות 2026', nameEn: 'Champions League Final 2026', date: '2026-05-30', type: 'sports', businessBoost: 'restaurant,food,bar,pub,entertainment,delivery,catering,bbq,retail', leadDays: 14 },
  { name: 'גמר הליגה האירופאית 2026', nameEn: 'Europa League Final 2026', date: '2026-05-20', type: 'sports', businessBoost: 'restaurant,food,bar,pub,entertainment,delivery', leadDays: 10 },
  // Israeli Premier League — championship round May 2026
  { name: 'גמר ליגת העל 2025/26', nameEn: 'Israeli Premier League Championship 2026', date: '2026-05-25', type: 'sports', businessBoost: 'restaurant,food,bar,pub,entertainment,delivery,retail', leadDays: 10 },
  // FIFA World Cup 2026 (USA/Canada/Mexico) — Israel participating, kicks off mid-June
  { name: 'מונדיאל 2026', nameEn: 'FIFA World Cup 2026', date: '2026-06-11', type: 'sports', businessBoost: 'restaurant,food,bar,pub,entertainment,delivery,retail,gift,catering,bbq', leadDays: 21 },
  // Israeli national team qualifying matches (estimate — update when schedule is confirmed)
  { name: 'משחק נבחרת ישראל — ליגת האומות', nameEn: 'Israel National Team — Nations League', date: '2026-03-24', type: 'sports', businessBoost: 'restaurant,food,bar,pub,delivery,entertainment', leadDays: 7 },
];

// ── Business-category boost matching ──────────────────────────────────────────
function getBusinessBoostLevel(category: string, boostCategories: string): 'high' | 'medium' | 'low' {
  const cat = category.toLowerCase();
  const boosts = boostCategories.toLowerCase().split(',').map(b => b.trim());

  // Direct keyword match
  if (boosts.some(b => cat.includes(b) || b.includes(cat))) return 'high';

  // Hebrew category → English keyword mapping
  const hebrewMap: Record<string, string[]> = {
    'מסעדה': ['restaurant', 'food', 'bbq', 'dairy', 'catering'],
    'אוכל': ['restaurant', 'food', 'bbq', 'catering'],
    'קייטרינג': ['catering', 'restaurant', 'food'],
    'מאפייה': ['bakery', 'food'],
    'בר': ['bar', 'pub', 'entertainment'],
    'פאב': ['bar', 'pub', 'entertainment'],
    'שיפוץ': ['construction', 'cleaning', 'garden'],
    'בנייה': ['construction'],
    'קבלן': ['construction', 'cleaning'],
    'משלוח': ['delivery'],
    'ספורט': ['sports', 'outdoor'],
    'ילדים': ['children', 'education'],
    'יופי': ['beauty'],
    'אופנה': ['fashion', 'clothing', 'retail'],
    'מתנות': ['gift', 'retail'],
    'תיירות': ['travel', 'tourism', 'hotel'],
    'בידור': ['entertainment', 'event'],
    'אירועים': ['event', 'catering', 'entertainment'],
  };

  for (const [heb, engKeywords] of Object.entries(hebrewMap)) {
    if (cat.includes(heb) && boosts.some(b => engKeywords.includes(b))) return 'high';
  }

  return 'medium';
}

// ── Core agent ────────────────────────────────────────────────────────────────
export async function detectEvents(req: Request, res: Response) {
  const { businessProfileId } = req.body;
  if (!businessProfileId) return res.status(400).json({ error: 'Missing businessProfileId' });

  const startTime = new Date().toISOString();
  try {
    const profile = await prisma.businessProfile.findFirst({ where: { id: businessProfileId } });
    if (!profile) return res.status(404).json({ error: 'No business profile' });

    const { name, category, city } = profile;

    const bizCtx = await loadBusinessContext(businessProfileId);
    const tone = bizCtx?.preferredTone || profile.tone_preference || 'professional';
    const toneInstruction = tone === 'casual' ? 'קליל וחברותי' : tone === 'warm' ? 'חם ואנושי' : 'מקצועי ואמין';

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 28 * 24 * 3600000); // 28 days from now

    // ── Phase 1: Merge holiday + sports calendars and filter upcoming ──────────
    const ALL_CALENDAR_EVENTS = [...ISRAELI_HOLIDAYS, ...MAJOR_EVENTS];

    const allRelevantEvents = ALL_CALENDAR_EVENTS.filter(h => {
      const eventDate = new Date(h.date);
      const alertDate = new Date(h.date);
      alertDate.setDate(alertDate.getDate() - h.leadDays);
      // Include if: holiday is upcoming (within 28 days) AND we are past the alert trigger date
      return eventDate >= now && eventDate <= windowEnd && now >= alertDate;
    });

    // ── Phase 2: Tavily search for dynamic events ─────────────────────────────
    // 4 targeted queries: sports (intl), sports (local), concerts, festivals
    let tavilyEvents: any[] = [];
    if (!isTavilyRateLimited()) {
      const currentMonth = new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
      const nextMonth = new Date(Date.now() + 30 * 24 * 3600000).toLocaleDateString('he-IL', { month: 'long' });

      const queries = [
        `Champions League Europa League ספורט בינלאומי ${currentMonth} תאריך`,
        `ליגת העל ישראל משחק ${city} ${currentMonth}`,
        `הופעות קונצרט ${city} ${currentMonth} ${nextMonth}`,
        `פסטיבל אירוע ${city} ${nextMonth}`,
      ];

      const results = await Promise.all(
        queries.map(q => isTavilyRateLimited() ? Promise.resolve([]) : tavilySearch(q, 3))
      );
      const seenUrls = new Set<string>();
      tavilyEvents = results.flat().filter(r => {
        if (!r.url || seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        return true;
      });
    }

    // ── Phase 3: LLM analysis of Tavily results ───────────────────────────────
    let extraEvents: any[] = [];
    if (tavilyEvents.length > 0) {
      const context = tavilyEvents.slice(0, 12)
        .map(r => `[${r.url}] ${r.title || ''}: ${(r.content || '').slice(0, 180)}`)
        .join('\n\n');

      try {
        const analysis: any = await invokeLLM({
          model: 'haiku',
          prompt: `זהה אירועי ספורט, הופעות ואירועים מקומיים בטקסט שיכולים להשפיע על העסק "${name}" (${category}, ${city}) בחודש הקרוב.

${context.slice(0, 3000)}

החזר JSON:
{
  "events": [{
    "name": "שם האירוע בעברית",
    "date_estimate": "YYYY-MM-DD או תיאור כמו 'סוף מאי 2026'",
    "type": "sports|concert|festival|fair|conference|cultural",
    "relevance": "high|medium|low",
    "audience_size": "large|medium|small",
    "opportunity": "הזדמנות לעסק — עד 8 מילים"
  }]
}
כלול רק אירועים ממשיים עם תאריך. אירועים ללא תאריך ברור — דלג. אם אין — החזר {"events":[]}`,
          response_json_schema: { type: 'object' },
        });
        extraEvents = (analysis?.events || []).filter(
          (e: any) => e.relevance !== 'low' && e.name
        );
      } catch (_) {}
    }

    // ── Phase 4: Deduplicate against existing alerts ──────────────────────────
    const existingAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, alert_type: 'market_opportunity' },
      select: { title: true },
    });
    const existingTitles = new Set(existingAlerts.map(a => a.title));

    const existingSignals = await prisma.marketSignal.findMany({
      where: {
        linked_business: businessProfileId,
        category: 'event',
        detected_at: { gte: new Date(Date.now() - 20 * 24 * 3600000).toISOString() },
      },
      select: { summary: true },
    });
    const existingSignalNames = new Set(existingSignals.map(s => s.summary));

    let created = 0;

    // ── Phase 5: Process calendar events (holidays + major sports) ────────────
    for (const event of allRelevantEvents) {
      const boostLevel = getBusinessBoostLevel(category, event.businessBoost);
      const daysAway = Math.ceil((new Date(event.date).getTime() - now.getTime()) / 86400000);
      const alertTitle = `${event.type === 'sports' ? '⚽' : '📅'} ${event.name} — בעוד ${daysAway} ימים`;

      if (existingTitles.has(alertTitle) || existingSignalNames.has(event.name)) continue;

      // LLM generates business-specific CTA + prefilled social post
      let prefilledText = '';
      let suggestedAction = `הכן מבצע ל${event.name}`;

      try {
        const [ctaResult, actionResult] = await Promise.all([
          invokeLLM({
            prompt: `כתוב פוסט שיווקי קצר בעברית (2-3 שורות) לעסק "${name}" (${category} ב${city}) לרגל "${event.name}" שמגיע בעוד ${daysAway} ימים.
סגנון: ${toneInstruction}.
${event.type === 'sports' ? `זהו אירוע ספורט — חשוב על מבצע שמתאים למאהדים/צופים, למשל: אוכל לפני המשחק, מסך גדול, הזמנה מראש.` : ''}
כתוב רק את טקסט הפוסט/ההודעה בלבד.`,
          }),
          invokeLLM({
            prompt: `עסק: "${name}" (${category}). אירוע: "${event.name}" בעוד ${daysAway} ימים.
${event.type === 'sports' ? 'אירוע ספורט — חשוב כיצד העסק יכול להרוויח מהאווירה, הצופים, ההזמנות המוגברות.' : ''}
פעולה אחת ספציפית שהעסק צריך לעשות עכשיו. תשובה: פועל + 5 מילים מקסימום.`,
          }),
        ]);
        prefilledText = typeof ctaResult === 'string' ? ctaResult.trim() : '';
        suggestedAction = typeof actionResult === 'string' ? actionResult.trim() : suggestedAction;
      } catch (_) {
        prefilledText = event.type === 'sports'
          ? `${event.name} מתקרב! ${name} מזמינה אתכם לחגוג עם ${category} מיוחד. הזמינו מראש >>>>`
          : `${event.name} בעוד ${daysAway} ימים! ${name} ב${city} מכינה בשבילכם מבצעים מיוחדים.`;
      }

      const urgencyHours = daysAway <= 7 ? 24 : daysAway <= 14 ? 72 : 168;

      const actionMeta = JSON.stringify({
        action_label: suggestedAction.split(' ').slice(0, 5).join(' '),
        action_type: 'social_post',
        prefilled_text: prefilledText,
        urgency_hours: urgencyHours,
        impact_reason: `${event.name} צפוי להגדיל ביקוש — עסקים שמקדמים ${daysAway} ימים מראש מגדילים הכנסות ב20-40%`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: alertTitle,
          description: `${event.name} בתאריך ${new Date(event.date).toLocaleDateString('he-IL')}. ${boostLevel === 'high' ? 'אירוע זה משמעותי מאוד לעסק שלך.' : 'הזדמנות לנצל את האירוע.'}`,
          suggested_action: suggestedAction,
          priority: boostLevel === 'high' || daysAway <= 10 ? 'high' : 'medium',
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      await prisma.marketSignal.create({
        data: {
          summary: `${event.name} — ${daysAway} ימים`,
          category: 'event',
          impact_level: boostLevel === 'high' ? 'high' : 'medium',
          recommended_action: suggestedAction,
          confidence: event.type === 'sports' || event.type === 'holiday' ? 95 : 80,
          source_signals: 'event_calendar',
          source_description: JSON.stringify({
            action_label: suggestedAction.split(' ').slice(0, 5).join(' '),
            action_type: 'social_post',
            prefilled_text: prefilledText,
            time_minutes: 10,
            urgency_hours: urgencyHours,
          }),
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      existingTitles.add(alertTitle);
      existingSignalNames.add(event.name);
      created++;
    }

    // ── Phase 6: Process Tavily-discovered events ─────────────────────────────
    for (const event of extraEvents.slice(0, 4)) {
      if (!event.name || existingSignalNames.has(event.name)) continue;

      const eventAlertTitle = `${event.type === 'sports' ? '⚽' : '🎯'} ${event.name} — הזדמנות עסקית`;
      if (existingTitles.has(eventAlertTitle)) continue;

      let prefilledText = '';
      try {
        const ctaResult = await invokeLLM({
          prompt: `כתוב פוסט שיווקי קצר (2 שורות) לעסק "${name}" (${category} ב${city}) לרגל "${event.name}".
${event.type === 'sports' ? 'אירוע ספורט — חשוב על קהל הצופים, האווירה.' : ''}
סגנון: ${toneInstruction}. כתוב רק את הטקסט.`,
        });
        prefilledText = typeof ctaResult === 'string' ? ctaResult.trim() : '';
      } catch (_) {}

      const isLargeEvent = event.audience_size === 'large';
      const actionMeta = JSON.stringify({
        action_label: `נצל את ${event.name}`.split(' ').slice(0, 5).join(' '),
        action_type: 'social_post',
        prefilled_text: prefilledText || `${event.name} בקרוב! ${event.opportunity || ''} — ${name}`,
        urgency_hours: isLargeEvent ? 48 : 72,
        impact_reason: `${event.name} צפוי להביא תנועה מוגברת לאזור ${city}`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: eventAlertTitle,
          description: `${event.name} — ${event.opportunity || 'אירוע עם פוטנציאל לעסק'}. תאריך: ${event.date_estimate || 'בקרוב'}`,
          suggested_action: `הכן מבצע/תוכן לרגל ${event.name}`,
          priority: isLargeEvent ? 'high' : 'medium',
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      await prisma.marketSignal.create({
        data: {
          summary: event.name,
          category: 'event',
          impact_level: isLargeEvent ? 'high' : 'medium',
          recommended_action: event.opportunity || `נצל את ${event.name}`,
          confidence: 65,
          source_signals: 'tavily_search',
          source_description: JSON.stringify({
            action_label: `נצל את ${event.name}`,
            action_type: 'social_post',
            prefilled_text: prefilledText || '',
            time_minutes: 10,
            urgency_hours: isLargeEvent ? 48 : 72,
          }),
          is_read: false,
          detected_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      existingTitles.add(eventAlertTitle);
      existingSignalNames.add(event.name);
      created++;
    }

    await writeAutomationLog('detectEvents', businessProfileId, startTime, created);
    console.log(`detectEvents done: ${created} alerts (${allRelevantEvents.length} calendar, ${extraEvents.length} tavily)`);
    return res.json({
      calendar_events: allRelevantEvents.length,
      tavily_events: extraEvents.length,
      signals_created: created,
    });
  } catch (err: any) {
    console.error('[detectEvents] error:', err.message);
    await writeAutomationLog('detectEvents', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
