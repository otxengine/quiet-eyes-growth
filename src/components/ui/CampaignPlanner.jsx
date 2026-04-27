import React, { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Target, TrendingUp, Users, MousePointerClick, Eye, Zap, Info } from 'lucide-react';

// ── Platform & Objective config ───────────────────────────────────────────────

const PLATFORMS = [
  { id: 'meta',      label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  { id: 'instagram', label: 'Instagram',  icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  { id: 'google',    label: 'Google Ads', icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
];

const OBJECTIVES = [
  { id: 'awareness',   label: 'מודעות',  icon: '👁',  desc: 'חשיפה לכמה שיותר אנשים' },
  { id: 'traffic',     label: 'תנועה',   icon: '🌐',  desc: 'קליקים לאתר / דף נחיתה' },
  { id: 'leads',       label: 'לידים',   icon: '🎯',  desc: 'הגשת פרטים ויצירת קשר' },
  { id: 'conversions', label: 'מכירות',  icon: '💰',  desc: 'רכישות ישירות' },
];

const DURATIONS = [7, 14, 30];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}
function fmtIls(n) {
  if (n == null) return '—';
  return `₪${n % 1 === 0 ? n : Number(n).toFixed(1)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon, label, low, mid, high, format = fmtNum, accent = '#4f46e5' }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px]">{icon}</span>
        <span className="text-[10px] text-gray-400 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-[11px] text-gray-300">{format(low)}</span>
        <span className="text-[15px] font-bold" style={{ color: accent }}>{format(mid)}</span>
        <span className="text-[11px] text-gray-300">{format(high)}</span>
      </div>
      <div className="text-[8px] text-gray-300 leading-none">נמוך · ממוצע · גבוה</div>
    </div>
  );
}

function AudienceMeter({ min, max }) {
  // Shows a visual "broad ↔ specific" reach bar like Facebook Ads Manager
  const label = max > 500000 ? 'רחב מדי' : max > 100000 ? 'רחב' : max > 30000 ? 'מאוזן' : 'ספציפי';
  const pct   = max > 500000 ? 90 : max > 100000 ? 70 : max > 30000 ? 45 : 25;
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
      <div className="flex justify-between text-[9px] text-blue-400 mb-1">
        <span>ספציפי</span>
        <span className="font-bold text-blue-700">{label}</span>
        <span>רחב</span>
      </div>
      <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-blue-700 font-bold text-center mt-1.5">
        {fmtNum(min)} – {fmtNum(max)} אנשים פוטנציאליים
      </p>
    </div>
  );
}

function InterestChip({ label, platform }) {
  const colors = {
    meta:      { color: '#1877f2', bg: '#e7f3ff' },
    instagram: { color: '#e1306c', bg: '#fde8f0' },
    google:    { color: '#4285f4', bg: '#e8f0fe' },
  };
  const { color, bg } = colors[platform] || colors.meta;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border"
      style={{ color, background: bg, borderColor: `${color}33` }}>
      {label}
    </span>
  );
}

function KeywordRow({ term, match }) {
  const matchColors = {
    exact:  { label: '[מדויק]',  color: '#1e40af', bg: '#dbeafe' },
    phrase: { label: '"ביטוי"',  color: '#065f46', bg: '#d1fae5' },
    broad:  { label: 'רחב',     color: '#92400e', bg: '#fef3c7' },
    negative: { label: '−שלילה', color: '#991b1b', bg: '#fee2e2' },
  };
  const m = matchColors[match] || matchColors.broad;
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[11px] text-gray-700">{term}</span>
      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
        style={{ color: m.color, background: m.bg }}>{m.label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * CampaignPlanner
 *
 * Props:
 *   businessProfile  — { id, name, category, city }
 *   onClose          — optional close handler
 */
export default function CampaignPlanner({ businessProfile, onClose }) {
  const [platform,  setPlatform]  = useState('meta');
  const [objective, setObjective] = useState('leads');
  const [budget,    setBudget]    = useState(50);
  const [days,      setDays]      = useState(7);
  const [result,    setResult]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const selectedPlatform = PLATFORMS.find(p => p.id === platform);

  const estimate = useCallback(async () => {
    const bpId = businessProfile?.id;
    if (!bpId) {
      setError('לא נמצא פרופיל עסקי — נסה לרענן את הדף');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res  = await base44.functions.invoke('estimateCampaignMetrics', {
        businessProfileId: bpId,
        platform,
        daily_budget_ils:  Number(budget),
        objective,
        campaign_days:     Number(days),
      });
      const data = res?.data || res;
      if (!data?.metrics) throw new Error('תגובה לא תקינה מהשרת');
      setResult(data);
    } catch (e) {
      setError(e.message || 'שגיאה בחישוב — נסה שוב');
    } finally {
      setLoading(false);
    }
  }, [businessProfile, platform, objective, budget, days]);

  const m  = result?.metrics;
  const t  = result?.targeting;
  const isMeta = platform !== 'google';

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Platform tabs ── */}
      <div>
        <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">פלטפורמה</p>
        <div className="grid grid-cols-3 gap-2">
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => { setPlatform(p.id); setResult(null); }}
              className="flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-[11px] font-semibold transition-all"
              style={{
                background:   platform === p.id ? p.bg : '#fff',
                borderColor:  platform === p.id ? p.color : '#e5e7eb',
                color:        platform === p.id ? p.color : '#6b7280',
              }}>
              <span className="text-[18px]">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Objective ── */}
      <div>
        <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">מטרת הקמפיין</p>
        <div className="grid grid-cols-2 gap-2">
          {OBJECTIVES.map(o => (
            <button key={o.id} onClick={() => { setObjective(o.id); setResult(null); }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-right transition-all"
              style={{
                background:  objective === o.id ? '#f0fdf4' : '#fff',
                borderColor: objective === o.id ? '#16a34a' : '#e5e7eb',
              }}>
              <span className="text-[16px] flex-shrink-0">{o.icon}</span>
              <div>
                <p className="text-[11px] font-bold" style={{ color: objective === o.id ? '#15803d' : '#374151' }}>{o.label}</p>
                <p className="text-[9px] text-gray-400">{o.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Budget + Duration ── */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">תקציב יומי</p>
          <div className="relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-bold">₪</span>
            <input type="number" min={10} max={10000} step={10}
              value={budget}
              onChange={e => { setBudget(Math.max(10, Number(e.target.value))); setResult(null); }}
              className="w-full border-2 border-gray-200 rounded-xl py-2.5 pr-8 pl-3 text-[14px] font-bold text-gray-800 focus:outline-none focus:border-indigo-400 transition-colors" />
          </div>
          {/* Budget tier quick-select will be shown after first estimate */}
          {result?.budget_tiers && (
            <div className="flex gap-1 mt-1.5">
              {[['מינימלי', result.budget_tiers.starter], ['צמיחה', result.budget_tiers.growth], ['אגרסיבי', result.budget_tiers.aggressive]].map(([lbl, val]) => (
                <button key={lbl} onClick={() => { setBudget(val); setResult(null); }}
                  className="flex-1 text-[9px] py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-all font-medium">
                  ₪{val}<br /><span className="text-[8px]">{lbl}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">משך הקמפיין</p>
          <div className="grid grid-cols-3 gap-1.5">
            {DURATIONS.map(d => (
              <button key={d} onClick={() => { setDays(d); setResult(null); }}
                className="py-2.5 rounded-xl border-2 text-[13px] font-bold transition-all"
                style={{
                  background:  days === d ? '#4f46e5' : '#fff',
                  borderColor: days === d ? '#4f46e5' : '#e5e7eb',
                  color:       days === d ? '#fff'    : '#6b7280',
                }}>
                {d}
                <span className="text-[9px] block font-normal">{d === 7 ? 'שבוע' : d === 14 ? 'שבועיים' : 'חודש'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Total budget summary */}
      <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-100">
        <span className="text-[11px] text-gray-500">סה"כ תקציב קמפיין</span>
        <span className="text-[15px] font-black text-gray-800">₪{budget * days}</span>
      </div>

      {/* ── Calculate button ── */}
      <button onClick={estimate} disabled={loading}
        className="w-full py-3 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 transition-all shadow-sm"
        style={{ background: loading ? '#a5b4fc' : (selectedPlatform?.color || '#4f46e5') }}>
        {loading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> מחשב תחזית...</>
          : <><Zap className="w-4 h-4" /> חשב תחזית קמפיין</>}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[11px] text-red-700 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RESULTS PANEL — only shown after calculate
          ══════════════════════════════════════════════════════════════════════ */}
      {result && m && (
        <div className="space-y-4 border-t border-gray-100 pt-4">

          {/* ── Estimated Daily Results (Facebook-style header card) ── */}
          <div className="rounded-2xl border-2 p-4 space-y-3"
            style={{ borderColor: selectedPlatform?.color + '44', background: selectedPlatform?.bg || '#f5f3ff' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[16px]">{selectedPlatform?.icon}</span>
              <div>
                <p className="text-[12px] font-bold text-gray-800">תוצאות יומיות צפויות</p>
                <p className="text-[10px] text-gray-500">לתקציב יומי ₪{budget} | {days} ימים</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/80 rounded-xl p-2.5 text-center">
                <p className="text-[9px] text-gray-400 mb-0.5">חשיפות יומיות</p>
                <p className="text-[16px] font-black text-gray-800">{fmtNum(m.daily_impressions?.mid)}</p>
                <p className="text-[9px] text-gray-400">{fmtNum(m.daily_impressions?.low)}–{fmtNum(m.daily_impressions?.high)}</p>
              </div>
              <div className="bg-white/80 rounded-xl p-2.5 text-center">
                <p className="text-[9px] text-gray-400 mb-0.5">הגעה יומית</p>
                <p className="text-[16px] font-black text-gray-800">{fmtNum(m.daily_reach?.mid)}</p>
                <p className="text-[9px] text-gray-400">{fmtNum(m.daily_reach?.low)}–{fmtNum(m.daily_reach?.high)}</p>
              </div>
              <div className="bg-white/80 rounded-xl p-2.5 text-center">
                <p className="text-[9px] text-gray-400 mb-0.5">קליקים יומיים</p>
                <p className="text-[16px] font-black" style={{ color: selectedPlatform?.color }}>{fmtNum(m.daily_clicks?.mid)}</p>
                <p className="text-[9px] text-gray-400">{fmtNum(m.daily_clicks?.low)}–{fmtNum(m.daily_clicks?.high)}</p>
              </div>
              <div className="bg-white/80 rounded-xl p-2.5 text-center">
                <p className="text-[9px] text-gray-400 mb-0.5">{objective === 'leads' ? 'לידים יומיים' : 'המרות יומיות'}</p>
                <p className="text-[16px] font-black text-green-600">{fmtNum(m.daily_leads?.mid)}</p>
                <p className="text-[9px] text-gray-400">{fmtNum(m.daily_leads?.low)}–{fmtNum(m.daily_leads?.high)}</p>
              </div>
            </div>
          </div>

          {/* ── Cost metrics ── */}
          <div>
            <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">עלויות</p>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard icon="📊" label="CTR" low={`${m.ctr_pct?.low}%`} mid={`${m.ctr_pct?.mid}%`} high={`${m.ctr_pct?.high}%`} format={v => v} accent="#4f46e5" />
              <MetricCard icon="🖱" label="עלות לקליק" low={m.cpc_ils?.low} mid={m.cpc_ils?.mid} high={m.cpc_ils?.high} format={fmtIls} accent="#d97706" />
              <MetricCard icon="🎯" label="עלות לליד" low={m.cost_per_lead_ils?.low} mid={m.cost_per_lead_ils?.mid} high={m.cost_per_lead_ils?.high} format={fmtIls} accent="#dc2626" />
            </div>
          </div>

          {/* ── Campaign total ── */}
          <div>
            <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">סיכום {days} ימים</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                <span className="text-[10px] text-gray-500">חשיפות כוללות</span>
                <span className="text-[12px] font-bold text-gray-800">{fmtNum(m.total_impressions?.mid)}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                <span className="text-[10px] text-gray-500">הגעה כוללת</span>
                <span className="text-[12px] font-bold text-gray-800">{fmtNum(m.total_reach?.mid)}</span>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                <span className="text-[10px] text-gray-500">קליקים כוללים</span>
                <span className="text-[12px] font-bold text-gray-800">{fmtNum(m.total_clicks?.mid)}</span>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex justify-between items-center">
                <span className="text-[10px] text-green-600">לידים כוללים</span>
                <span className="text-[12px] font-bold text-green-700">{fmtNum(m.total_leads?.mid)}</span>
              </div>
            </div>
          </div>

          {/* ── Targeting panel ── */}
          {t && (
            <div>
              <p className="text-[10px] text-gray-400 font-semibold mb-2 uppercase tracking-wider">
                {isMeta ? '📘 טרגטינג לפי פורמט Meta Ads' : '🔍 טרגטינג לפי פורמט Google Ads'}
              </p>

              {isMeta ? (
                <div className="space-y-3">
                  {/* Audience size meter */}
                  {t.estimated_audience_min && (
                    <AudienceMeter min={t.estimated_audience_min} max={t.estimated_audience_max} />
                  )}

                  {/* Demographics */}
                  <div className="bg-white border border-gray-100 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-gray-500 mb-2">👥 דמוגרפיה</p>
                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-700">
                      <span className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1">גיל {t.age_min}–{t.age_max}</span>
                      <span className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1">{t.genders}</span>
                      <span className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1">📍 {result.city} +{t.geo_radius_km || 20}km</span>
                    </div>
                  </div>

                  {/* Detailed Targeting — Interests */}
                  {t.fb_interests?.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">✅ Detailed Targeting — תחומי עניין</p>
                      <div className="text-[9px] text-gray-400 mb-2">אנשים שתואמים לאחד מהבאים:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {t.fb_interests.map((item, i) => (
                          <InterestChip key={i} label={item} platform={platform} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Behaviors */}
                  {t.fb_behaviors?.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">⚡ Behaviors</p>
                      <div className="flex flex-wrap gap-1.5">
                        {t.fb_behaviors.map((item, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-600">{item}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom Audiences */}
                  {(t.lookalike_seed || t.custom_audience_tip) && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
                      <p className="text-[10px] font-semibold text-indigo-700">🔁 Custom & Lookalike Audiences</p>
                      {t.lookalike_seed && (
                        <div>
                          <p className="text-[9px] text-indigo-400 mb-0.5">Lookalike seed:</p>
                          <p className="text-[10px] text-indigo-800">{t.lookalike_seed}</p>
                        </div>
                      )}
                      {t.custom_audience_tip && (
                        <div>
                          <p className="text-[9px] text-indigo-400 mb-0.5">Custom Audience:</p>
                          <p className="text-[10px] text-indigo-800">{t.custom_audience_tip}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Retargeting */}
                  {t.retargeting_suggestion && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                      <p className="text-[9px] text-amber-500 mb-0.5 font-semibold">🔄 רטרגטינג מוצע</p>
                      <p className="text-[10px] text-amber-800">{t.retargeting_suggestion}</p>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Google Ads targeting ── */
                <div className="space-y-3">
                  {/* Keywords */}
                  {(t.keywords_exact?.length > 0 || t.keywords_broad?.length > 0) && (
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">🔑 מילות מפתח</p>
                      <div className="divide-y divide-gray-50">
                        {(t.keywords_exact || []).map((kw, i) => <KeywordRow key={`e${i}`} term={kw} match="exact" />)}
                        {(t.keywords_broad || []).map((kw, i) => <KeywordRow key={`b${i}`} term={kw} match="broad" />)}
                        {(t.keywords_negative || []).map((kw, i) => <KeywordRow key={`n${i}`} term={kw} match="negative" />)}
                      </div>
                    </div>
                  )}

                  {/* In-Market Audiences */}
                  {t.in_market_audiences?.length > 0 && (
                    <div className="bg-white border border-gray-100 rounded-xl p-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-2">🎯 In-Market Audiences</p>
                      <div className="flex flex-wrap gap-1.5">
                        {t.in_market_audiences.map((a, i) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 font-medium">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Settings */}
                  <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-gray-500 mb-2">⚙️ הגדרות קמפיין</p>
                    {t.location_targeting && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">📍 מיקוד גיאוגרפי</span>
                        <span className="text-gray-700 font-medium">{t.location_targeting}</span>
                      </div>
                    )}
                    {t.ad_schedule && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">🕐 לוח שידור</span>
                        <span className="text-gray-700 font-medium">{t.ad_schedule}</span>
                      </div>
                    )}
                    {t.bid_strategy && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-400">📈 אסטרטגיית בידינג</span>
                        <span className="text-gray-700 font-medium">{t.bid_strategy}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CPM note */}
          <p className="text-[9px] text-gray-300 text-center">{result.benchmark_note}</p>
        </div>
      )}
    </div>
  );
}
