import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Shield, TrendingUp, MessageSquare, Target, Zap } from 'lucide-react';
import { toast } from 'sonner';

export default function BattlecardPanel({ competitor, businessProfile }) {
  const [loading, setLoading] = useState(false);
  const [battlecard, setBattlecard] = useState(() => {
    try { return competitor.battlecard_content ? JSON.parse(competitor.battlecard_content) : null; } catch (_) { return null; }
  });

  const generate = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('generateBattlecard', {
        competitorId: competitor.id,
        businessProfileId: businessProfile?.id,
      });
      if (res?.data?.battlecard || res?.battlecard) {
        setBattlecard(res?.data?.battlecard || res?.battlecard);
        toast.success('פרופיל עודכן ✓');
      }
    } catch (_) {
      toast.error('שגיאה ביצירת פרופיל המתחרה');
    }
    setLoading(false);
  };

  if (!battlecard) {
    return (
      <div className="text-center py-6">
        <p className="text-[12px] text-foreground-muted mb-3">אין פרופיל מתחרה עדיין</p>
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-foreground text-background text-[12px] font-medium rounded-lg hover:opacity-90 transition-opacity mx-auto disabled:opacity-60">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {loading ? 'מייצר...' : 'צור פרופיל מתחרה'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-foreground leading-snug">{battlecard.headline}</p>
          {battlecard.confidence_score && (
            <span className="text-[10px] text-foreground-muted mt-0.5 block">ביטחון: {battlecard.confidence_score}%</span>
          )}
        </div>
        <button onClick={generate} disabled={loading}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-foreground-muted border border-border rounded-md hover:bg-secondary transition-colors">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {loading ? 'מעדכן...' : 'רענן פרופיל'}
        </button>
      </div>

      {/* Our advantages */}
      {battlecard.our_advantages?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-success" />
            <h4 className="text-[11px] font-semibold text-foreground">היתרונות שלנו</h4>
          </div>
          <ul className="space-y-1">
            {battlecard.our_advantages.map((adv, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-foreground-secondary">
                <span className="text-success mt-0.5 flex-shrink-0">✓</span>
                {adv}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Their weaknesses */}
      {battlecard.their_weaknesses?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="w-3.5 h-3.5 text-[#d97706]" />
            <h4 className="text-[11px] font-semibold text-foreground">נקודות חולשה שלהם</h4>
          </div>
          <ul className="space-y-1">
            {battlecard.their_weaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-foreground-secondary">
                <span className="text-[#d97706] mt-0.5 flex-shrink-0">→</span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Talking points */}
      {battlecard.talking_points?.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
            <h4 className="text-[11px] font-semibold text-foreground">תגובות מוכנות</h4>
          </div>
          <div className="space-y-2">
            {battlecard.talking_points.map((tp, i) => (
              <div key={i} className="bg-secondary rounded-lg p-2.5 border border-border">
                <p className="text-[10px] text-foreground-muted mb-1">לקוח אומר: <span className="italic">"{tp.customer_says}"</span></p>
                <p className="text-[11px] text-foreground font-medium">"{tp.you_respond}"</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* USP */}
      {battlecard.our_usp && (
        <div className="bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5 text-success" />
            <span className="text-[11px] font-semibold text-success">ה-USP שלנו</span>
          </div>
          <p className="text-[12px] text-foreground-secondary">{battlecard.our_usp}</p>
        </div>
      )}

      {/* Data gaps */}
      {battlecard.data_gaps?.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-foreground-muted mb-1">פערי מידע שיחזקו את הניתוח:</p>
          <div className="flex flex-wrap gap-1">
            {battlecard.data_gaps.map((gap, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[9px] bg-secondary text-foreground-muted border border-border">{gap}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
