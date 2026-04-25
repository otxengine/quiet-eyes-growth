/**
 * sectorPrompts — sector-specific few-shot examples injected into LLM prompts.
 *
 * Covers: restaurant, beauty, fitness, legal, medical, real_estate, retail,
 * auto, cleaning, education, events, tech_services, accounting, construction.
 *
 * Usage: `getSectorContext(category)` returns a string block to append to any prompt.
 */

interface SectorDef {
  /** Short display name */
  name: string;
  /** Common customer pain points (used in lead messages) */
  painPoints: string[];
  /** Example first-contact WhatsApp message */
  firstContactExample: string;
  /** Example review response (positive) */
  reviewResponsePositive: string;
  /** Example review response (negative) */
  reviewResponseNegative: string;
  /** Example social post hook */
  postHookExample: string;
  /** Relevant keywords for signals */
  keywords: string[];
}

const SECTOR_LIBRARY: Record<string, SectorDef> = {
  restaurant: {
    name: 'מסעדה / קייטרינג',
    painPoints: ['אוכל איכותי לאירוע', 'קייטרינג', 'משלוחים מהירים', 'אוכל בריא'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש מסעדה לאירוע. יש לנו תפריט קייטרינג מיוחד — אשמח לשלוח פרטים. מתי הכי נוח?',
    reviewResponsePositive: 'תודה רבה {name}! שמחים שנהנית. אנחנו עובדים קשה כל יום כדי שכל ביקור יהיה חוויה מיוחדת. מחכים לראותך שוב!',
    reviewResponseNegative: 'שלום {name}, מצטערים מאוד על חווייתך. הדברים שציינת חשובים לנו מאוד. אשמח לדבר איתך ישירות כדי לתקן — אנא פנה אלינו ישירות.',
    postHookExample: 'האם ידעת ש-73% מהאנשים בוחרים מסעדה לפי הביקורות? הנה מה שלקוחות שלנו אומרים...',
    keywords: ['אוכל', 'מסעדה', 'קייטרינג', 'משלוח', 'שף', 'תפריט'],
  },
  beauty: {
    name: 'יופי / ספא / קוסמטיקה',
    painPoints: ['טיפול עור', 'מניקור', 'תסרוקת לאירוע', 'טיפולי פנים'],
    firstContactExample: 'היי {name}! ראיתי שאת מחפשת טיפול יופי. יש לנו מקום פנוי ביום חמישי — האם מתאים? אנחנו מתמחות ב{service}.',
    reviewResponsePositive: 'תודה {name}! שמחנו לפנק אותך! מחכות לראותך שוב. קבל תזכורת — הניקיון מועיל כל 4 שבועות.',
    reviewResponseNegative: '{name} יקרה, עצוב לשמוע. הצוות שלנו תמיד שואף ל-100%. אנחנו רוצות לפנות אלייך ולתקן את הרושם — אנא דברי איתנו.',
    postHookExample: '5 דקות ביום שיחסכו לך שעות של טיפול עור. הטיפ הקטן שרוב האנשים לא יודעים...',
    keywords: ['יופי', 'ספא', 'קוסמטיקה', 'מניקור', 'פדיקור', 'טיפול', 'עור'],
  },
  fitness: {
    name: 'כושר / אימון / יוגה',
    painPoints: ['הרזיה', 'חיטוב', 'כאב גב', 'חיזוק', 'ירידה במשקל'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש להתחיל להתאמן. השבוע יש לנו שבוע ניסיון חינמי — תרצה לנסות? אנחנו מתמחים ב{service}.',
    reviewResponsePositive: 'תודה {name}! הסיפור שלך מעורר השראה! זה בדיוק בשביל זה אנחנו עושים מה שאנחנו עושים. כל הכבוד על ההישגים!',
    reviewResponseNegative: '{name} שלום, מצטערים על חוויית האימון. נשמח לדבר ולמצוא את הפתרון המתאים לך. הצלחתך חשובה לנו.',
    postHookExample: 'שלושה שינויים קטנים שהאמנו 200 לקוחות ב-6 חודשים. מוכן לשמוע מה השניה החשובה?',
    keywords: ['כושר', 'אימון', 'חדר כושר', 'יוגה', 'פילאטיס', 'ריצה', 'הרזיה'],
  },
  legal: {
    name: 'עורך דין / משרד משפטי',
    painPoints: ['ייעוץ משפטי', 'חוזה', 'גירושין', 'נדל"ן', 'ירושה'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש ייעוץ משפטי בנושא {service}. אנחנו מתמחים בתחום זה עם ניסיון של שנים. אשמח להציע פגישת ייעוץ ראשונה.',
    reviewResponsePositive: 'תודה רבה {name} על ביטחונכם בנו. שמחנו לעזור ומקווים שהסוגיה נפתרה לשביעות רצונכם. לכל שאלה נוספת — אנחנו כאן.',
    reviewResponseNegative: '{name} שלום, מצטערים שהחוויה לא עמדה בציפיות. נשמח לדון בנושא ישירות. נשאר מחויבים לשרת אתכם בצורה הטובה ביותר.',
    postHookExample: 'חוזה שכירות שלא בדקת עלול לעלות לך הרבה. 3 סעיפים שחשוב לבדוק לפני שחותמים...',
    keywords: ['עורך דין', 'משפטי', 'חוזה', 'תביעה', 'ירושה', 'גירושין', 'נדל"ן'],
  },
  medical: {
    name: 'רפואה / קליניקה / פיזיותרפיה',
    painPoints: ['כאב', 'טיפול', 'תור מהיר', 'פיזיותרפיה', 'רפואת שיניים'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש {service}. יש לנו תורים פנויים השבוע. אנחנו מציעים ייעוץ ראשוני ללא עלות. מתי מתאים?',
    reviewResponsePositive: 'תודה {name}! שמחים שהטיפול עזר. בריאות זו עדיפות ואנחנו גאים לתרום לשלך. נמשיך לתת את המיטב.',
    reviewResponseNegative: '{name} יקר/ה, מצטערים מאוד. בריאות המטופלים היא מעל הכל. נשמח לפנות אליך ישירות ולוודא שקיבלת את הטיפול הנכון.',
    postHookExample: 'כאב גב? לפני שאתה לוקח כדורים — נסה את השיטה שעוזרת לרוב המטופלים שלנו תוך שבוע...',
    keywords: ['רפואה', 'קליניקה', 'רופא', 'פיזיותרפיה', 'שיניים', 'עיניים', 'כאב'],
  },
  real_estate: {
    name: 'נדל"ן / תיווך',
    painPoints: ['קנייה', 'מכירה', 'השכרה', 'משקיע', 'דירה'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש {service} באזור {city}. יש לי מספר נכסים מעניינים שלא מפורסמים — מתי נוח לדבר?',
    reviewResponsePositive: 'תודה רבה {name}! העסקה שלכם הייתה הנאה אמיתית. שמחים שמצאתם בית. נשמח לעמוד לשירותכם לכל שאלה עתידית.',
    reviewResponseNegative: '{name} שלום, מצטערים על חוויית הקנייה/מכירה. נשמח לדבר ולהבין איך נוכל לשפר. פנה אלינו ישירות.',
    postHookExample: 'מה קורה לשוק הנדל"ן ב{city} החודש? 3 נתונים שכל קונה/מוכר חייב לדעת...',
    keywords: ['נדל"ן', 'דירה', 'בית', 'קנייה', 'מכירה', 'שכירות', 'השקעה'],
  },
  retail: {
    name: 'חנות / קמעונאות',
    painPoints: ['מחיר', 'מוצר', 'משלוח מהיר', 'הנחה', 'זמינות'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש {service}. הגעת למקום הנכון — יש לנו את המלאי הגדול ביותר באזור ומשלוח עד הבית תוך 24 שעות.',
    reviewResponsePositive: 'תודה {name}! שמחים שהמוצר עמד בציפיות. חזרו אלינו — בשביל הלקוחות שלנו תמיד יש הפתעות!',
    reviewResponseNegative: '{name} שלום, מצטערים מאוד. שירות לקוחות מעולה הוא ערך מרכזי שלנו. נשמח לטפל ולפצות — פנה אלינו ישירות.',
    postHookExample: 'מבצע שמסתיים ביום שישי! אלה {count} המוצרים הכי נמכרים השבוע...',
    keywords: ['חנות', 'קמעונאות', 'מכירה', 'מבצע', 'הנחה', 'מוצר', 'מלאי'],
  },
  auto: {
    name: 'רכב / גרז\'/ טסטים',
    painPoints: ['תיקון', 'טסט', 'צמיגים', 'שמן', 'ביטוח'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש {service}. אנחנו יכולים לקבל אותך מחר בלי תור ממתין. מה הרכב ומה הבעיה?',
    reviewResponsePositive: 'תודה {name}! שמחים שהרכב חזר לפעולה מושלמת. אנחנו כאן לכל תקלה עתידית — בטיחות הנסיעה שלך חשובה לנו.',
    reviewResponseNegative: '{name} שלום, לא נעים לשמוע. הרכב שלך בידיים הנכונות — נשמח לבדוק שוב ולתקן כל מה שצריך. פנה אלינו.',
    postHookExample: 'האות הזאת על לוח המכוונים שרוב הנהגים מתעלמים ממנה — ויכולה לעלות לך הרבה...',
    keywords: ['רכב', 'גרז', 'טסט', 'תיקון', 'צמיגים', 'מוסך', 'שמן'],
  },
  cleaning: {
    name: 'ניקיון / איחזוק',
    painPoints: ['ניקיון לאחר שיפוץ', 'ניקיון עסקי', 'ניקיון דירה', 'מהיר', 'אמין'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש שירות ניקיון. אנחנו מגיעים עם הציוד, מהר ויסודיים. מתי נוח לתאם?',
    reviewResponsePositive: 'תודה {name}! שמחנו לעזור שהבית/המשרד יהיה מבריק. נשמח לחזור לפי לוח זמנים קבוע!',
    reviewResponseNegative: '{name} שלום, מצטערים. ניקיון יסודי הוא ההבטחה שלנו. נחזור ונתקן ללא עלות — מתי מתאים?',
    postHookExample: '3 אזורים בבית שרוב האנשים שוכחים לנקות — ומה קורה אם לא...',
    keywords: ['ניקיון', 'איחזוק', 'ניקוי', 'מנקה', 'דירה', 'משרד'],
  },
  education: {
    name: 'חינוך / הדרכה / קורסים',
    painPoints: ['שיעורים פרטיים', 'קורס', 'הכנה לבחינה', 'מיומנות', 'לימודים'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש עזרה ב{service}. אנחנו מתאימים תוכנית אישית לכל תלמיד. רוצה לשמוע יותר?',
    reviewResponsePositive: 'תודה {name}! הצלחתך היא ההצלחה שלנו. שמחים שהדרך ללמידה הפכה קלה יותר. המשך להצליח!',
    reviewResponseNegative: '{name} שלום, מצטערים. נשמח לדבר ולהבין איך לשפר את החוויה שלך. כל תלמיד מגיע להצליח.',
    postHookExample: 'הטכניקה שעוזרת לתלמידים לשפר את ציוניהם ב-30% תוך חודש — ואיך מיישמים אותה...',
    keywords: ['חינוך', 'שיעורים', 'קורס', 'הדרכה', 'לימודים', 'מורה', 'בגרות'],
  },
};

// Fallback for unknown sectors
const DEFAULT_DEF: SectorDef = {
  name: 'עסק כללי',
  painPoints: ['שירות מהיר', 'מחיר', 'איכות', 'אמינות'],
  firstContactExample: 'שלום {name}! ראיתי שאתה מחפש {service}. אשמח לספר יותר על מה שאנחנו מציעים. מתי נוח לדבר?',
  reviewResponsePositive: 'תודה רבה {name}! שמחים לשמוע ומחכים לראותך שוב בקרוב!',
  reviewResponseNegative: '{name} שלום, מצטערים. נשמח לדבר ולתקן. פנה אלינו ישירות.',
  postHookExample: 'שאלה אחת שכל לקוח שואל — והתשובה שמפתיעה כולם...',
  keywords: ['שירות', 'מקצועי', 'איכות', 'לקוח'],
};

/** Normalize category strings to sector keys */
function normalizeSector(category: string): string {
  const cat = (category || '').toLowerCase();
  if (/מסעד|קייטר|שף|אוכל|בר|פאב/.test(cat)) return 'restaurant';
  if (/יופי|ספא|קוסמטיק|עיצוב שיער|מניקור|פדיקור|ציפורניים/.test(cat)) return 'beauty';
  if (/כושר|חדר כושר|אימון|יוגה|פילאטיס|ריצה/.test(cat)) return 'fitness';
  if (/עורך דין|משפט|עו"ד/.test(cat)) return 'legal';
  if (/רפוא|קליניק|רופא|פיזיו|שיניים|אופטיק/.test(cat)) return 'medical';
  if (/נדל"ן|תיווך|נכס/.test(cat)) return 'real_estate';
  if (/חנות|קמעונאות|מכולת|סופר/.test(cat)) return 'retail';
  if (/רכב|גרז|מוסך|טסט/.test(cat)) return 'auto';
  if (/ניקיון|ניקוי|איחזוק/.test(cat)) return 'cleaning';
  if (/חינוך|לימוד|קורס|הדרכה|מורה/.test(cat)) return 'education';
  return 'default';
}

/** Returns a few-shot block to append to any agent prompt */
export function getSectorContext(category: string): string {
  const key = normalizeSector(category);
  const def = SECTOR_LIBRARY[key] || DEFAULT_DEF;

  return `
=== דוגמאות לסקטור: ${def.name} ===
נושאי כאב נפוצים: ${def.painPoints.join(', ')}
דוגמת פוסט-וו: "${def.postHookExample}"
דוגמת פנייה ראשונה: "${def.firstContactExample}"
=== סוף דוגמאות ===`;
}

/** Returns the sector-specific pain points as an array */
export function getSectorPainPoints(category: string): string[] {
  const key = normalizeSector(category);
  return (SECTOR_LIBRARY[key] || DEFAULT_DEF).painPoints;
}

/** Returns the sector-specific keywords for signal scanning */
export function getSectorKeywords(category: string): string[] {
  const key = normalizeSector(category);
  return (SECTOR_LIBRARY[key] || DEFAULT_DEF).keywords;
}

/** Returns example review responses for a given tone */
export function getSectorReviewResponse(category: string, type: 'positive' | 'negative'): string {
  const key = normalizeSector(category);
  const def = SECTOR_LIBRARY[key] || DEFAULT_DEF;
  return type === 'positive' ? def.reviewResponsePositive : def.reviewResponseNegative;
}
