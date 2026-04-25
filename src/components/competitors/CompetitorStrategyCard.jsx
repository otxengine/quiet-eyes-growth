import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Target, ChevronUp, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import ActionPopup from '@/components/ui/ActionPopup';

/**
 * Infer action_type from tactic text — matches patterns in Hebrew/English.
 */
function inferActionType(tacticText) {
  if (!tacticText) return 'task';
  const t = tacticText;
  if (/פרסם|פוסט|שתף|אינסטגרם|פייסבוק|סושיאל|תוכן/i.test(t)) return 'social_post';
  if (/התקשר|פגישה|שיחה|טלפון|ליצור קשר/i.test(t))             return 'call';
  if (/מבצע|הנחה|קמפיין|קידום|מכירות/i.test(t))                 return 'promote';
  if (/הגב|תגובה|ביקורת|לקוח/i.test(t))                         return 'respond';
  return 'task';
}

/**
 * CompetitorStrategyCard — AI-generated counter-strategy for a competitor.
 * Props: competitor (with .id), businessProfileId
 */
export default function CompetitorStrategyCard({ competitor, businessProfileId }) {
  const [strategy, setStrategy] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [creatingTask, setCreatingTask] = useState(null);
  const [popupSignal, setPopupSignal]   = useState(null); // ITEM 5: ActionPopup

  const generate = async () => {
    setOpen(true);
    if (strategy) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke('generateCompetitorStrategy', {
        competitorId: competitor.id,
        businessProfileId,
      });
      const data = res?.data || res;
      setStrategy(data?.strategy ? data : null);
      if (!data?.strategy) toast.error('לא ניתן לייצר אסטרטגיה — נסה שוב');
    } catch {
      toast.error('שגיאה ביצירת אסטרטגיה');
    }
    setLoading(false);
  };

  const handleCreateTask = async (tactic, i) => {
    setCreatingTask(i);
    try {
      await base44.entities.Task.create({
        title: tactic,
        description: `אסטרטגיה מול ${competitor.name}: ${strategy?.strategy || ''}`,
        status: 'pending',
        priority: 'medium',
        source_type: 'alert',
        linked_business: businessProfileId || '',
      });
      toast.success('המשימה נוצרה ✓');
    } catch {
      toast.error('שגיאה ביצירת המשימה');
    }
    setCreatingTask(null);
  };

  if (!open) {
    return (
      <button onClick={generate}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#888888] bg-[#fafafa] border border-[#f0f0f0] hover:bg-[#f5f5f5] hover:border-[#dddddd] transition-all">
        <Target className="w-3 h-3" /> אסטרטגיה תחרותית
      </button>
    );
  }

  return (
    <>
    <div className="mt-3 rounded-lg border border-[#e8e8e8] bg-[#fafafa] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-[#eeeeee]"
        onClick={() => setOpen(false)}>
        <div className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-[#666666]" />
          <span className="text-[11px] font-semibold text-[#333333]">אסטרטגיה מול {competitor.name}</span>
        </div>
        <ChevronUp className="w-3.5 h-3.5 text-[#aaaaaa]" />
      </div>

      <div className="px-3 pb-3 pt-2">
        {/* Skeleton */}
        {loading && (
          <div className="animate-pulse space-y-2 py-1">
            <div className="h-4 w-3/4 bg-gray-200 rounded" />
            <div className="h-3 w-full bg-gray-100 rounded" />
            <div className="h-8 w-full bg-gray-200 rounded-lg mt-2" />
            <div className="h-8 w-full bg-gray-100 rounded-lg" />
            <div className="h-8 w-full bg-gray-100 rounded-lg" />
          </div>
        )}

        {/* Content */}
        {!loading && strategy && (
          <div className="space-y-3">
            {/* Main strategy */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-semibold text-indigo-600 mb-0.5 uppercase tracking-wide">האסטרטגיה</p>
              <p className="text-[12px] font-medium text-indigo-900">{strategy.strategy}</p>
            </div>

            {/* Key advantage + risk row */}
            <div className="grid grid-cols-2 gap-2">
              {strategy.key_advantage && (
                <div className="bg-green-50 border border-green-100 rounded-lg px-2.5 py-2">
                  <p className="text-[9px] font-bold text-green-600 uppercase mb-0.5">היתרון שלנו</p>
                  <p className="text-[10px] text-green-800">{strategy.key_advantage}</p>
                </div>
              )}
              {strategy.risk && (
                <div className="bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
                  <p className="text-[9px] font-bold text-red-600 uppercase mb-0.5">סיכון</p>
                  <p className="text-[10px] text-red-800">{strategy.risk}</p>
                </div>
              )}
            </div>

            {/* Timeline badge */}
            {strategy.timeline && (
              <p className="text-[10px] text-[#888888]">⏱ אופק זמן: {strategy.timeline}</p>
            )}

            {/* Tactics */}
            {strategy.tactics?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#333333] mb-1.5">🎯 טקטיקות</p>
                <div className="space-y-1.5">
                  {strategy.tactics.map((tactic, i) => (
                    <button key={i}
                      onClick={() => {
                        const actionType = inferActionType(tactic);
                        setPopupSignal({
                          id: `strategy_${competitor.id}_${i}`,
                          summary: `אסטרטגיה מול ${competitor.name}: ${strategy.strategy}`,
                          recommended_action: tactic,
                          source_description: JSON.stringify({
                            action_label:  tactic.split(' ').slice(0, 5).join(' '),
                            action_type:   actionType,
                            prefilled_text: `טקטיקה אסטרטגית מול ${competitor.name}:\n\n${tactic}\n\nאסטרטגיה: ${strategy.strategy}`,
                            time_minutes:  actionType === 'call' ? 10 : actionType === 'social_post' ? 15 : 20,
                          }),
                          impact_level: 'high',
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-[#e8e8e8] text-[11px] hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-right group">
                      <span className="text-[#333333]">{i + 1}. {tactic}</span>
                      <CheckCheck className="w-3 h-3 text-[#bbbbbb] group-hover:text-indigo-500 flex-shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    {popupSignal && (
      <ActionPopup
        signal={popupSignal}
        businessProfile={{ id: businessProfileId }}
        onClose={() => setPopupSignal(null)}
      />
    )}
    </>
  );
}
