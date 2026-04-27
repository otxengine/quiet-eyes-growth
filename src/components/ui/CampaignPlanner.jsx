import React, { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, TrendingUp, Users, MousePointerClick, Eye, Target, Zap } from 'lucide-react';

const PLATFORMS = [
  { id: 'meta',      label: 'Facebook',  icon: '📘', color: '#1877f2' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#e1306c' },
  { id: 'google',    label: 'Google',    icon: '🔍', color: '#4285f4' },
];

const OBJECTIVES = [
  { id: 'awareness',    label: 'מודעות',  icon: '👁',  desc: 'חשיפה מקסימלית' },
  { id: 'traffic',      label: 'תנועה',   icon: '🌐',  desc: 'קליקים לאתר' },
  { id: 'leads',        label: 'לידים',   icon: '🎯',  desc: 'הגשת פרטים' },
  { id: 'conversions',  label: 'מכירות',  icon: '💰',  desc: 'רכישות ישירות' },
];

const DURATIONS = [7, 14, 30];

function fmt(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtIls(n) {
  if (!n && n !== 0) return '—';
  return `₪${n % 1 === 0 ? n : n.toFixed(1)}`;
}

function RangeBar({ low, mid, high, format = fmt, label, icon, color = '#4f46e5' }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[10px] text-gray-500 font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[11px] text-gray-400">{format(low)}</span>
        <span className="text-[13px] font-bold" style={{ color }}>{format(mid)}</span>
        <span className="text-[11px] text-gray-400">{format(high)}</span>
      </div>
      <div className="text-[9px] text-gray-300 mt-0.5">נמוך · ממוצע · גבוה</div>
    </div>
  );
}

function TagList({ items, color = '#4f46e5', bg = '#eef2ff' }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.slice(0, 6).map((item, i) => (
        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{ color, background: bg, border: `1px solid ${color}22` }}>
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * CampaignPlanner
 * Props:
 *   businessProfile  — { id, name, category, city }
 *   audienceSegments — from getAudienceSegments (optional, for pre-filling targeting)
 *   onClose          — optional close handler
 */
export default function CampaignPlanner({ businessProfile, audienceSegments, onClose }) {
  const [platform,  setPlatform]  = useState('meta');
  const [objective, setObjective] = useState('leads');
  const [budget,    setBudget]    = useState(50);
  const [days,      setDays]      = useState(7);
  const [result,    setResult]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const estimate = useCallback(async () => {
    if (!businessProfile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await base44.functions.invoke('estimateCampaignMetrics', {
        businessProfileId: businessProfile.id,
        platform,
        daily_budget_ils: budget,
        objective,
        campaign_days: days,
      });
      setResult(data);
    } catch (e) {
      setError(e.message || 'שגיאה בחישוב');
    } finally {
      setLoading(false);
    }
  }, [businessProfile, platform, objective, budget, days]);

  const m = result?.metrics;
  const t = result?.targeting;
  const isMeta = platform !== 'google';

  // Pick best matching audience segment for display
  const topSegment = audienceSegments?.[0] || null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-indigo-600" />
          <span className="text-[13px] font-bold text-gray-800">תכנון קמפיין ממומן</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-[18px] leading-none">×</button>
        )}
      </div>

      {/* Platform selector */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1.5 font-medium">פלטפורמה</p>
        <div className="grid grid-cols-3 gap-1.5">
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              className="flex flex-col items-center gap-0.5 py-2 rounded-xl border text-[11px] font-medium transition-all"
              style={{
                background: platform === p.id ? `${p.color}12` : '#fff',
                borderColor: platform === p.id ? p.color : '#e5e7eb',
                color: platform === p.id ? p.color : '#6b7280',
              }}
            >
              <span className="text-[16px]">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Objective selector */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1.5 font-medium">מטרת הקמפיין</p>
        <div className="grid grid-cols-2 gap-1.5">
          {OBJECTIVES.map(o => (
            <button
              key={o.id}
              onClick={() => setObjective(o.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border text-right transition-all"
              style={{
                background: objective === o.id ? '#eef2ff' : '#fff',
                borderColor: objective === o.id ? '#4f46e5' : '#e5e7eb',
              }}
            >
              <span className="text-[15px]">{o.icon}</span>
              <div>
                <p className="text-[11px] font-semibold" style={{ color: objective === o.id ? '#4f46e5' : '#374151' }}>{o.label}</p>
                <p className="text-[9px] text-gray-400">{o.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Budget + Duration */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-gray-400 mb-1 font-medium">תקציב יומי (₪)</p>
          <div className="relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">₪</span>
            <input
              type="number"
              min={10} max={5000} step={10}
              value={budget}
              onChange={e => setBudget(Math.max(10, Number(e.target.value)))}
              className="w-full border border-gray-200 rounded-xl py-2 pr-7 pl-3 text-[13px] font-bold text-gray-800 focus:outline-none focus:border-indigo-400"
            />
          </div>
          {result?.budget_tiers && (
            <div className="flex gap-1 mt-1">
              {[['מינימלי', result.budget_tiers.starter], ['צמיחה', result.budget_tiers.growth], ['אגרסיבי', result.budget_tiers.aggressive]].map(([label, val]) => (
                <button key={label} onClick={() => setBudget(val)}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-all">
                  ₪{val}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[10px] text-gray-400 mb-1 font-medium">משך (ימים)</p>
          <div className="grid grid-cols-3 gap-1">
            {DURATIONS.map(d => (
              <button key={d} onClick={() => setDays(d)}
                className="py-2 rounded-xl border text-[12px] font-bold transition-all"
                style={{
                  background: days === d ? '#4f46e5' : '#fff',
                  borderColor: days === d ? '#4f46e5' : '#e5e7eb',
                  color: days === d ? '#fff' : '#6b7280',
                }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Total budget pill */}
      <div className="text-center">
        <span className="text-[10px] text-gray-400">סה"כ תקציב: </span>
        <span className="text-[12px] font-bold text-indigo-700">₪{budget * days}</span>
      </div>

      {/* Calculate button */}
      <button
        onClick={estimate}
        disabled={loading}
        className="w-full py-2.5 rounded-xl text-[12px] font-bold text-white transition-all flex items-center justify-center gap-2"
        style={{ background: loading ? '#a5b4fc' : '#4f46e5' }}
      >
        {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> מחשב...</> : <><Zap className="w-3.5 h-3.5" /> חשב תחזית קמפיין</>}
      </button>

      {error && <p className="text-[11px] text-red-500 text-center">{error}</p>}

      {/* ── Results panel ── */}
      {result && m && (
        <div className="space-y-3 mt-1">
          {/* Predicted metrics grid */}
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-2">📊 תחזית ל-{days} ימים</p>
            <div className="grid grid-cols-2 gap-2">
              <RangeBar icon="👁" label="חשיפות כוללות"    low={m.total_impressions?.low} mid={m.total_impressions?.mid} high={m.total_impressions?.high} />
              <RangeBar icon="👥" label="אנשים שיראו"      low={m.total_reach?.low}       mid={m.total_reach?.mid}       high={m.total_reach?.high} />
              <RangeBar icon="👆" label="קליקים"           low={m.total_clicks?.low}      mid={m.total_clicks?.mid}      high={m.total_clicks?.high} />
              <RangeBar icon="🎯" label={objective === 'leads' ? 'לידים' : 'המרות'}
                low={m.total_leads?.low} mid={m.total_leads?.mid} high={m.total_leads?.high} color="#059669" />
            </div>
          </div>

          {/* Cost metrics */}
          <div>
            <p className="text-[10px] text-gray-400 font-medium mb-2">💰 עלויות</p>
            <div className="grid grid-cols-3 gap-2">
              <RangeBar icon="💵" label="CPM (לאלף)" low={m.cpm_ils?.low}         mid={m.cpm_ils?.mid}         high={m.cpm_ils?.high}         format={fmtIls} color="#d97706" />
              <RangeBar icon="🖱" label="CPC (לקליק)" low={m.cpc_ils?.low}        mid={m.cpc_ils?.mid}         high={m.cpc_ils?.high}         format={fmtIls} color="#d97706" />
              <RangeBar icon="📋" label="עלות/ליד"    low={m.cost_per_lead_ils?.low} mid={m.cost_per_lead_ils?.mid} high={m.cost_per_lead_ils?.high} format={fmtIls} color="#dc2626" />
            </div>
          </div>

          {/* CTR */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-[11px] text-indigo-700 font-medium">CTR צפוי</span>
            <span className="text-[13px] font-bold text-indigo-800">
              {m.ctr_pct?.low}% – {m.ctr_pct?.high}%
            </span>
          </div>

          {/* ── Audience targeting panel ── */}
          {t && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-400 font-medium">🎯 טרגטינג מוכן להדבקה</p>

              {isMeta ? (
                <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-2.5">
                  {/* Interests */}
                  {t.fb_interests?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">תחומי עניין (Detailed Targeting)</p>
                      <TagList items={t.fb_interests} color="#1877f2" bg="#e7f3ff" />
                    </div>
                  )}
                  {/* Behaviors */}
                  {t.fb_behaviors?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">התנהגויות (Behaviors)</p>
                      <TagList items={t.fb_behaviors} color="#6b7280" bg="#f3f4f6" />
                    </div>
                  )}
                  {/* Demographics */}
                  <div className="flex gap-3 text-[10px] text-gray-600">
                    <span>🎂 {t.age_min}–{t.age_max}</span>
                    <span>⚧ {t.genders}</span>
                    <span>📍 {result.city} +{t.geo_radius_km || 20}km</span>
                  </div>
                  {/* Audience size */}
                  {t.estimated_audience_min && (
                    <div className="bg-blue-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-blue-700">גודל קהל פוטנציאלי</span>
                      <span className="text-[11px] font-bold text-blue-800">
                        {fmt(t.estimated_audience_min)} – {fmt(t.estimated_audience_max)}
                      </span>
                    </div>
                  )}
                  {/* Lookalike */}
                  {t.lookalike_seed && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-0.5">Lookalike Audience seed</p>
                      <p className="text-[10px] text-gray-700 bg-gray-50 rounded-lg px-2 py-1">{t.lookalike_seed}</p>
                    </div>
                  )}
                  {/* Custom audience */}
                  {t.custom_audience_tip && (
                    <div className="text-[10px] text-indigo-700 bg-indigo-50 rounded-lg px-2 py-1.5">
                      💡 {t.custom_audience_tip}
                    </div>
                  )}
                </div>
              ) : (
                /* Google Ads targeting */
                <div className="bg-white border border-gray-100 rounded-xl p-3 space-y-2.5">
                  {t.keywords_exact?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">ביטויים מדויקים [exact match]</p>
                      <TagList items={t.keywords_exact} color="#4285f4" bg="#e8f0fe" />
                    </div>
                  )}
                  {t.keywords_broad?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">ביטויים רחבים [broad match]</p>
                      <TagList items={t.keywords_broad} color="#34a853" bg="#e6f4ea" />
                    </div>
                  )}
                  {t.keywords_negative?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">מילות שלילה [negative]</p>
                      <TagList items={t.keywords_negative} color="#ea4335" bg="#fce8e6" />
                    </div>
                  )}
                  {t.in_market_audiences?.length > 0 && (
                    <div>
                      <p className="text-[9px] text-gray-400 mb-1">קהלים In-Market</p>
                      <TagList items={t.in_market_audiences} color="#fbbc04" bg="#fef9e7" />
                    </div>
                  )}
                  {t.ad_schedule && (
                    <div className="flex justify-between text-[10px] text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5">
                      <span>🕐 לוח שידור</span>
                      <span className="font-medium">{t.ad_schedule}</span>
                    </div>
                  )}
                  {t.bid_strategy && (
                    <div className="flex justify-between text-[10px] text-gray-600 bg-gray-50 rounded-lg px-2 py-1.5">
                      <span>📈 אסטרטגיית בידינג</span>
                      <span className="font-medium">{t.bid_strategy}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Audience segment tip from getAudienceSegments */}
          {topSegment && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <p className="text-[10px] text-indigo-500 mb-1 font-medium">💡 טיפ לקריאייטיב — {topSegment.segment_name}</p>
              <p className="text-[11px] text-indigo-800">{topSegment.ad_creative_tip || topSegment.description}</p>
              {topSegment.purchase_trigger && (
                <p className="text-[10px] text-indigo-600 mt-1">טריגר לרכישה: {topSegment.purchase_trigger}</p>
              )}
            </div>
          )}

          <p className="text-[9px] text-gray-400 text-center">{result.benchmark_note}</p>
        </div>
      )}
    </div>
  );
}
