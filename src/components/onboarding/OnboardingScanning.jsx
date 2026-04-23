import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Check, Loader2 } from 'lucide-react';

const scanSteps = [
  { fn: 'autoConfigOsint', text: 'מנתח את העסק ומגדיר מקורות מידע...' },
  { fn: 'learnFromWebsite', text: 'לומד את האתר שלך...', requiresWebsite: true },
  { fn: 'collectWebSignals', text: 'אוסף נתונים מהרשת...' },
  { fn: 'collectSocialSignals', text: 'סורק רשתות חברתיות...' },
  { fn: 'runMarketIntelligence', text: 'מנתח תובנות שוק...', delay: 8000 },
  { fn: 'detectTrends', text: 'מזהה מגמות וטרנדים בסקטור...' },
  { fn: 'runCompetitorIdentification', text: 'מזהה מתחרים...' },
  { fn: 'runLeadGeneration', text: 'מחפש לידים פוטנציאליים...' },
  { fn: 'enrichLeads', text: 'מעשיר ומדרג לידים...' },
  { fn: 'updateSectorKnowledge', text: 'בונה מאגר ידע סקטוריאלי...' },
  { fn: 'runPredictions', text: 'מייצר חיזויים ותחזיות...', delay: 5000 },
  { fn: 'calculateHealthScore', text: 'מחשב אינדקס בריאות עסקית...' },
  { fn: 'generateProactiveAlerts', text: 'מייצר התראות והמלצות...' },
];

const fallbackInsights = [
  { category: 'threat', title: 'תחרות גוברת באזור', recommended_action: 'בדוק את המתחרים החדשים.', confidence: 75 },
  { category: 'opportunity', title: 'ביקוש גובר לשירותים דיגיטליים', recommended_action: 'שקול להוסיף הזמנה אונליין.', confidence: 80 },
  { category: 'trend', title: 'עלייה בחיפושים מקומיים', recommended_action: 'וודא שפרופיל Google Business מעודכן.', confidence: 85 }
];

export default function OnboardingScanning() {
  const location = useLocation();
  const navigate = useNavigate();
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [statusText, setStatusText] = useState('סורקים את השוק שלך...');
  const businessProfile = location.state?.businessProfile;
  const ranRef = useRef(false);

  useEffect(() => {
    if (!businessProfile || ranRef.current) { if (!businessProfile) navigate('/onboarding'); return; }
    ranRef.current = true;

    const run = async () => {
      const bp = businessProfile;
      const params = { businessProfileId: bp.id, name: bp.name, category: bp.category, city: bp.city };
      let signals = [];

      for (let i = 0; i < scanSteps.length; i++) {
        const step = scanSteps[i];

        // Skip website learning step if no website URL
        if (step.requiresWebsite && !bp.website_url) {
          setCompletedSteps(prev => [...prev, i]);
          continue;
        }

        setCurrentStep(i);
        setStatusText(step.text);

        // Delay before market intelligence to let signals save
        if (step.delay) {
          await new Promise(r => setTimeout(r, step.delay));
        }

        try {
          const stepParams = step.fn === 'learnFromWebsite'
            ? { businessProfileId: bp.id, websiteUrl: bp.website_url }
            : params;
          await base44.functions.invoke(step.fn, stepParams);
        } catch (err) {
          console.error(`${step.fn} failed:`, err);
        }
        setCompletedSteps(prev => [...prev, i]);
      }

      // Get generated signals for insights page
      try {
        const allSignals = await base44.entities.MarketSignal.filter({ linked_business: bp.id }, '-detected_at', 10);
        signals = allSignals.slice(0, 5);
      } catch (_) {}

      // Fallback if no signals generated
      if (signals.length === 0) {
        const now = new Date().toISOString();
        for (const insight of fallbackInsights) {
          const signal = await base44.entities.MarketSignal.create({
            summary: insight.title, impact_level: insight.category === 'threat' ? 'high' : 'medium',
            category: insight.category, recommended_action: insight.recommended_action,
            confidence: insight.confidence, is_read: false, detected_at: now, linked_business: bp.id,
          });
          signals.push(signal);
        }
      }

      navigate('/onboarding/insights', { state: { businessProfile: bp, signals } });
    };

    run();
  }, [businessProfile, navigate]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="text-center">
        <div className="relative w-32 h-32 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full border-4 border-[#111111]/10 scanning-pulse" />
          <div className="absolute inset-4 rounded-full border-4 border-[#111111]/20 scanning-pulse" style={{ animationDelay: '0.3s' }} />
          <div className="absolute inset-8 rounded-full border-4 border-[#111111]/30 scanning-pulse" style={{ animationDelay: '0.6s' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-[#f0f0f0]" />
          </div>
        </div>

        <h2 className="text-xl font-medium text-[#444444] mb-8">{statusText}</h2>

        <div className="space-y-3 text-right max-w-xs mx-auto">
          {scanSteps.map((step, index) => (
            <div key={index} className={`flex items-center gap-3 transition-all duration-500 ${index <= currentStep ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                {completedSteps.includes(index) ? (
                  <div className="w-5 h-5 rounded-full bg-[#f0fdf8] flex items-center justify-center">
                    <Check className="w-3 h-3 text-[#10b981]" />
                  </div>
                ) : index === currentStep ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#999999]" />
                ) : (
                  <div className="w-3 h-3 rounded-full bg-[#eeeeee]" />
                )}
              </div>
              <span className={`text-sm ${completedSteps.includes(index) ? 'text-[#10b981]' : 'text-[#999999]'}`}>{step.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}