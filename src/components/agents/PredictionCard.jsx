import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { TrendingUp, ShieldAlert, Target, BarChart3, Layers, ChevronDown, ChevronUp, Check, X } from 'lucide-react';

const typeConfig = {
  demand_forecast: { icon: BarChart3, color: '#3b82f6', label: 'חיזוי ביקוש' },
  churn_risk: { icon: ShieldAlert, color: '#ef4444', label: 'סיכון נטישה' },
  deal_probability: { icon: Target, color: '#10b981', label: 'סיכויי סגירה' },
  market_trend: { icon: TrendingUp, color: '#f59e0b', label: 'מגמת שוק' },
  scenario: { icon: Layers, color: '#8b5cf6', label: 'תרחיש' },
};

const impactColors = { high: '#ef4444', medium: '#f59e0b', low: '#10b981' };

export default function PredictionCard({ prediction }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const config = typeConfig[prediction.prediction_type] || typeConfig.market_trend;
  const Icon = config.icon;

  const updateMutation = useMutation({
    mutationFn: (status) => base44.entities.Prediction.update(prediction.id, { status, is_read: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['predictions'] }),
  });

  const actions = prediction.recommended_actions?.split('\n').filter(Boolean) || [];

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] hover:border-[#dddddd] transition-colors">
      <div className="p-3 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${config.color}10` }}>
          <Icon className="w-4 h-4" style={{ color: config.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: config.color, backgroundColor: `${config.color}15` }}>{config.label}</span>
            {prediction.timeframe && <span className="text-[9px] text-[#bbbbbb]">⏱ {prediction.timeframe}</span>}
          </div>
          <p className="text-[12px] font-medium text-[#222222] mt-0.5 truncate">{prediction.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-center">
            <span className="text-[14px] font-bold" style={{ color: config.color }}>{prediction.confidence}%</span>
            <span className="text-[8px] text-[#cccccc] block">ביטחון</span>
          </div>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: impactColors[prediction.impact_level] || '#999' }} />
          {expanded ? <ChevronUp className="w-4 h-4 text-[#cccccc]" /> : <ChevronDown className="w-4 h-4 text-[#cccccc]" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-[#f5f5f5] space-y-3">
          <p className="text-[12px] text-[#444444] leading-relaxed">{prediction.summary}</p>

          {actions.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-[#222222] mb-1.5">פעולות מומלצות</h4>
              <div className="space-y-1">
                {actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#444444]">
                    <span className="text-[#10b981] mt-0.5">•</span>
                    <span>{action.replace(/^[-•]\s*/, '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {prediction.data_sources && (
            <p className="text-[9px] text-[#bbbbbb]">מבוסס על: {prediction.data_sources}</p>
          )}

          {prediction.status === 'active' && (
            <div className="flex gap-2 pt-1">
              <button onClick={(e) => { e.stopPropagation(); updateMutation.mutate('confirmed'); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors">
                <Check className="w-3 h-3" /> אשר חיזוי
              </button>
              <button onClick={(e) => { e.stopPropagation(); updateMutation.mutate('dismissed'); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium text-[#999999] bg-white border border-[#eeeeee] hover:border-[#cccccc] transition-colors">
                <X className="w-3 h-3" /> לא רלוונטי
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}