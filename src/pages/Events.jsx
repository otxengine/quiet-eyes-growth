import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, Loader2, Zap, Clock, TrendingUp } from 'lucide-react';
import ActionPopup from '@/components/ui/ActionPopup';
import { toast } from 'sonner';

const EVENT_TABS = [
  { key: 'all',        label: 'הכל' },
  { key: 'holiday',    label: 'חגים יהודיים' },
  { key: 'religion',   label: 'דתות אחרות' },
  { key: 'sports',     label: 'ספורט' },
  { key: 'seasonal',   label: 'עונתי' },
  { key: 'commercial', label: 'מסחרי' },
];

const HOLIDAY_KEYWORDS  = ['פסח', 'ראש השנה', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'יום כיפור', 'עצמאות', 'ירושלים', 'לג בעומר', 'ט"ו באב', 'שמחת תורה', 'holiday', 'jewish', 'yom_kippur', 'rosh_hashana'];
const RELIGION_KEYWORDS = ['eid', 'עיד', 'רמדאן', 'ramadan', 'christmas', 'כריסמס', 'חג המולד', 'easter', 'פסחא', 'מולד', 'ביירם'];
const SPORTS_KEYWORDS   = ['ליגת האלופות', 'גמר', 'ספורט', 'כדורגל', 'כדורסל', 'champions', 'europa', 'world cup', 'מונדיאל', 'ליגה', 'אצטדיון', 'יורו', 'euro', 'copa'];
const SEASONAL_KEYWORDS = ['קיץ', 'חורף', 'אביב', 'סתיו', 'חזרה ללימודים', 'חתונה', 'עונה', 'summer', 'winter', 'spring', 'renovation', 'שיפוץ'];
const COMMERCIAL_KEYWORDS = ['בלאק פריידי', 'ולנטיין', 'ינואר', 'כושר', 'דיאטה', 'החלטות', 'black friday', 'valentine', 'commercial', 'אמהות', 'אבות', 'הלווין', 'halloween'];

function classifyEvent(title = '', description = '', tags = []) {
  const text = `${title} ${description} ${tags.join(' ')}`.toLowerCase();
  if (RELIGION_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'religion';
  if (SPORTS_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'sports';
  if (HOLIDAY_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'holiday';
  if (SEASONAL_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'seasonal';
  if (COMMERCIAL_KEYWORDS.some(k => text.includes(k.toLowerCase()))) return 'commercial';
  return 'other';
}

// Static upcoming events — all religions, sports, commercial, seasonal
// Dates are real upcoming dates from April 2026 onward
const STATIC_EVENTS = [
  // ─── Jewish Holidays ───
  {
    id: 'static_lag_baomer',
    _type: 'static',
    title: "לג בעומר — הדלקות והתכנסויות",
    description: "עונת ההדלקות — עסקים קרובים למדורות (מזון, שתייה, ציוד) עם פוטנציאל מכירה גבוה. מומלץ הכנת מבצעים ממוקדים.",
    event_date: '2026-05-14',
    category: 'holiday',
    tags: ['לג בעומר', 'חגים יהודיים'],
  },
  {
    id: 'static_yom_yerushalayim',
    _type: 'static',
    title: "יום ירושלים — הזדמנות לאומית",
    description: "יום ירושלים מציין את איחוד העיר — אירועים ציבוריים רבים ברחבי הארץ. הזדמנות לתכנים פטריוטיים ומבצעים ממוקדים.",
    event_date: '2026-05-28',
    category: 'holiday',
    tags: ['ירושלים', 'חגים יהודיים'],
  },
  {
    id: 'static_shavuot',
    _type: 'static',
    title: "שבועות — חג מתנת התורה",
    description: "חג שבועות — מועד מרכזי לצריכת מוצרי חלב, מאפים, ולמפגשים משפחתיים. מותגי מזון, קונדיטוריה ואירועים — ביקוש גבוה.",
    event_date: '2026-06-01',
    category: 'holiday',
    tags: ['שבועות', 'חגים יהודיים'],
  },
  {
    id: 'static_tubeav',
    _type: 'static',
    title: 'ט"ו באב — חג האהבה הישראלי',
    description: "חג האהבה הישראלי — הזדמנות עסקית מצוינת לפרחים, מסעדות, מתנות וחוויות זוגיות. קהל יעד: זוגות, מתאהבים.",
    event_date: '2026-08-09',
    category: 'holiday',
    tags: ['ט"ו באב', 'אהבה'],
  },
  {
    id: 'static_rosh_hashana',
    _type: 'static',
    title: "ראש השנה תשפ\"ז — שנה חדשה",
    description: "ראש השנה 5787 — עונת הקניות החזקה ביותר בשנה. ביקוש גבוה למתנות, בגדים, אוכל ושירותים. שיא הפעילות העסקית.",
    event_date: '2026-09-18',
    category: 'holiday',
    tags: ['ראש השנה', 'חגים יהודיים'],
  },
  {
    id: 'static_yom_kippur',
    _type: 'static',
    title: "יום כיפור — לפניו ואחריו",
    description: "יום כיפור — עסקים נסגרים אך יש הזדמנות עסקית רבה בימים שלפני: ארוחות לפני הצום, בגדי לבן, מזון לאחר הצום.",
    event_date: '2026-09-27',
    category: 'holiday',
    tags: ['יום כיפור', 'חגים יהודיים'],
  },
  {
    id: 'static_sukkot',
    _type: 'static',
    title: "סוכות — חג האסיף",
    description: "סוכות — ביקוש גבוה לחומרי בניה, ריהוט, ציוד חוץ, ומוצרי מזון. שבוע חופשות — שיא לענף הבילוי והבידור.",
    event_date: '2026-10-02',
    category: 'holiday',
    tags: ['סוכות', 'חגים יהודיים'],
  },
  {
    id: 'static_simchat_torah',
    _type: 'static',
    title: "שמחת תורה — סיום החגים",
    description: "שמחת תורה — סיום עונת החגים. הזדמנות אחרונה למבצעי חגים לפני חזרה לשגרה. לקוחות חוזרים לקניות יום-יומיות.",
    event_date: '2026-10-10',
    category: 'holiday',
    tags: ['שמחת תורה', 'חגים יהודיים'],
  },
  {
    id: 'static_hanukkah',
    _type: 'static',
    title: "חנוכה — חג האורות",
    description: "חנוכה — עונת מתנות ופעילויות משפחתיות. מתאים לקמפיינים של מתנות, חוויות, סופגניות, ואורות. הזדמנות לתוכן יצירתי.",
    event_date: '2026-12-14',
    category: 'holiday',
    tags: ['חנוכה', 'חגים יהודיים'],
  },

  // ─── Muslim Holidays ───
  {
    id: 'static_eid_adha',
    _type: 'static',
    title: "עיד אל-אדחא — חג הקורבן",
    description: "עיד אל-אדחא — חג גדול בקהילות המוסלמיות. ביקוש גבוה לבשר, מתנות, בגדים ומסעדות. הזדמנות לפנות לקהל הערבי-ישראלי.",
    event_date: '2026-06-05',
    category: 'religion',
    tags: ['עיד', 'מוסלמי', 'דתות אחרות'],
  },
  {
    id: 'static_ramadan_2027',
    _type: 'static',
    title: "רמדאן — חודש הצום המוסלמי",
    description: "חודש רמדאן — שינוי בדפוסי צריכה בקהילות המוסלמיות. ביקוש גבוה לאוכל בשעות הלילה, מתנות ופעילויות משפחתיות.",
    event_date: '2027-02-07',
    category: 'religion',
    tags: ['רמדאן', 'מוסלמי'],
  },
  {
    id: 'static_eid_fitr_2027',
    _type: 'static',
    title: "עיד אל-פיטר — חג שבירת הצום",
    description: "עיד אל-פיטר — חג גדול בסוף חודש הצום. ביקוש גבוה לבגדים חדשים, מתנות, מסעדות ומאפים.",
    event_date: '2027-03-10',
    category: 'religion',
    tags: ['עיד', 'מוסלמי'],
  },

  // ─── Christian Holidays ───
  {
    id: 'static_christmas',
    _type: 'static',
    title: "כריסמס — חג המולד הנוצרי",
    description: "חג המולד — הזדמנות עסקית עולמית. עסקים בתיירות, אירוח ומסעדות נהנים מביקוש גבוה. מתאים לקמפיינים בינלאומיים.",
    event_date: '2026-12-25',
    category: 'religion',
    tags: ['כריסמס', 'נוצרי', 'חג המולד'],
  },
  {
    id: 'static_new_year_2027',
    _type: 'static',
    title: "ראש השנה הלועזי 2027",
    description: "ראש השנה הלועזי — עונת חגיגות, מסעדות ואירועים. ביקוש גבוה לחבילות חגיגה, מסעדות, ובידור. ערב חגיגי ל-31.12.",
    event_date: '2027-01-01',
    category: 'religion',
    tags: ['ראש השנה לועזי', 'כריסמס', 'נוצרי'],
  },
  {
    id: 'static_easter_2027',
    _type: 'static',
    title: "פסחא — חג הפסחא הנוצרי",
    description: "חג הפסחא — חשוב לקהל הנוצרי ולתיירות. הזדמנות לעסקים בירושלים ובאזורי תיירות לנוצרים מהארץ ומחו\"ל.",
    event_date: '2027-04-04',
    category: 'religion',
    tags: ['פסחא', 'נוצרי'],
  },

  // ─── Sports ───
  {
    id: 'static_ucl_final',
    _type: 'static',
    title: "גמר ליגת האלופות 2026",
    description: "גמר ליגת האלופות — אחד מהאירועים הנצפים ביותר בעולם. עסקי מזון, ספורט ובר-אירועים: זמן שיא לקמפיינים ממוקדי כדורגל.",
    event_date: '2026-05-30',
    category: 'sports',
    tags: ['כדורגל', 'ליגת האלופות', 'ספורט'],
  },
  {
    id: 'static_euro2026_start',
    _type: 'static',
    title: "יורו 2026 — אליפות אירופה בכדורגל",
    description: "אליפות אירופה 2026 — טורניר כדורגל בין-לאומי עם מיליוני צופים. הזדמנות עסקית ענקית לברים, מסעדות ועסקי ספורט.",
    event_date: '2026-06-10',
    category: 'sports',
    tags: ['כדורגל', 'יורו', 'ספורט'],
  },
  {
    id: 'static_world_cup_2026',
    _type: 'static',
    title: "גמר מונדיאל 2026 — קנדה/ארה\"ב/מקסיקו",
    description: "מונדיאל 2026 — גמר טורניר כדורגל העולמי. אירוע מדיה עולמי ענקי — הזדמנות שיווקית פיק לכל עסק.",
    event_date: '2026-07-19',
    category: 'sports',
    tags: ['מונדיאל', 'כדורגל', 'world cup'],
  },
  {
    id: 'static_premier_league_start',
    _type: 'static',
    title: "פתיחת עונת הפרמייר ליג 2026/27",
    description: "עונת הפרמייר ליג הבאה מתחילה — שיא הביקוש לתכנים כדורגליים, ערבי צפייה ומוצרי ספורט.",
    event_date: '2026-08-15',
    category: 'sports',
    tags: ['פרמייר ליג', 'כדורגל', 'ספורט'],
  },

  // ─── Commercial ───
  {
    id: 'static_mothers_day',
    _type: 'static',
    title: "יום האם — מבצעים ומתנות",
    description: "יום האם — אחד מהימים החזקים ביותר לרכישת מתנות ושירותים. הזדמנות למסעדות, חנויות מתנות, ספא וטיפוח.",
    event_date: '2026-05-10',
    category: 'commercial',
    tags: ['אמהות', 'מתנות', 'מסחרי'],
  },
  {
    id: 'static_fathers_day',
    _type: 'static',
    title: "יום האב — הזדמנות מסחרית",
    description: "יום האב — ביקוש לחוויות, ציוד ספורט, מסעדות ומוצרי גברים. מומלץ לפתח קמפיין ייעודי שבועיים מראש.",
    event_date: '2026-06-21',
    category: 'commercial',
    tags: ['אבות', 'מתנות', 'מסחרי'],
  },
  {
    id: 'static_back_to_school',
    _type: 'static',
    title: "חזרה לבית הספר — עונת ספטמבר",
    description: "חזרה ללימודים — עונה של קניות ממוקדות: ציוד לימודים, ביגוד, תזונה, ספורט חוגים. הורים מחפשים שירותים לילדים.",
    event_date: '2026-09-01',
    category: 'commercial',
    tags: ['חזרה ללימודים', 'ספטמבר', 'ילדים'],
  },
  {
    id: 'static_halloween',
    _type: 'static',
    title: "הלווין — עונת תחפושות ואירועים",
    description: "הלווין — גדל בישראל כאירוע חברתי. בארים, אירועים ומסעדות מארגנים מסיבות. הזדמנות לתחפושות, עיצוב ואירועים.",
    event_date: '2026-10-31',
    category: 'commercial',
    tags: ['הלווין', 'halloween', 'אירועים'],
  },
  {
    id: 'static_black_friday',
    _type: 'static',
    title: "בלאק פריידי — שיא עונת ההנחות",
    description: "בלאק פריידי 2026 — הכנה מוקדמת: לקוחות מחכים לסייל. הכנת מבצעים 2-3 שבועות מראש מגדילה מכירות משמעותית.",
    event_date: '2026-11-27',
    category: 'commercial',
    tags: ['בלאק פריידי', 'black friday', 'הנחות'],
  },
  {
    id: 'static_january_fitness',
    _type: 'static',
    title: "ינואר — עונת כושר והחלטות שנה חדשה",
    description: "ינואר 2027 — שיא ההרשמות לחדרי כושר, דיאטות, ויועצי בריאות. הזדמנות עסקית ענקית לענף הכושר והתזונה.",
    event_date: '2027-01-01',
    category: 'commercial',
    tags: ['ינואר', 'כושר', 'דיאטה', 'החלטות'],
  },
  {
    id: 'static_valentine',
    _type: 'static',
    title: "ולנטיין — יום האהבה הבינלאומי",
    description: "יום האהבה — ביקוש גבוה למסעדות, מתנות, פרחים, טיפוח וחוויות זוגיות. קמפיין ממוקד זוגות שבועיים מראש.",
    event_date: '2027-02-14',
    category: 'commercial',
    tags: ['ולנטיין', 'valentine', 'אהבה'],
  },

  // ─── Seasonal ───
  {
    id: 'static_summer_opening',
    _type: 'static',
    title: "פתיחת עונת הקיץ — יוני 2026",
    description: "קיץ 2026 מגיע — עסקים בתחומי בריכות, חופשות, מזגנים, אופנת קיץ ומשקאות קרים ייהנו מגל ביקוש. הכנה מוקדמת חיונית.",
    event_date: '2026-06-01',
    category: 'seasonal',
    tags: ['קיץ', 'summer', 'עונתי'],
  },
  {
    id: 'static_wedding_season',
    _type: 'static',
    title: "עונת החתונות — שיא הקיץ",
    description: "יוני–אוגוסט — עונת החתונות השיא. מספרות, מסעדות, ציוד לאירועים, ביגוד, פרחים ולוגיסטיקה — ביקוש בשיא.",
    event_date: '2026-06-15',
    category: 'seasonal',
    tags: ['חתונה', 'עונתי', 'קיץ'],
  },
  {
    id: 'static_renovation_fall',
    _type: 'static',
    title: "עונת השיפוצים — סתיו 2026",
    description: "ספטמבר–נובמבר — עונת השיפוצים השנייה בשנה. ביקוש לקבלנים, עיצוב פנים, חנויות בניה ומוצרי בית.",
    event_date: '2026-10-15',
    category: 'seasonal',
    tags: ['שיפוץ', 'renovation', 'עונתי'],
  },
  {
    id: 'static_winter_season',
    _type: 'static',
    title: "פתיחת עונת החורף — דצמבר",
    description: "חורף 2026 — ביקוש למוצרי חימום, ביגוד חורף, תחנות גז, טיפולי עור יבש ומסעדות חמות. זמן לקמפיין עונת החורף.",
    event_date: '2026-12-01',
    category: 'seasonal',
    tags: ['חורף', 'winter', 'עונתי'],
  },
];

function getCountdown(input, isDate = false) {
  if (!input) return null;
  const hours = isDate
    ? Math.ceil((new Date(input).getTime() - Date.now()) / 3600000)
    : Number(input);
  if (hours <= 0) return null;
  if (hours <= 24) return { text: `${hours} שעות`, urgent: true };
  const days = Math.ceil(hours / 24);
  if (days <= 3) return { text: `${days} ימים`, urgent: true };
  if (days <= 14) return { text: `${days} ימים`, urgent: false };
  return { text: `${Math.ceil(days / 7)} שבועות`, urgent: false };
}

function EventCard({ item, businessProfile, type }) {
  const [popup, setPopup] = useState(false);

  let title, description, tags;
  if (type === 'static') {
    title = item.title;
    description = item.description;
    tags = item.tags || [];
  } else {
    title = type === 'alert' ? item.title : item.agent_name || item.summary?.slice(0, 60);
    description = type === 'alert' ? item.description : item.summary;
    tags = item.tags || [];
  }

  let meta = {};
  if (type !== 'static') {
    try { meta = JSON.parse(type === 'alert' ? (item.source_agent || '{}') : (item.source_description || '{}')); } catch {}
  }

  const countdown = type === 'static'
    ? getCountdown(item.event_date, true)
    : getCountdown(meta.urgency_hours);

  const category = type === 'static' ? item.category : classifyEvent(title, description, tags);

  const categoryIcons = {
    sports:     '⚽',
    holiday:    '✡️',
    religion:   '🕌',
    seasonal:   '🌿',
    commercial: '🛍️',
    other:      '📅',
  };

  const fakeSignal = {
    id: item.id,
    summary: description,
    agent_name: title,
    category: 'event',
    source_description: type === 'alert' ? item.source_agent : item.source_description,
    impact_level: meta.impact || 'medium',
  };

  return (
    <div className={`card-base p-4 fade-in-up border-r-4 ${countdown?.urgent ? 'border-r-red-400 bg-red-50/30' : 'border-r-blue-300'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-base">{categoryIcons[category] || '📅'}</span>
            <span className="text-[13px] font-semibold text-foreground leading-snug">{title}</span>
            {countdown && (
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                countdown.urgent
                  ? 'bg-red-50 text-red-600 border-red-200'
                  : 'bg-blue-50 text-blue-600 border-blue-200'
              }`}>
                <Clock className="w-3 h-3" />
                בעוד {countdown.text}
              </span>
            )}
            {type === 'static' && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-secondary text-foreground-muted border border-border">
                לוח שנה
              </span>
            )}
          </div>
          <p className="text-[12px] text-foreground-secondary leading-relaxed mb-2 line-clamp-3">{description}</p>
          {meta.action_label && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              <TrendingUp className="w-3.5 h-3.5 text-primary opacity-60" />
              <span>{meta.action_label}</span>
              {meta.time_minutes && <span className="opacity-60">· {meta.time_minutes} דקות</span>}
            </div>
          )}
        </div>
        <button
          onClick={() => setPopup(true)}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all"
        >
          <Zap className="w-3.5 h-3.5" />
          פעל עכשיו
        </button>
      </div>

      {popup && (
        <ActionPopup
          signal={fakeSignal}
          businessProfile={businessProfile}
          onClose={() => setPopup(false)}
        />
      )}
    </div>
  );
}

export default function Events() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [scanning, setScanning] = useState(false);

  const { data: eventAlerts = [], isLoading: loadingAlerts } = useQuery({
    queryKey: ['eventAlerts', bpId],
    queryFn: () => base44.entities.ProactiveAlert.filter({ linked_business: bpId, alert_type: 'market_opportunity' }, '-created_date', 50),
    enabled: !!bpId,
  });

  const { data: eventSignals = [], isLoading: loadingSignals } = useQuery({
    queryKey: ['eventSignals', bpId],
    queryFn: () => base44.entities.MarketSignal.filter({ linked_business: bpId, category: 'event' }, '-detected_at', 50),
    enabled: !!bpId,
  });

  const isLoading = loadingAlerts || loadingSignals;

  function extractEventDate(item) {
    // Static events have a structured event_date field — use it directly
    if (item.event_date) return new Date(item.event_date).getTime();
    // DB events: try metadata, then text regex, then creation date
    const text = item._type === 'alert' ? (item.description || '') : (item.summary || '');
    const m = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])).getTime();
    try {
      const meta = JSON.parse(item._type === 'alert' ? (item.source_agent || '{}') : (item.source_description || '{}'));
      if (meta.urgency_hours) return Date.now() + Number(meta.urgency_hours) * 3600000;
    } catch {}
    return new Date(item.created_date || item.detected_at || 0).getTime();
  }

  // Merge: DB items + static events, dedup by title, keep only future events from static
  const dbItems = [
    ...eventAlerts.map(a => ({ ...a, _type: 'alert' })),
    ...eventSignals.map(s => ({ ...s, _type: 'signal' })),
  ];

  const dbTitlesLower = new Set(dbItems.map(i => (i._type === 'alert' ? i.title : i.agent_name || '').toLowerCase()));

  const staticFiltered = STATIC_EVENTS.filter(e => {
    const isPast = new Date(e.event_date).getTime() < Date.now() - 86400000; // skip if more than 1 day past
    const isDup = dbTitlesLower.has(e.title.toLowerCase());
    return !isPast && !isDup;
  });

  const allItems = [...dbItems, ...staticFiltered]
    .sort((a, b) => extractEventDate(a) - extractEventDate(b));

  const categoryMap = useMemo(() => {
    const map = new Map();
    allItems.forEach(item => {
      if (item._type === 'static') { map.set(item.id, item.category); return; }
      const title = item._type === 'alert' ? item.title : (item.agent_name || '');
      const desc  = item._type === 'alert' ? item.description : item.summary;
      map.set(item.id, classifyEvent(title, desc, item.tags || []));
    });
    return map;
  }, [allItems]);

  const getCategory = (item) => categoryMap.get(item.id) || 'other';

  const filtered = activeTab === 'all'
    ? allItems
    : allItems.filter(item => getCategory(item) === activeTab);

  const countByTab = {
    holiday:    allItems.filter(i => getCategory(i) === 'holiday').length,
    religion:   allItems.filter(i => getCategory(i) === 'religion').length,
    sports:     allItems.filter(i => getCategory(i) === 'sports').length,
    seasonal:   allItems.filter(i => getCategory(i) === 'seasonal').length,
    commercial: allItems.filter(i => getCategory(i) === 'commercial').length,
  };

  const handleScan = async () => {
    setScanning(true);
    toast.info('סורק אירועים קרובים...');
    try {
      const res = await base44.functions.invoke('detectEvents', { businessProfileId: bpId });
      const found = res?.data?.signals_created ?? 0;
      queryClient.invalidateQueries({ queryKey: ['eventAlerts', bpId] });
      queryClient.invalidateQueries({ queryKey: ['eventSignals', bpId] });
      toast.success(found > 0 ? `נמצאו ${found} אירועים רלוונטיים ✓` : 'הסריקה הושלמה — בדוק שוב בעוד מספר שניות');
    } catch {
      toast.error('שגיאה בסריקת אירועים');
    }
    setScanning(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold text-foreground tracking-tight">אירועים והזדמנויות</h1>
          <p className="text-[12px] text-foreground-muted mt-0.5">
            חגים מכל הדתות, אירועי ספורט, עונות מסחריות — הזדמנויות צמיחה לעסק שלך
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
          {scanning ? 'סורק...' : 'סרוק אירועים ←'}
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'סה"כ אירועים', value: allItems.length, color: 'text-primary' },
          { label: 'חגים יהודיים',  value: countByTab.holiday,    color: 'text-purple-500' },
          { label: 'ספורט',         value: countByTab.sports,     color: 'text-green-600' },
          { label: 'מסחרי/עונתי',  value: countByTab.commercial + countByTab.seasonal, color: 'text-amber-500' },
        ].map(card => (
          <div key={card.label} className="card-base p-4 fade-in-up">
            <p className="text-[10px] font-medium text-foreground-muted mb-1">{card.label}</p>
            <span className={`text-[24px] font-bold tracking-tight ${card.color}`}>{card.value}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-border overflow-x-auto">
        {EVENT_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative whitespace-nowrap ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {tab.label}
            {tab.key !== 'all' && countByTab[tab.key] > 0 && (
              <span className="mr-1 text-[9px] font-bold text-foreground-muted">({countByTab[tab.key]})</span>
            )}
            {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-foreground-muted" />
          <span className="text-[13px] text-foreground-muted">טוען אירועים...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-base py-20 text-center fade-in-up">
          <Calendar className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted mb-1">
            {activeTab === 'all' ? 'טרם זוהו אירועים רלוונטיים לעסק שלך' : `אין אירועים בקטגוריית "${EVENT_TABS.find(t=>t.key===activeTab)?.label}"`}
          </p>
          <p className="text-[11px] text-foreground-muted opacity-50">לחץ "סרוק אירועים" לזהות הזדמנויות קרובות</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <EventCard
              key={`${item._type}-${item.id}`}
              item={item}
              type={item._type}
              businessProfile={businessProfile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
