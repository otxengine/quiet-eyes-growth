import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ExternalLink } from 'lucide-react';

const categoryColors = {
  threat: '#dc2626',
  opportunity: '#10b981',
  trend: '#d97706',
  competitor_move: '#6366f1',
  mention: '#999999',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function freshnessDot(dateStr) {
  if (!dateStr) return '#ccc';
  const hours = (Date.now() - new Date(dateStr).getTime()) / 3600000;
  if (hours < 6) return '#10b981';
  if (hours < 24) return '#d97706';
  return '#dc2626';
}

function extractDomain(urlStr) {
  if (!urlStr) return null;
  try {
    const first = urlStr.split('|')[0].trim();
    if (!first.startsWith('http')) return null;
    return new URL(first).hostname.replace('www.', '');
  } catch { return null; }
}

export default function MarketIntelColumn({ signals }) {
  const navigate = useNavigate();
  const display = (signals || []).filter(s => s.category !== 'mention').slice(0, 3);

  return (
    <div className="card-base overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 text-foreground-muted opacity-50" />
        <h3 className="text-[12px] font-semibold text-foreground">מודיעין שוק</h3>
        <button onClick={() => navigate('/signals')} className="text-[10px] text-foreground-muted hover:text-foreground mr-auto transition-colors">הכל ←</button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border" style={{ maxHeight: '320px' }}>
        {display.length === 0 ? (
          <div className="flex items-center justify-center h-full py-10">
            <p className="text-[11px] text-foreground-muted">אין תובנות חדשות</p>
          </div>
        ) : (
          display.map((signal, i) => {
            const color = categoryColors[signal.category] || '#999';
            const sourceUrl = signal.source_urls ? signal.source_urls.split('|')[0].trim() : null;
            const domain = extractDomain(signal.source_urls) || signal.source_description || null;

            return (
              <div key={signal.id || i} className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer" style={{ borderRight: `2px solid ${color}` }}
                onClick={() => navigate('/signals')}>
                <p className="text-[12px] font-medium text-foreground leading-snug mb-1">{signal.summary}</p>
                {signal.recommended_action && (
                  <p className="text-[10px] text-foreground-muted line-clamp-1 mb-1.5">{signal.recommended_action}</p>
                )}
                <div className="flex items-center gap-2">
                  {domain && (
                    sourceUrl && sourceUrl.startsWith('http') ? (
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="flex items-center gap-0.5 text-[9px] text-foreground-muted hover:text-foreground hover:underline transition-colors">
                        <ExternalLink className="w-2.5 h-2.5" />מקור: {domain}
                      </a>
                    ) : (
                      <span className="text-[9px] text-foreground-muted">מקור: {domain}</span>
                    )
                  )}
                  <span className="flex items-center gap-1 text-[9px] text-foreground-muted opacity-50 mr-auto">
                    <span className="w-[4px] h-[4px] rounded-full inline-block" style={{ backgroundColor: freshnessDot(signal.detected_at || signal.created_date) }} />
                    {timeAgo(signal.detected_at || signal.created_date)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}