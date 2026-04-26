import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Target, TrendingUp, ArrowLeft, Lightbulb } from 'lucide-react';

const categoryConfig = {
  threat: { icon: AlertTriangle, borderColor: 'border-l-[#dc2626]' },
  opportunity: { icon: Target, borderColor: 'border-l-[#10b981]' },
  trend: { icon: TrendingUp, borderColor: 'border-l-[#d97706]' },
};

export default function OnboardingInsights() {
  const location = useLocation();
  const navigate = useNavigate();
  const { businessProfile, signals } = location.state || {};

  const handleContinue = async () => {
    if (businessProfile?.id) {
      await base44.entities.BusinessProfile.update(businessProfile.id, { onboarding_completed: true });
      try { base44.functions.invoke('runFullScan', { businessProfileId: businessProfile.id }); } catch (e) {}
    }
    navigate('/', { state: { fromOnboarding: true } });
  };

  if (!businessProfile || !signals) { navigate('/onboarding'); return null; }

  return (
    <div className="min-h-screen bg-white py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#111111] mb-2">מה גילינו על השוק שלך</h1>
          <p className="text-[#999999] text-sm">{businessProfile.name} · {businessProfile.category} · {businessProfile.city}</p>
        </div>

        <div className="space-y-4 mb-8">
          {signals.map((signal, index) => {
            const config = categoryConfig[signal.category] || categoryConfig.trend;
            const Icon = config.icon;
            return (
              <div key={signal.id || index}
                className={`bg-white rounded-[10px] border border-[#f0f0f0] border-l-[2.5px] ${config.borderColor} p-5 card-enter`}
                style={{ animationDelay: `${index * 0.15}s` }}>
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-medium text-[#222222] mb-1.5">{signal.summary}</h3>
                    {signal.recommended_action && (
                      <p className="text-[12px] text-[#999999] leading-relaxed mb-2">{signal.recommended_action}</p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="px-2.5 py-1 bg-[#fafafa] rounded text-[11px] text-[#999999]">ביטחון: {signal.confidence}%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={handleContinue}
          className="w-full h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md transition-colors flex items-center justify-center gap-2">
          המשך למרכז הפיקוד <ArrowLeft className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}