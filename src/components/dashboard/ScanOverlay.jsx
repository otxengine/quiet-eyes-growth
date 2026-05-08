import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Check, Loader2, X } from 'lucide-react';

// Full scan pipeline — mirrors runFullScan order exactly
const defaultScanSteps = [
  // ── Cleanup ───────────────────────────────────────────────────────────────
  { key: 'cleanup_insights',  label: 'מנקה תובנות ישנות וכפולות...',       fn: 'cleanupInsights',             resultKey: 'total_cleaned' },
  // ── Data Collection ───────────────────────────────────────────────────────
  { key: 'collect',           label: 'אוסף אותות מהרשת...',                fn: 'collectWebSignals',           resultKey: 'new_signals_saved' },
  { key: 'social',            label: 'סורק פייסבוק ואינסטגרם...',          fn: 'collectSocialSignals',        resultKey: 'new_signals' },
  { key: 'ig_comments',       label: 'מנתח תגובות אינסטגרם...',            fn: 'analyzeInstagramComments',    resultKey: 'comments_analyzed' },
  { key: 'social_comments',   label: 'מנתח תגובות ברשתות חברתיות...',      fn: 'analyzeSocialComments',       resultKey: 'comments_analyzed' },
  { key: 'tiktok_content',    label: 'מנתח תוכן TikTok של העסק...',        fn: 'analyzeTikTokContent',        resultKey: 'videos_analyzed' },
  { key: 'reviews',           label: 'סורק ביקורות גוגל ומשלוחים...',      fn: 'scanAllReviews',              resultKey: 'new_reviews' },
  // ── Analysis ─────────────────────────────────────────────────────────────
  { key: 'market',            label: 'מנתח מודיעין שוק...',                fn: 'runMarketIntelligence',       resultKey: 'insights_generated' },
  { key: 'compete',           label: 'מזהה מתחרים ושינויים...',            fn: 'runCompetitorIdentification', resultKey: 'competitors_found' },
  { key: 'leads',             label: 'סורק לידים מהאינטרנט...',            fn: 'runLeadGeneration',           resultKey: 'leads_generated' },
  { key: 'social_leads',      label: 'מחפש לידים ברשתות חברתיות...',       fn: 'findSocialLeads',             resultKey: 'leads_created' },
  // ── Trend Intelligence ────────────────────────────────────────────────────
  { key: 'tiktok_trends',     label: 'סורק טרנדים בTikTok (Apify)...',     fn: 'tiktokSectorTrendAgent',      resultKey: 'trends_created' },
  { key: 'trends',            label: 'מזהה מגמות שוק + Google Trends...',  fn: 'detectTrends',                resultKey: 'trends_created' },
  { key: 'early_trends',      label: 'מגלה טרנדים מוקדמים...',             fn: 'detectEarlyTrends',           resultKey: 'trends_created' },
  { key: 'viral',             label: 'סורק סיגנלים ויראלים...',            fn: 'detectViralSignals',          resultKey: 'signals_created' },
  // ── Predictive + Alerts ───────────────────────────────────────────────────
  { key: 'predictions',       label: 'מחשב תחזיות AI...',                  fn: 'runPredictions',              resultKey: 'predictions_created' },
  { key: 'alerts',            label: 'מייצר התראות פרואקטיביות...',        fn: 'generateProactiveAlerts',     resultKey: 'alerts_created' },
  { key: 'advisory',          label: 'מנתח תובנות אסטרטגיות מכל OSINT...', fn: 'generateAdvisoryInsights',    resultKey: 'insights_created' },
  // ── Learning + Optimization ───────────────────────────────────────────────
  { key: 'ml',                label: 'לומד מעסקאות סגורות...',             fn: 'runMLLearning',               resultKey: 'patterns_learned' },
  { key: 'ml_cycle',          label: 'מריץ מחזור אופטימיזציה...',          fn: 'runMLLearningCycle',          resultKey: 'events_processed' },
  { key: 'health',            label: 'מחשב ציון בריאות עסקית...',          fn: 'calculateHealthScore',        resultKey: 'score' },
  { key: 'cleanup',           label: 'מנקה נתונים ולומד...',               fn: 'cleanupAndLearn',             resultKey: 'signals_archived' },
  { key: 'briefing',          label: 'מכין בריפינג בוקר...',               fn: 'generateMorningBriefing',     resultKey: 'sections' },
];

export default function ScanOverlay({ businessProfile, onComplete, onClose, steps, title }) {
  const scanSteps = steps || defaultScanSteps;
  const scanTitle = title || 'סורק את השוק שלך...';

  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState({});
  const [results, setResults] = useState({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!businessProfile?.id) return;
    let cancelled = false;

    const run = async () => {
      const params = {
        businessProfileId: businessProfile.id,
        name: businessProfile.name,
        category: businessProfile.category,
        city: businessProfile.city,
      };
      const finalResults = {};

      for (let i = 0; i < scanSteps.length; i++) {
        if (cancelled) return;
        setCurrentStep(i);
        const step = scanSteps[i];

        if (step.fn) {
          try {
            const stepParams = step.force ? { ...params, force: true } : params;
            const res = await base44.functions.invoke(step.fn, stepParams);
            finalResults[step.key] = res.data?.[step.resultKey] || 0;
          } catch (e) {
            console.error(`${step.fn} failed:`, e);
            finalResults[step.key] = 0;
          }
        } else {
          await new Promise(r => setTimeout(r, 800));
        }

        setCompleted(prev => ({ ...prev, [step.key]: true }));
        setResults({ ...finalResults });
      }

      setDone(true);
      setTimeout(() => {
        if (!cancelled) onComplete?.();
      }, 2500);
    };

    run();
    return () => { cancelled = true; };
  }, [businessProfile?.id]);

  const totalSignals = (results.collect || 0) + (results.social || 0);
  const totalLeads   = (results.leads || 0) + (results.social_leads || 0);
  const totalTrends  = (results.tiktok_trends || 0) + (results.trends || 0) + (results.early_trends || 0);
  const totalInsights = (results.alerts || 0) + (results.advisory || 0);
  const summary = [
    results.reviews      ? `${results.reviews} ביקורות`            : null,
    totalSignals > 0     ? `${totalSignals} אותות`                  : null,
    results.compete      ? `${results.compete} מתחרים`              : null,
    totalLeads > 0       ? `${totalLeads} לידים`                    : null,
    totalTrends > 0      ? `${totalTrends} טרנדים`                  : null,
    results.viral        ? `${results.viral} סיגנלים ויראלים`       : null,
    totalInsights > 0    ? `${totalInsights} תובנות`                : null,
    results.predictions  ? `${results.predictions} תחזיות`          : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4 relative">
        <button onClick={onClose} className="absolute top-4 left-4 p-1 rounded-md hover:bg-secondary transition-colors">
          <X className="w-4 h-4 text-foreground-muted" />
        </button>

        {!done ? (
          <>
            <h3 className="text-[15px] font-semibold text-foreground mb-6 text-center">{scanTitle}</h3>
            <div className="space-y-3">
              {scanSteps.map((step, i) => (
                <div key={step.key} className={`flex items-center gap-3 transition-all duration-300 ${i <= currentStep ? 'opacity-100' : 'opacity-30'}`}>
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    {completed[step.key] ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : i === currentStep ? (
                      <Loader2 className="w-4 h-4 animate-spin text-foreground-muted" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-border" />
                    )}
                  </div>
                  <span className={`text-[12px] ${completed[step.key] ? 'text-success' : 'text-foreground-secondary'}`}>
                    {completed[step.key] ? '✓ ' : ''}{step.label}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6 text-success" />
            </div>
            <h3 className="text-[15px] font-semibold text-foreground mb-1">סריקה הושלמה ✓</h3>
            {summary && <p className="text-[12px] text-foreground-muted mb-1">נמצאו: {summary}</p>}
            <p className="text-[10px] text-foreground-muted opacity-60">עודכן: {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
