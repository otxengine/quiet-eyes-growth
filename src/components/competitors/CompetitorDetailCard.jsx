import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, MapPin, Briefcase, Banknote, ExternalLink } from 'lucide-react';
import CompetitorSwotCard from '@/components/competitors/CompetitorSwotCard';
import CompetitorStrategyCard from '@/components/competitors/CompetitorStrategyCard';
import CompetitorNewsCard from '@/components/competitors/CompetitorNewsCard';
import CompetitorNotesEditor from '@/components/competitors/CompetitorNotesEditor';
import CompetitorPriceBadge from '@/components/competitors/CompetitorPriceBadge';
import BattlecardSection from '@/components/competitors/BattlecardSection';

function Sparkline({ trend }) {
  const heights = trend === 'up' ? [15, 18, 20, 22, 28, 32, 36] : trend === 'down' ? [36, 32, 28, 22, 20, 18, 15] : [24, 26, 24, 25, 24, 26, 24];
  return (
    <div className="flex items-end gap-[2px]">
      {heights.map((h, i) => {
        const opacity = trend === 'up' ? 0.08 + (i * 0.035) : trend === 'down' ? 0.04 + (i * 0.02) : 0.04;
        const color = trend === 'up' ? `rgba(16,185,129,${opacity})` : trend === 'down' ? `rgba(220,38,38,${opacity})` : `rgba(0,0,0,${opacity})`;
        return <div key={i} className="w-[3px] rounded-t" style={{ height: h * 0.6, background: color }} />;
      })}
    </div>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function CompetitorDetailCard({ competitor, businessName, signals = [], businessProfileId, otxBizId }) {
  const [expanded, setExpanded] = useState(false);
  const comp = competitor;
  const initials = comp.name?.substring(0, 2) || '??';
  const tags = comp.tags ? comp.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return (
    <div className="card-base">
      {/* Header - always visible */}
      <div className="p-5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-foreground-muted text-[10px] font-bold flex-shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium text-[#222222] truncate">{comp.name}</span>
              {tags.length > 0 && (
                <div className="flex gap-1 flex-shrink-0">
                  {tags.slice(0, 2).map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded-full text-[8px] font-medium bg-[#f5f5f5] text-[#888888]">{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {comp.category && <span className="text-[11px] text-[#999999]">{comp.category}</span>}
              {comp.address && <span className="text-[10px] text-[#cccccc] flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{comp.address}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-2xl font-bold ${comp.rating >= 4.3 ? 'text-[#10b981]' : comp.rating >= 4 ? 'text-[#d97706]' : 'text-[#dc2626]'}`}>
                {comp.rating?.toFixed(1) || '—'}
              </span>
              {comp.trend_direction === 'up' && <TrendingUp className="w-4 h-4 text-[#10b981]" />}
              {comp.trend_direction === 'down' && <TrendingDown className="w-4 h-4 text-[#dc2626]" />}
              {(!comp.trend_direction || comp.trend_direction === 'stable') && <Minus className="w-4 h-4 text-[#cccccc]" />}
              <Sparkline trend={comp.trend_direction} />
            </div>
            <span className="text-[11px] text-[#999999]">{comp.review_count || 0} ביקורות</span>
            {expanded ? <ChevronUp className="w-4 h-4 text-[#cccccc]" /> : <ChevronDown className="w-4 h-4 text-[#cccccc]" />}
          </div>
        </div>

        {/* Quick info row */}
        <div className="flex flex-wrap gap-3 mt-3">
          {comp.strengths && (
            <div className="flex items-start gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#10b981] mt-1 flex-shrink-0" />
              <p className="text-[11px] text-[#444444]"><span className="font-medium text-[#10b981]">חוזקות:</span> {comp.strengths}</p>
            </div>
          )}
          {comp.weaknesses && (
            <div className="flex items-start gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#dc2626] mt-1 flex-shrink-0" />
              <p className="text-[11px] text-[#444444]"><span className="font-medium text-[#dc2626]">חולשות:</span> {comp.weaknesses}</p>
            </div>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4 fade-in-up">
          {/* Enriched data from agents */}
          {(comp.menu_highlights || comp.price_points || comp.current_promotions || comp.recent_reviews_summary) && (
            <div className="bg-secondary/50 rounded-lg p-4 space-y-3 border border-border">
              <span className="text-[10px] font-semibold text-foreground-muted">מידע שנאסף אוטומטית</span>
              {comp.menu_highlights && (
                <div>
                  <span className="text-[10px] font-medium text-primary block mb-0.5">🍽️ תפריט/מוצרים</span>
                  <p className="text-[11px] text-foreground-secondary">{comp.menu_highlights}</p>
                </div>
              )}
              {comp.price_points && (
                <div>
                  <span className="text-[10px] font-medium text-primary block mb-0.5">💰 מחירים שנמצאו</span>
                  <p className="text-[11px] text-foreground-secondary">{comp.price_points}</p>
                </div>
              )}
              {comp.current_promotions && (
                <div className="flex items-start gap-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning/10 text-warning border border-warning/20 flex-shrink-0">מבצע!</span>
                  <p className="text-[11px] text-foreground-secondary">{comp.current_promotions}</p>
                </div>
              )}
              {comp.opening_hours && (
                <div>
                  <span className="text-[10px] font-medium text-foreground-muted block mb-0.5">🕐 שעות פתיחה</span>
                  <p className="text-[11px] text-foreground-secondary">{comp.opening_hours}</p>
                </div>
              )}
              {comp.recent_reviews_summary && (
                <div>
                  <span className="text-[10px] font-medium text-foreground-muted block mb-0.5">💬 מה הלקוחות אומרים</span>
                  <p className="text-[11px] text-foreground-secondary italic">{comp.recent_reviews_summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Services & Pricing */}
          <div className="flex flex-wrap gap-4">
            {comp.services && (
              <div className="flex items-start gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-[#cccccc] mt-0.5" />
                <div>
                  <span className="text-[10px] font-medium text-[#999999] block mb-0.5">שירותים עיקריים</span>
                  <p className="text-[11px] text-[#444444]">{comp.services}</p>
                </div>
              </div>
            )}
            {comp.price_range && (
              <div className="flex items-start gap-1.5">
                <Banknote className="w-3.5 h-3.5 text-[#cccccc] mt-0.5" />
                <div>
                  <span className="text-[10px] font-medium text-[#999999] block mb-0.5">טווח מחירים</span>
                  <p className="text-[11px] text-[#444444]">{comp.price_range}</p>
                </div>
              </div>
            )}
          </div>

          {/* Competitor Price Tracking */}
          <CompetitorPriceBadge competitor={comp} />

          {/* SWOT Analysis */}
          <CompetitorSwotCard competitor={comp} businessName={businessName} otxBusinessId={otxBizId} />

          {/* Competitor Strategy */}
          <CompetitorStrategyCard competitor={comp} businessProfileId={businessProfileId} />

          {/* News Feed */}
          <CompetitorNewsCard signals={signals} competitorName={comp.name} />

          {/* Battlecard */}
          <BattlecardSection competitor={comp} businessProfileId={businessProfileId} />

          {/* Notes & Tags */}
          <CompetitorNotesEditor competitor={comp} />

          {/* Source links */}
          {comp.notes && comp.notes.includes('http') && (() => {
            const urls = comp.notes.match(/(https?:\/\/[^\s|]+)/g) || [];
            return urls.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-[#999999]">קישורי מקור</span>
                {urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:underline">
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{url}</span>
                  </a>
                ))}
              </div>
            ) : null;
          })()}

          {comp.last_scanned && (
            <div className="pt-2 border-t border-[#f5f5f5]">
              <span className="text-[10px] text-[#cccccc]">סריקה אחרונה: {timeAgo(comp.last_scanned)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}