import { base44 } from '@/api/base44Client';

// ── Rich FAQ knowledge base ────────────────────────────────────────────────────
const FAQ = [
  // Auth & Login
  {
    keywords: ['התחבר', 'לוגין', 'login', 'כניסה', 'סיסמה', 'password', 'חשבון', 'רשום'],
    answer: 'לבעיות התחברות: (1) נסה לנקות קוקיז ולטעון מחדש. (2) לחץ "שכחתי סיסמה" בדף הכניסה ותקבל מייל איפוס. (3) אם אין לך חשבון — לחץ "הרשמה" ומלא את פרטי העסק.',
  },
  // Scanning
  {
    keywords: ['סריקה', 'scan', 'לא מתחיל', 'תקוע', 'לא מסתיים', 'סוכן', 'agent'],
    answer: 'הסריקה מפעילה 24+ סוכני AI ועלולה להימשך 2-5 דקות. אם נתקעה: (1) רענן את הדף. (2) לחץ "סרוק מחדש" בלוח הבקרה. (3) ודא שהעסק רשום — ללא פרופיל העסק הסריקה לא תפעל.',
  },
  // Leads
  {
    keywords: ['ליד', 'lead', 'לקוחות פוטנציאלים', 'לידים', 'ליד חם'],
    answer: 'לידים מתמלאים אוטומטית מהסריקה. אם הלידים ריקים: (1) ודא שהסריקה רצה לפחות פעם אחת. (2) בדוק "מקורות מידע" — צריך לפחות מקור אחד מחובר. (3) הוסף מספר טלפון / אתר אינטרנט לפרופיל כדי לשפר איתור לידים.',
  },
  // Billing / Subscription
  {
    keywords: ['מנוי', 'תשלום', 'חיוב', 'subscription', 'כרטיס', 'billing', 'תוכנית', 'שדרג', 'upgrade'],
    answer: 'לניהול מנוי: עבור ל"ניהול מנוי" בתפריט הצד. שם תוכל לשדרג, לשנות פרטי כרטיס, או לראות חשבוניות. לבעיה דחופה עם חיוב — פתח פנייה לנציג.',
  },
  // Error / Crash
  {
    keywords: ['שגיאה', 'error', 'קריסה', 'crash', 'לא נטען', 'ריק', 'לא עובד', 'bug'],
    answer: 'לתיקון שגיאות: (1) רענן חזק (Ctrl+Shift+R). (2) פתח בדפדפן אחר. (3) נקה cache. אם השגיאה חוזרת — שלח לנו צילום מסך + תיאור מה עשית לפני. נחזור אליך תוך 24 שעות.',
  },
  // Settings / Profile
  {
    keywords: ['הגדרות', 'settings', 'פרופיל', 'profile', 'שנה', 'עדכן שם', 'קטגוריה', 'עיר'],
    answer: 'עדכון פרטי העסק: לחץ על "הגדרות" בתפריט. שם תוכל לעדכן: שם העסק, קטגוריה, עיר, שירותים, ושעות פעילות. עדכון הפרטים ישפר את דיוק הסריקות.',
  },
  // Competitors
  {
    keywords: ['מתחרים', 'competitor', 'מתחרה', 'לא מוצא'],
    answer: 'מתחרים מזוהים אוטומטית בסריקה. אם אין תוצאות: (1) ודא שהקטגוריה והעיר מוגדרים בפרופיל. (2) לחץ "סרוק" מהדשבורד להפעלת סוכן הסריקה. (3) ניתן להוסיף מתחרה ידנית מדף "מתחרים".',
  },
  // Integrations
  {
    keywords: ['אינטגרציה', 'integration', 'חיבור', 'api', 'webhook', 'google', 'facebook', 'crm'],
    answer: 'אינטגרציות נמצאות תחת "אינטגרציות" בתפריט. כרגע נתמכות: Google Business, Facebook, WhatsApp. אם האינטגרציה לא מתחברת — נתק וחבר מחדש. לבעיה עם API מסוים — פתח פנייה עם שם השירות.',
  },
  // Reviews
  {
    keywords: ['ביקורת', 'ביקורות', 'review', 'מוניטין', 'תגובה', 'כוכבים'],
    answer: 'ביקורות מסונכרנות אוטומטית מ-Google. המערכת מציעה תגובות AI לביקורות שליליות. אם ביקורות לא מופיעות: (1) ודא חיבור Google Business. (2) לחץ "סרוק ביקורות" בדף מוניטין. התגובות ממתינות לאישורך לפני שליחה.',
  },
  // Performance / Slow
  {
    keywords: ['איטי', 'slow', 'טעינה', 'loading', 'זמן', 'ארוך'],
    answer: 'אם המערכת איטית: (1) נסה ברשת אחרת (WiFi / cellular). (2) בדוק שאין הרחבות דפדפן שחוסמות. (3) מומלץ להשתמש ב-Chrome / Edge עדכני. לסריקות — הן רצות ברקע וזה נורמלי שלוקחות זמן.',
  },
  // Data / Privacy
  {
    keywords: ['נתונים', 'פרטיות', 'data', 'privacy', 'מחיקה', 'GDPR'],
    answer: 'כל הנתונים שלך מוצפנים ומאובטחים. אנו עומדים בתקן GDPR. למחיקת חשבון — עבור להגדרות ← "מחק חשבון". לשאלות על אבטחת מידע — פתח פנייה ונשיב תוך 24 שעות.',
  },
  // Mobile
  {
    keywords: ['מובייל', 'mobile', 'טלפון', 'אפליקציה', 'app'],
    answer: 'OTX זמין כאפליקציית PWA — פתח את האתר בנייד ולחץ "הוסף למסך הבית". ממשק הנייד עוצב לניהול מהיר: לידים, ביקורות ותובנות זמינים מיידית.',
  },
];

// ── AI-powered support system prompt ─────────────────────────────────────────
const SUPPORT_SYSTEM_PROMPT = `אתה סוכן תמיכה טכנית של OTX — פלטפורמת מודיעין עסקי AI לעסקים קטנים ישראלים.

המוצר כולל:
- סריקת מתחרים אוטומטית (24+ סוכנים)
- ניהול לידים ועדכונים אוטומטיים
- מוניטין ותגובות AI לביקורות
- תובנות שוק בזמן אמת
- יועץ AI (CommandHome) לניהול שוטף
- לוח ניהול ארגוני

כללי תגובה:
1. ענה תמיד בעברית
2. תשובה קצרה וישירה (2-4 שורות)
3. הצע צעדים ממוספרים לפתרון
4. אם לא בטוח — המלץ לפתוח פנייה לנציג
5. אל תמציא פתרונות — אם לא יודע, אמור זאת`;

// ── FAQ fallback ───────────────────────────────────────────────────────────────
function getFaqFallback(message) {
  const lower = message.toLowerCase();
  for (const faq of FAQ) {
    if (faq.keywords.some(k => lower.includes(k))) {
      return { text: faq.answer, suggest_escalate: false };
    }
  }
  return {
    text: 'לא מצאתי פתרון מיידי לשאלתך. אפשר לפתוח פנייה לנציג שיחזור אליך בהקדם.',
    suggest_escalate: true,
  };
}

// ── Main async function ───────────────────────────────────────────────────────
export async function getBotResponse(message, history = []) {
  // Build multi-turn prompt from history
  const historyText = history.slice(-6)
    .map(m => `${m.role === 'user' ? 'משתמש' : 'סוכן'}: ${m.text}`)
    .join('\n');
  const prompt = historyText
    ? `${SUPPORT_SYSTEM_PROMPT}\n\nהיסטוריית שיחה:\n${historyText}\n\nמשתמש: ${message}`
    : `${SUPPORT_SYSTEM_PROMPT}\n\nשאלת המשתמש: ${message}`;

  // Try AI first
  try {
    const response = await base44.integrations.Core.InvokeLLM({
      model: 'haiku',
      maxTokens: 350,
      prompt,
    });
    // Handle multiple response shapes: string, { content }, { text }, { reply }
    const text = typeof response === 'string'
      ? response
      : response?.content || response?.text || response?.reply || '';
    if (text && text.length > 10) {
      // Detect if AI is escalating
      const shouldEscalate = /נציג|פנייה|צור קשר|לא יכול|לא בטוח/.test(text);
      return { text, suggest_escalate: shouldEscalate };
    }
  } catch (err) {
    console.warn('[SupportBot] AI failed, falling back to FAQ:', err?.message);
  }

  // Fallback to FAQ keyword matching
  return getFaqFallback(message);
}

// Sync version still exported for backwards compat (returns FAQ only)
export function getBotResponseSync(message) {
  return getFaqFallback(message);
}
