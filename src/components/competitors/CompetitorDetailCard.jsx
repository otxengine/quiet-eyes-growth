import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, MapPin, ArrowLeft, Clock, ExternalLink, Instagram, Globe } from 'lucide-react';
import CompetitorSwotCard from '@/components/competitors/CompetitorSwotCard';
import CompetitorStrategyCard from '@/components/competitors/CompetitorStrategyCard';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

// Parse comma/newline separated list, strip bracketed dates, cap at `max`
function parseList(str, max = 2) {
  if (!str) return [];
  return str
    .split(/[,\n•]+/)
    .map(s => s.replace(/^\[.*?\]\s*/, '').trim())
    .filter(s => s.length > 2)
    .slice(0, max);
}

export default function CompetitorDetailCard({
  competitor,
  businessName,
  signals = [],
  businessProfileId,
  otxBizId,
  intelChanges = [],
}) {
  const [expanded, setExpanded] = useState(false);
  const comp = competitor;
  const initials = (comp.name || '??').substring(0, 2);

  // Find the most recent intel insight for this competitor
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
          {/* Avatar */}
          <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-foreground-muted text-[10px] font-bold flex-shrink-0">
            {initials}
          </div>

          {/* Name + location */}
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

          {/* Rating + trend + chevron */}
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

          {/* SECTION 1 — What they offer */}
          {hasOffer && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                מה הם מציעים
              </p>
              <div className="space-y-1.5">
                {services && (
                  <p className="text-[11px] text-foreground-secondary leading-snug">
                    {services.slice(0, 150)}
                  </p>
                )}
                {comp.price_range && (
                  <p className="text-[11px] text-foreground-muted">
                    טווח מחירים:{' '}
                    <span className="text-foreground font-medium">{comp.price_range}</span>
                  </p>
                )}
                {comp.current_promotions && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-100 text-[11px] text-orange-700">
                    <span className="font-medium">מבצע:</span>{' '}
                    {comp.current_promotions.slice(0, 90)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 2 — What customers say */}
          {hasVoice && (
            <div>
              <p className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide mb-2">
                מה הלקוחות אומרים
              </p>
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
                  <p className="text-[11px] text-foreground-secondary italic">
                    {comp.recent_reviews_summary.slice(0, 120)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* SECTION 3 — Opportunity for you */}
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

          {/* On-demand deep analysis */}
          <div className="flex flex-wrap gap-2 pt-1">
            <CompetitorSwotCard
              competitor={comp}
              businessName={businessName}
              otxBusinessId={otxBizId}
            />
            <CompetitorStrategyCard
              competitor={comp}
              businessProfileId={businessProfileId}
            />
          </div>

          {/* Social links + last scanned */}
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-border">
            {comp.last_scanned && (
              <span className="flex items-center gap-1 text-[10px] text-foreground-muted opacity-50">
                <Clock className="w-3 h-3" />
                נסרק {timeAgo(comp.last_scanned)}
              </span>
            )}
            {comp.instagram_handle && (
              <a href={comp.instagram_handle} target="_blank" rel="noopener noreferrer"
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
          </div>
        </div>
      )}
    </div>
  );
}
