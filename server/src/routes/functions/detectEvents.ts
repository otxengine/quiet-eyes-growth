import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

// ── Israeli Holiday Calendar ──────────────────────────────────────────────────
// Fixed dates for 2025–2027. Add future years here when needed.
// All dates are the EVE (erev) — the business action window starts 7–21 days before.
const ISRAELI_HOLIDAYS: Array<{
  name: string;
  nameEn: string;
  date: string;       // ISO YYYY-MM-DD of the holiday start
  type: 'holiday' | 'national' | 'cultural';
  businessBoost: string; // which business categories benefit most
  leadDays: number;   // how many days before to alert
}> = [
  // 2025
  { name: 'ראש השנה', nameEn: 'Rosh Hashana', date: '2025-09-22', type: 'holiday', businessBoost: 'restaurant,food,bakery,gift,retail,beauty,fashion', leadDays: 21 },
  { name: 'יום כיפור', nameEn: 'Yom Kippur', date: '2025-10-01', type: 'holiday', businessBoost: 'restaurant,food,fashion,retail,clothing', leadDays: 14 },
  { name: 'סוכות', nameEn: 'Sukkot', date: '2025-10-06', type: 'holiday', businessBoost: 'restaurant,food,construction,garden,retail', leadDays: 14 },
  { name: 'חנוכה', nameEn: 'Hanukkah', date: '2025-12-14', type: 'holiday', businessBoost: 'restaurant,food,retail,gift,children,education,entertainment', leadDays: 14 },
  // 2026
  { name: 'טו בשבט', nameEn: "Tu B'Shvat", date: '2026-02-13', type: 'cultural', businessBoost: 'restaurant,food,garden,nature,education', leadDays: 10 },
  { name: 'פורים', nameEn: 'Purim', date: '2026-03-05', type: 'holiday', businessBoost: 'restaurant,food,costume,entertainment,children,event,beauty', leadDays: 14 },
  { name: 'פסח', nameEn: 'Passover', date: '2026-04-01', type: 'holiday', businessBoost: 'restaurant,food,hotel,travel,tourism,retail,cleaning,beauty', leadDays: 21 },
  { name: 'יום הזיכרון', nameEn: 'Memorial Day', date: '2026-04-29', type: 'national', businessBoost: 'restaurant,food,event,culture', leadDays: 7 },
  { name: 'יום העצמאות', nameEn: 'Independence Day', date: '2026-04-30', type: 'national', businessBoost: 'restaurant,food,bbq,entertainment,retail,tourism,event', leadDays: 14 },
  { name: 'ל"ג בעומר', nameEn: "Lag B'Omer", date: '2026-05-17', type: 'cultural', businessBoost: 'food,bbq,outdoor,event,children', leadDays: 10 },
  { name: 'שבועות', nameEn: 'Shavuot', date: '2026-05-21', type: 'holiday', businessBoost: 'restaurant,food,dairy,bakery,retail', leadDays: 14 },
  { name: 'ראש השנה', nameEn: 'Rosh Hashana', date: '2026-09-11', type: 'holiday', businessBoost: 'restaurant,food,bakery,gift,retail,beauty,fashion', leadDays: 21 },
  { name: 'יום כיפור', nameEn: 'Yom Kippur', date: '2026-09-20', type: 'holiday', businessBoost: 'restaurant,food,fashion,retail,clothing', leadDays: 14 },
  { name: 'סוכות', nameEn: 'Sukkot', date: '2026-09-25', type: 'holiday', businessBoost: 'restaurant,food,construction,garden,retail', leadDays: 14 },
];

// ── Business-category action templates ───────────────────────────────────────
function getBusinessBoostLevel(category: string, boostCategories: string): 'high' | 'medium' | 'low' {
  const cat = category.toLowerCase();
  const boosts = boostCategories.toLowerCase().split(',');
  if (boosts.some(b => cat.includes(b) || b.includes(cat))) return 'high';
  // Broad match
  if (cat.includes('אוכל') || cat.includes('מסעדה') || cat.includes('קייטרינג')) {
    if (boosts.some(b => ['restaurant', 'food', 'bakery', 'bbq', 'dairy'].includes(b))) return 'high';
  }
  if (cat.includes('שיפוץ') || cat.includes('בנייה') || cat.includes('קבלן')) {
    if (boosts.some(b => ['construction', 'cleaning', 'garden'].includes(b))) return 'high';
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
    const windowStart = new Date(now.getTime() + 7 * 24 * 3600000);   // 7 days from now
    const windowEnd   = new Date(now.getTime() + 28 * 24 * 3600000);  // 28 days from now

    // ── Phase 1: Check fixed Israeli holiday calendar ─────────────────────────
    const upcomingHolidays = ISRAELI_HOLIDAYS.filter(h => {
      const holidayDate = new Date(h.date);
      const alertDate   = new Date(h.date);
      alertDate.setDate(alertDate.getDate() - h.leadDays);
      // Alert if: today is within the lead window AND holiday is in next 28 days
      return holidayDate >= windowStart && holidayDate <= windowEnd && now >= alertDate;
    });

    // Also include holidays where we're still within lead window even if past windowStart
    const allRelevantHolidays = ISRAELI_HOLIDAYS.filter(h => {
      const holidayDate = new Date(h.date);
      const alertDate   = new Date(h.date);
      alertDate.setDate(alertDate.getDate() - h.leadDays);
      return holidayDate >= now && holidayDate <= windowEnd && now >= alertDate;
    });

    // ── Phase 2: Tavily search for sports/local events ────────────────────────
    let tavilyEvents: any[] = [];
    if (!isTavilyRateLimited()) {
      const sportQuery = `אירועי ספורט ${city} ישראל חודש הבא`;
      const localQuery = `פסטיבל אירוע ${city} ${new Date().toLocaleDateString('he-IL', { month: 'long' })}`;
      const [sportResults, localResults] = await Promise.all([
        tavilySearch(sportQuery, 4),
        tavilySearch(localQuery, 4),
      ]);
      const combinedResults = [...sportResults, ...localResults];
      const seenUrls = new Set<string>();
      tavilyEvents = combinedResults.filter(r => {
        if (!r.url || seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        return true;
      });
    }

    // ── Phase 3: LLM analysis of Tavily results for additional events ─────────
    let extraEvents: any[] = [];
    if (tavilyEvents.length > 0) {
      const context = tavilyEvents.slice(0, 10)
        .map(r => `[${r.url}] ${r.title || ''}: ${(r.content || '').slice(0, 200)}`)
        .join('\n\n');

      try {
        const analysis: any = await invokeLLM({
          model: 'haiku',
          prompt: `זהה אירועי ספורט ואירועים מקומיים בטקסט הבא שעשויים להשפיע על עסק "${name}" (${category}, ${city}) בחודש הקרוב.

${context.slice(0, 2500)}

החזר JSON:
{
  "events": [{
    "name": "שם האירוע בעברית",
    "date_estimate": "YYYY-MM-DD או תיאור",
    "type": "sports|festival|fair|conference|cultural",
    "relevance": "high|medium|low",
    "opportunity": "הזדמנות לעסק — עד 10 מילים"
  }]
}
כלול רק אירועים עם תאריך ממשי. אם אין אירועים ממשיים — החזר {"events":[]}`,
          response_json_schema: { type: 'object' },
        });
        extraEvents = (analysis?.events || []).filter((e: any) => e.relevance !== 'low');
      } catch (_) {}
    }

    // ── Phase 4: Generate alerts ──────────────────────────────────────────────
    const existingAlerts = await prisma.proactiveAlert.findMany({
      where: { linked_business: businessProfileId, is_dismissed: false, alert_type: 'market_opportunity' },
      select: { title: true },
    });
    const existingTitles = new Set(existingAlerts.map(a => a.title));

    const existingSignals = await prisma.marketSignal.findMany({
      where: { linked_business: businessProfileId, category: 'event' },
      select: { summary: true },
    });
    const existingSignalNames = new Set(existingSignals.map(s => s.summary));

    let created = 0;

    // Process holidays
    for (const holiday of allRelevantHolidays) {
      const boostLevel = getBusinessBoostLevel(category, holiday.businessBoost);
      const alertTitle = `🗓 ${holiday.name} בעוד ${Math.ceil((new Date(holiday.date).getTime() - now.getTime()) / 86400000)} ימים`;

      if (existingTitles.has(alertTitle) || existingSignalNames.has(holiday.name)) continue;

      // Generate business-specific CTA with LLM
      let prefilledText = '';
      let suggestedAction = '';
      try {
        const ctaResult = await invokeLLM({
          prompt: `כתוב הצעה שיווקית קצרה בעברית (2-3 שורות) לעסק "${name}" (${category} ב${city}) לרגל ${holiday.name}.
סגנון: ${toneInstruction}.
כלול: מה להציע ללקוחות, איך לנצל את החג/אירוע להגדלת המכירות.
כתוב רק את טקסט הפוסט/ההודעה, מתאים לשיתוף בוואטסאפ או אינסטגרם.`,
        });
        prefilledText = typeof ctaResult === 'string' ? ctaResult.trim() : '';

        const actionResult = await invokeLLM({
          prompt: `עסק: "${name}" (${category}). חג/אירוע: ${holiday.name} בעוד ${Math.ceil((new Date(holiday.date).getTime() - now.getTime()) / 86400000)} ימים.
פעולה אחת ספציפית שהעסק צריך לעשות עכשיו כדי לנצל את ה${holiday.name}. תשובה: פועל + 4 מילים מקסימום.`,
        });
        suggestedAction = typeof actionResult === 'string' ? actionResult.trim() : `הכן מבצע ל${holiday.name}`;
      } catch (_) {
        prefilledText = `🎉 ${holiday.name} מתקרב! הזמינו מראש ונהנו מהצעות מיוחדות. ${name} ב${city}.`;
        suggestedAction = `הכן מבצע ל${holiday.name}`;
      }

      const daysAway = Math.ceil((new Date(holiday.date).getTime() - now.getTime()) / 86400000);
      const urgencyHours = daysAway <= 10 ? 48 : daysAway <= 14 ? 72 : 168;

      const actionMeta = JSON.stringify({
        action_label: suggestedAction.split(' ').slice(0, 4).join(' '),
        action_type: 'social_post',
        prefilled_text: prefilledText,
        urgency_hours: urgencyHours,
        impact_reason: `${holiday.name} צפוי להגדיל ביקוש בענף ${category} ב${city} — עסקים שמתכוננים מראש מרוויחים פי 2-3 יותר`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: alertTitle,
          description: `${holiday.name} בתאריך ${new Date(holiday.date).toLocaleDateString('he-IL')}. ${boostLevel === 'high' ? 'אירוע זה משמעותי מאוד לעסק שלך.' : 'הזדמנות לנצל את האירוע.'}`,
          suggested_action: suggestedAction,
          priority: boostLevel === 'high' ? 'high' : 'medium',
          source_agent: actionMeta,
          is_dismissed: false,
          is_acted_on: false,
          created_at: new Date().toISOString(),
          linked_business: businessProfileId,
        },
      }).catch(() => {});

      // Also create MarketSignal for the Intelligence page
      if (!existingSignalNames.has(holiday.name)) {
        await prisma.marketSignal.create({
          data: {
            summary: `${holiday.name} — ${daysAway} ימים`,
            category: 'event',
            impact_level: boostLevel === 'high' ? 'high' : 'medium',
            recommended_action: suggestedAction,
            confidence: 95,
            source_signals: 'israeli_holiday_calendar',
            source_description: JSON.stringify({
              action_label: suggestedAction.split(' ').slice(0, 4).join(' '),
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
        existingSignalNames.add(holiday.name);
      }

      existingTitles.add(alertTitle);
      created++;
    }

    // Process Tavily-discovered events
    for (const event of extraEvents.slice(0, 3)) {
      if (!event.name || existingSignalNames.has(event.name)) continue;

      let prefilledText = '';
      try {
        const ctaResult = await invokeLLM({
          prompt: `כתוב הודעת שיווק קצרה בעברית (2 שורות) לעסק "${name}" (${category} ב${city}) לרגל "${event.name}".
ציין: מה להציע, למה זה רלוונטי לאירוע. סגנון: ${toneInstruction}.`,
        });
        prefilledText = typeof ctaResult === 'string' ? ctaResult.trim() : '';
      } catch (_) {}

      const eventAlertTitle = `🎯 ${event.name} — הזדמנות עסקית`;
      if (existingTitles.has(eventAlertTitle)) continue;

      const actionMeta = JSON.stringify({
        action_label: `נצל את ${event.name}`,
        action_type: 'social_post',
        prefilled_text: prefilledText || `קורה בקרוב: ${event.name}! ${event.opportunity || ''} — ${name}`,
        urgency_hours: 72,
        impact_reason: `${event.name} צפוי להביא תנועה מוגברת לאזור ${city}`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: eventAlertTitle,
          description: `${event.name} — ${event.opportunity || 'אירוע מקומי עם פוטנציאל לעסק'}. תאריך: ${event.date_estimate || 'בקרוב'}`,
          suggested_action: `הכן מבצע/תוכן לרגל ${event.name}`,
          priority: event.relevance === 'high' ? 'high' : 'medium',
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
          impact_level: event.relevance === 'high' ? 'high' : 'medium',
          recommended_action: event.opportunity || `נצל את ${event.name}`,
          confidence: 65,
          source_signals: 'tavily_search',
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
    console.log(`detectEvents done: ${created} alerts created (${allRelevantHolidays.length} holidays, ${extraEvents.length} local events)`);
    return res.json({ events_found: allRelevantHolidays.length + extraEvents.length, signals_created: created });
  } catch (err: any) {
    console.error('[detectEvents] error:', err.message);
    await writeAutomationLog('detectEvents', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
