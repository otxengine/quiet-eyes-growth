import React, { useState, lazy, Suspense, Component } from 'react';

class SilentBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, MapPin, ArrowLeft, Clock, Instagram, Globe, X, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
const CompetitorSwotCard = lazy(() => import('@/components/competitors/CompetitorSwotCard'));
import CompetitorStrategyCard from '@/components/competitors/CompetitorStrategyCard';
import DismissMenu from '@/components/ui/DismissMenu';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function parseList(str, max = 2) {
  if (!str) return [];
  return str
    .split(/[,\n•]+/)
    .map(s => s.replace(/^\[.*?\]\s*/, '').trim())
    .filter(s => s.length > 2)
    .slice(0, max);
}

function UrlInput({ label, fieldKey, initialValue, competitorId }) {
  const [val, setVal] = useState(initialValue || '');
  const save = () => {
    if (val === (initialValue || '')) return;
    base44.entities.Competitor.update(competitorId, { [fieldKey]: val || null })
      .catch(() => toast.error('שגיאה בשמירת קישור'));
  };
  const clear = (e) => {
    e.stopPropagation();
    setVal('');
    base44.entities.Competitor.update(competitorId, { [fieldKey]: null })
      .catch(() => toast.error('שגיאה בשמירת קישור'));
  };
  return (
    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
      <span className="text-[10px] text-foreground-muted w-16 flex-shrink-0">{label}</span>
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        placeholder="הוסף קישור..."
        className="flex-1 min-w-0 text-[11px] bg-transparent border-b border-border focus:border-primary/50 outline-none py-0.5 text-foreground-secondary placeholder-foreground-muted/40 transition-colors"
      />
      {val && (
        <button onClick={clear} className="text-foreground-muted/50 hover:text-danger transition-colors flex-shrink-0">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export default function CompetitorDetailCard({
  competitor,
  businessName,
  signals = [],
  businessProfileId,
  otxBizId,
  intelChanges = [],
  onDelete,
  onDismissed,
  onDeepAnalysis,
}) {
  const [expanded, setExpanded] = useState(false);
  const comp = competitor;
  const initials = (comp.name || '??').substring(0, 2);

  const firstName = (comp.name || '').split(' ')[0].toLowerCase();
  const intelAlert = intelChanges.find(c =>
    (c._kind === 'alert' || c.change_type === 'intel') &&
    (c.competitor_name || '').toLowerCase().includes(firstName)
  );

  const strengths  = parseList(comp.strengths,  2);
  const complaints = parseList(comp.weaknesses, 2);
  const services   = comp.services || comp.menu_highlights || '';
  const hasVoice   = strengths.length > 0 || complaints.length > 0 || comp.recent_reviews_summary;
  const hasOffer   = services || comp.price_range || comp.current_promotions;

  return (
    <div className="card-base">
      {/* ── Header (always visible) ───────────────────────────────────── */}
      <div className="px-5 py-4 cursor-pointer select-none" onClick={() => setExpanded(v => !v)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-foreground-muted text-[10px] font-bold flex-shrink-0">
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-foreground truncate">{comp.name}</span>
              {comp.current_promotions && (
                <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-50 border border-orange-200 text-orange-700 flex-shrink-0">
                  מבצע פעיל
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {comp.category && <span className="text-[10px] text-foreground-muted">{comp.category}</span>}
              {comp.address && (
                <span className="text-[10px] text-foreground-muted flex items-center gap-0.5">
                  <MapPin className="w-2.5 h-2.5" />{comp.address}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1">
              <span className={`text-[20px] font-bold ${
                comp.rating >= 4.3 ? 'text-success' :
                comp.rating >= 4   ? 'text-warning'  : 'text-danger'
              }`}>
                {comp.rating != null ? Number(comp.rating).toFixed(1) : '—'}
              </span>
              {comp.trend_direction === 'up'   && <TrendingUp   className="w-3.5 h-3.5 text-success" />}
              {comp.trend_direction === 'down' && <TrendingDown className="w-3.5 h-3.5 text-danger"  />}
              {(!comp.trend_direction || comp.trend_direction === 'stable') && (
                <Minus className="w-3.5 h-3.5 text-foreground-muted opacity-30" />
              )}
            </div>
            <span className="text-[10px] text-foreground-muted">{comp.review_count || 0} ביקורות</span>
            {expanded
              ? <ChevronUp   className="w-4 h-4 text-foreground-muted opacity-40" />
              : <ChevronDown className="w-4 h-4 text-foreground-muted opacity-40" />}
          </div>
        </div>
      </div>

      {/* ── Expanded content ─────────────────────────────────────────── */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4 fade-in-up">

          {hasOffer && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">מה הם מציעים</p>
              <div className="space-y-1.5">
                {services && (
                  <p className="text-[11px] text-foreground-secondary leading-snug">{services.slice(0, 150)}</p>
                )}
                {comp.price_range && (
                  <p className="text-[11px] text-foreground-muted">
                    טווח מחירים:{' '}<span className="text-foreground font-medium">{comp.price_range}</span>
                  </p>
                )}
                {comp.current_promotions && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-100 text-[11px] text-orange-700">
                    <span className="font-medium">מבצע:</span>{' '}{comp.current_promotions.slice(0, 90)}
                    {comp.last_promo_detected_at && (
                      <span className="text-[10px] text-orange-400 mr-1">· {timeAgo(comp.last_promo_detected_at)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {hasVoice && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">מה הלקוחות אומרים</p>
              <div className="space-y-1">
                {strengths.map((s, i) => (
                  <div key={`s${i}`} className="flex items-start gap-2">
                    <span className="text-success text-[10px] mt-0.5 flex-shrink-0">✓</span>
                    <p className="text-[11px] text-foreground-secondary">{s}</p>
                  </div>
                ))}
                {complaints.map((w, i) => (
                  <div key={`w${i}`} className="flex items-start gap-2">
                    <span className="text-danger text-[10px] mt-0.5 flex-shrink-0">✗</span>
                    <p className="text-[11px] text-foreground-secondary">{w}</p>
                  </div>
                ))}
                {!strengths.length && !complaints.length && comp.recent_reviews_summary && (
                  <p className="text-[11px] text-foreground-secondary italic">{comp.recent_reviews_summary.slice(0, 120)}</p>
                )}
              </div>
            </div>
          )}

          {(comp.social_post_frequency || comp.social_followers_est) && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">פעילות סושיאל</p>
              <div className="space-y-1">
                {comp.social_followers_est && (
                  <p className="text-[11px] text-foreground-secondary">
                    <span className="text-foreground-muted">עוקבים (הערכה):</span>{' '}{comp.social_followers_est}
                  </p>
                )}
                {comp.social_post_frequency && (
                  <p className="text-[11px] text-foreground-secondary">
                    <span className="text-foreground-muted">תדירות פרסום:</span>{' '}{comp.social_post_frequency}
                  </p>
                )}
              </div>
            </div>
          )}

          {comp.sponsored_ads_detected && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">מודעות ממומנות פעילות</p>
              <div className="rounded-lg bg-orange-50 border border-orange-100 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-orange-700">📣 {comp.active_ad_platforms || 'לא ידוע'}</span>
                  {comp.active_ad_count > 0 && (
                    <span className="text-[10px] text-orange-500">{comp.active_ad_count} מודעות</span>
                  )}
                </div>
                {comp.last_promo_detected && (
                  <p className="text-[11px] text-foreground-secondary">{comp.last_promo_detected.slice(0, 120)}</p>
                )}
                {comp.ad_gaps && (
                  <p className="text-[11px] text-success font-medium">💡 הזדמנות: {comp.ad_gaps.slice(0, 100)}</p>
                )}
              </div>
            </div>
          )}

          {intelAlert && (
            <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-3">
              <p className="text-[10px] font-semibold text-primary mb-1.5">ההזדמנות שלך</p>
              <p className="text-[11px] text-foreground-secondary leading-snug">
                {(intelAlert.change_summary || '').replace(/^🔍\s*[^:]+:\s*/, '').slice(0, 140)}
              </p>
              {intelAlert.action_label && (
                <button className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary hover:opacity-75 transition-opacity">
                  {intelAlert.action_label.slice(0, 45)}
                  <ArrowLeft className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Editable URL links */}
          <div>
            <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">קישורים</p>
            <div className="space-y-2">
              <UrlInput label="אתר" fieldKey="website_url" initialValue={comp.website_url} competitorId={comp.id} />
              <UrlInput label="Instagram" fieldKey="instagram_url" initialValue={comp.instagram_url} competitorId={comp.id} />
              <UrlInput label="Facebook" fieldKey="facebook_url" initialValue={comp.facebook_url} competitorId={comp.id} />
              <UrlInput label="TikTok" fieldKey="tiktok_url" initialValue={comp.tiktok_url} competitorId={comp.id} />
            </div>
          </div>

          {/* On-demand deep analysis */}
          <div className="flex flex-wrap gap-2 pt-1">
            <SilentBoundary>
              <Suspense fallback={null}>
                <CompetitorSwotCard competitor={comp} businessName={businessName} otxBusinessId={otxBizId} />
              </Suspense>
            </SilentBoundary>
            <CompetitorStrategyCard competitor={comp} businessProfileId={businessProfileId} />
            {onDeepAnalysis && (
              <button
                onClick={e => { e.stopPropagation(); onDeepAnalysis(comp.id); }}
                className="text-xs font-semibold px-3 py-1 rounded-lg text-violet-600 hover:text-violet-800 bg-violet-50 transition-colors"
              >
                ניתוח מעמיק
              </button>
            )}
          </div>

          {/* Meta — last scanned · quick links · not-relevant · remove */}
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-border">
            {comp.last_scanned && (
              <span className="flex items-center gap-1 text-[10px] text-foreground-muted opacity-50">
                <Clock className="w-3 h-3" />
                נסרק {timeAgo(comp.last_scanned)}
              </span>
            )}
            {comp.instagram_url && (
              <a href={comp.instagram_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-pink-500 hover:underline"
                onClick={e => e.stopPropagation()}>
                <Instagram className="w-3 h-3" /> Instagram
              </a>
            )}
            {comp.facebook_url && (
              <a href={comp.facebook_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-blue-500 hover:underline"
                onClick={e => e.stopPropagation()}>
                <Globe className="w-3 h-3" /> Facebook
              </a>
            )}
            {comp.tiktok_url && (
              <a href={comp.tiktok_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:underline"
                onClick={e => e.stopPropagation()}>
                <Globe className="w-3 h-3" /> TikTok
              </a>
            )}
            {comp.website_url && (
              <a href={comp.website_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-foreground-muted hover:underline"
                onClick={e => e.stopPropagation()}>
                <Globe className="w-3 h-3" /> אתר
              </a>
            )}
            <div className="flex-1" />
            <DismissMenu
              entityType="competitor"
              entityId={comp.id}
              title={comp.name}
              businessProfileId={businessProfileId}
              buttonLabel="לא רלוונטי"
              buttonClassName="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-amber-500 transition-colors"
              onDismissed={() => onDismissed?.()}
            />
            <button
              onClick={e => { e.stopPropagation(); onDelete?.(comp.id); }}
              className="flex items-center gap-1 text-[10px] text-foreground-muted hover:text-danger transition-colors"
            >
              <Trash2 className="w-3 h-3" /> הסר
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
