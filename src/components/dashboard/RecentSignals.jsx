import React from 'react';
import { AlertTriangle, Target, TrendingUp, Users, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const categoryConfig = {
  threat: { icon: AlertTriangle, borderColor: 'border-l-[#dc2626]' },
  opportunity: { icon: Target, borderColor: 'border-l-[#10b981]' },
  trend: { icon: TrendingUp, borderColor: 'border-l-[#d97706]' },
  competitor_move: { icon: Users, borderColor: 'border-l-[#999999]' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

export default function RecentSignals({ signals = [] }) {
  const navigate = useNavigate();

  return (
    <div className="card-base h-full flex flex-col fade-in-up">
      <div className="px-5 py-3.5 border-b border-border">
        <h3 className="text-[13px] font-semibold text-foreground">תובנות אחרונות</h3>
      </div>
      {signals.length === 0 ? (
        <div className="p-8 text-center flex-1 flex flex-col items-center justify-center">
          <Eye className="w-10 h-10 text-foreground-muted opacity-20 mb-3" />
          <p className="text-[12px] text-foreground-muted">המערכת סורקת את השוק שלך — תובנות יופיעו בקרוב</p>
        </div>
      ) : (
        <div className="divide-y divide-border flex-1 overflow-hidden">
          {signals.slice(0, 3).map((signal, i) => {
            const config = categoryConfig[signal.category] || categoryConfig.trend;
            return (
              <div
                key={signal.id}
                className={`px-5 py-3.5 hover:bg-secondary/50 transition-all duration-150 cursor-pointer border-l-[2.5px] ${config.borderColor}`}
                onClick={() => navigate('/signals')}
              >
                <p className={`text-[12px] text-foreground leading-snug ${!signal.is_read ? 'font-semibold' : 'font-medium'}`}>
                  {signal.summary}
                </p>
                {signal.recommended_action && (
                  <p className="text-[11px] text-foreground-muted line-clamp-1 mt-1">{signal.recommended_action}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-foreground-muted opacity-60">{timeAgo(signal.detected_at || signal.created_date)}</span>
                  <span className="text-[10px] text-foreground font-medium opacity-40 hover:opacity-100 transition-opacity">ניתוח ←</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}