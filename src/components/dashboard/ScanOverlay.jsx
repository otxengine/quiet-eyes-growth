import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Check, Loader2, X, Zap } from 'lucide-react';

// Animated label sequence shown while runFullScan runs on the backend
const SCAN_LABELS = [
  'מנקה תובנות ישנות...',
  'אוסף אותות מהרשת...',
  'סורק פייסבוק ואינסטגרם...',
  'מנתח תגובות ורשתות חברתיות...',
  'מנתח תוכן TikTok...',
  'סורק ביקורות גוגל...',
  'מנתח מודיעין שוק...',
  'מזהה מתחרים ושינויים...',
  'סורק לידים מהאינטרנט...',
  'מחפש לידים ברשתות...',
  'סורק טרנדים TikTok...',
  'מזהה מגמות שוק...',
  'מגלה טרנדים מוקדמים...',
  'סורק סיגנלים ויראלים...',
  'מחשב תחזיות AI...',
  'מייצר התראות פרואקטיביות...',
  'מנתח תובנות אסטרטגיות...',
  'לומד ומייעל...',
  'מחשב ציון בריאות עסקית...',
  'מכין בריפינג בוקר...',
];

export default function ScanOverlay({ businessProfile, onComplete, onClose, steps, title }) {
  const scanTitle = title || 'סורק את השוק שלך...';
  // Custom steps mode (called from other pages with explicit steps list)
  const customSteps = steps || null;
  const totalSteps = customSteps ? customSteps.length : SCAN_LABELS.length;

  const [labelIdx, setLabelIdx]   = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState({});
  const [results, setResults]     = useState({});
  const [done, setDone]           = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!businessProfile?.id) return;
    cancelledRef.current = false;

    const params = {
      businessProfileId: businessProfile.id,
      name: businessProfile.name,
      category: businessProfile.category,
      city: businessProfile.city,
    };

    if (customSteps) {
      // ── Individual-step mode (backward compat for custom step lists) ──────
      const run = async () => {
        const finalResults = {};
        for (let i = 0; i < customSteps.length; i++) {
          if (cancelledRef.current) return;
          setCurrentStep(i);
          setLabelIdx(i);
          const step = customSteps[i];
          if (step.fn) {
            try {
              const res = await base44.functions.invoke(step.fn, step.force ? { ...params, force: true } : params);
              finalResults[step.key] = res.data?.[step.resultKey] || 0;
            } catch (e) {
              console.error(`${step.fn} failed:`, e);
              finalResults[step.key] = 0;
            }
          } else {
            await new Promise(r => setTimeout(r, 600));
          }
          setCompleted(prev => ({ ...prev, [step.key]: true }));
          setResults({ ...finalResults });
        }
        setDone(true);
        setTimeout(() => { if (!cancelledRef.current) onComplete?.(); }, 2000);
      };
      run();
    } else {
      // ── Full-scan mode: single runFullScan call + animated labels ─────────
      const LABEL_INTERVAL = 3500;
      let idx = 0;
      const timer = setInterval(() => {
        if (cancelledRef.current) { clearInterval(timer); return; }
        idx = Math.min(idx + 1, SCAN_LABELS.length - 1);
        setLabelIdx(idx);
        setCurrentStep(idx);
      }, LABEL_INTERVAL);

      base44.functions.invoke('runFullScan', params, 360000) // 6 min — scan runs many agents
        .then(res => {
          clearInterval(timer);
          if (cancelledRef.current) return;
          const r = res.data?.results || {};
          setResults({
            reviews:      r.collectReviews?.new_reviews || 0,
            collect:      r.collectWebSignals?.new_signals_saved || 0,
            social:       r.collectSocialSignals?.new_signals || 0,
            compete:      r.runCompetitorIdentification?.competitors_found || 0,
            leads:        (r.runLeadGeneration?.leads_generated || 0) + (r.findSocialLeads?.leads_created || 0),
            tiktok_trends: r.tiktokSectorTrendAgent?.trends_created || 0,
            trends:       r.detectTrends?.trends_created || 0,
            early_trends: r.detectEarlyTrends?.trends_created || 0,
            viral:        r.detectViralSignals?.signals_created || 0,
            alerts:       r.generateProactiveAlerts?.alerts_created || 0,
            advisory:     r.generateAdvisoryInsights?.insights_created || 0,
            predictions:  r.runPredictions?.predictions_created || 0,
          });
          setLabelIdx(SCAN_LABELS.length - 1);
          setCurrentStep(SCAN_LABELS.length - 1);
          setDone(true);
          setTimeout(() => { if (!cancelledRef.current) onComplete?.(); }, 2000);
        })
        .catch(e => {
          clearInterval(timer);
          if (cancelledRef.current) return;
          console.error('runFullScan failed:', e);
          setDone(true);
          setTimeout(() => { if (!cancelledRef.current) onComplete?.(); }, 1500);
        });

      return () => { cancelledRef.current = true; clearInterval(timer); };
    }

    return () => { cancelledRef.current = true; };
  }, [businessProfile?.id]);

  const progress = done ? 100 : Math.round(((labelIdx + 1) / totalSteps) * 100);
  const currentLabel = customSteps ? (customSteps[labelIdx]?.label || '') : SCAN_LABELS[labelIdx];

  const totalSignals  = (results.collect || 0) + (results.social || 0);
  const totalLeads    = results.leads || 0;
  const totalTrends   = (results.tiktok_trends || 0) + (results.trends || 0) + (results.early_trends || 0);
  const totalInsights = (results.alerts || 0) + (results.advisory || 0);
  const summary = [
    totalSignals > 0    ? `${totalSignals} אותות`         : null,
    results.reviews     ? `${results.reviews} ביקורות`   : null,
    results.compete     ? `${results.compete} מתחרים`     : null,
    totalLeads > 0      ? `${totalLeads} לידים`           : null,
    totalTrends > 0     ? `${totalTrends} טרנדים`         : null,
    results.viral       ? `${results.viral} ויראלי`       : null,
    totalInsights > 0   ? `${totalInsights} תובנות`       : null,
    results.predictions ? `${results.predictions} תחזיות` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-5 w-72 mx-4 relative">
        <button onClick={onClose} className="absolute top-3 left-3 p-1 rounded-md hover:bg-secondary transition-colors">
          <X className="w-3.5 h-3.5 text-foreground-muted" />
        </button>

        {!done ? (
          <>
            <div className="flex items-center gap-2 mb-4 pr-5">
              <Zap className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <h3 className="text-[13px] font-semibold text-foreground truncate">{scanTitle}</h3>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-border rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Current step */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Loader2 className="w-3 h-3 animate-spin text-primary flex-shrink-0" />
                <span className="text-[11px] text-foreground-secondary truncate">{currentLabel}</span>
              </div>
              <span className="text-[10px] text-foreground-muted flex-shrink-0 tabular-nums">
                {labelIdx + 1}/{totalSteps}
              </span>
            </div>
          </>
        ) : (
          <div className="text-center py-1">
            <div className="w-9 h-9 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-2">
              <Check className="w-4 h-4 text-success" />
            </div>
            <h3 className="text-[13px] font-semibold text-foreground mb-1">סריקה הושלמה ✓</h3>
            {summary
              ? <p className="text-[11px] text-foreground-muted leading-relaxed">{summary}</p>
              : <p className="text-[11px] text-foreground-muted">הנתונים עודכנו</p>
            }
            <p className="text-[10px] text-foreground-muted opacity-40 mt-1">
              {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
