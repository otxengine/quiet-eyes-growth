import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Check, Loader2, X } from 'lucide-react';

// Default full-scan steps used by Dashboard
const defaultScanSteps = [
  { key: 'collect',       label: 'אוסף נתונים מ-12 מקורות...',     fn: 'collectWebSignals',           resultKey: 'new_signals_saved' },
  { key: 'social',        label: 'סורק רשתות חברתיות...',           fn: 'collectSocialSignals',        resultKey: 'signals_saved' },
  { key: 'reviews',       label: 'סורק ביקורות...',                  fn: 'scanAllReviews',              resultKey: 'new_reviews' },
  { key: 'analyze',       label: 'מנתח תובנות שוק...',              fn: 'runMarketIntelligence',       resultKey: 'insights_generated' },
  { key: 'compete',       label: 'מזהה מתחרים ושינויים...',         fn: 'runCompetitorIdentification', resultKey: 'competitors_found' },
  { key: 'leads',         label: 'סורק לידים ואותות ביקוש...',     fn: 'runLeadGeneration',           resultKey: 'leads_generated' },
  { key: 'early_trends',  label: 'מגלה טרנדים מוקדמים...',         fn: 'detectEarlyTrends',           resultKey: 'trends_created' },
  { key: 'viral',         label: 'סורק סיגנלים ויראלים...',         fn: 'detectViralSignals',          resultKey: 'signals_created' },
  { key: 'cleanup',       label: 'מנקה ולומד...',                   fn: 'cleanupAndLearn',             resultKey: 'signals_archived' },
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
            const res = await base44.functions.invoke(step.fn, params);
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
  const summary = [
    results.reviews      ? `${results.reviews} ביקורות`           : null,
    results.analyze      ? `${results.analyze} תובנות`             : null,
    results.compete      ? `${results.compete} מתחרים`             : null,
    totalSignals > 0     ? `${totalSignals} אותות`                 : null,
    results.leads        ? `${results.leads} לידים`                : null,
    results.early_trends ? `${results.early_trends} טרנדים מוקדמים` : null,
    results.viral        ? `${results.viral} סיגנלים ויראלים`      : null,
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
