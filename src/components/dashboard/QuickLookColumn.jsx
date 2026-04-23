import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import MiniPipelineBar from './MiniPipelineBar';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'עכשיו';
  if (hours < 24) return `לפני ${hours}ש`;
  return `לפני ${Math.floor(hours / 24)}י`;
}

export default function QuickLookColumn({ competitors, leads, reviews }) {
  const navigate = useNavigate();

  // Competitor changes (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const changed = (competitors || []).filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);

  // Satisfaction from reviews
  const rated = (reviews || []).filter(r => r.rating);
  const avgRating = rated.length > 0 ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length) : 0;
  const satisfactionPct = Math.round((avgRating / 5) * 100);

  return (
    <div className="card-base overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-[12px] font-semibold text-foreground">מבט מהיר</h3>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border" style={{ maxHeight: '320px' }}>
        {/* Section A: Competitor changes */}
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold text-foreground-muted mb-2">מתחרים — שינויים אחרונים</p>
          {changed.length === 0 ? (
            <p className="text-[10px] text-foreground-muted opacity-60">אין שינויים השבוע</p>
          ) : (
            <div className="space-y-1.5">
              {changed.slice(0, 3).map((c, i) => {
                const noteUrl = c.notes?.match(/(https?:\/\/[^\s|]+)/)?.[1];
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#d97706] flex-shrink-0" />
                    <span className="text-[10px] text-foreground-secondary flex-1 truncate">{c.name}</span>
                    <span className="text-[9px] text-[#d97706]">שינוי מחירים</span>
                    {noteUrl && (
                      <a href={noteUrl} target="_blank" rel="noopener noreferrer" className="text-foreground-muted hover:text-foreground">
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => navigate('/competitors')} className="text-[9px] text-foreground-muted hover:text-foreground mt-2 transition-colors">
            כל המתחרים ←
          </button>
        </div>

        {/* Section B: Satisfaction */}
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold text-foreground-muted mb-2">שביעות רצון</p>
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12">
              <svg width="48" height="48" className="transform -rotate-90">
                <circle cx="24" cy="24" r="20" fill="none" stroke="#f0f0f0" strokeWidth="3" />
                <circle cx="24" cy="24" r="20" fill="none"
                  stroke={satisfactionPct >= 70 ? '#10b981' : satisfactionPct >= 50 ? '#d97706' : '#dc2626'}
                  strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 20}
                  strokeDashoffset={2 * Math.PI * 20 * (1 - satisfactionPct / 100)}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[11px] font-bold text-foreground">{avgRating.toFixed(1)}</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-foreground">{satisfactionPct}% שביעות רצון</p>
              <p className="text-[9px] text-foreground-muted">מתוך {rated.length} ביקורות</p>
            </div>
          </div>
        </div>

        {/* Section C: Pipeline */}
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold text-foreground-muted mb-2">Pipeline</p>
          <MiniPipelineBar leads={leads || []} />
          <button onClick={() => navigate('/leads?view=pipeline')} className="text-[9px] text-foreground-muted hover:text-foreground mt-2 transition-colors">
            צפה ב-Pipeline ←
          </button>
        </div>
      </div>
    </div>
  );
}