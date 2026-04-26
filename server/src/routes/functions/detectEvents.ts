import { Request, Response } from 'express';
import { prisma } from '../../db';
import { invokeLLM } from '../../lib/llm';
import { writeAutomationLog } from '../../lib/automationLog';
import { loadBusinessContext } from '../../lib/businessContext';
import { tavilySearch, isTavilyRateLimited } from '../../lib/tavily';

// ── Sector opportunity entry ───────────────────────────────────────────────────
// Each event can have multiple sector entries. The first matching entry wins.
interface SectorEntry {
  keywords: string[];   // category keywords — any match triggers this entry
  opportunity: string;  // what this event means for this specific sector
  boost: 'high' | 'medium';
}

// ── Calendar event ─────────────────────────────────────────────────────────────
interface CalendarEvent {
  name: string;
  nameEn: string;
  date: string;         // ISO YYYY-MM-DD
  type: 'holiday' | 'national' | 'cultural' | 'sports' | 'seasonal' | 'commercial';
  leadDays: number;     // how many days before to start alerting
  sectors: SectorEntry[];           // sector-specific opportunities (ordered, first match wins)
  defaultOpportunity: string;       // fallback for any sector not matched above
}

// ── Sector matcher ─────────────────────────────────────────────────────────────
function getSectorContext(
  category: string,
  event: CalendarEvent,
): { boost: 'high' | 'medium' | 'low'; opportunity: string } {
  const lower = category.toLowerCase();
  for (const entry of event.sectors) {
    if (entry.keywords.some(kw => lower.includes(kw) || kw.includes(lower.split(' ')[0]))) {
      return { boost: entry.boost, opportunity: entry.opportunity };
    }
  }
  return { boost: 'low', opportunity: event.defaultOpportunity };
}

// ── Israeli Holiday + Seasonal + Sports Calendar ───────────────────────────────
const CALENDAR_EVENTS: CalendarEvent[] = [

  // ═══════════════════════════════════════════════════════════════
  // JEWISH HOLIDAYS 2025–2026
  // ═══════════════════════════════════════════════════════════════

  {
    name: 'ראש השנה', nameEn: 'Rosh Hashana', date: '2025-09-22',
    type: 'holiday', leadDays: 21,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'קייטרינג', 'food', 'restaurant', 'catering', 'בית קפה', 'cafe'], boost: 'high', opportunity: 'ארוחות חגיגיות, תפריט מיוחד לראש השנה, הזמנות מראש' },
      { keywords: ['מאפייה', 'bakery', 'קונדיטוריה', 'pastry'], boost: 'high', opportunity: 'חלות, עוגות דבש, עוגיות שנה טובה — הביקוש מכפיל את עצמו' },
      { keywords: ['מספרה', 'ספא', 'קוסמטיקה', 'יופי', 'beauty', 'salon', 'spa', 'hair', 'nail'], boost: 'high', opportunity: 'תספורת, צביעה וטיפול לפני החג — לוחות זמנים מלאים שבועיים לפני' },
      { keywords: ['מתנות', 'gift', 'קמעונאות', 'retail', 'חנות', 'shop', 'store', 'אופנה', 'fashion'], boost: 'high', opportunity: 'סלי מתנה, מוצרי חג, מבצעים לרגל השנה החדשה' },
      { keywords: ['ניקיון', 'cleaning', 'שיפוץ', 'renovation', 'contractor', 'קבלן'], boost: 'medium', opportunity: 'ניקיון לפני החג, סידור הבית לקראת האורחים' },
      { keywords: ['מלון', 'hotel', 'תיירות', 'tourism', 'travel', 'טיולים', 'נופש', 'resort'], boost: 'high', opportunity: 'חבילות חג ונסיעות לשנה החדשה — הזמנות נסגרות מוקדם' },
      { keywords: ['כושר', 'fitness', 'gym', 'יוגה', 'yoga', 'פילאטיס'], boost: 'medium', opportunity: 'מנויי "שנה חדשה החלטות" — הזמן הטוב ביותר להצעת חבילות' },
    ],
    defaultOpportunity: 'מבצע מיוחד לכבוד ראש השנה — לקוחות מחפשים שירותים לפני החג',
  },

  {
    name: 'יום כיפור', nameEn: 'Yom Kippur', date: '2025-10-01',
    type: 'holiday', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'catering'], boost: 'high', opportunity: 'ארוחה לפני הצום וסעודה המפסקת — שיא ההכנסות ביום אחד' },
      { keywords: ['אופנה', 'fashion', 'ביגוד', 'clothing', 'קמעונאות', 'retail'], boost: 'medium', opportunity: 'לבוש צנוע ולבן ליום כיפור — ביקוש לפריטים לבנים' },
      { keywords: ['ספורט', 'sports', 'אופניים', 'bicycle', 'bike'], boost: 'high', opportunity: 'יום כיפור = יום האופניים — קדם מכירה של אופניים וציוד' },
    ],
    defaultOpportunity: 'מבצע לפני יום כיפור — ימי הפעילות הנותרים לפני הצום',
  },

  {
    name: 'סוכות', nameEn: 'Sukkot', date: '2025-10-06',
    type: 'holiday', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג'], boost: 'high', opportunity: 'ארוחות בסוכה ואירועי חג — ביקוש גבוה לחוויה חגיגית' },
      { keywords: ['גינון', 'garden', 'עץ', 'wood', 'נגר', 'carpenter', 'בנייה', 'construction'], boost: 'high', opportunity: 'בניית סוכות — שירותי נגרות, בד/סכך, עיצוב סוכה' },
      { keywords: ['קמעונאות', 'retail', 'חנות', 'shop', 'מתנות', 'gift'], boost: 'medium', opportunity: 'ארבעת המינים, קישוטי סוכה, מוצרי חג' },
      { keywords: ['מלון', 'hotel', 'תיירות', 'tourism', 'נופש'], boost: 'high', opportunity: 'חופשות סוכות משפחתיות — שבוע חופש שלם' },
    ],
    defaultOpportunity: 'הזדמנות לחג הסוכות — שבוע חופש עם ביקוש מוגבר',
  },

  {
    name: 'חנוכה', nameEn: 'Hanukkah', date: '2025-12-14',
    type: 'holiday', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'מאפייה', 'bakery', 'קייטרינג'], boost: 'high', opportunity: 'סופגניות, לביבות, ארוחות חגיגיות — 8 ימים של ביקוש' },
      { keywords: ['ילדים', 'children', 'kids', 'חינוך', 'education', 'צעצועים', 'toys'], boost: 'high', opportunity: 'מתנות לילדים לחנוכה — 8 לילות, 8 מתנות' },
      { keywords: ['קמעונאות', 'retail', 'מתנות', 'gift', 'חנות', 'shop', 'אופנה'], boost: 'high', opportunity: 'מבצעי חנוכה ומתנות — עונת המתנות הישראלית' },
      { keywords: ['בידור', 'entertainment', 'אירועים', 'events', 'פנאי'], boost: 'high', opportunity: 'אירועי חנוכה, הדלקות נרות, הופעות — ביקוש גבוה' },
      { keywords: ['מספרה', 'beauty', 'salon', 'יופי', 'קוסמטיקה'], boost: 'medium', opportunity: 'תסרוקות וטיפוח לחגיגות חנוכה' },
    ],
    defaultOpportunity: 'מבצע חנוכה — 8 ימים של קידומי מכירות',
  },

  {
    name: 'פורים', nameEn: 'Purim', date: '2026-03-05',
    type: 'holiday', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'מאפייה', 'bakery'], boost: 'high', opportunity: 'אוזני המן, ארוחות פורים, משלוחי מנות — יום הכי "שמח" בשנה' },
      { keywords: ['תחפושות', 'costume', 'בגדים', 'clothing', 'אופנה', 'fashion', 'קמעונאות', 'retail'], boost: 'high', opportunity: 'תחפושות לפורים — ביקוש עצום 2-3 שבועות לפני' },
      { keywords: ['יופי', 'beauty', 'מספרה', 'makeup', 'איפור', 'salon', 'קוסמטיקה'], boost: 'high', opportunity: 'איפור ועיצוב פורים — פגישות מלאות שבוע לפני' },
      { keywords: ['ילדים', 'children', 'kids', 'חינוך', 'education', 'צעצועים', 'toys'], boost: 'high', opportunity: 'תחפושות ומשחקים לפורים לילדים' },
      { keywords: ['בידור', 'entertainment', 'אירועים', 'events', 'מוזיקה', 'music'], boost: 'high', opportunity: 'מסיבות פורים, הופעות, אירועים — עונת הצ\'ופר' },
      { keywords: ['מתנות', 'gift', 'חנות', 'shop'], boost: 'medium', opportunity: 'משלוחי מנות, סלי מתנה, מוצרי פורים' },
    ],
    defaultOpportunity: 'מבצע פורים — החג הכי שמח בשנה לכל עסק',
  },

  {
    name: 'פסח', nameEn: 'Passover', date: '2026-04-01',
    type: 'holiday', leadDays: 21,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג'], boost: 'high', opportunity: 'תפריט כשר לפסח, ארוחות הסדר, קייטרינג למשפחות גדולות' },
      { keywords: ['ניקיון', 'cleaning'], boost: 'high', opportunity: 'ניקיון פסח — הביקוש הגבוה ביותר בשנה לשירותי ניקיון' },
      { keywords: ['שיפוץ', 'renovation', 'contractor', 'קבלן', 'אינסטלטור', 'חשמלאי'], boost: 'medium', opportunity: 'שיפוצים לפני פסח — בעלי בית מנצלים את החג לשדרוג' },
      { keywords: ['מלון', 'hotel', 'תיירות', 'tourism', 'travel', 'נופש'], boost: 'high', opportunity: 'חבילות פסח — עונת השיא לתיירות פנים ובחו״ל' },
      { keywords: ['קמעונאות', 'retail', 'מתנות', 'gift', 'חנות'], boost: 'high', opportunity: 'מוצרים כשרים לפסח, מתנות לחג, סלי אוכל' },
      { keywords: ['יופי', 'beauty', 'מספרה', 'salon', 'קוסמטיקה', 'spa', 'ספא'], boost: 'high', opportunity: 'טיפוח לפני חג — לקוחות מגיעים לתספורת ומניקור' },
      { keywords: ['כושר', 'fitness', 'gym', 'ספורט', 'sports'], boost: 'medium', opportunity: 'חופשת פסח = מנויי ספורט לחופש — קורסים לילדים ולמבוגרים' },
    ],
    defaultOpportunity: 'מבצע פסח — חג משפחתי גדול עם ביקוש מוגבר לכל שירות',
  },

  {
    name: 'יום העצמאות', nameEn: 'Independence Day', date: '2026-04-22',
    type: 'national', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'catering'], boost: 'high', opportunity: 'מנגל לאומי — ביקוש לשיפודים, סלטים, קייטרינג ליום העצמאות' },
      { keywords: ['בידור', 'entertainment', 'אירועים', 'events', 'מוזיקה', 'music'], boost: 'high', opportunity: 'אירועי יום העצמאות — הפקת חגיגות, הצגות, קונצרטים' },
      { keywords: ['קמעונאות', 'retail', 'ביגוד', 'clothing', 'אופנה', 'fashion'], boost: 'medium', opportunity: 'מוצרים בצבעי כחול-לבן, ביגוד לאומי, מוצרי ישראליות' },
      { keywords: ['תיירות', 'tourism', 'travel', 'מלון', 'hotel'], boost: 'high', opportunity: 'טיולים ביום העצמאות — חבילות לאתרי תיירות ישראלים' },
      { keywords: ['ספורט', 'sports', 'כושר', 'fitness', 'outdoor', 'bicycle', 'אופניים'], boost: 'medium', opportunity: 'אירועי ספורט ביום העצמאות — מרוצי אופניים, ריצות, טיולים' },
    ],
    defaultOpportunity: 'חגיגות יום העצמאות — שיא האווירה הלאומית והצרכנות',
  },

  {
    name: 'ל"ג בעומר', nameEn: "Lag B'Omer", date: '2026-05-17',
    type: 'cultural', leadDays: 10,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'bbq'], boost: 'high', opportunity: 'מדורות, מנגל, אוכל לחוץ — ל"ג בעומר = פסגת עונת הברביקיו' },
      { keywords: ['ילדים', 'children', 'kids', 'חינוך', 'education'], boost: 'high', opportunity: 'אירועי ל"ג בעומר לילדים — חיצים, מדורות, פעילויות שדה' },
      { keywords: ['outdoor', 'ספורט', 'sports', 'כושר', 'fitness'], boost: 'medium', opportunity: 'פעילות חוץ ביום ל"ג בעומר — ציוד לשדה, אביזרי חוץ' },
    ],
    defaultOpportunity: 'ל"ג בעומר — מדורות ואווירת חוץ לכל סקטור',
  },

  {
    name: 'שבועות', nameEn: 'Shavuot', date: '2026-05-21',
    type: 'holiday', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'dairy', 'חלב', 'גבינה'], boost: 'high', opportunity: 'ארוחות חלביות לשבועות — צ\'יזקייק, בלינצ\'ס, מוצרי חלב' },
      { keywords: ['מאפייה', 'bakery', 'קונדיטוריה', 'pastry'], boost: 'high', opportunity: 'עוגות גבינה, קינוחים חלביים לחג' },
      { keywords: ['קמעונאות', 'retail', 'מתנות', 'gift'], boost: 'medium', opportunity: 'מוצרים לחג השבועות — סלי אוכל ומתנות' },
    ],
    defaultOpportunity: 'חג שבועות — ביקוש למוצרים ושירותים חלביים',
  },

  {
    name: 'ראש השנה תשפ"ז', nameEn: 'Rosh Hashana 2026', date: '2026-09-11',
    type: 'holiday', leadDays: 21,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'catering', 'קייטרינג', 'בית קפה', 'cafe'], boost: 'high', opportunity: 'ארוחות חגיגיות, תפריט מיוחד לראש השנה, הזמנות מראש' },
      { keywords: ['מאפייה', 'bakery', 'קונדיטוריה'], boost: 'high', opportunity: 'חלות, עוגות דבש, עוגיות שנה טובה' },
      { keywords: ['מספרה', 'ספא', 'קוסמטיקה', 'יופי', 'beauty', 'salon', 'spa', 'hair', 'nail'], boost: 'high', opportunity: 'תספורת, צביעה וטיפול לפני החג' },
      { keywords: ['מתנות', 'gift', 'קמעונאות', 'retail', 'חנות', 'shop'], boost: 'high', opportunity: 'סלי מתנה, מוצרי חג, מבצעים לרגל השנה החדשה' },
      { keywords: ['ניקיון', 'cleaning', 'שיפוץ', 'renovation', 'contractor', 'קבלן'], boost: 'medium', opportunity: 'ניקיון לפני החג, סידור הבית לקראת האורחים' },
      { keywords: ['מלון', 'hotel', 'תיירות', 'tourism', 'travel', 'נופש'], boost: 'high', opportunity: 'חבילות חג ונסיעות לשנה החדשה — הזמנות נסגרות מוקדם' },
    ],
    defaultOpportunity: 'מבצע מיוחד לכבוד ראש השנה — לקוחות מחפשים שירותים לפני החג',
  },

  // ═══════════════════════════════════════════════════════════════
  // MAJOR SPORTS EVENTS
  // ═══════════════════════════════════════════════════════════════

  {
    name: 'גמר ליגת האלופות 2026', nameEn: 'Champions League Final 2026', date: '2026-05-30',
    type: 'sports', leadDays: 14,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'בר', 'bar', 'פאב', 'pub'], boost: 'high', opportunity: 'צפייה משותפת — הכן מסך גדול, מבצע "ארוחת הגמר", הזמנה מוקדמת' },
      { keywords: ['משלוח', 'delivery', 'wolt', 'שליחות'], boost: 'high', opportunity: 'גל הזמנות משלוח בשעת הגמר — הגדל קיבולת ב-24 שעות לפני' },
      { keywords: ['אלקטרוניקה', 'electronics', 'טלוויזיה', 'tv', 'מסכים', 'screen'], boost: 'high', opportunity: 'מסכים וסאונד לצפייה בגמר — שיא ביקוש לטלוויזיות וסאונד בר' },
      { keywords: ['קמעונאות', 'retail', 'ספורט', 'sports', 'כדורגל', 'football'], boost: 'medium', opportunity: 'ציוד כדורגל, חולצות, מוצרי מאהדים לגמר' },
      { keywords: ['בידור', 'entertainment', 'אירועים', 'events'], boost: 'high', opportunity: 'אירועי צפייה — הפק מסיבת גמר, כרטיסים, מנוי VIP' },
    ],
    defaultOpportunity: 'גמר ליגת האלופות — ביקוש מוגבר לכל עסק בשעות המשחק',
  },

  {
    name: 'מונדיאל 2026', nameEn: 'FIFA World Cup 2026', date: '2026-06-11',
    type: 'sports', leadDays: 21,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'בר', 'bar', 'פאב', 'pub', 'קייטרינג'], boost: 'high', opportunity: 'עונת המונדיאל = חודש של צפייה משותפת — מבצעי "ארוחת משחק" יומיים' },
      { keywords: ['משלוח', 'delivery', 'wolt', 'שליחות'], boost: 'high', opportunity: 'שיא הזמנות משלוח בשעות משחקים — חזק את צי המשלוח' },
      { keywords: ['ספורט', 'sports', 'כדורגל', 'football', 'קמעונאות', 'retail'], boost: 'high', opportunity: 'ציוד, חולצות, מוצרי מאהדים ישראלים — נבחרת ישראל במונדיאל!' },
      { keywords: ['אלקטרוניקה', 'electronics', 'מסכים', 'tv'], boost: 'high', opportunity: 'מסכים 4K לצפייה במונדיאל — שיא ביקוש שנתי' },
      { keywords: ['מלון', 'hotel', 'תיירות', 'tourism', 'travel'], boost: 'high', opportunity: 'חבילות למשחקים בארה"ב — ישראל במונדיאל!' },
    ],
    defaultOpportunity: 'מונדיאל 2026 — ישראל משתתפת! אווירה לאומית שמשפיעה על כל עסק',
  },

  {
    name: 'גמר ליגת העל 2025/26', nameEn: 'Israeli Premier League Championship', date: '2026-05-25',
    type: 'sports', leadDays: 10,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'בר', 'bar', 'פאב', 'pub'], boost: 'high', opportunity: 'גמר ליגת העל — צפייה משותפת, מבצע ארוחת גמר' },
      { keywords: ['ספורט', 'sports', 'כדורגל', 'football'], boost: 'high', opportunity: 'גמר ליגת העל — ציוד, חולצות, מוצרי מאהדים' },
    ],
    defaultOpportunity: 'גמר ליגת העל — ביקוש מוגבר סביב המשחק',
  },

  // ═══════════════════════════════════════════════════════════════
  // SEASONAL & COMMERCIAL EVENTS
  // ═══════════════════════════════════════════════════════════════

  {
    name: 'ולנטיין', nameEn: "Valentine's Day", date: '2026-02-14',
    type: 'commercial', leadDays: 10,
    sectors: [
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'cafe', 'בית קפה'], boost: 'high', opportunity: 'ארוחת ערב רומנטית — הזמנות מוקדמות, תפריט מיוחד זוגי' },
      { keywords: ['מתנות', 'gift', 'פרחים', 'flowers', 'תכשיטים', 'jewelry', 'קמעונאות', 'retail'], boost: 'high', opportunity: 'מתנות לולנטיין — פרחים, תכשיטים, סלי מתנה' },
      { keywords: ['יופי', 'beauty', 'מספרה', 'salon', 'spa', 'ספא', 'קוסמטיקה', 'nail'], boost: 'high', opportunity: 'טיפול ויופי לולנטיין — זוגות מתפנקים, הציע חבילות זוגיות' },
      { keywords: ['מלון', 'hotel', 'נופש', 'resort', 'צימר'], boost: 'high', opportunity: 'חבילות זוגיות לולנטיין — סוויטה רומנטית, ארוחת בוקר' },
      { keywords: ['כושר', 'fitness', 'gym', 'יוגה', 'yoga'], boost: 'medium', opportunity: 'אימון זוגי לולנטיין — מבצע "הבא את הבן/בת זוג בחינם"' },
    ],
    defaultOpportunity: 'יום האהבה — הפוטנציאל הגדול ביותר לקידום זוגות ומתנות',
  },

  {
    name: 'חזרה לבית ספר', nameEn: 'Back to School', date: '2026-09-01',
    type: 'seasonal', leadDays: 21,
    sectors: [
      { keywords: ['חינוך', 'education', 'שיעורים', 'tutor', 'לימוד', 'הדרכה', 'training'], boost: 'high', opportunity: 'שיעורים פרטיים, קורסים — פתיחת שנה = זמן הרישום' },
      { keywords: ['קמעונאות', 'retail', 'חנות', 'shop', 'ציוד', 'supply', 'אופנה', 'fashion', 'ביגוד', 'clothing'], boost: 'high', opportunity: 'ציוד לבית ספר, תיקים, ביגוד אחיד — ביקוש שיא בסוף אוגוסט' },
      { keywords: ['ילדים', 'children', 'kids', 'pediatric'], boost: 'high', opportunity: 'מוצרים ושירותים לילדים — תחילת שנה = הורים קונים הכל' },
      { keywords: ['טכנולוגיה', 'technology', 'מחשבים', 'computers', 'אלקטרוניקה', 'electronics'], boost: 'high', opportunity: 'מחשבים, טאבלטים, אוזניות לבית ספר — שיא הביקוש בספטמבר' },
      { keywords: ['תחבורה', 'transport', 'רכב', 'car', 'אוטו', 'auto', 'אופניים', 'bicycle'], boost: 'medium', opportunity: 'אופניים, קורקינט, תחבורה לבית ספר — ביקוש גבוה' },
    ],
    defaultOpportunity: 'חזרה לבית ספר — תחילת שנה = ביקוש מוגבר לכל שירות',
  },

  {
    name: 'חופש הגדול', nameEn: 'Summer Vacation', date: '2026-07-01',
    type: 'seasonal', leadDays: 21,
    sectors: [
      { keywords: ['מחנות', 'camp', 'ילדים', 'children', 'kids', 'חינוך', 'education', 'בידור', 'entertainment'], boost: 'high', opportunity: 'מחנות קיץ, פעילויות לילדים — הורים מחפשים פתרון ל-8 שבועות' },
      { keywords: ['תיירות', 'tourism', 'travel', 'מלון', 'hotel', 'נופש', 'resort', 'צימר'], boost: 'high', opportunity: 'נסיעות קיץ — עונת השיא לתיירות, הזמנות נסגרות 6 שבועות מראש' },
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קייטרינג', 'ice cream', 'גלידה'], boost: 'high', opportunity: 'גלידה, שתייה, ארוחות קיץ — שיא הצריכה בחודשי החום' },
      { keywords: ['כושר', 'fitness', 'gym', 'ספורט', 'sports', 'שחייה', 'swim', 'outdoor'], boost: 'high', opportunity: 'כרטיסי בריכה, קורסי שחייה, ספורט קיץ — הרשמה לפני הקיץ' },
      { keywords: ['אופנה', 'fashion', 'ביגוד', 'clothing', 'קמעונאות', 'retail'], boost: 'high', opportunity: 'קולקציית קיץ, בגדי ים — שיא המכירות ביוני' },
      { keywords: ['שיפוץ', 'renovation', 'contractor', 'קבלן', 'ניקיון', 'cleaning'], boost: 'medium', opportunity: 'שיפוצי קיץ בזמן שהמשפחה בחופשה — הכי קל לבצע' },
    ],
    defaultOpportunity: 'חופש הגדול — שיא הצריכה הקיצית לכל עסק',
  },

  {
    name: 'עונת החתונות', nameEn: 'Wedding Season', date: '2026-06-01',
    type: 'seasonal', leadDays: 28,
    sectors: [
      { keywords: ['קייטרינג', 'catering', 'מסעדה', 'אוכל', 'food', 'restaurant'], boost: 'high', opportunity: 'קייטרינג לחתונות — עונת השיא מאי עד אוקטובר, הזמן לסגור חוזים' },
      { keywords: ['יופי', 'beauty', 'מספרה', 'salon', 'makeup', 'איפור', 'spa', 'ספא', 'nail', 'קוסמטיקה'], boost: 'high', opportunity: 'שיער ואיפור לחתונות — חד-ייחודי! ספר לשידוכים עם מחיר מיוחד' },
      { keywords: ['צלם', 'photographer', 'וידאו', 'video', 'סרטון', 'film', 'photography'], boost: 'high', opportunity: 'צילום חתונות — השוק הכי תחרותי, הבדל על ידי בידול ברור' },
      { keywords: ['פרחים', 'flowers', 'עיצוב', 'design', 'decor', 'דקור'], boost: 'high', opportunity: 'פרחי חתונה ועיצוב — חתונות = שיא הכנסות לעיצוב פרחוני' },
      { keywords: ['מלון', 'hotel', 'אולם', 'hall', 'venue', 'אירועים', 'events'], boost: 'high', opportunity: 'אולמות ומלונות לחתונות — 70% מהחתונות מאי-אוקטובר' },
      { keywords: ['מוזיקה', 'music', 'דיג\'יי', 'dj', 'band', 'להקה', 'בידור', 'entertainment'], boost: 'high', opportunity: 'מוזיקה לאירועים — DJs ולהקות נסגרות שנה מראש בעונה' },
      { keywords: ['אופנה', 'fashion', 'ביגוד', 'clothing', 'שמלה', 'dress', 'חליפה', 'suit'], boost: 'high', opportunity: 'שמלות כלה, חליפות חתן — עונת החתונות מתחילה 6 חודשים לפני' },
    ],
    defaultOpportunity: 'עונת החתונות (מאי-אוקטובר) — 70% מהחתונות בתקופה זו',
  },

  {
    name: 'בלאק פריידיי', nameEn: 'Black Friday', date: '2026-11-27',
    type: 'commercial', leadDays: 14,
    sectors: [
      { keywords: ['קמעונאות', 'retail', 'חנות', 'shop', 'store', 'אופנה', 'fashion', 'ביגוד', 'clothing', 'מתנות', 'gift'], boost: 'high', opportunity: 'בלאק פריידי — ישראל מאמצת! הגדל מלאי, פרסם 2 שבועות מראש' },
      { keywords: ['אלקטרוניקה', 'electronics', 'מחשבים', 'computers', 'טלפון', 'phone', 'tech', 'טכנולוגיה'], boost: 'high', opportunity: 'מבצעי בלאק פריידי — ירידת מחירים גדולה, לקוחות מחכים לזה' },
      { keywords: ['כושר', 'fitness', 'gym', 'יוגה', 'yoga', 'ספורט', 'sports'], boost: 'high', opportunity: 'מנויים בבלאק פריידי — מוכרים חבילות שנתיות בהנחה' },
      { keywords: ['מסעדה', 'אוכל', 'food', 'restaurant', 'קפה', 'cafe'], boost: 'medium', opportunity: 'מבצע "בלאק פריידי" על ארוחות או כרטיסי מתנה' },
    ],
    defaultOpportunity: 'בלאק פריידי — צרכני ישראל מצפים למבצעים, הנוכחות הדיגיטלית קריטית',
  },

  {
    name: 'ינואר — עונת ה"החלטות"', nameEn: 'New Year Resolutions', date: '2026-01-01',
    type: 'commercial', leadDays: 14,
    sectors: [
      { keywords: ['כושר', 'fitness', 'gym', 'יוגה', 'yoga', 'פילאטיס', 'pilates', 'ספורט', 'sports'], boost: 'high', opportunity: 'ינואר = שיא ההרשמות — "החלטות השנה החדשה" מגדילות מנויים ב-40%' },
      { keywords: ['תזונה', 'nutrition', 'דיאטה', 'diet', 'בריאות', 'health', 'wellness'], boost: 'high', opportunity: 'תוכניות דיאטה וניהול משקל — ינואר הוא החודש הכי בוער' },
      { keywords: ['חינוך', 'education', 'קורסים', 'courses', 'הדרכה', 'training', 'לימוד'], boost: 'high', opportunity: 'קורסים ולימודים חדשים — ינואר = זמן פתיחת קורסים' },
      { keywords: ['יופי', 'beauty', 'מספרה', 'salon', 'spa', 'ספא', 'קוסמטיקה'], boost: 'medium', opportunity: '"מראה חדש לשנה חדשה" — לקוחות מחפשים שינוי חזותי' },
      { keywords: ['שיפוץ', 'renovation', 'contractor', 'קבלן', 'עיצוב', 'design', 'interior'], boost: 'medium', opportunity: '"בית חדש לשנה חדשה" — פתיחת שנה = שיפוץ' },
    ],
    defaultOpportunity: 'ינואר — החלטות השנה החדשה מניעות ביקוש לכל שירות שיפור עצמי',
  },

  {
    name: 'עונת השיפוצים — פתיחת אביב', nameEn: 'Spring Renovation Season', date: '2026-04-15',
    type: 'seasonal', leadDays: 21,
    sectors: [
      { keywords: ['שיפוץ', 'renovation', 'contractor', 'קבלן', 'בנייה', 'construction', 'חשמלאי', 'electrician', 'אינסטלטור', 'plumber', 'נגר', 'carpenter'], boost: 'high', opportunity: 'פתיחת עונת השיפוצים — אפריל עד יוני הם החודשים הכי עמוסים, סגור עבודות עכשיו' },
      { keywords: ['גינון', 'garden', 'landscaping', 'צמחים', 'plants', 'עציצים'], boost: 'high', opportunity: 'גינון אביבי — לקוחות מחפשים שדרוג לגינה לפני הקיץ' },
      { keywords: ['ניקיון', 'cleaning'], boost: 'high', opportunity: 'ניקיון אביבי — spring cleaning, שטיפת חלונות, ניקיון עמוק' },
      { keywords: ['עיצוב', 'design', 'interior', 'פנים', 'דקור', 'decor'], boost: 'high', opportunity: 'עיצוב פנים לאביב — לקוחות רוצים "מראה חדש" לפני הקיץ' },
      { keywords: ['ריהוט', 'furniture', 'קמעונאות', 'retail', 'חנות', 'shop'], boost: 'medium', opportunity: 'ריהוט גן ומרפסת לפני הקיץ — עונת הקנייה' },
    ],
    defaultOpportunity: 'אביב — עונת השדרוגים, הניקיון והשיפוץ',
  },
];

// ── Build sector-aware Tavily queries for dynamic event detection ───────────────
function buildEventTavilyQueries(category: string, city: string): string[] {
  const lower = category.toLowerCase();
  const month = new Date().toLocaleDateString('he-IL', { month: 'long' });
  const nextMonth = new Date(Date.now() + 30 * 24 * 3600000).toLocaleDateString('he-IL', { month: 'long' });

  const queries: string[] = [
    // Universal: always search for local events
    `אירועים ${city} ${month} ${nextMonth}`,
  ];

  // Sector-specific dynamic queries
  if (['מסעדה', 'אוכל', 'food', 'restaurant', 'בר', 'bar', 'פאב'].some(k => lower.includes(k))) {
    queries.push(`ליגת האלופות Champions League Europa League ספורט בינלאומי ${month} גמר תאריך`);
    queries.push(`ליגת העל ישראל ${city} משחק ${month}`);
  }
  if (['יופי', 'beauty', 'מספרה', 'salon', 'spa'].some(k => lower.includes(k))) {
    queries.push(`תצוגת אופנה כנס יופי מופע ${city} ${month} ${nextMonth}`);
  }
  if (['ספורט', 'sports', 'כושר', 'fitness', 'gym'].some(k => lower.includes(k))) {
    queries.push(`תחרות ספורט מרוץ אירוע ${city} ${month} ${nextMonth}`);
    queries.push(`Champions League מונדיאל ספורט בינלאומי ${month}`);
  }
  if (['בידור', 'entertainment', 'מוזיקה', 'music', 'אירועים'].some(k => lower.includes(k))) {
    queries.push(`הופעות קונצרט פסטיבל ${city} ${month} ${nextMonth}`);
  }
  if (['ילדים', 'children', 'kids', 'חינוך', 'education'].some(k => lower.includes(k))) {
    queries.push(`ירידים פסטיבלים ילדים משפחות ${city} ${month} ${nextMonth}`);
  }
  if (['מלון', 'hotel', 'תיירות', 'tourism', 'travel'].some(k => lower.includes(k))) {
    queries.push(`כנס תערוכה אירוע עסקי ${city} ${month} ${nextMonth}`);
  }

  // Always include a general cultural/festival search
  queries.push(`פסטיבל תערוכה הופעה ${city} ${nextMonth}`);

  // Deduplicate and limit to 4 queries max (Tavily credit conservation)
  return [...new Set(queries)].slice(0, 4);
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
    const windowEnd = new Date(now.getTime() + 28 * 24 * 3600000);

    // ── Phase 0: Dismiss stale event alerts whose date has passed ─────────────
    // Finds market_opportunity alerts where the description contains a date like "DD.MM.YYYY"
    // and that date is in the past.
    try {
      const openEventAlerts = await prisma.proactiveAlert.findMany({
        where: {
          linked_business: businessProfileId,
          is_dismissed: false,
          alert_type: 'market_opportunity',
        },
        select: { id: true, description: true },
      });

      const staleIds: string[] = [];
      for (const alert of openEventAlerts) {
        const desc = alert.description || '';
        const m = desc.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (m) {
          const eventDate = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
          if (eventDate < now) staleIds.push(alert.id);
        }
      }

      if (staleIds.length > 0) {
        await prisma.proactiveAlert.updateMany({
          where: { id: { in: staleIds } },
          data: { is_dismissed: true },
        });
        console.log(`[detectEvents] dismissed ${staleIds.length} past-event alerts`);
      }
    } catch (_) {}

    // ── Phase 1: Find upcoming calendar events ────────────────────────────────
    const upcomingEvents = CALENDAR_EVENTS.filter(ev => {
      const eventDate = new Date(ev.date);
      const alertDate = new Date(ev.date);
      alertDate.setDate(alertDate.getDate() - ev.leadDays);
      return eventDate >= now && eventDate <= windowEnd && now >= alertDate;
    });

    // ── Phase 2: Tavily search — sector-aware queries ─────────────────────────
    let tavilyRawEvents: any[] = [];
    if (!isTavilyRateLimited()) {
      const queries = buildEventTavilyQueries(category || '', city);
      const results = await Promise.all(
        queries.map(q => isTavilyRateLimited() ? Promise.resolve([]) : tavilySearch(q, 3))
      );
      const seenUrls = new Set<string>();
      tavilyRawEvents = results.flat().filter(r => {
        if (!r.url || seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        return true;
      });
    }

    // ── Phase 3: LLM extraction of Tavily events ──────────────────────────────
    let extraEvents: any[] = [];
    if (tavilyRawEvents.length > 0) {
      const context = tavilyRawEvents.slice(0, 12)
        .map(r => `[${r.url}] ${r.title || ''}: ${(r.content || '').slice(0, 160)}`)
        .join('\n\n');

      try {
        const analysis: any = await invokeLLM({
          model: 'haiku',
          prompt: `זהה אירועים ממשיים בטקסט שיכולים להשפיע על עסק "${name}" (${category}, ${city}) בחודש הקרוב.

${context.slice(0, 3000)}

החזר JSON:
{
  "events": [{
    "name": "שם האירוע בעברית",
    "date_estimate": "YYYY-MM-DD או 'סוף מאי 2026'",
    "type": "sports|concert|festival|fair|conference|cultural|commercial",
    "relevance": "high|medium|low",
    "audience_size": "large|medium|small",
    "opportunity": "ההזדמנות הספציפית לעסק זה (${category}) — עד 10 מילים"
  }]
}
כלול רק אירועים עם תאריך ממשי. ללא תאריך — דלג. אם אין — החזר {"events":[]}`,
          response_json_schema: { type: 'object' },
        });
        extraEvents = (analysis?.events || []).filter(
          (e: any) => e.relevance !== 'low' && e.name && e.date_estimate
        );
      } catch (_) {}
    }

    // ── Phase 4: Deduplication ────────────────────────────────────────────────
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

    // ── Phase 5: Create alerts for calendar events ────────────────────────────
    for (const event of upcomingEvents) {
      const sectorCtx = getSectorContext(category || '', event);

      // Skip if this event has very low relevance for this sector
      // (but still create a low-priority alert if it's a major holiday/sports event)
      const isHighValue = event.type === 'sports' || event.type === 'holiday' || event.type === 'national';
      if (sectorCtx.boost === 'low' && !isHighValue) continue;

      const daysAway = Math.ceil((new Date(event.date).getTime() - now.getTime()) / 86400000);
      const icon = event.type === 'sports' ? '⚽' : event.type === 'commercial' ? '🛍' : event.type === 'seasonal' ? '🌿' : '📅';
      const alertTitle = `${icon} ${event.name} — בעוד ${daysAway} ימים`;

      if (existingTitles.has(alertTitle) || existingSignalNames.has(event.name)) continue;

      // LLM generates business-specific CTA using sector opportunity as context
      let prefilledText = '';
      let suggestedAction = `נצל את ${event.name} לקידום ${category}`;

      try {
        const [ctaRes, actionRes] = await Promise.all([
          invokeLLM({
            prompt: `כתוב פוסט שיווקי קצר בעברית (2-3 שורות) לעסק "${name}" (${category} ב${city}) לרגל "${event.name}".

הזדמנות ספציפית לסקטור זה: ${sectorCtx.opportunity}
${event.type === 'sports' ? 'אירוע ספורט — חשוב על הצופים, האווירה, ההזמנות המוגברות.' : ''}
${event.type === 'seasonal' ? 'אירוע עונתי — כוון לצורך העונתי הספציפי.' : ''}
סגנון: ${toneInstruction}.
כתוב רק את טקסט הפוסט.`,
          }),
          invokeLLM({
            prompt: `עסק: "${name}" (${category}). אירוע: "${event.name}" בעוד ${daysAway} ימים.
הזדמנות: ${sectorCtx.opportunity}
פעולה אחת ספציפית עכשיו — עד 8 מילים.`,
          }),
        ]);
        prefilledText = typeof ctaRes === 'string' ? ctaRes.trim() : '';
        suggestedAction = typeof actionRes === 'string' ? actionRes.trim() : suggestedAction;
      } catch (_) {
        prefilledText = `${event.name} מתקרב! ${sectorCtx.opportunity}. ${name} ב${city} מכין מבצעים מיוחדים.`;
      }

      const urgencyHours = daysAway <= 7 ? 24 : daysAway <= 14 ? 72 : 168;
      const priority = sectorCtx.boost === 'high' || daysAway <= 10 ? 'high' : 'medium';

      const actionMeta = JSON.stringify({
        action_label: suggestedAction.split(' ').slice(0, 5).join(' '),
        action_type: 'social_post',
        prefilled_text: prefilledText,
        urgency_hours: urgencyHours,
        impact_reason: `${event.name} — ${sectorCtx.opportunity}`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: alertTitle,
          description: `${event.name} בתאריך ${new Date(event.date).toLocaleDateString('he-IL')} (בעוד ${daysAway} ימים).\n${sectorCtx.opportunity}`,
          suggested_action: suggestedAction,
          priority,
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
          impact_level: sectorCtx.boost === 'high' ? 'high' : 'medium',
          recommended_action: suggestedAction,
          confidence: event.type === 'holiday' || event.type === 'sports' ? 95 : 80,
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

    // ── Phase 6: Create alerts for Tavily-discovered events ───────────────────
    for (const event of extraEvents.slice(0, 3)) {
      if (!event.name || existingSignalNames.has(event.name)) continue;

      const icon = event.type === 'sports' ? '⚽' : event.type === 'concert' ? '🎵' : '🎯';
      const alertTitle = `${icon} ${event.name} — הזדמנות עסקית`;
      if (existingTitles.has(alertTitle)) continue;

      let prefilledText = '';
      try {
        const ctaRes = await invokeLLM({
          prompt: `כתוב פוסט שיווקי קצר (2 שורות) לעסק "${name}" (${category} ב${city}) לרגל "${event.name}".
הזדמנות: ${event.opportunity || 'אירוע מקומי'}.
${event.type === 'sports' ? 'אירוע ספורט — כוון לצופים ולאווירה.' : ''}
${event.type === 'concert' ? 'הופעה — כוון לקהל שמגיע לאזור.' : ''}
סגנון: ${toneInstruction}. כתוב רק את הטקסט.`,
        });
        prefilledText = typeof ctaRes === 'string' ? ctaRes.trim() : '';
      } catch (_) {}

      const isLarge = event.audience_size === 'large';
      const actionMeta = JSON.stringify({
        action_label: `נצל את ${event.name}`.split(' ').slice(0, 5).join(' '),
        action_type: 'social_post',
        prefilled_text: prefilledText || `${event.name} בקרוב! ${event.opportunity || ''} — ${name}`,
        urgency_hours: isLarge ? 48 : 72,
        impact_reason: `${event.name} צפוי להביא תנועה מוגברת לאזור ${city}`,
      });

      await prisma.proactiveAlert.create({
        data: {
          alert_type: 'market_opportunity',
          title: alertTitle,
          description: `${event.name} — ${event.opportunity || 'אירוע עם פוטנציאל לעסק'}. תאריך: ${event.date_estimate || 'בקרוב'}`,
          suggested_action: `הכן תוכן/מבצע לרגל ${event.name}`,
          priority: isLarge ? 'high' : 'medium',
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
          impact_level: isLarge ? 'high' : 'medium',
          recommended_action: event.opportunity || `נצל את ${event.name}`,
          confidence: 65,
          source_signals: 'tavily_search',
          source_description: JSON.stringify({
            action_label: `נצל את ${event.name}`,
            action_type: 'social_post',
            prefilled_text: prefilledText || '',
            time_minutes: 10,
            urgency_hours: isLarge ? 48 : 72,
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

    await writeAutomationLog('detectEvents', businessProfileId, startTime, created);
    console.log(`detectEvents done: ${created} alerts | sector: ${category} | calendar: ${upcomingEvents.length} | tavily: ${extraEvents.length}`);
    return res.json({
      sector: category,
      calendar_events: upcomingEvents.length,
      tavily_events: extraEvents.length,
      signals_created: created,
    });
  } catch (err: any) {
    console.error('[detectEvents] error:', err.message);
    await writeAutomationLog('detectEvents', businessProfileId, startTime, 0, 'failed', err.message);
    return res.status(500).json({ error: err.message });
  }
}
