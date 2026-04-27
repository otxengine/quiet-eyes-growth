import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Loader2, RefreshCw, ChevronDown, ChevronUp, Send, ArrowRight,
  Eye, MousePointerClick, Users, TrendingUp, Zap, CheckCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Config ────────────────────────────────────────────────────────────────────

const PLATFORMS = [
  { id: 'meta',      label: 'Facebook',   icon: '📘', color: '#1877f2', bg: '#e7f3ff' },
  { id: 'instagram', label: 'Instagram',  icon: '📸', color: '#e1306c', bg: '#fde8f0' },
  { id: 'google',    label: 'Google Ads', icon: '🔍', color: '#4285f4', bg: '#e8f0fe' },
];

const OBJECTIVES = [
  { id: 'awareness',   label: 'מודעות',  desc: 'חשיפה לכמה שיותר אנשים' },
  { id: 'traffic',     label: 'תנועה',   desc: 'קליקים לאתר' },
  { id: 'leads',       label: 'לידים',   desc: 'יצירת קשר ופרטים' },
  { id: 'conversions', label: 'מכירות',  desc: 'רכישות ישירות' },
];

const DURATIONS = [7, 14, 30];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000)    return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

function fmtRange(low, high) {
  if (low == null && high == null) return '—';
  if (low === high || high == null) return fmtNum(low);
  return `${fmtNum(low)}–${fmtNum(high)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/40 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="text-right">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          {subtitle && <p className="text-[11px] text-foreground-muted">{subtitle}</p>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, low, high, unit = '', accent }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3 bg-secondary/50 rounded-xl border border-border">
      <Icon className="w-4 h-4" style={{ color: accent }} />
      <span className="text-[15px] font-bold text-foreground">
        {unit}{fmtRange(low, high)}
      </span>
      <span className="text-[10px] text-foreground-muted text-center">{label}</span>
    </div>
  );
}

function InterestChip({ label, platform }) {
  const colors = {
    meta:      { bg: '#e7f3ff', color: '#1877f2' },
    instagram: { bg: '#fde8f0', color: '#e1306c' },
    google:    { bg: '#e8f0fe', color: '#4285f4' },
  };
  const c = colors[platform] || colors.meta;
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border" style={{ background: c.bg, color: c.color, borderColor: c.color + '33' }}>
      {label}
    </span>
  );
}

function KeywordRow({ term, match }) {
  const matchConfig = {
    exact:   { label: 'מדויק',  bg: '#dcfce7', color: '#166534' },
    phrase:  { label: 'ביטוי',  bg: '#fef9c3', color: '#854d0e' },
    broad:   { label: 'רחב',    bg: '#f3f4f6', color: '#374151' },
    negative:{ label: 'שלילה',  bg: '#fee2e2', color: '#991b1b' },
  };
  const mc = matchConfig[match] || matchConfig.broad;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className="text-[11px] font-medium text-foreground flex-1">{term}</span>
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: mc.bg, color: mc.color }}>
        {mc.label}
      </span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CampaignCreate() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bpId = businessProfile?.id;

  // URL context from signal
  const signalId      = searchParams.get('signalId') || '';
  const signalSummary = searchParams.get('summary') || '';
  const signalAction  = searchParams.get('action')  || '';
  const signalCat     = searchParams.get('category') || '';

  // Form state
  const [postContent,  setPostContent]  = useState('');
  const [platform,     setPlatform]     = useState('meta');
  const [objective,    setObjective]    = useState('leads');
  const [budget,       setBudget]       = useState(50);
  const [days,         setDays]         = useState(7);
  const [chosenSeg,    setChosenSeg]    = useState(null); // selected audience segment

  // Async state
  const [generatingPost,  setGeneratingPost]  = useState(false);
  const [loadingAudience, setLoadingAudience] = useState(false);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [saving,          setSaving]          = useState(false);

  const [audienceData,  setAudienceData]  = useState(null);
  const [forecastData,  setForecastData]  = useState(null);
  const [error,         setError]         = useState('');

  const platConfig = PLATFORMS.find(p => p.id === platform) || PLATFORMS[0];

  // ── Auto-generate post on load ────────────────────────────────────────────

  const generatePost = useCallback(async () => {
    if (!businessProfile) return;
    setGeneratingPost(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'haiku',
        prompt: `כתוב פוסט שיווקי לרשת חברתית בעברית עבור עסק "${businessProfile.name}" (${businessProfile.category} ב${businessProfile.city}).
${signalSummary ? `הזדמנות/מגמה: "${signalSummary}"` : ''}
${signalAction  ? `מטרת הקמפיין: ${signalAction}` : ''}
פלטפורמת פרסום: ${platConfig.label}
מטרה: ${OBJECTIVES.find(o => o.id === objective)?.label || objective}

כתוב 3-4 משפטים בלבד: טון חברותי, מניע לפעולה בסוף, אמוג'י אחד-שניים. ללא כותרות.`,
      });
      const text = typeof result === 'string' ? result.trim() : (result?.content || '');
      setPostContent(text);
    } catch (e) {
      toast.error('שגיאה ביצירת הפוסט');
    }
    setGeneratingPost(false);
  }, [businessProfile, signalSummary, signalAction, platConfig.label, objective]);

  useEffect(() => {
    if (businessProfile && !postContent) generatePost();
  }, [businessProfile]); // eslint-disable-line

  // ── Load audience segments ────────────────────────────────────────────────

  const loadAudience = async () => {
    if (!bpId) return;
    setLoadingAudience(true);
    try {
      const res = await base44.functions.invoke('getAudienceSegments', {
        businessProfileId: bpId,
        insight_text: signalSummary,
        action_type: signalCat,
      });
      const data = res?.data || res;
      setAudienceData(data);
      if (data?.segments?.length) setChosenSeg(data.segments[0]);
    } catch (e) {
      toast.error('שגיאה בטעינת קהלי יעד');
    }
    setLoadingAudience(false);
  };

  // ── Load forecast ─────────────────────────────────────────────────────────

  const loadForecast = async () => {
    if (!bpId || !budget) return;
    setLoadingForecast(true);
    setError('');
    try {
      const res = await base44.functions.invoke('estimateCampaignMetrics', {
        businessProfileId: bpId,
        platform,
        daily_budget_ils: Number(budget),
        objective,
        campaign_days: Number(days),
      });
      const data = res?.data || res;
      setForecastData(data);
    } catch (e) {
      setError(e?.message || 'שגיאה בחישוב תחזית');
    }
    setLoadingForecast(false);
  };

  // ── Publish / Save ────────────────────────────────────────────────────────

  const handlePublish = async (asDraft = false) => {
    if (!bpId) { toast.error('חסר מזהה עסק'); return; }
    if (!postContent.trim()) { toast.error('יש להזין תוכן לפוסט'); return; }
    setSaving(true);
    try {
      const m = forecastData?.metrics;
      await base44.entities.Campaign.create({
        linked_business: bpId,
        signal_id:        signalId || null,
        signal_summary:   signalSummary || null,
        title:            signalSummary ? `קמפיין: ${signalSummary.slice(0, 60)}` : `קמפיין ${platConfig.label}`,
        platform,
        objective,
        post_content:     postContent,
        audience_json:    chosenSeg ? JSON.stringify(chosenSeg) : null,
        daily_budget_ils: Number(budget),
        campaign_days:    Number(days),
        total_budget_ils: Number(budget) * Number(days),
        est_reach_low:    m?.total_reach?.low  ?? null,
        est_reach_high:   m?.total_reach?.high ?? null,
        est_leads_low:    m?.total_leads?.low  ?? null,
        est_leads_high:   m?.total_leads?.high ?? null,
        status:           asDraft ? 'draft' : 'published',
        published_at:     asDraft ? null : new Date().toISOString(),
      });
      toast.success(asDraft ? 'נשמר כטיוטה' : 'הקמפיין פורסם! 🎉');
      navigate('/campaigns');
    } catch (e) {
      toast.error('שגיאה בשמירת הקמפיין');
    }
    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!businessProfile) {
    return (
      <div className="p-6 text-center text-foreground-muted" dir="rtl">
        לא נמצא פרופיל עסקי
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate('/campaigns')} className="text-foreground-muted hover:text-foreground">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-[17px] font-bold text-foreground">יצירת קמפיין</h1>
          <p className="text-[11px] text-foreground-muted">{businessProfile.name} · {businessProfile.city}</p>
        </div>
      </div>

      {/* Signal banner */}
      {signalSummary && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <Zap className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-semibold text-amber-800 mb-0.5">מבוסס על תובנה</p>
            <p className="text-[11px] text-amber-700">{signalSummary}</p>
          </div>
        </div>
      )}

      {/* ── 1. Post content ── */}
      <SectionCard title="תוכן הפוסט" subtitle="ערוך את הטקסט או בקש תוכן חדש">
        <div className="p-4 space-y-3">
          <textarea
            value={postContent}
            onChange={e => setPostContent(e.target.value)}
            rows={5}
            placeholder="הפוסט ייווצר אוטומטית..."
            className="w-full text-[13px] text-foreground bg-secondary border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
          />
          <div className="flex gap-2">
            <button
              onClick={generatePost}
              disabled={generatingPost}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] text-foreground-muted hover:text-foreground hover:bg-secondary transition-all"
            >
              {generatingPost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              צור תוכן חדש
            </button>
          </div>
        </div>
      </SectionCard>

      {/* ── 2. Platform & Objective ── */}
      <SectionCard title="פלטפורמה ומטרה">
        <div className="p-4 space-y-4">
          {/* Platform tabs */}
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted mb-2">פלטפורמה</p>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all"
                  style={{
                    background: platform === p.id ? p.bg : 'transparent',
                    borderColor: platform === p.id ? p.color : 'hsl(var(--border))',
                    color: platform === p.id ? p.color : 'hsl(var(--foreground-muted))',
                  }}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Objective */}
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted mb-2">מטרת הקמפיין</p>
            <div className="grid grid-cols-2 gap-2">
              {OBJECTIVES.map(o => (
                <button
                  key={o.id}
                  onClick={() => setObjective(o.id)}
                  className="flex flex-col items-start px-3 py-2 rounded-lg border text-right transition-all"
                  style={{
                    background: objective === o.id ? 'hsl(var(--sidebar-accent-active))' : 'transparent',
                    borderColor: objective === o.id ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  }}
                >
                  <span className="text-[12px] font-semibold text-foreground">{o.label}</span>
                  <span className="text-[10px] text-foreground-muted">{o.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── 3. Budget & Duration ── */}
      <SectionCard title="תקציב ומשך">
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-foreground-muted block mb-1.5">
              תקציב יומי (₪)
            </label>
            <input
              type="number"
              min={10}
              value={budget}
              onChange={e => setBudget(e.target.value)}
              className="w-full text-[14px] font-bold text-foreground bg-secondary border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-foreground-muted mb-1.5">משך הקמפיין</p>
            <div className="flex gap-2">
              {DURATIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className="flex-1 py-2 rounded-lg border text-[12px] font-medium transition-all"
                  style={{
                    background: days === d ? 'hsl(var(--foreground))' : 'transparent',
                    color: days === d ? 'hsl(var(--background))' : 'hsl(var(--foreground-muted))',
                    borderColor: days === d ? 'hsl(var(--foreground))' : 'hsl(var(--border))',
                  }}
                >
                  {d}י׳
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 pb-3">
          <p className="text-[11px] text-foreground-muted">
            תקציב כולל: <span className="font-bold text-foreground">₪{Number(budget) * Number(days)}</span>
          </p>
        </div>
      </SectionCard>

      {/* ── 4. Audience ── */}
      <SectionCard title="קהל יעד" subtitle="טרגטינג מוכן לפייסבוק / גוגל" defaultOpen={false}>
        <div className="p-4">
          {!audienceData && (
            <button
              onClick={loadAudience}
              disabled={loadingAudience}
              className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[12px] font-semibold hover:opacity-90 transition-all"
            >
              {loadingAudience ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {loadingAudience ? 'טוען קהלי יעד...' : 'טען קהלי יעד'}
            </button>
          )}

          {audienceData?.segments?.length > 0 && (
            <div className="space-y-3">
              {audienceData.segments.map((seg, i) => {
                const isChosen = chosenSeg === seg;
                return (
                  <button
                    key={i}
                    onClick={() => setChosenSeg(seg)}
                    className="w-full text-right px-4 py-3 rounded-xl border-2 transition-all"
                    style={{
                      borderColor: isChosen ? platConfig.color : 'hsl(var(--border))',
                      background: isChosen ? platConfig.bg : 'transparent',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-bold text-foreground">{seg.segment_name}</span>
                      <div className="flex items-center gap-2">
                        {isChosen && <CheckCircle className="w-4 h-4" style={{ color: platConfig.color }} />}
                        <span className="text-[10px] text-foreground-muted">{seg.estimated_audience_range}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-foreground-muted mb-2">{seg.description}</p>

                    {/* FB interests */}
                    {platform !== 'google' && seg.facebook_targeting?.interests?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {seg.facebook_targeting.interests.slice(0, 5).map((interest, j) => (
                          <InterestChip key={j} label={interest} platform={platform} />
                        ))}
                      </div>
                    )}

                    {/* Google keywords */}
                    {platform === 'google' && seg.google_targeting?.keywords?.length > 0 && (
                      <div className="border border-border rounded-lg overflow-hidden">
                        {seg.google_targeting.keywords.slice(0, 3).map((kw, j) => (
                          <KeywordRow key={j} term={kw} match="exact" />
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground-muted">
                      <span>גיל: {seg.age_min}–{seg.age_max}</span>
                      <span>{seg.genders}</span>
                      <span>המרה: {Math.round((seg.conversion_probability || 0) * 100)}%</span>
                    </div>
                    {seg.ad_creative_tip && (
                      <p className="mt-1.5 text-[10px] text-foreground-muted bg-secondary/50 rounded-lg px-2 py-1">
                        💡 {seg.ad_creative_tip}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── 5. Forecast ── */}
      <SectionCard title="תחזית ביצועים" subtitle="הערכת תוצאות על בסיס נתוני שוק ישראל" defaultOpen={false}>
        <div className="p-4">
          {!forecastData && !loadingForecast && (
            <button
              onClick={loadForecast}
              className="flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-lg text-[12px] font-semibold hover:opacity-90 transition-all"
            >
              <TrendingUp className="w-4 h-4" /> חשב תחזית
            </button>
          )}
          {loadingForecast && (
            <div className="flex items-center gap-2 text-[12px] text-foreground-muted py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> מחשב תחזית...
            </div>
          )}
          {error && (
            <div className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {forecastData?.metrics && !loadingForecast && (
            <div className="space-y-4">
              {/* Daily metrics */}
              <div>
                <p className="text-[10px] font-semibold text-foreground-muted mb-2 uppercase tracking-wider">ביום</p>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    icon={Eye} label="חשיפות" accent="#6366f1"
                    low={forecastData.metrics.daily_impressions?.low}
                    high={forecastData.metrics.daily_impressions?.high}
                  />
                  <MetricCard
                    icon={Users} label="הגעה" accent="#8b5cf6"
                    low={forecastData.metrics.daily_reach?.low}
                    high={forecastData.metrics.daily_reach?.high}
                  />
                  <MetricCard
                    icon={MousePointerClick} label="קליקים" accent="#f59e0b"
                    low={forecastData.metrics.daily_clicks?.low}
                    high={forecastData.metrics.daily_clicks?.high}
                  />
                  <MetricCard
                    icon={TrendingUp} label={objective === 'leads' ? 'לידים' : 'המרות'} accent="#10b981"
                    low={forecastData.metrics.daily_leads?.low}
                    high={forecastData.metrics.daily_leads?.high}
                  />
                </div>
              </div>

              {/* Campaign totals */}
              <div>
                <p className="text-[10px] font-semibold text-foreground-muted mb-2 uppercase tracking-wider">
                  סה״כ לקמפיין ({days} ימים)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MetricCard
                    icon={Eye} label="חשיפות כולל" accent="#6366f1"
                    low={forecastData.metrics.total_impressions?.low}
                    high={forecastData.metrics.total_impressions?.high}
                  />
                  <MetricCard
                    icon={TrendingUp} label="לידים כולל" accent="#10b981"
                    low={forecastData.metrics.total_leads?.low}
                    high={forecastData.metrics.total_leads?.high}
                  />
                </div>
              </div>

              {/* Benchmark rates */}
              <div className="flex flex-wrap gap-3 text-[11px] text-foreground-muted border-t border-border pt-3">
                <span>CTR: {forecastData.metrics.ctr_pct?.low}–{forecastData.metrics.ctr_pct?.high}%</span>
                <span>CPC: ₪{forecastData.metrics.cpc_ils?.low}–₪{forecastData.metrics.cpc_ils?.high}</span>
                <span>CPM: ₪{forecastData.metrics.cpm_ils?.low}–₪{forecastData.metrics.cpm_ils?.high}</span>
                {forecastData.metrics.cost_per_lead_ils?.mid > 0 && (
                  <span>עלות/ליד: ₪{forecastData.metrics.cost_per_lead_ils?.mid}</span>
                )}
              </div>
              {forecastData.benchmark_note && (
                <p className="text-[10px] text-foreground-muted opacity-60">{forecastData.benchmark_note}</p>
              )}

              <button
                onClick={loadForecast}
                className="flex items-center gap-1.5 text-[11px] text-foreground-muted hover:text-foreground transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> עדכן תחזית
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Publish bar ── */}
      <div className="sticky bottom-4 bg-card border border-border rounded-xl shadow-lg px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => handlePublish(true)}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-[13px] text-foreground-muted hover:text-foreground transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          שמור טיוטה
        </button>
        <button
          onClick={() => handlePublish(false)}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-bold text-background hover:opacity-90 transition-all"
          style={{ background: platConfig.color }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          פרסם ב-{platConfig.label}
        </button>
        <div className="text-right">
          <p className="text-[12px] font-bold text-foreground">₪{Number(budget) * Number(days)}</p>
          <p className="text-[10px] text-foreground-muted">סה״כ</p>
        </div>
      </div>
    </div>
  );
}
