import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Radar, CheckCircle, Circle } from 'lucide-react';
import { toast } from 'sonner';

const scanSteps = [
  { key: 'collect', label: 'אוסף נתונים מהרשת...', fn: 'collectWebSignals', resultKey: 'new_signals_saved', resultLabel: 'אותות' },
  { key: 'analyze', label: 'מנתח תובנות שוק...', fn: 'runMarketIntelligence', resultKey: 'insights_generated', resultLabel: 'תובנות' },
  { key: 'compete', label: 'מזהה מתחרים...', fn: 'runCompetitorIdentification', resultKey: 'competitors_found', resultLabel: 'מתחרים' },
  { key: 'leads', label: 'מחפש לידים...', fn: 'runLeadGeneration', resultKey: 'leads_generated', resultLabel: 'לידים' },
  { key: 'enrich', label: 'מעשיר לידים...', fn: 'enrichLeads', resultKey: 'enriched', resultLabel: 'הועשרו' },
  { key: 'sector', label: 'מעדכן ידע סקטוריאלי...', fn: 'updateSectorKnowledge', resultKey: 'signals_analyzed', resultLabel: 'נתונים' },
  { key: 'gaps', label: 'מזהה פערי ידע...', fn: 'identifyKnowledgeGaps', resultKey: 'gaps_found', resultLabel: 'פערים' },
  { key: 'predict', label: 'מייצר חיזויים...', fn: 'runPredictions', resultKey: 'predictions_created', resultLabel: 'חיזויים' },
  { key: 'alerts', label: 'יוצר התראות חכמות...', fn: 'generateProactiveAlerts', resultKey: 'alerts_created', resultLabel: 'התראות' },
  { key: 'health', label: 'מחשב בריאות עסקית...', fn: 'calculateHealthScore', resultKey: 'overall_score', resultLabel: 'ציון' },
  { key: 'prices', label: 'עוקב מחירי מתחרים...', fn: 'trackCompetitorPrices', resultKey: 'changes', resultLabel: 'שינויים' },
];

export default function AgentStatusBar({ onScanComplete, businessProfile }) {
  const [scanning, setScanning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState({});
  const [results, setResults] = useState({});

  const handleScan = async () => {
    if (!businessProfile?.name) {
      toast.error('חסר פרופיל עסקי — לך להגדרות');
      return;
    }
    setScanning(true);
    setCompletedSteps({});
    setResults({});

    const finalResults = {};
    for (let i = 0; i < scanSteps.length; i++) {
      const step = scanSteps[i];
      setCurrentStep(i);
      try {
        const res = await base44.functions.invoke(step.fn, {
          businessProfileId: businessProfile.id,
          name: businessProfile.name,
          category: businessProfile.category,
          city: businessProfile.city,
        });
        finalResults[step.key] = res.data?.[step.resultKey] || 0;
        setCompletedSteps(prev => ({ ...prev, [step.key]: true }));
        setResults({ ...finalResults });
      } catch (err) {
        console.error(`${step.fn} failed:`, err);
        setCompletedSteps(prev => ({ ...prev, [step.key]: 'error' }));
      }
    }

    setCurrentStep(-1);
    setScanning(false);

    const summary = [
      finalResults.collect ? `${finalResults.collect} אותות` : null,
      finalResults.analyze ? `${finalResults.analyze} תובנות` : null,
      finalResults.compete ? `${finalResults.compete} מתחרים` : null,
      finalResults.leads ? `${finalResults.leads} לידים` : null,
    ].filter(Boolean).join(', ');

    toast.success(`סריקה הושלמה ✓ ${summary || ''}`);
    if (onScanComplete) onScanComplete();
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <button
        onClick={handleScan}
        disabled={scanning}
        className="btn-subtle flex items-center gap-1.5 px-4 py-2 rounded-lg bg-foreground text-background text-[11px] font-medium hover:opacity-90 transition-all disabled:opacity-50"
      >
        {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />}
        {scanning ? (scanSteps[currentStep]?.label || 'סורק...') : 'סרוק עכשיו ←'}
      </button>

      {scanning && (
        <div className="flex gap-2">
          {scanSteps.map((step, i) => (
            <div key={step.key} className="flex items-center gap-1">
              {completedSteps[step.key] === true ? (
                <CheckCircle className="w-3 h-3 text-[#10b981]" />
              ) : completedSteps[step.key] === 'error' ? (
                <Circle className="w-3 h-3 text-[#dc2626]" />
              ) : i === currentStep ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#d97706]" />
              ) : (
                <Circle className="w-3 h-3 text-[#eeeeee]" />
              )}
              {completedSteps[step.key] === true && results[step.key] > 0 && (
                <span className="text-[8px] text-[#10b981]">{results[step.key]}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {!scanning && Object.keys(results).length > 0 && (
        <span className="flex items-center gap-1.5 text-[10px] text-success font-medium">
          <CheckCircle className="w-3 h-3" />
          {[
            results.collect ? `${results.collect} אותות` : null,
            results.analyze ? `${results.analyze} תובנות` : null,
            results.leads ? `${results.leads} לידים` : null,
          ].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
  );
}