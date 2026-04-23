import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { otxSupabase } from '@/lib/otx-supabase';
import ActionPopup from '@/components/ui/ActionPopup';
import { swotTypeToPopupType } from '@/lib/popup_classifier';

const SWOT_COLS = [
  { key: 'strengths',     label: 'חוזקות',     icon: '✅', color: 'text-green-600' },
  { key: 'weaknesses',    label: 'חולשות',     icon: '⚠️', color: 'text-amber-600' },
  { key: 'opportunities', label: 'הזדמנויות',  icon: '🟢', color: 'text-blue-600'  },
  { key: 'threats',       label: 'איומים',     icon: '🔴', color: 'text-red-600'   },
];

export default function CompetitorSwotCard({ competitor, businessName, otxBusinessId }) {
  const [swot,          setSwot]          = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [open,          setOpen]          = useState(false);
  const [showFull,      setShowFull]      = useState(false);
  const [popupSignal,   setPopupSignal]   = useState(null); // ITEM 5: ActionPopup
  const [dataSource,    setDataSource]    = useState(null); // 'otx' | 'base44' | null

  // ITEM 5: convert SWOT action into synthetic signal → ActionPopup
  // swotKey is the SWOT column the action came from (strengths/weaknesses/opportunities/threats)
  const handleActionClick = (action, swotKey = 'weaknesses') => {
    const actionType = swotTypeToPopupType(swotKey);
    setPopupSignal({
      id: `swot_${competitor.id}_${action.label}`,
      summary: `SWOT מול ${competitor.name}: ${action.label}`,
      recommended_action: action.label,
      source_description: JSON.stringify({
        action_label: action.label,
        action_type: actionType,
        prefilled_text: `פעולה מניתוח SWOT מול ${competitor.name}:\n\n${action.label}\n\nהקשר: ניתוח SWOT — ${businessName}`,
        time_minutes: action.minutes || 15,
      }),
      impact_level: 'medium',
      category: swotKey === 'opportunities' ? 'opportunity' : 'competitor_move',
    });
  };

  const generate = async () => {
    setOpen(true);
    if (swot) return;
    setLoading(true);
    try {
      // Fetch real competitor_changes from OTX Supabase
      let otxChangesBlock = '';
      if (otxBusinessId) {
        try {
          const { data: changes } = await otxSupabase
            .from('competitor_changes')
            .select('competitor_name, change_type, change_summary, detected_at_utc, confidence_score')
            .eq('business_id', otxBusinessId)
            .ilike('competitor_name', `%${competitor.name.split(' ')[0]}%`)
            .order('detected_at_utc', { ascending: false })
            .limit(5);

          if (changes?.length) {
            setDataSource('otx');
            otxChangesBlock = `\nשינויים אחרונים שזוהו (נתונים אמיתיים):\n` +
              changes.map(c => `• [${c.change_type}] ${c.change_summary || 'ללא פרטים'} (${c.detected_at_utc?.slice(0, 10) || '?'}, ביטחון: ${Math.round((c.confidence_score || 0) * 100)}%)`).join('\n');
          } else {
            setDataSource('base44');
          }
        } catch (_) {
          setDataSource('base44');
        }
      } else {
        setDataSource('base44');
      }

      const res = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        prompt: `אתה אנליסט עסקי. בצע ניתוח SWOT מול המתחרה "${competitor.name}" מנקודת המבט של "${businessName}".
נתונים: דירוג ${competitor.rating || '?'}/5, ביקורות ${competitor.review_count || '?'}, מגמה: ${competitor.trend_direction || '?'}
חוזקות שלהם: ${competitor.strengths || '?'}, חולשות: ${competitor.weaknesses || '?'}, שירותים: ${competitor.services || '?'}${otxChangesBlock}

ענה בפורמט JSON בלבד, ללא הסברים נוספים:
{
  "strengths":     ["עד 3 מילים", "עד 3 מילים", "עד 3 מילים"],
  "weaknesses":    ["עד 3 מילים", "עד 3 מילים"],
  "opportunities": ["עד 3 מילים", "עד 3 מילים"],
  "threats":       ["עד 3 מילים", "עד 3 מילים"],
  "actions": [
    { "label": "פועל + יעד קצר", "minutes": 20 },
    { "label": "פועל + יעד קצר", "minutes": 10 },
    { "label": "פועל + יעד קצר", "minutes": 5  }
  ]
}
חובה: מקסימום 3 מילים לכל פריט SWOT. בדיוק 3 פעולות.`,
      });

      let parsed = null;
      try {
        const src = typeof res === 'string' ? res : JSON.stringify(res);
        const match = src.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch (_) {}
      setSwot(parsed || { strengths: [], weaknesses: [], opportunities: [], threats: [], actions: [] });
    } catch (_) {
      setSwot({ strengths: [], weaknesses: [], opportunities: [], threats: [], actions: [] });
    }
    setLoading(false);
  };

  if (!open) {
    return (
      <>
        <button onClick={generate}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#888888] bg-[#fafafa] border border-[#f0f0f0] hover:bg-[#f5f5f5] hover:border-[#dddddd] transition-all">
          <Shield className="w-3 h-3" /> ניתוח SWOT
        </button>
        {popupSignal && (
          <ActionPopup signal={popupSignal} businessProfile={{ name: businessName }} onClose={() => setPopupSignal(null)} />
        )}
      </>
    );
  }

  return (
    <>
    <div className="mt-3 rounded-lg border border-[#e8e8e8] bg-[#fafafa] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-[#eeeeee]"
        onClick={() => setOpen(false)}>
        <div className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-[#666666]" />
          <span className="text-[11px] font-semibold text-[#333333]">SWOT — {competitor.name}</span>
          {dataSource === 'otx' && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
              נתונים אמיתיים
            </span>
          )}
          {dataSource === 'base44' && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
              הערכה
            </span>
          )}
        </div>
        <ChevronUp className="w-3.5 h-3.5 text-[#aaaaaa]" />
      </div>

      <div className="px-3 pb-3 pt-2">
        {/* Skeleton while loading */}
        {loading && (
          <div className="animate-pulse space-y-2 py-1">
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="space-y-1">
                  <div className="h-3 w-10 bg-gray-200 rounded" />
                  <div className="h-3 w-12 bg-gray-100 rounded" />
                  <div className="h-3 w-10 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
            <div className="h-8 w-full bg-gray-200 rounded-lg mt-3" />
            <div className="h-8 w-full bg-gray-100 rounded-lg" />
          </div>
        )}

        {/* Loaded content */}
        {!loading && swot && (
          <div className="space-y-3">
            {/* 4-column SWOT grid */}
            <div className="grid grid-cols-4 gap-2 border-b border-[#eeeeee] pb-3">
              {SWOT_COLS.map(({ key, label, icon, color }) => (
                <div key={key}>
                  <p className={`text-[9px] font-bold uppercase tracking-wide mb-1.5 ${color}`}>{label}</p>
                  {(swot[key] || []).map((item, i) => (
                    <p key={i} className="text-[10px] text-[#444444] leading-tight mb-1">
                      {icon} {item}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            {/* 3 action buttons */}
            {swot.actions?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#333333] mb-1.5">🚀 3 פעולות שנובעות מהניתוח</p>
                <div className="space-y-1.5">
                  {swot.actions.map((action, i) => {
                    // Infer SWOT column from action label for better popup type
                    const lbl = (action.label || '').toLowerCase();
                    const inferredKey =
                      /פרסם|שתף|פוסט|story|קמפיין|הזדמנות/.test(lbl) ? 'opportunities' :
                      /חזק|יתרון|strength/.test(lbl) ? 'strengths' :
                      /איום|מחיר|מתחרה|threat/.test(lbl) ? 'threats' :
                      'weaknesses';
                    return (
                      <button key={i}
                        onClick={() => handleActionClick(action, inferredKey)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-[#e8e8e8] text-[11px] hover:border-primary hover:bg-primary/5 transition-all text-right">
                        <span className="text-[#333333]">{i + 1}. {action.label} ←</span>
                        <span className="text-[10px] text-[#999999]">⏱ {action.minutes} דקות</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Full analysis toggle */}
            <button
              onClick={() => setShowFull(!showFull)}
              className="flex items-center gap-1 text-[10px] text-[#999999] hover:text-[#555555] transition-colors"
            >
              {showFull ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showFull ? 'הסתר פרטים' : 'הצג ניתוח מלא'}
            </button>
            {showFull && (
              <div className="text-[10px] text-[#555555] leading-relaxed space-y-1 border-t border-[#eeeeee] pt-2">
                {SWOT_COLS.map(({ key, label }) =>
                  swot[key]?.length > 0 ? (
                    <p key={key}>
                      <strong>{label}:</strong> {swot[key].join(' · ')}
                    </p>
                  ) : null,
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ITEM 5: ActionPopup for SWOT actions */}
    {popupSignal && (
      <ActionPopup signal={popupSignal} businessProfile={{ name: businessName }} onClose={() => setPopupSignal(null)} />
    )}
  </>
  );
}
