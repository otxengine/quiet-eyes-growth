import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';

export default function SentimentVelocityCard({ bpId }) {
  const { data: memory } = useQuery({
    queryKey: ['businessMemoryVelocity', bpId],
    queryFn: () => base44.entities.BusinessMemory.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const memRecord = memory?.[0];
  if (!memRecord?.channel_preferences) return null;

  let velocity: any = null;
  try { velocity = JSON.parse(memRecord.channel_preferences); } catch { return null; }

  if (!velocity?.measured_at || velocity.sentiment_now === null) return null;

  const v = velocity.sentiment_velocity;
  const now = velocity.sentiment_now;
  const isPositive = v > 0;
  const isNegative = v < 0;
  const isNeutral = v === 0 || v === null;

  const color = isNegative ? '#ef4444' : isPositive ? '#10b981' : '#6b7280';
  const bg = isNegative ? 'bg-red-50 border-red-100' : isPositive ? 'bg-green-50 border-green-100' : 'bg-secondary border-border';

  const Icon = isNegative ? TrendingDown : isPositive ? TrendingUp : Minus;

  return (
    <div className={`card-base p-4 border ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4" style={{ color }} />
        <span className="text-[12px] font-semibold text-foreground">מהירות סנטימנט</span>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <p className="text-[9px] text-foreground-muted mb-0.5">ציון עכשיו</p>
          <p className="text-[24px] font-bold" style={{ color }}>{now}</p>
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-[14px] font-bold" style={{ color }}>
            {v > 0 ? '+' : ''}{v ?? '–'}
          </span>
          <span className="text-[9px] text-foreground-muted">vs שבוע שעבר</span>
        </div>
      </div>

      {/* Mini bar */}
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[9px] text-foreground-muted">{velocity.sentiment_prev ?? '–'}</span>
        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${now}%`, background: color }} />
        </div>
        <span className="text-[9px] font-semibold" style={{ color }}>{now}</span>
      </div>

      <div className="flex items-center justify-between mt-2 text-[9px] text-foreground-muted">
        <span>{velocity.reviews_this_week || 0} ביקורות השבוע</span>
        {velocity.threats_this_week > 0 && (
          <span className="text-danger font-medium">{velocity.threats_this_week} איומים</span>
        )}
      </div>
    </div>
  );
}
