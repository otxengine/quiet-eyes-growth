import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star } from 'lucide-react';

export default function SatisfactionScore({ bpId }) {
  const { data: surveys = [] } = useQuery({
    queryKey: ['surveys', bpId],
    queryFn: () => base44.entities.CustomerSurvey.filter({ linked_business: bpId, response_received: true }),
    enabled: !!bpId,
  });

  if (surveys.length === 0) return null;

  const avg = surveys.reduce((sum, s) => sum + (s.rating || 0), 0) / surveys.length;

  return (
    <div className="card-base px-5 py-4 fade-in-up">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium text-foreground-muted">שביעות רצון</p>
        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
      </div>
      <span className="text-[28px] font-bold text-foreground leading-none tracking-tight">{avg.toFixed(1)}</span>
      <p className="text-[9px] text-foreground-muted mt-1">{surveys.length} סקרים</p>
    </div>
  );
}