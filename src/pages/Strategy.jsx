/**
 * Strategy page — redesigned to match new Figma design.
 *
 * Top section: AI chat input ("מה המטרה שלך?") + quick chips
 * → Submitting generates a focused strategy via LLM and shows result cards.
 *
 * Bottom section: "אסטרטגיות במיוחד עבורך"
 * → Auto-generated system recommendations cached in localStorage (daily).
 * → Each card shows title, description, "מבוסס על" tags, time, steps.
 * → "הצג תוכנית פעולה" expands the card inline with numbered steps.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { ChevronLeft, Clock, Link2, MoreVertical, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import KoriAvatar from '@/components/onboarding/KoriAvatar';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

const QUICK_CHIPS = [
  'להשיג 3 לקוחות חדשים',
  'להגדיל כמות משלוחים ב-20%',
  'להעלות מחירים',
  'לגייס עובדים',
];

const TAG_COLORS = [
  'bg-purple-50 text-purple-700',
  'bg-blue-50  text-blue-700',
  'bg-green-50  text-green-700',
  'bg-pink-50   text-pink-700',
  'bg-amber-50  text-amber-700',
];

// ── localStorage cache (keyed per business + day) ────────────────────────────

function recoCacheKey(bpId) {
  return `strategy_recos_${bpId}_${new Date().toISOString().slice(0, 10)}`;
}
function readRecoCache(bpId) {
  try { return JSON.parse(localStorage.getItem(recoCacheKey(bpId)) || 'null'); } catch { return null; }
}
function writeRecoCache(bpId, data) {
  try { localStorage.setItem(recoCacheKey(bpId), JSON.stringify(data)); } catch {}
}

// ── Intelligence context builder ─────────────────────────────────────────────
// Extracts agent_missions + business_deep_profile from the loaded businessProfile
// and formats them as a concise LLM-ready block.

function buildIntelContext(bp) {
  if (!bp) return '';
  const parts = [];

  // Agent missions (generated at onboarding by LLM planner)
  try {
    const m = JSON.parse(bp.agent_missions || '{}');
    if (m.quick_wins_he?.length)
      parts.push(`ניצחונות מהירים שזוהו ע"י AI:\n${m.quick_wins_he.slice(0, 3).map(w => `• ${w}`).join('\n')}`);
    if (m.weekly_focus_he)   parts.push(`מוקד שבועי: ${m.weekly_focus_he}`);
    if (m.market_watch_he)   parts.push(`לעקוב בשוק: ${m.market_watch_he}`);
    if (m.business_summary)  parts.push(`תקציר עסקי (AI): ${m.business_summary}`);
  } catch {}

  // Deep profile (scraped from website + social URLs)
  try {
    const dp = JSON.parse(bp.business_deep_profile || '{}');
    if (dp.actual_services?.length)
      parts.push(`שירותים מאומתים מהאתר: ${dp.actual_services.join(', ')}`);
    if (dp.unique_selling_points?.length)
      parts.push(`יתרונות ייחודיים: ${dp.unique_selling_points.join(' | ')}`);
    if (dp.target_audience_detected)
      parts.push(`קהל יעד מזוהה: ${dp.target_audience_detected}`);
    if (dp.sector_specific_insights?.length)
      parts.push(`תובנות סקטור AI:\n${dp.sector_specific_insights.slice(0, 2).map(i => `• ${i}`).join('\n')}`);
    if (dp.price_range)
      parts.push(`טווח מחירים: ${dp.price_range}`);
  } catch {}

  return parts.length > 0
    ? `\n=== נתוני AI Intelligence Machine ===\n${parts.join('\n')}\n=== סוף נתוני AI ===\n`
    : '';
}

// ── LLM JSON call ────────────────────────────────────────────────────────────

async function callLLM(prompt) {
  const result = await base44.integrations.Core.InvokeLLM({ model: 'sonnet', maxTokens: 900, prompt });
  const text  = typeof result === 'string' ? result : (result?.content || '{}');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in response');
  return JSON.parse(match[0]);
}

// ── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({ s }) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col gap-3">
      {/* Header */}
      <div dir="rtl" className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-[14px] text-gray-900 leading-snug flex-1">{s.title}</h3>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="text-gray-300 hover:text-gray-500 p-1 rounded"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute left-0 top-7 bg-white border border-gray-100 shadow-lg rounded-xl py-1 z-20 min-w-[110px]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                onClick={() => setMenuOpen(false)}
                className="w-full text-right px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50"
              >
                התעלם
              </button>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-full text-right px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-50"
              >
                שתף
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-gray-500 leading-relaxed" dir="rtl">{s.description}</p>

      {/* Based-on tags */}
      <div dir="rtl">
        <p className="text-[10px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">מבוסס על</p>
        <div className="flex flex-wrap gap-1.5">
          {(s.based_on || []).map((tag, i) => (
            <span key={i} className={`text-[10px] px-2.5 py-1 rounded-full font-medium ${TAG_COLORS[i % TAG_COLORS.length]}`}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Expanded steps */}
      {expanded && s.steps?.length > 0 && (
        <ol dir="rtl" className="space-y-2 border-t border-gray-100 pt-3">
          {s.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12px] text-gray-700">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-50 text-rose-600 font-bold text-[10px] flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Footer */}
      <div dir="rtl" className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {s.time_minutes || 2} דק׳
          </span>
          <span className="flex items-center gap-1">
            <Link2 className="w-3.5 h-3.5" />
            {s.steps_count || s.steps?.length || 4} שלבים
          </span>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[12px] font-semibold border border-rose-300 text-rose-600 px-4 py-1.5 rounded-full hover:bg-rose-50 transition-colors whitespace-nowrap"
        >
          {expanded ? 'הסתר' : 'הצג תוכנית פעולה'}
        </button>
      </div>
    </div>
  );
}

// ── Skeleton loader ──────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse space-y-3">
      <div className="h-4 bg-gray-100 rounded w-3/4" />
      <div className="space-y-1.5">
        <div className="h-3 bg-gray-50 rounded w-full" />
        <div className="h-3 bg-gray-50 rounded w-5/6" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <div className="h-6 w-20 bg-purple-50 rounded-full" />
        <div className="h-6 w-24 bg-blue-50 rounded-full" />
        <div className="h-6 w-16 bg-pink-50 rounded-full" />
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-gray-50">
        <div className="flex gap-3">
          <div className="h-3 w-12 bg-gray-50 rounded" />
          <div className="h-3 w-14 bg-gray-50 rounded" />
        </div>
        <div className="h-8 w-32 bg-rose-50 rounded-full" />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Strategy() {
  const { businessProfile } = useOutletContext();
  const bpId     = businessProfile?.id;
  const userName = businessProfile?.owner_name || businessProfile?.name || '';

  // Chat (on-demand strategy from user goal)
  const [chatGoal,    setChatGoal]    = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatResult,  setChatResult]  = useState(null);

  // System recommendations (auto-generated, cached daily)
  const [recos,        setRecos]        = useState(null);
  const [recosLoading, setRecosLoading] = useState(false);

  // ── Generate focused strategy from user goal ──────────────────────────────
  const sendGoal = useCallback(async (goal) => {
    const g = goal.trim();
    if (!g || chatLoading || !bpId) return;
    setChatGoal('');
    setChatLoading(true);
    setChatResult(null);
    try {
      const intelCtx = buildIntelContext(businessProfile);
      const parsed = await callLLM(
        `אתה יועץ עסקי AI לעסקים קטנים ישראלים. בעל עסק "${businessProfile.name}" (${businessProfile.category || 'עסק'}, ${businessProfile.city || ''}) הגדיר את המטרה: "${g}"
${intelCtx}
בנה 2 אסטרטגיות פעולה ספציפיות ומעשיות להשגת המטרה. כל אסטרטגיה ממוקדת, מבוססת על המידע שלמעלה, ומותאמת לעסק הזה בדיוק.
השתמש בנתוני ה-Intelligence Machine לעיל — אל תמציא נתונים שאינם מופיעים שם.

החזר JSON בלבד (ללא \`\`\`json ולא טקסט נוסף):
{
  "strategies": [
    {
      "title": "שם האסטרטגיה (עד 5 מילים)",
      "description": "מה המערכת זיהתה ולמה האסטרטגיה הזו רלוונטית — כולל נתון קונקרטי אחד לפחות (2-3 משפטים)",
      "based_on": ["מקור נתון 1", "מקור נתון 2", "מקור נתון 3"],
      "time_minutes": 3,
      "steps_count": 4,
      "steps": ["שלב 1: ...", "שלב 2: ...", "שלב 3: ...", "שלב 4: ..."]
    }
  ]
}`
      );
      if (!Array.isArray(parsed.strategies) || parsed.strategies.length === 0) throw new Error('empty');
      setChatResult(parsed);
    } catch (err) {
      console.error('[Strategy chat]', err);
      toast.error('לא הצלחנו לייצר אסטרטגיה. נסה שוב.');
    }
    setChatLoading(false);
  }, [bpId, businessProfile, chatLoading]);

  // ── Auto-generate system recommendations (daily cache) ────────────────────
  const generateRecos = useCallback(async (force = false) => {
    if (!bpId || !businessProfile) return;
    if (!force) {
      const cached = readRecoCache(bpId);
      if (cached?.strategies?.length) { setRecos(cached); return; }
    }
    setRecosLoading(true);
    try {
      const intelCtx = buildIntelContext(businessProfile);
      const parsed = await callLLM(
        `אתה יועץ עסקי AI. נתח את עסק "${businessProfile.name}" (${businessProfile.category || 'עסק'}, ${businessProfile.city || ''}) בהתבסס על נתוני ה-Intelligence Machine שלהלן וזהה 2 תחומים מרכזיים לשיפור.
${intelCtx}
לכל תחום — בנה אסטרטגיה מפורטת עם שלבים ברורים, המבוססת על הנתונים לעיל בלבד.
הימנע מהמלצות גנריות — כל שלב חייב להתייחס לנתון ספציפי מהפרופיל לעיל.

החזר JSON בלבד (ללא \`\`\`json ולא טקסט נוסף):
{
  "strategies": [
    {
      "title": "שם האסטרטגיה (עד 5 מילים)",
      "description": "מה המערכת זיהתה בניתוח הנתונים ולמה אסטרטגיה זו חיונית — עם נתון קונקרטי (אחוז, מספר, טווח זמן) (2-3 משפטים)",
      "based_on": ["מקור נתון 1", "מקור נתון 2", "מקור נתון 3"],
      "time_minutes": 2,
      "steps_count": 4,
      "steps": ["שלב 1: ...", "שלב 2: ...", "שלב 3: ...", "שלב 4: ..."]
    }
  ]
}`
      );
      if (!Array.isArray(parsed.strategies) || parsed.strategies.length === 0) throw new Error('empty');
      writeRecoCache(bpId, parsed);
      setRecos(parsed);
    } catch (err) {
      console.error('[Strategy recos]', err);
    }
    setRecosLoading(false);
  }, [bpId, businessProfile]);

  useEffect(() => {
    if (bpId) generateRecos(false);
  }, [bpId]); // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ── Hero: avatar + greeting + chat input + chips ──────────────────── */}
      <div
        className="flex flex-col items-center text-center gap-5 pt-4 pb-6 rounded-2xl relative overflow-hidden"
        style={{
          backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      >
        <KoriAvatar size="lg" className="shadow-md" />

        <div className="space-y-1">
          <h1 className="text-[22px] font-bold text-gray-900">{getGreeting()} {userName},</h1>
          <h1 className="text-[22px] font-bold text-gray-900">בוא נבנה יחד אסטרטגיה מנצחת!</h1>
        </div>

        {/* Chat input */}
        <div className="flex items-center bg-white border border-gray-200 rounded-full shadow-sm w-full max-w-2xl overflow-hidden pr-5 pl-1.5 py-1.5">
          <input
            value={chatGoal}
            onChange={e => setChatGoal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendGoal(chatGoal)}
            placeholder="מה המטרה שלך?"
            dir="rtl"
            className="flex-1 bg-transparent text-[13px] text-gray-700 placeholder:text-gray-400 outline-none min-w-0"
          />
          <button
            onClick={() => sendGoal(chatGoal)}
            disabled={!chatGoal.trim() || chatLoading}
            className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
            style={{ marginRight: '8px' }}
          >
            {chatLoading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin block" />
              : <ChevronLeft className="w-5 h-5 text-white" />}
          </button>
        </div>

        {/* Quick chips */}
        <div className="flex flex-wrap gap-2 justify-center">
          {QUICK_CHIPS.map((chip, i) => (
            <button
              key={i}
              onClick={() => sendGoal(chip)}
              disabled={chatLoading}
              className="text-[12px] font-medium bg-white border border-gray-200 text-gray-700 px-4 py-1.5 rounded-full hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat result ───────────────────────────────────────────────────── */}
      {chatLoading && (
        <div className="space-y-3">
          <div dir="rtl" className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            <span className="text-[13px] text-gray-500">מייצר אסטרטגיה מותאמת אישית...</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton /><CardSkeleton />
          </div>
        </div>
      )}

      {!chatLoading && chatResult?.strategies?.length > 0 && (
        <div className="space-y-3">
          <div dir="rtl" className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <h2 className="text-[14px] font-bold text-gray-900">האסטרטגיה שלך מוכנה</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {chatResult.strategies.map((s, i) => <StrategyCard key={i} s={s} />)}
          </div>
        </div>
      )}

      {/* ── System recommendations ────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-5 border border-gray-100"
        style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f5f0ff 50%, #fff0f6 100%)' }}
      >
        {/* Section header */}
        <div dir="rtl" className="flex items-start justify-between mb-5">
          <button
            onClick={() => generateRecos(true)}
            disabled={recosLoading}
            className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${recosLoading ? 'animate-spin' : ''}`} />
            עדכן
          </button>
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">אסטרטגיות במיוחד עבורך</h2>
            <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
              המערכת ניתחה את הנתונים ובנתה אסטרטגיה לשיפור בכל אחד מהתחומים הבאים
            </p>
          </div>
        </div>

        {/* Skeletons while loading */}
        {recosLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton /><CardSkeleton />
          </div>
        )}

        {/* Recommendation cards */}
        {!recosLoading && recos?.strategies?.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recos.strategies.map((s, i) => <StrategyCard key={i} s={s} />)}
          </div>
        )}

        {/* Empty state */}
        {!recosLoading && !recos && (
          <div className="text-center py-8">
            <p className="text-[13px] text-gray-400 mb-3">
              המערכת מכינה המלצות אסטרטגיות מותאמות לעסק שלך...
            </p>
            <button
              onClick={() => generateRecos(true)}
              className="text-[12px] font-semibold text-purple-600 hover:underline flex items-center gap-1.5 mx-auto"
            >
              <Sparkles className="w-3.5 h-3.5" />
              צור המלצות עכשיו
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
