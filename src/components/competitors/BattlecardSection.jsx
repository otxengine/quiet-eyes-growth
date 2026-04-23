import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Shield, Loader2, ChevronDown, ChevronUp, Zap, RefreshCw, Target } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { resolveActionDestination } from '@/lib/action_router';
import ComposerDrawer from '@/components/modals/ComposerDrawer';
import ReplyDrawer from '@/components/modals/ReplyDrawer';

function parseKeyValue(text) {
  const lines = (text || '').split('\n').filter(Boolean);
  const get = (key) => {
    const line = lines.find(l => l.startsWith(key + ':'));
    return line ? line.slice(key.length + 1).trim() : '';
  };
  return {
    move:        get('THE_MOVE'),
    actionLabel: get('ACTION_LABEL'),
    window:      get('WINDOW'),
  };
}

export default function BattlecardSection({ competitor, businessProfileId, ourRating }) {
  const [open,              setOpen]              = useState(false);
  const [generating,        setGenerating]        = useState(false);
  const [theMove,           setTheMove]           = useState(null);
  const [generatingMove,    setGeneratingMove]    = useState(false);
  const [showTalkingPoints, setShowTalkingPoints] = useState(false);
  const [activeDrawer,      setActiveDrawer]      = useState(null);
  const qc = useQueryClient();

  const handleTheMoveClick = async () => {
    if (!theMove?.actionLabel) return;
    const dest = resolveActionDestination({
      label:   theMove.actionLabel,
      context: theMove.move,
    });

    if (dest.type === 'open_composer') {
      setActiveDrawer({ type: 'composer', props: { text: dest.text, platform: dest.platform, context: dest.context } });
    } else if (dest.type === 'open_reply') {
      setActiveDrawer({ type: 'reply', props: { reviewUrl: dest.reviewUrl, context: dest.context } });
    } else if (dest.type === 'open_url') {
      window.open(dest.url, '_blank', 'noopener');
    } else if (dest.type === 'open_modal') {
      toast.info(dest.title);
    } else {
      // open_task
      try {
        await base44.entities.Task.create({
          title: dest.title,
          description: dest.description ?? `מהלך אסטרטגי מול ${competitor.name}`,
          status: 'pending',
          estimated_minutes: dest.estimatedMinutes,
        });
        toast.success(`משימה נוצרה: ${dest.title} ✓`);
      } catch {
        toast.error('לא ניתן ליצור משימה');
      }
    }
  };

  let bc = null;
  try {
    if (competitor.battlecard_content) bc = JSON.parse(competitor.battlecard_content);
  } catch (_) {}

  const generateTheMove = async () => {
    if (theMove || generatingMove || !bc) return;
    setGeneratingMove(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `מתחרה: ${competitor.name}
יתרונות שלנו: ${bc.our_advantages?.slice(0, 3).join(', ') || 'לא ידוע'}
חולשות שלהם: ${bc.their_weaknesses?.slice(0, 3).join(', ') || 'לא ידוע'}
דירוג שלהם: ${competitor.rating || 'לא ידוע'}/5${ourRating ? `\nדירוג שלנו: ${ourRating}/5` : ''}

ענה בפורמט הזה בלבד:
THE_MOVE: [הזדמנות ספציפית אחת עכשיו — משפט אחד, מקסימום 15 מילים]
ACTION_LABEL: [פועל + יעד, עד 4 מילים]
WINDOW: [כמה זמן ההזדמנות פתוחה, למשל "48 שעות" או "השבוע"]

אסור: פסקאות, הסברים, bullet points.`,
        model: 'gemini_3_flash',
      });
      setTheMove(parseKeyValue(result));
    } catch (_) {}
    setGeneratingMove(false);
  };

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && bc) generateTheMove();
  };

  const generate = async (e) => {
    e?.stopPropagation();
    setGenerating(true);
    try {
      await base44.functions.invoke('generateBattlecard', {
        competitorId: competitor.id,
        businessProfileId,
      });
      qc.invalidateQueries({ queryKey: ['competitorsPage'] });
      toast.success('כרטיס קרב עודכן ✓');
      setOpen(true);
      setTheMove(null); // reset so generateTheMove reruns with fresh data
    } catch {
      toast.error('שגיאה בייצור כרטיס קרב');
    }
    setGenerating(false);
  };

  if (!bc) return (
    <>
      <button onClick={generate} disabled={generating}
        className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-foreground-muted border border-border rounded-md px-3 py-1.5 hover:border-primary hover:text-primary transition-all">
        {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
        {generating ? 'מייצר כרטיס קרב...' : 'צור כרטיס קרב'}
      </button>
    </>
  );

  return (
    <>
    <div className="mt-3 border border-border rounded-lg overflow-hidden">
      {/* ── Header ── */}
      <button onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-secondary/40 hover:bg-secondary/70 transition-colors">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-primary" />
          <span className="text-[12px] font-medium">כרטיס קרב</span>
          {bc.confidence_score && (
            <span className="text-[10px] text-foreground-muted">· {bc.confidence_score}% ביטחון</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={generating}
            className="p-1 text-foreground-muted hover:text-primary">
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-foreground-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground-muted" />}
        </div>
      </button>

      {open && (
        <div className="p-4 space-y-4 text-right">

          {/* ── Score comparison bar ── */}
          {(ourRating || competitor.rating) && (
            <div className="flex justify-around items-center py-3 border-b border-border">
              {ourRating && (
                <div className="text-center">
                  <span className="text-3xl font-bold text-green-500">{ourRating}</span>
                  <p className="text-[10px] text-foreground-muted mt-0.5">הציון שלנו</p>
                </div>
              )}
              {ourRating && competitor.rating && (
                <span className="text-foreground-muted/30 text-xl font-light">vs</span>
              )}
              {competitor.rating && (
                <div className="text-center">
                  <span className={`text-3xl font-bold ${
                    parseFloat(competitor.rating) < parseFloat(ourRating || 0)
                      ? 'text-red-400' : 'text-foreground-secondary'
                  }`}>
                    {competitor.rating}
                  </span>
                  <p className="text-[10px] text-foreground-muted mt-0.5">{competitor.name}</p>
                </div>
              )}
            </div>
          )}

          {/* Headline */}
          {bc.headline && (
            <p className="text-[13px] font-semibold border-r-2 border-primary pr-3">{bc.headline}</p>
          )}

          {/* ── We win / They lose — max 3 each ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bc.our_advantages?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-green-600 mb-2 uppercase tracking-wide">אנחנו מנצחים ב</p>
                {bc.our_advantages.slice(0, 3).map((a, i) => (
                  <div key={i} className="flex gap-2 mb-1 text-[11px] text-foreground-secondary">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✅</span>{a}
                  </div>
                ))}
              </div>
            )}
            {bc.their_weaknesses?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-amber-600 mb-2 uppercase tracking-wide">הם חלשים ב</p>
                {bc.their_weaknesses.slice(0, 3).map((w, i) => (
                  <div key={i} className="flex gap-2 mb-1 text-[11px] text-foreground-secondary">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">⚠️</span>{w}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── The One Move ── */}
          <div className="border border-primary/20 rounded-lg p-3 bg-primary/5">
            <p className="text-[10px] font-semibold text-primary mb-2 flex items-center gap-1">
              <Target className="w-3 h-3" /> המהלך הגדול השבוע
            </p>
            {generatingMove && !theMove && (
              <div className="animate-pulse space-y-2">
                <div className="h-3 w-3/4 bg-primary/10 rounded" />
                <div className="h-8 w-1/2 bg-primary/10 rounded-lg" />
              </div>
            )}
            {theMove?.move && (
              <>
                <p className="text-[12px] text-foreground-secondary leading-snug mb-2">{theMove.move}</p>
                {theMove.window && (
                  <p className="text-[10px] text-foreground-muted mb-2">⏳ חלון הזדמנויות: {theMove.window}</p>
                )}
                {theMove.actionLabel && (
                  <button
                    onClick={handleTheMoveClick}
                    className="flex items-center justify-between w-full px-3.5 py-2 bg-foreground text-background rounded-lg text-[11px] font-medium hover:opacity-90 transition-all">
                    <span>{theMove.actionLabel} ←</span>
                  </button>
                )}
              </>
            )}
            {!generatingMove && !theMove && (
              <p className="text-[11px] text-foreground-muted">מנתח הזדמנויות...</p>
            )}
          </div>

          {/* USP */}
          {bc.our_usp && (
            <div className="bg-white border border-border rounded-lg p-3">
              <p className="text-[10px] font-semibold text-primary mb-1">למה לבחור בנו</p>
              <p className="text-[11px] text-foreground-secondary">{bc.our_usp}</p>
            </div>
          )}

          {/* Talking points — collapsed by default */}
          {bc.talking_points?.length > 0 && (
            <div>
              <button
                onClick={() => setShowTalkingPoints(!showTalkingPoints)}
                className="flex items-center gap-1.5 text-[10px] text-foreground-muted hover:text-primary transition-colors"
              >
                <Zap className="w-3 h-3" />
                {showTalkingPoints
                  ? 'הסתר נקודות שיח'
                  : `הצג נקודות שיח (${bc.talking_points.length})`}
                {showTalkingPoints
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />}
              </button>
              {showTalkingPoints && (
                <div className="mt-2 space-y-2">
                  {bc.talking_points.slice(0, 3).map((tp, i) => (
                    <div key={i} className="bg-secondary/50 rounded-lg p-2.5">
                      <p className="text-[10px] text-foreground-muted mb-1">לקוח: "{tp.customer_says}"</p>
                      <p className="text-[11px] text-foreground font-medium">אתה: "{tp.you_respond}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {bc.data_gaps?.length > 0 && (
            <p className="text-[10px] text-foreground-muted opacity-50">
              פערי מידע: {bc.data_gaps.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>

    {/* Drawers */}
    {activeDrawer?.type === 'composer' && (
      <ComposerDrawer {...activeDrawer.props} onClose={() => setActiveDrawer(null)} />
    )}
    {activeDrawer?.type === 'reply' && (
      <ReplyDrawer {...activeDrawer.props} onClose={() => setActiveDrawer(null)} />
    )}
  </>
  );
}
