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
  /** 5 content pillars — types of posts that drive engagement in this sector */
  contentPillars: string[];
  /** Platform-specific best format */
  platformFormats: { instagram: string; tiktok: string; facebook: string };
  /** Conversion triggers — phrases/angles that move people to buy */
  conversionTriggers: string[];
  /** Typical audience demographics */
  audienceDemographics: string;
}

const SECTOR_LIBRARY: Record<string, SectorDef> = {
  restaurant: {
    name: 'מסעדה / קייטרינג',
    painPoints: ['אוכל איכותי לאירוע', 'קייטרינג', 'משלוחים מהירים', 'אוכל בריא', 'חוויית ארוחה מיוחדת'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש מסעדה לאירוע. יש לנו תפריט קייטרינג מיוחד — אשמח לשלוח פרטים. מתי הכי נוח?',
    reviewResponsePositive: 'תודה רבה {name}! שמחים שנהנית. אנחנו עובדים קשה כל יום כדי שכל ביקור יהיה חוויה מיוחדת. מחכים לראותך שוב!',
    reviewResponseNegative: 'שלום {name}, מצטערים מאוד על חווייתך. הדברים שציינת חשובים לנו מאוד. אשמח לדבר איתך ישירות כדי לתקן — אנא פנה אלינו ישירות.',
    postHookExample: 'האם ידעת ש-73% מהאנשים בוחרים מסעדה לפי הביקורות? הנה מה שלקוחות שלנו אומרים...',
    keywords: ['אוכל', 'מסעדה', 'קייטרינג', 'משלוח', 'שף', 'תפריט'],
    contentPillars: [
      'מאחורי הקלעים במטבח — הכנת מנה ייחודית, הצגת השף, תהליך הבישול',
      'חינוך קולינרי — טיפ בישול מהיר, סוד מקצועי, היסטוריה של מנה',
      'חוויית לקוח — צילום שולחן, אטמוספרה, ביקורת לקוח עם ציטוט',
      'מנה מיוחדת — הצגת מנה עונתית, חדשה, או "מנת השף הסודית"',
      'נוסטלגיה ומורשת — סיפור מאחורי המסעדה, מתכון משפחתי, מסורת',
    ],
    platformFormats: {
      instagram: 'קרוסל תמונות איכותיות של מנות + Reels קצרים של הכנה (15-30 שניות)',
      tiktok: 'וידאו מאחורי הקלעים, טיפ בישול מהיר, או "צפו איך מכינים X"',
      facebook: 'פוסטים ארוכים יותר עם סיפור + תמונה, אירועים ומבצעי שבוע',
    },
    conversionTriggers: [
      'הזמינו עכשיו — מקומות מוגבלים לסוף שבוע',
      'הצעה מיוחדת לביקור ראשון',
      'קייטרינג לאירוע שלכם — שלחו הודעה לפרטים',
      'מנה חדשה שנוספה השבוע בלבד',
    ],
    audienceDemographics: 'זוגות ומשפחות 25-55, אוהבי אוכל 20-40, מארגני אירועים, אנשי עסקים לארוחות צהריים',
  },
  beauty: {
    name: 'יופי / ספא / קוסמטיקה',
    painPoints: ['טיפול עור', 'מניקור', 'תסרוקת לאירוע', 'טיפולי פנים', 'הרגשה טובה עם עצמי'],
    firstContactExample: 'היי {name}! ראיתי שאת מחפשת טיפול יופי. יש לנו מקום פנוי ביום חמישי — האם מתאים? אנחנו מתמחות ב{service}.',
    reviewResponsePositive: 'תודה {name}! שמחנו לפנק אותך! מחכות לראותך שוב. קבל תזכורת — הניקיון מועיל כל 4 שבועות.',
    reviewResponseNegative: '{name} יקרה, עצוב לשמוע. הצוות שלנו תמיד שואף ל-100%. אנחנו רוצות לפנות אלייך ולתקן את הרושם — אנא דברי איתנו.',
    postHookExample: '5 דקות ביום שיחסכו לך שעות של טיפול עור. הטיפ הקטן שרוב האנשים לא יודעים...',
    keywords: ['יופי', 'ספא', 'קוסמטיקה', 'מניקור', 'פדיקור', 'טיפול', 'עור'],
    contentPillars: [
      'טרנספורמציה — לפני ואחרי, שינוי מרשים, תוצאה ריאלית',
      'חינוך יופי — טיפ טיפוח יומי, מיתוס vs. מציאות, מוצר מומלץ עם הסבר',
      'מאחורי הקלעים — סלון, כלים, תהליך הטיפול',
      'ביטחון עצמי — הרגשת הלקוחה אחרי הטיפול, סיפור השינוי',
      'מבצע ועונתי — טיפול מיוחד, חבילה, מתנה ללקוחה חוזרת',
    ],
    platformFormats: {
      instagram: 'Reels טרנספורמציה + תמונות high-quality לפני-אחרי + Stories לקידום',
      tiktok: 'ASMR טיפולים, "הכנה לאירוע", טיפ יופי מהיר ויזואלי',
      facebook: 'פוסט מבצע + ביקורת לקוחה + הזמנה לתאם תור',
    },
    conversionTriggers: [
      'תורים פנויים השבוע — הזמינו עכשיו',
      'מתנה מיוחדת ללקוחה חדשה',
      'חבילת כלה / אירוע — צרי קשר לפרטים',
      'השאירי פרטים — נחזור אלייך תוך שעה',
    ],
    audienceDemographics: 'נשים 18-50, בעיקר 25-40, לפני אירועים, עיסוק בטיפוח שוטף',
  },
  fitness: {
    name: 'כושר / אימון / יוגה',
    painPoints: ['הרזיה', 'חיטוב', 'כאב גב', 'חיזוק', 'ירידה במשקל', 'חוסר מוטיבציה'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש להתחיל להתאמן. השבוע יש לנו שבוע ניסיון חינמי — תרצה לנסות? אנחנו מתמחים ב{service}.',
    reviewResponsePositive: 'תודה {name}! הסיפור שלך מעורר השראה! זה בדיוק בשביל זה אנחנו עושים מה שאנחנו עושים. כל הכבוד על ההישגים!',
    reviewResponseNegative: '{name} שלום, מצטערים על חוויית האימון. נשמח לדבר ולמצוא את הפתרון המתאים לך. הצלחתך חשובה לנו.',
    postHookExample: 'שלושה שינויים קטנים שהאמנו 200 לקוחות ב-6 חודשים. מוכן לשמוע מה השניה החשובה?',
    keywords: ['כושר', 'אימון', 'חדר כושר', 'יוגה', 'פילאטיס', 'ריצה', 'הרזיה'],
    contentPillars: [
      'סיפורי הצלחה — מסע לקוח, לפני-אחרי, ציטוט השראה',
      'טיפ מקצועי — תרגיל נכון, טעות נפוצה, שגרת אימון מומלצת',
      'מוטיבציה — ציטוט, אתגר שבועי, "הצטרף לאתגר"',
      'מאחורי הקלעים — תוכנית אימון, ציוד, הכנת המדריך',
      'חינוך תזונה ובריאות — טיפ תזונה, שאלה נפוצה, מיתוס vs. מציאות',
    ],
    platformFormats: {
      instagram: 'Reels אימון + תמונות בתוצאות + Stories אינטראקטיביות (סקר, שאלה)',
      tiktok: 'שגרת אימון 60 שניות, טיפ מהיר, אתגר ויראלי (#FitnessChallenge)',
      facebook: 'פוסט עם סיפור השראה + קישור לניסיון חינמי + אירוע קבוצתי',
    },
    conversionTriggers: [
      'שבוע ניסיון חינמי — אין התחייבות',
      'רק X מקומות נשארו לקבוצה הבאה',
      'הגע עם חבר — שניהם מקבלים הנחה',
      'תוכנית אישית בחינם לרשומים החודש',
    ],
    audienceDemographics: 'גברים ונשים 20-45, רוצים לשנות אורח חיים, מתחילים + מתאמנים ותיקים',
  },
  legal: {
    name: 'עורך דין / משרד משפטי',
    painPoints: ['ייעוץ משפטי', 'חוזה', 'גירושין', 'נדל"ן', 'ירושה'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש ייעוץ משפטי בנושא {service}. אנחנו מתמחים בתחום זה עם ניסיון של שנים. אשמח להציע פגישת ייעוץ ראשונה.',
    reviewResponsePositive: 'תודה רבה {name} על ביטחונכם בנו. שמחנו לעזור ומקווים שהסוגיה נפתרה לשביעות רצונכם. לכל שאלה נוספת — אנחנו כאן.',
    reviewResponseNegative: '{name} שלום, מצטערים שהחוויה לא עמדה בציפיות. נשמח לדון בנושא ישירות. נשאר מחויבים לשרת אתכם בצורה הטובה ביותר.',
    postHookExample: 'חוזה שכירות שלא בדקת עלול לעלות לך הרבה. 3 סעיפים שחשוב לבדוק לפני שחותמים...',
    keywords: ['עורך דין', 'משפטי', 'חוזה', 'תביעה', 'ירושה', 'גירושין', 'נדל"ן'],
    contentPillars: ['חינוך משפטי — טיפ שכולם צריכים לדעת', 'מיתוס vs. מציאות משפטית', 'מקרה הצלחה (ללא פרטים מזהים)', 'שינויי חקיקה שמשפיעים עלייך', 'שאלות נפוצות'],
    platformFormats: { instagram: 'Carousel מידע ויזואלי (5-7 שקפים), טקסט + אייקונים', tiktok: 'ועדיין לא נפוץ לסקטור — עדיף LinkedIn + Facebook', facebook: 'פוסט ארוך עם מידע מלא + הזמנה לייעוץ חינמי' },
    conversionTriggers: ['ייעוץ ראשוני ללא עלות', 'שאלה אחת שיכולה לחסוך לך אלפי שקלים', 'שלח הודעה עכשיו — נחזור תוך שעה'],
    audienceDemographics: 'עסקים קטנים ובינוניים, יחידים בהליכים משפחתיים, יזמי נדל"ן, 30-60',
  },
  medical: {
    name: 'רפואה / קליניקה / פיזיותרפיה',
    painPoints: ['כאב', 'טיפול', 'תור מהיר', 'פיזיותרפיה', 'רפואת שיניים'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש {service}. יש לנו תורים פנויים השבוע. אנחנו מציעים ייעוץ ראשוני ללא עלות. מתי מתאים?',
    reviewResponsePositive: 'תודה {name}! שמחים שהטיפול עזר. בריאות זו עדיפות ואנחנו גאים לתרום לשלך. נמשיך לתת את המיטב.',
    reviewResponseNegative: '{name} יקר/ה, מצטערים מאוד. בריאות המטופלים היא מעל הכל. נשמח לפנות אליך ישירות ולוודא שקיבלת את הטיפול הנכון.',
    postHookExample: 'כאב גב? לפני שאתה לוקח כדורים — נסה את השיטה שעוזרת לרוב המטופלים שלנו תוך שבוע...',
    keywords: ['רפואה', 'קליניקה', 'רופא', 'פיזיותרפיה', 'שיניים', 'עיניים', 'כאב'],
    contentPillars: ['טיפ בריאות מהיר ומעשי', 'הסבר על טיפול/נוהל', 'מיתוס בריאות vs. מציאות', 'כאבים נפוצים ואיך לפתור', 'מקרה הצלחה מטופל'],
    platformFormats: { instagram: 'אינפוגרפיקה + carousel הסבר', tiktok: 'טיפ בריאות מהיר 30-60 שניות', facebook: 'פוסט מפורט + קישור לתור אונליין' },
    conversionTriggers: ['תורים זמינים השבוע', 'בדיקה ראשונה ללא עלות', 'הפנייה מהרופא? נסדר הכל'],
    audienceDemographics: 'כל הגילאים, בעיקר 30-65 עם כאבים ספציפיים, הורים לילדים, ספורטאים',
  },
  real_estate: {
    name: 'נדל"ן / תיווך',
    painPoints: ['קנייה', 'מכירה', 'השכרה', 'משקיע', 'דירה'],
    firstContactExample: 'שלום {name}, ראיתי שאתה מחפש {service} באזור {city}. יש לי מספר נכסים מעניינים שלא מפורסמים — מתי נוח לדבר?',
    reviewResponsePositive: 'תודה רבה {name}! העסקה שלכם הייתה הנאה אמיתית. שמחים שמצאתם בית. נשמח לעמוד לשירותכם לכל שאלה עתידית.',
    reviewResponseNegative: '{name} שלום, מצטערים על חוויית הקנייה/מכירה. נשמח לדבר ולהבין איך נוכל לשפר. פנה אלינו ישירות.',
    postHookExample: 'מה קורה לשוק הנדל"ן ב{city} החודש? 3 נתונים שכל קונה/מוכר חייב לדעת...',
    keywords: ['נדל"ן', 'דירה', 'בית', 'קנייה', 'מכירה', 'שכירות', 'השקעה'],
    contentPillars: ['עדכון שוק מקומי', 'טיפ לקונה/מוכר', 'נכס שנמכר / הצלחה', 'מדריך צעד-אחר-צעד לתהליך', 'מגמות שוק'],
    platformFormats: { instagram: 'תמונות נכסים + Reels סיור בנכס', tiktok: 'סיור וירטואלי, טיפ שוק 60 שניות', facebook: 'פוסט מפורט + קישור לנכסים + קבוצת שוק מקומי' },
    conversionTriggers: ['הנכס הזה לא יחכה — צרו קשר היום', 'שמאות חינמית לנכסכם', 'לקוחות שלנו חסכו בממוצע 50K₪'],
    audienceDemographics: 'זוגות צעירים 28-40, משקיעים 35-60, משפרי דיור 35-55',
  },
  retail: {
    name: 'חנות / קמעונאות',
    painPoints: ['מחיר', 'מוצר', 'משלוח מהיר', 'הנחה', 'זמינות'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש {service}. הגעת למקום הנכון — יש לנו את המלאי הגדול ביותר באזור ומשלוח עד הבית תוך 24 שעות.',
    reviewResponsePositive: 'תודה {name}! שמחים שהמוצר עמד בציפיות. חזרו אלינו — בשביל הלקוחות שלנו תמיד יש הפתעות!',
    reviewResponseNegative: '{name} שלום, מצטערים מאוד. שירות לקוחות מעולה הוא ערך מרכזי שלנו. נשמח לטפל ולפצות — פנה אלינו ישירות.',
    postHookExample: 'מבצע שמסתיים ביום שישי! אלה {count} המוצרים הכי נמכרים השבוע...',
    keywords: ['חנות', 'קמעונאות', 'מכירה', 'מבצע', 'הנחה', 'מוצר', 'מלאי'],
    contentPillars: ['מוצר השבוע + יתרונות', 'מאחורי הקלעים — מיהם אנחנו', 'ביקורת לקוח + תמונה', 'מבצע / מוגבל בזמן', 'טיפ שימוש / הדרכה על מוצר'],
    platformFormats: { instagram: 'תמונות מוצר איכותיות, Reels unboxing, Stories מבצעים', tiktok: 'unboxing, הדגמת מוצר, "למה כולם קונים את זה"', facebook: 'מבצע + קישור לחנות + פוסט ביקורות' },
    conversionTriggers: ['מבצע לזמן מוגבל — X% הנחה', 'משלוח חינמי מ-X₪', 'קנה שניים, קבל שלישי במחיר מוזל'],
    audienceDemographics: 'תלוי במוצר, בדרך כלל 25-55 רוכשים מקוונים ומקומיים',
  },
  auto: {
    name: 'רכב / גרז\'/ טסטים',
    painPoints: ['תיקון', 'טסט', 'צמיגים', 'שמן', 'ביטוח'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש {service}. אנחנו יכולים לקבל אותך מחר בלי תור ממתין. מה הרכב ומה הבעיה?',
    reviewResponsePositive: 'תודה {name}! שמחים שהרכב חזר לפעולה מושלמת. אנחנו כאן לכל תקלה עתידית — בטיחות הנסיעה שלך חשובה לנו.',
    reviewResponseNegative: '{name} שלום, לא נעים לשמוע. הרכב שלך בידיים הנכונות — נשמח לבדוק שוב ולתקן כל מה שצריך. פנה אלינו.',
    postHookExample: 'האות הזאת על לוח המכוונים שרוב הנהגים מתעלמים ממנה — ויכולה לעלות לך הרבה...',
    keywords: ['רכב', 'גרז', 'טסט', 'תיקון', 'צמיגים', 'מוסך', 'שמן'],
    contentPillars: ['טיפ טיפול ברכב', 'תיקון מפתיע שמנענו ללקוח', 'מה לבדוק לפני נסיעה ארוכה', 'צמיג / שמן / טסט — מתי ולמה', 'מוצר/שירות חדש'],
    platformFormats: { instagram: 'תמונות לפני-אחרי תיקון, Reels תהליך עבודה', tiktok: 'טיפ מהיר על רכב, "כך תדעו שצריך להחליף צמיגים"', facebook: 'מבצע עונתי + תורים + פוסט מידעי' },
    conversionTriggers: ['קבל תור לטסט תוך 24 שעות', 'בדיקה חינמית לרכב', 'מבצע חילוף שמן + צמיגים'],
    audienceDemographics: 'נהגים 25-65, בעלי רכב, גברים בעיקר אבל לא רק',
  },
  cleaning: {
    name: 'ניקיון / איחזוק',
    painPoints: ['ניקיון לאחר שיפוץ', 'ניקיון עסקי', 'ניקיון דירה', 'מהיר', 'אמין'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש שירות ניקיון. אנחנו מגיעים עם הציוד, מהר ויסודיים. מתי נוח לתאם?',
    reviewResponsePositive: 'תודה {name}! שמחנו לעזור שהבית/המשרד יהיה מבריק. נשמח לחזור לפי לוח זמנים קבוע!',
    reviewResponseNegative: '{name} שלום, מצטערים. ניקיון יסודי הוא ההבטחה שלנו. נחזור ונתקן ללא עלות — מתי מתאים?',
    postHookExample: '3 אזורים בבית שרוב האנשים שוכחים לנקות — ומה קורה אם לא...',
    keywords: ['ניקיון', 'איחזוק', 'ניקוי', 'מנקה', 'דירה', 'משרד'],
    contentPillars: ['טיפ ניקיון מהיר', 'לפני-אחרי ניקיון', 'ניקיון עמוק לעונה', 'כלים ומוצרים מקצועיים', 'ביקורת לקוח'],
    platformFormats: { instagram: 'לפני-אחרי ויזואלי, Reels תהליך ניקיון מרגיע', tiktok: 'CleanTok — ניקיון סטיפאינג, ASMR ניקוי', facebook: 'מבצע עונתי + המלצות + קישור לתיאום' },
    conversionTriggers: ['ניקיון ראשוני בהנחה', 'חבילת ניקיון חודשי קבוע', 'מגיעים תוך 24 שעות'],
    audienceDemographics: 'בעלי בתים 30-60, עסקים, בעלי נכסים להשכרה',
  },
  education: {
    name: 'חינוך / הדרכה / קורסים',
    painPoints: ['שיעורים פרטיים', 'קורס', 'הכנה לבחינה', 'מיומנות', 'לימודים'],
    firstContactExample: 'שלום {name}! ראיתי שאתה מחפש עזרה ב{service}. אנחנו מתאימים תוכנית אישית לכל תלמיד. רוצה לשמוע יותר?',
    reviewResponsePositive: 'תודה {name}! הצלחתך היא ההצלחה שלנו. שמחים שהדרך ללמידה הפכה קלה יותר. המשך להצליח!',
    reviewResponseNegative: '{name} שלום, מצטערים. נשמח לדבר ולהבין איך לשפר את החוויה שלך. כל תלמיד מגיע להצליח.',
    postHookExample: 'הטכניקה שעוזרת לתלמידים לשפר את ציוניהם ב-30% תוך חודש — ואיך מיישמים אותה...',
    keywords: ['חינוך', 'שיעורים', 'קורס', 'הדרכה', 'לימודים', 'מורה', 'בגרות'],
    contentPillars: ['סיפור הצלחה תלמיד', 'טיפ לימוד מוכח', 'מיתוס חינוכי vs. מציאות', 'הכנה לבחינה — מדריך', 'מאחורי הקלעים — המורה/הקורס'],
    platformFormats: { instagram: 'carousel טיפים, Stories שאלות אינטראקטיביות', tiktok: '"שיעור ב-60 שניות", טיפ מהיר לבחינה', facebook: 'פוסט מפורט + הזמנה לשיעור ניסיון + קבוצת הורים' },
    conversionTriggers: ['שיעור ניסיון ראשון חינמי', 'כפל ציון תוך חודש — או הכסף חזר', 'הרשמה לסמסטר הבא פתוחה — X מקומות נשארו'],
    audienceDemographics: 'תלמידים 12-18, הורים 35-55, בוגרים שרוצים לרכוש מיומנות',
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
  contentPillars: ['הצגת שירות מרכזי + יתרון', 'ביקורת לקוח מרוצה', 'מאחורי הקלעים', 'טיפ מקצועי', 'מבצע / הצעה מיוחדת'],
  platformFormats: { instagram: 'תמונות מקצועיות + Reels תהליך עבודה', tiktok: 'טיפ מהיר ויזואלי', facebook: 'פוסט מפורט + הזמנה ליצור קשר' },
  conversionTriggers: ['צרו קשר לקבלת הצעת מחיר', 'ניסיון ראשוני ללא עלות', 'מוגבל בזמן — פנה עכשיו'],
  audienceDemographics: 'לקוחות פוטנציאליים מקומיים 25-60',
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

/**
 * Returns a rich content strategy block for use in content/marketing agent prompts.
 * Includes pillars, platform formats, conversion triggers, and audience demographics.
 */
export function getSectorContentStrategy(category: string): string {
  const key = normalizeSector(category);
  const def = SECTOR_LIBRARY[key] || DEFAULT_DEF;

  return `
=== אסטרטגיית תוכן לסקטור: ${def.name} ===
קהל יעד טיפוסי: ${def.audienceDemographics}

5 עמודי תוכן שעובדים בסקטור זה:
${def.contentPillars.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

פורמטים מנצחים לפלטפורמה:
  Instagram: ${def.platformFormats.instagram}
  TikTok:    ${def.platformFormats.tiktok}
  Facebook:  ${def.platformFormats.facebook}

טריגרי המרה שעובדים:
${def.conversionTriggers.map(t => `  • ${t}`).join('\n')}

נושאי כאב נפוצים בסקטור: ${def.painPoints.join(', ')}
דוגמת Hook: "${def.postHookExample}"
=== סוף אסטרטגיית תוכן ===`;
}
