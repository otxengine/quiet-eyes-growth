import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Check, Loader2 } from 'lucide-react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3002';

const scanSteps = [
  { fn: 'parseProfile',            text: 'מנתח את פרופיל העסק שלך...',      narrative: 'מבין את הסקטור שלך לעומק...' },
  { fn: 'autoConfigOsint',         text: 'מגדיר מקורות מידע מותאמים...',    narrative: 'בוחר את המקורות הרלוונטיים לתחום שלך...' },
  { fn: 'learnFromWebsite',        text: 'לומד את האתר שלך...',             narrative: 'קורא את הדפים ומבין את הקול שלך...', requiresWebsite: true },
  { fn: 'collectWebSignals',       text: 'סורק את השוק ברשת...',            narrative: 'מחפש מה לקוחות מדברים על הסקטור שלך...' },
  { fn: 'collectSocialSignals',    text: 'אוסף אותות מרשתות חברתיות...',   narrative: 'מנתח טרנדים רלוונטיים לעסק שלך...' },
  { fn: 'runMarketIntelligence',   text: 'מנתח תובנות שוק...',              narrative: 'מזהה הזדמנויות ספציפיות לתחום שלך...', delay: 8000 },
  { fn: 'detectTrends',            text: 'מזהה מגמות בסקטור שלך...',        narrative: 'מה עולה בתחום שלך עכשיו?' },
  { fn: 'runCompetitorIdentification', text: 'מזהה מתחרים רלוונטיים...',    narrative: 'מוצא את המתחרים האמיתיים שלך בלבד...' },
  { fn: 'runLeadGeneration',       text: 'מחפש לידים פוטנציאליים...',       narrative: 'מחפש אנשים שמחפשים בדיוק מה שאתה מציע...' },
  { fn: 'enrichLeads',             text: 'מדרג ומעשיר לידים...',            narrative: 'בודק כל ליד לפי קריטריונים של הסקטור שלך...' },
  { fn: 'updateSectorKnowledge',   text: 'בונה ידע על הסקטור שלך...',       narrative: 'לומד מכל העסקים בתחום דומה...' },
  { fn: 'runPredictions',          text: 'מייצר תחזיות אישיות...',          narrative: 'צופה קדימה בהתאם לתחום ולעונה...', delay: 5000 },
  { fn: 'calculateHealthScore',    text: 'מחשב אינדקס בריאות עסקית...',    narrative: 'מדד עולמי שבנוי בדיוק לתחום שלך...' },
  { fn: 'generateProactiveAlerts', text: 'מייצר המלצות ראשונות...',         narrative: 'רק תובנות שרלוונטיות לעסק שלך בדיוק...' },
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
  const [statusText, setStatusText] = useState('מתחיל ניתוח העסק שלך...');
  const [narrativeText, setNarrativeText] = useState('');
  const businessProfile = location.state?.businessProfile;
  const onboardingData = location.state?.onboardingData || {};
  const ranRef = useRef(false);

  useEffect(() => {
    if (!businessProfile || ranRef.current) {
      if (!businessProfile) navigate('/onboarding');
      return;
    }
    ranRef.current = true;

    const run = async () => {
      const bp = businessProfile;
      const params = { businessProfileId: bp.id, name: bp.name, category: bp.category, city: bp.city };
      let signals = [];

      for (let i = 0; i < scanSteps.length; i++) {
        const step = scanSteps[i];

        // Skip website step if no website URL
        if (step.requiresWebsite && !bp.website_url) {
          setCompletedSteps(prev => [...prev, i]);
          continue;
        }

        setCurrentStep(i);
        setStatusText(step.text);
        setNarrativeText(step.narrative);

        // Delay before heavy steps
        if (step.delay) {
          await new Promise(r => setTimeout(r, step.delay));
        }

        try {
          if (step.fn === 'parseProfile') {
            // Call our new parse-profile endpoint to build AI sector profile
            const key = sessionStorage.getItem('__user_token') || '';
            await fetch(`${SERVER_URL}/api/onboarding/parse-profile`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
              body: JSON.stringify({
                businessProfileId: bp.id,
                description:       bp.description,
                category:          bp.category,
                city:              bp.city,
                goal:              onboardingData.goal,
                price_tier:        onboardingData.price_tier,
                customer_sources:  onboardingData.customer_sources,
              }),
            }).catch(() => {}); // non-fatal
          } else if (step.fn === 'learnFromWebsite') {
            await base44.functions.invoke('learnFromWebsite', { businessProfileId: bp.id, websiteUrl: bp.website_url });
          } else {
            await base44.functions.invoke(step.fn, params);
          }
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
    <div className="min-h-screen bg-white flex items-center justify-center p-4" dir="rtl">
      <div className="text-center max-w-sm w-full">
        {/* Animated scanner */}
        <div className="relative w-28 h-28 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-[#111111]/10 scanning-pulse" />
          <div className="absolute inset-4 rounded-full border-4 border-[#111111]/15 scanning-pulse" style={{ animationDelay: '0.3s' }} />
          <div className="absolute inset-8 rounded-full border-4 border-[#111111]/20 scanning-pulse" style={{ animationDelay: '0.6s' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-[#111111]/10" />
          </div>
        </div>

        <h2 className="text-lg font-semibold text-[#222222] mb-1">{statusText}</h2>
        {narrativeText && (
          <p className="text-[12px] text-[#aaaaaa] mb-6 transition-all duration-300">{narrativeText}</p>
        )}

        {/* Step list */}
        <div className="space-y-2.5 text-right max-w-xs mx-auto">
          {scanSteps.map((step, index) => (
            <div
              key={index}
              className={`flex items-center gap-3 transition-all duration-500 ${
                index <= currentStep ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
              }`}
            >
              <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                {completedSteps.includes(index) ? (
                  <div className="w-5 h-5 rounded-full bg-[#f0fdf8] flex items-center justify-center">
                    <Check className="w-3 h-3 text-[#10b981]" />
                  </div>
                ) : index === currentStep ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#999999]" />
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-[#eeeeee]" />
                )}
              </div>
              <span className={`text-[12px] ${completedSteps.includes(index) ? 'text-[#10b981]' : 'text-[#999999]'}`}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
