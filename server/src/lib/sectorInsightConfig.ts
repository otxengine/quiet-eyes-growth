/**
 * sectorInsightConfig — per-sector alert priorities, seasonal triggers,
 * and few-shot examples injected into generateProactiveAlerts.
 *
 * Each sector defines:
 *  - topAlertTypes: ordered list of most valuable alert types for this sector
 *  - seasonalTriggers: month-based opportunities (0=Jan)
 *  - quickWinTriggers: data conditions that ALWAYS warrant an alert
 *  - fewShotExamples: 2 concrete examples of high-quality insights for this sector
 *  - israeliCalendarHooks: Israeli events that create business opportunities
 */

interface SectorInsightConfig {
  topAlertTypes: string[];
  seasonalTriggers: Record<number, string>;   // month (0-11) → trigger description
  quickWinTriggers: string[];
  fewShotExamples: Array<{ title: string; description: string; action: string; type: string }>;
  israeliCalendarHooks: string[];
}

const SECTOR_INSIGHT_MAP: Record<string, SectorInsightConfig> = {
  restaurant: {
    topAlertTypes: ['demand_gap', 'negative_review', 'competitor_move', 'content_opportunity', 'retention_risk'],
    seasonalTriggers: {
      0: 'ינואר — עונת דיאטות/בריאות. קדם תפריט בריא/קל',
      2: 'פסח מתקרב — קדם תפריט כשר לפסח ואפשרויות קייטרינג',
      3: 'אפריל/מאי — עונת בר מצוות ואירועים. קדם חבילות קייטרינג',
      5: 'יוני — ימי הולדת קיץ, חתונות. קדם הזמנות לאירועים',
      8: 'ספטמבר — ראש השנה. קדם ארוחות חג, קייטרינג משפחתי',
      10: 'נובמבר — חנוכה מתקרב. קדם מבצעים לחנוכה',
      11: 'דצמבר — חגים. קדם ארוחות חג ומבצעי סוף שנה',
    },
    quickWinTriggers: [
      'אם יש ביקורת שלילית על מנה ספציפית — כתוב תגובה שמאזכרת את המנה בשמה ומציעה תיקון',
      'אם יש ליד שמחפש קייטרינג ומחכה מעל 24 שעות — שלח הצעת מחיר מיידית',
      'אם סוף שבוע מתקרב (ש-ו) ואין פוסט — צור תוכן ל-"ארוחת שבת"',
      'אם מתחרה פתח ביקורת שלילית — זו הזדמנות לפרסם ביקורות חיוביות שלך',
    ],
    fewShotExamples: [
      {
        type: 'negative_review',
        title: 'ביקורת שלילית מ-דנה כ. על המתנה ארוכה',
        description: 'דנה השאירה 2 כוכבים לפני 3 שעות: "המתנה של 40 דקות לא קבילה". 2 ביקורות דומות החודש.',
        action: 'הגב ישירות: "דנה, אנחנו מתנצלים על ההמתנה. זה לא הסטנדרט שלנו. אנחנו שמחים להציע ארוחה חינמית בביקור הבא כפיצוי. ניצור איתך קשר."',
      },
      {
        type: 'content_opportunity',
        title: 'ערב שישי — אין פוסט שבועי',
        description: 'לא פורסם תוכן מאז שלושה ימים. שישי = פיק תנועה לחיפוש מסעדות לשבת.',
        action: 'פרסם Reel קצר של הכנת המנה המיוחדת לשבת עם הטקסט: "כבר הזמנתם מקום לשבת? 🕯️ מקומות מוגבלים — הזמינו בלינק"',
      },
    ],
    israeliCalendarHooks: [
      'ערב שישי → המלצה: פוסט "ארוחת שבת" + הזמנת מקומות',
      'ערב יום כיפור → המלצה: קידום ארוחה לאחר הצום',
      'ערב פסח → המלצה: "תפריט כשר לפסח מוכן!" + קייטרינג',
      'ל"ג בעומר → המלצה: קידום ארוחות/מנגל משפחתי',
    ],
  },

  beauty: {
    topAlertTypes: ['hot_lead', 'retention_risk', 'content_opportunity', 'demand_gap', 'competitor_move'],
    seasonalTriggers: {
      1: 'פורים מתקרב — קדם איפור לפורים, תחפושות, חבילות',
      2: 'מרץ — עונת חתונות מתחילה. קדם איפור כלה + חבילות בנות לוויה',
      3: 'פסח — לקוחות מחפשות להיראות מיוחדות לחג',
      4: 'מאי — יום האם. קדם שובר מתנה, חבילת ספא',
      5: 'יוני — תחילת קיץ. קדם טיפולי שיזוף, עור קיצי',
      8: 'ספטמבר — עונת חגים. עיצוב שיער לראש השנה',
      11: 'דצמבר — ניו יר. קדם מנוי שנתי + חבילת טיפוחים',
    },
    quickWinTriggers: [
      'אם יש ליד חם שלא קיבל מענה ב-6 שעות — ייתכן שהלך למתחרה. פנה עכשיו',
      'אם חג ישראלי עוד פחות מ-7 ימים — קדם "מקומות אחרונים לפני החג"',
      'אם לקוחה ביקרה לפני 6 שבועות ולא חזרה — שלח תזכורת אישית',
      'אם מתחרה מציע מבצע — צור מבצע נגדי עם ערך מוסף שונה (לא רק מחיר)',
    ],
    fewShotExamples: [
      {
        type: 'retention_risk',
        title: '3 לקוחות לא חזרו מעל 7 שבועות',
        description: 'מיכל ר., שרה ל. ורותם ב. — כולן ביקרו בתדירות חודשית, לא שמענו מהן 7+ שבועות.',
        action: 'שלח WhatsApp אישי: "היי מיכל! זה הרבה זמן 💕 יש לנו מקום פנוי השבוע — מה קורה? מגיע לך פינוק קטן!"',
      },
      {
        type: 'content_opportunity',
        title: 'פורים בעוד 10 ימים — אין תוכן על כך',
        description: 'פורים הוא פיק הביקוש לשירותי יופי. מתחרה כבר פרסמה פוסט על "איפור פורים". ',
        action: 'פרסם Reel: "5 לוקים לפורים שאפשר להגיע אלינו ✨ תורים נגמרים מהר — הזמינו עכשיו 📲"',
      },
    ],
    israeliCalendarHooks: [
      'פורים (שבועיים לפני) → "תורי איפור לפורים מתמלאים — הזמינו עכשיו"',
      'יום האם → "מתנה מושלמת לאמא — חבילת ספא במחיר מיוחד"',
      'ראש השנה → "תיראי מדהים בחגים — תורים אחרונים"',
      'חתונות/אירועים → "מחפשת איפור לאירוע? נשמח לעזור"',
    ],
  },

  fitness: {
    topAlertTypes: ['demand_gap', 'hot_lead', 'retention_risk', 'content_opportunity', 'competitor_move'],
    seasonalTriggers: {
      0: 'ינואר — פיק הגדול בשנה. "שנה חדשה, גוף חדש". קדם מנויים אגרסיבית',
      1: 'פברואר — ירידה ראשונה בלידים. קדם "אל תוותר — ראה תוצאות"',
      5: 'יוני — קיץ מתקרב. קדם "גוף לקיץ" + מנוי קיץ',
      8: 'ספטמבר — חזרה לשגרה אחרי קיץ. גל חדש של מצטרפים',
      10: 'נובמבר — לפני חגים. "תישאר בפורמה בחגים"',
    },
    quickWinTriggers: [
      'אם ליד מחפש "הרזיה/חיטוב" ולא קיבל מענה ב-3 שעות — ייתכן שנרשם במתחרה',
      'אם ינואר ופחות מ-X לידים — זו אנומליה, בדוק אם הקמפיין פעיל',
      'אם חבר הגיע לפני 30 יום ולא בא מאז — שלח הודעת עידוד',
      'אם יש ביקורת שמזכירה "יוקר" — התייחס למחיר בתגובה עם הוכחת ערך',
    ],
    fewShotExamples: [
      {
        type: 'hot_lead',
        title: '5 לידים לא ענו להם מעל 8 שעות — בסיכון גבוה',
        description: 'יוסי מ., מיה ר., ועוד 3 — כולם מחפשים "חדר כושר בתל אביב". ממוצע מענה מתחרה: 2 שעות.',
        action: 'שלח WhatsApp: "שלום יוסי! ראינו שהתעניינת באימונים 💪 יש לנו שבוע ניסיון חינמי השבוע — מתי תרצה להגיע?"',
      },
      {
        type: 'content_opportunity',
        title: 'ינואר — אין מסע לקוח "לפני ואחרי"',
        description: 'ינואר הוא החודש הכי ויראלי לתוכן כושר. 3 חודשים בלי פוסט "תוצאות אמיתיות".',
        action: 'בקש מ-2 חברים מרוצים תמונות לפני-אחרי. פרסם עם: "90 יום. תוצאות אמיתיות. הסיפור של [שם]... ומה קורה כשמתחייבים 🔥"',
      },
    ],
    israeliCalendarHooks: [
      'ינואר → "שנה חדשה, גוף חדש — שבוע ניסיון חינמי"',
      'לפני קיץ (מאי-יוני) → "גוף לקיץ — מתחילים עכשיו"',
      'ספטמבר → "חזרה לשגרה — מצטרפים לקבוצה"',
    ],
  },

  legal: {
    topAlertTypes: ['hot_lead', 'content_opportunity', 'demand_gap', 'negative_review'],
    seasonalTriggers: {
      0: 'ינואר — תחילת שנה, חידוש חוזים. קדם בדיקת חוזים עסקיים',
      8: 'ספטמבר — שנת עסקים חדשה. פנייה לעסקים לגבי חוזים שנתיים',
    },
    quickWinTriggers: [
      'אם ליד לא ענה לו ב-24 שעות — עו"ד מאבדים לידים מהר מאוד',
      'אם יש ביקורת שלילית — נדיר בסקטור, חשוב מאוד לטפל',
    ],
    fewShotExamples: [
      {
        type: 'hot_lead',
        title: 'ליד חדש: "עזרה בחוזה שכירות" — לא ענו 12 שעות',
        description: 'אורי ד. פנה בנושא "חוזה שכירות מסחרי". לידים משפטיים בממוצע ממתינים 4-6 שעות לפני שפונים לעורך דין אחר.',
        action: 'חזור לאורי מייד: "שלום אורי, קיבלנו את פנייתך לגבי חוזה השכירות. אנחנו מתמחים בתחום זה — מתי נוח לשיחה קצרה?"',
      },
      {
        type: 'content_opportunity',
        title: 'LinkedIn — שבועיים בלי פוסט מידעי',
        description: 'עורכי דין שמפרסמים תוכן חינוכי ב-LinkedIn מקבלים 40% יותר לידים אורגניים.',
        action: 'כתוב פוסט: "5 סעיפים שכל שוכר מסחרי חייב לבדוק בחוזה לפני שחותם [חינם]"',
      },
    ],
    israeliCalendarHooks: [
      'תחילת שנה עסקית → "האם החוזים השנתיים שלכם מעודכנים?"',
      'אחרי חגים → "חוזים שצריך לחדש לאחר הפסקת הקיץ"',
    ],
  },

  medical: {
    topAlertTypes: ['hot_lead', 'negative_review', 'retention_risk', 'content_opportunity'],
    seasonalTriggers: {
      0: 'ינואר — עונת שפעת, כאבים. קדם תורים מהירים',
      4: 'מאי — אביב, אלרגיות. תוכן על טיפולי אלרגיה',
      8: 'ספטמבר — חזרה לבית ספר, חיסונים. קדם תורים לילדים',
    },
    quickWinTriggers: [
      'אם ליד מחפש "טיפול דחוף/כאב" — עונה בתוך שעה',
      'אם ביקורת שלילית — השפעה על אמינות, חייב תגובה מקצועית תוך שעתיים',
    ],
    fewShotExamples: [
      {
        type: 'negative_review',
        title: 'ביקורת שלילית על "המתנה ארוכה לתור"',
        description: 'ד.כ. כתב 2 כוכבים: "חיכיתי שעה מעבר לזמן שנקבע". רפיטישן ביקורת: 3 בחודש על אותו נושא.',
        action: 'הגב מקצועית: "ד.כ., אנחנו מצטערים על ההמתנה הבלתי סבירה. שיפרנו את מערכת הזימון. נשמח לתאם תור שיתכבד בזמן מובטח."',
      },
      {
        type: 'content_opportunity',
        title: 'עונת אלרגיות — אין תוכן מניעתי',
        description: 'אפריל/מאי — פיק בחיפושים על "טיפול לאלרגיה". מתחרים פרסמו 3 פוסטים על כך.',
        action: 'פרסם: "5 דברים שאלרגיית אביב עושה לגוף — ומה ניתן לעשות 🌸 [הסבר + קישור לתור]"',
      },
    ],
    israeliCalendarHooks: [
      'ספטמבר → "חיסונים לשפעת לפני החגים — קבע תור עכשיו"',
      'ינואר → "ממה סובלים בחורף? תורים פתוחים"',
    ],
  },

  retail: {
    topAlertTypes: ['demand_gap', 'competitor_move', 'content_opportunity', 'hot_lead'],
    seasonalTriggers: {
      0: 'ינואר — סייל חורף. קדם מבצעים על מלאי',
      4: 'מאי — יום האם. קדם מתנות + שוברים',
      6: 'יולי — קיץ, מבצעי קיץ',
      10: 'נובמבר — Black Friday ישראלי, חנוכה',
      11: 'דצמבר — שנה חדשה, מתנות',
    },
    quickWinTriggers: [
      'אם מתחרה הוריד מחיר — הגב עם ערך מוסף, לא רק מחיר',
      'אם מוצר ספציפי נמכר הרבה ביקורות — קדם אותו עם ביקורת לקוח',
      'אם יש מלאי שלא נמכר — צור "מבצע שבועי" ממוקד',
    ],
    fewShotExamples: [
      {
        type: 'competitor_move',
        title: 'מתחרה השיקה "מבצע 20% + משלוח חינמי"',
        description: 'Zara מקומית פרסמה מבצע על כל הפריטים. זוהה בסריקת אותות שוק לפני שעה.',
        action: 'פרסם תגובה: "אצלנו לא רק מחיר — כל קנייה מגיעה עם [ייחוד ספציפי שלך]. השבוע בלבד: [מבצע נגדי]. קנה עכשיו →"',
      },
      {
        type: 'content_opportunity',
        title: 'יום האם בעוד 5 ימים — אין תוכן',
        description: 'יום האם הוא אחד מ-3 פיקי הרכישה בשנה. אין פרסום בנושא.',
        action: 'פרסם Stories + פוסט: "מחפשים מתנה מושלמת לאמא? 🌸 [תמונת המוצרים הנמכרים] — משלוח מובטח עד יום האם"',
      },
    ],
    israeliCalendarHooks: [
      'יום האם → "מתנות לאמא — מגוון ומשלוח מהיר"',
      'חנוכה → "מתנות חנוכה — קנו מוקדם, חסכו בדמי משלוח"',
      'Black Friday → "מחירים ישראליים — לא צריך לחכות"',
    ],
  },

  cleaning: {
    topAlertTypes: ['demand_gap', 'hot_lead', 'content_opportunity', 'retention_risk'],
    seasonalTriggers: {
      2: 'מרץ — ניקיון פסח. הפיק הגדול בשנה לניקיון',
      8: 'ספטמבר — ניקיון לחגים, חזרה מקיץ',
      11: 'דצמבר — ניקיון לשנה חדשה',
    },
    quickWinTriggers: [
      'ניקיון פסח — אם פחות מ-3 שבועות לפסח ואין פרסום, זה דחוף',
      'אם יש ליד "ניקיון לאחר שיפוץ" — לרוב דחוף, ענה תוך שעה',
    ],
    fewShotExamples: [
      {
        type: 'demand_gap',
        title: '3 שבועות לפסח — ביקוש לניקיון פסח טרם טופל',
        description: 'זוהו 12 חיפושים על "ניקיון פסח" באזור. לוח היומן עוד ריק לפסח.',
        action: 'פרסם מיידית: "ניקיון פסח מקצועי 🧹 עוד מקומות אחרונים לפני החג — הזמינו עכשיו לפני שנגמר!"',
      },
      {
        type: 'content_opportunity',
        title: 'CleanTok — לא פרסמת ב-TikTok 3 שבועות',
        description: '#cleantok מגיע ל-50B+ צפיות. ניקיון הוא אחד הסגמנטים הכי ויראליים ב-TikTok.',
        action: 'צלם 30 שניות של "ניקיון ASMR" — ניקוי פינה קשה. אין צורך בעריכה מיוחדת. כיתוב: "כשלקוחה אומרת תודה 🙏 #cleantok"',
      },
    ],
    israeliCalendarHooks: [
      '3 שבועות לפסח → "ניקיון פסח מקצועי — הזמינו לפני שנגמר"',
      'אחרי החגים → "חזרת מהחגים? הבית ממתין לניקיון עמוק"',
    ],
  },

  education: {
    topAlertTypes: ['hot_lead', 'demand_gap', 'content_opportunity', 'retention_risk'],
    seasonalTriggers: {
      0: 'ינואר — מחצית שנייה מתחילה. תלמידים מחפשים שיעורים פרטיים',
      4: 'מאי — לפני הבגרויות. הפיק הגדול בשנה',
      8: 'ספטמבר — שנת לימודים חדשה. גל רישומים',
      10: 'נובמבר — בחינות מועד א. קדם "הכנה לבחינה"',
    },
    quickWinTriggers: [
      'מאי/יוני = בגרויות — כל ליד "שיעורים פרטיים" הוא דחוף מאוד',
      'ספטמבר = חזרה ללימודים — הציע חינם שיעור ניסיון',
    ],
    fewShotExamples: [
      {
        type: 'hot_lead',
        title: '4 לידים לפני הבגרויות — לא ענו להם',
        description: 'נועה, גיל, מיה ועמית פנו לגבי "הכנה לבגרות מתמטיקה". בגרות עוד 3 שבועות.',
        action: 'שלח מייד: "שלום נועה! ראינו שאת מחפשת עזרה במתמטיקה לפני הבגרות. יש לנו מקום אחרון — נתחיל השבוע. מתי נוח?"',
      },
      {
        type: 'demand_gap',
        title: 'ספטמבר — עלייה בחיפושים "שיעורים פרטיים" באזורך',
        description: 'זוהו 25 חיפושים "שיעורים פרטיים [עיר]" בשבוע. פחות ממחצית מבוקש מכוסה ע"י ספקים.',
        action: 'פרסם: "שנת לימודים חדשה! 📚 שיעורי ניסיון חינמיים השבוע — X מקומות נשארו. הרשמה [לינק]"',
      },
    ],
    israeliCalendarHooks: [
      'ספטמבר → "חזרה ללימודים — הרשמה לשיעורים פרטיים נפתחת"',
      'מאי → "בגרויות — עוד לא מאוחר לשיפור"',
    ],
  },

  auto: {
    topAlertTypes: ['demand_gap', 'hot_lead', 'content_opportunity', 'competitor_move'],
    seasonalTriggers: {
      2: 'מרץ/אפריל — החלפת צמיגי חורף לקיץ',
      9: 'אוקטובר — החלפת צמיגי קיץ לחורף',
      5: 'יוני — בדיקות רכב לפני קיץ/חופשות',
    },
    quickWinTriggers: [
      'ליד "טסט שנתי" — תמיד דחוף, תאריך הטסט קבוע',
      'חורף = עונת גשמים = עונת צמיגים — הצע המרה',
    ],
    fewShotExamples: [
      {
        type: 'demand_gap',
        title: 'עונת החלפת צמיגים — אין פרסום',
        description: 'אוקטובר מתחיל. עונת החלפת צמיגים לחורף. מתחרה כבר פרסם מבצע.',
        action: 'פרסם: "הגשם מגיע 🌧️ החלפת צמיגים לחורף — עד סוף השבוע ב-[מחיר]. תאמו תור עכשיו"',
      },
      {
        type: 'content_opportunity',
        title: 'TikTok — 3 שבועות בלי תוכן טיפ רכב',
        description: 'טיפים על רכב מגיעים ל-200K-1M צפיות ב-TikTok. הפורמט הוכח.',
        action: 'צלם 30 שניות: "הסימן הזה על לוח המכוונים שרוב הנהגים מתעלמים ממנו... ❗" — פשוט, מהיר, ויראלי',
      },
    ],
    israeliCalendarHooks: [
      'לפני פסח (נסיעות) → "רכב מוכן לנסיעה ארוכה? בדיקה חינמית"',
      'אוקטובר → "עונת גשמים מגיעה — האם הצמיגים שלך מוכנים?"',
    ],
  },
};

const DEFAULT_CONFIG: SectorInsightConfig = {
  topAlertTypes: ['hot_lead', 'negative_review', 'opportunity', 'content_opportunity', 'demand_gap'],
  seasonalTriggers: {},
  quickWinTriggers: [
    'אם ליד לא ענה לו ב-24 שעות — זמן פנייה חוזרת',
    'אם ביקורת שלילית — תגובה תוך 2 שעות',
  ],
  fewShotExamples: [
    {
      type: 'hot_lead',
      title: 'ליד חם לא קיבל מענה ב-X שעות',
      description: 'לקוח פנה לגבי שירות ספציפי ומחכה. ממוצע המתנה לפני ביטול: 12 שעות.',
      action: 'חזור ללקוח מיידית עם פנייה אישית ומוכנה לשלוח',
    },
  ],
  israeliCalendarHooks: [
    'חגים ישראלים → הזדמנות לפרסום ממוקד',
    'סוף שבוע → תוכן מעודד ביקור/הזמנה',
  ],
};

function normalizeSector(category: string): string {
  const cat = (category || '').toLowerCase();
  if (/מסעד|קייטר|שף|אוכל|בר|פאב|cafe|restaurant/.test(cat)) return 'restaurant';
  if (/יופי|ספא|קוסמטיק|שיער|מניקור|פדיקור|ציפורן|beauty|salon/.test(cat)) return 'beauty';
  if (/כושר|חדר כושר|אימון|יוגה|פילאטיס|gym|fitness/.test(cat)) return 'fitness';
  if (/עורך דין|משפט|עו"ד|legal|law/.test(cat)) return 'legal';
  if (/רפוא|קליניק|רופא|פיזיו|שיניים|medical|clinic/.test(cat)) return 'medical';
  if (/נדל"ן|תיווך|נכס|real.estate/.test(cat)) return 'real_estate';
  if (/חנות|קמעונאות|מכולת|retail|shop/.test(cat)) return 'retail';
  if (/רכב|גרז|מוסך|טסט|auto|car/.test(cat)) return 'auto';
  if (/ניקיון|ניקוי|איחזוק|clean/.test(cat)) return 'cleaning';
  if (/חינוך|לימוד|קורס|הדרכה|מורה|education/.test(cat)) return 'education';
  return 'default';
}

/**
 * getBusinessSectorContext — unified entry point for all agents.
 * If the business has an AI-parsed sector_profile (from onboarding), use it.
 * Otherwise fall back to getSectorInsightBlock(category).
 *
 * Pass the BusinessProfile object (or a subset with category + sector_profile).
 */
export function getBusinessSectorContext(profile: {
  category: string;
  sector_profile?: string | null;
  description?: string | null;
  business_goal?: string | null;
  price_tier?: string | null;
}): string {
  if (profile.sector_profile) {
    try {
      const sp = JSON.parse(profile.sector_profile);
      return buildAISectorBlock(sp, profile.category);
    } catch {
      // fall through to regex-based
    }
  }
  return getSectorInsightBlock(profile.category);
}

/**
 * Build a rich sector context block from the AI-parsed sector_profile JSON.
 */
function buildAISectorBlock(sp: Record<string, any>, rawCategory: string): string {
  const key = sp.sector_key || normalizeSector(rawCategory);
  const cfg = SECTOR_INSIGHT_MAP[key] || DEFAULT_CONFIG;
  const currentMonth = new Date().getMonth();
  const seasonalNow = cfg.seasonalTriggers[currentMonth];

  const lines: string[] = [
    `=== פרופיל עסקי מדויק: ${sp.sector_label_he || rawCategory} ===`,
    `תת-סקטור: ${sp.sub_sector || 'לא מוגדר'}`,
    `סוג עסק: ${sp.business_type || 'לא מוגדר'} | מודל: ${Array.isArray(sp.service_model) ? sp.service_model.join(' + ') : (sp.service_model || 'לא מוגדר')}`,
    `קהל יעד: ${sp.target_audience_he || ''}`,
    `הקשר מחיר: ${sp.price_context_he || ''}`,
  ];

  if (sp.relevant_topics?.length) {
    lines.push(`\nנושאים רלוונטיים לעסק זה (חפש תובנות על):`);
    sp.relevant_topics.slice(0, 6).forEach((t: string) => lines.push(`  • ${t}`));
  }

  if (sp.irrelevant_topics?.length) {
    lines.push(`\n[חשוב מאוד] נושאים לא רלוונטיים — אל תכלול תובנות על:`);
    sp.irrelevant_topics.slice(0, 6).forEach((t: string) => lines.push(`  ✗ ${t}`));
  }

  if (sp.content_themes_he?.length) {
    lines.push(`\nנושאי תוכן שמדבר לקהל שלהם:`);
    sp.content_themes_he.forEach((t: string) => lines.push(`  → ${t}`));
  }

  if (sp.competitor_type_he) {
    lines.push(`\nסוג מתחרים: ${sp.competitor_type_he}`);
  }

  if (sp.key_trust_signals_he?.length) {
    lines.push(`\nמה בונה אמון בסקטור זה: ${sp.key_trust_signals_he.join(' | ')}`);
  }

  if (seasonalNow) {
    lines.push(`\nטריגר עונתי עכשיו: ${seasonalNow}`);
  }

  if (cfg.quickWinTriggers.length) {
    lines.push(`\nטריגרים לתובנה מיידית (מהכללת סקטור):`);
    cfg.quickWinTriggers.slice(0, 3).forEach(t => lines.push(`  → ${t}`));
  }

  lines.push(`\nסוגי התראות בעדיפות: ${cfg.topAlertTypes.join(', ')}`);
  lines.push(`=== סוף פרופיל ===`);
  return lines.join('\n');
}

/**
 * Returns sector-specific context block to inject into generateProactiveAlerts prompt.
 * Includes: top alert types, seasonal triggers for current month, quick-win triggers,
 * and two concrete few-shot examples of high-quality insights.
 */
export function getSectorInsightBlock(category: string): string {
  const key = normalizeSector(category);
  const cfg = SECTOR_INSIGHT_MAP[key] || DEFAULT_CONFIG;
  const currentMonth = new Date().getMonth();

  const seasonalNow = cfg.seasonalTriggers[currentMonth];

  const lines: string[] = [
    `=== הנחיות ייחודיות לסקטור: ${category} ===`,
    `סוגי תובנות בעדיפות עליונה לסקטור זה: ${cfg.topAlertTypes.join(', ')}`,
  ];

  if (seasonalNow) {
    lines.push(`⏰ טריגר עונתי עכשיו (${new Date().toLocaleString('he-IL', { month: 'long' })}): ${seasonalNow}`);
  }

  if (cfg.israeliCalendarHooks.length > 0) {
    lines.push(`\nהזדמנויות לוח שנה ישראלי רלוונטיות:`);
    cfg.israeliCalendarHooks.forEach(h => lines.push(`  • ${h}`));
  }

  lines.push(`\nטריגרים לתובנה מיידית בסקטור זה (בדוק בנתונים):`);
  cfg.quickWinTriggers.forEach(t => lines.push(`  → ${t}`));

  lines.push(`\n--- דוגמאות לתובנות באיכות גבוהה לסקטור זה ---`);
  cfg.fewShotExamples.forEach((ex, i) => {
    lines.push(`דוגמה ${i + 1} (${ex.type}):`);
    lines.push(`  כותרת: "${ex.title}"`);
    lines.push(`  תיאור: "${ex.description}"`);
    lines.push(`  פעולה מוצעת: "${ex.action}"`);
  });

  lines.push(`=== סוף הנחיות סקטור ===`);
  return lines.join('\n');
}
