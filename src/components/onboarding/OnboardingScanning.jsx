import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Check } from 'lucide-react';
import KoriAvatar from './KoriAvatar';
import { ONBOARDING_STATE_KEY } from './OnboardingSelectPlan';

// Stripe redirects (select-plan -> checkout -> back here) lose React Router
// state, so fall back to the snapshot OnboardingSelectPlan stashed before redirecting.
function useOnboardingState(location) {
  if (location.state?.businessProfile) return location.state;
  const isStripeReturn = new URLSearchParams(window.location.search).get('success') === 'true';
  if (!isStripeReturn) return {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(ONBOARDING_STATE_KEY) || 'null');
    return saved || {};
  } catch {
    return {};
  }
}

const API_BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:3007/api';

const scanSteps = [
  { fn: 'parseProfile',            text: 'מנתח את פרופיל העסק שלך...',      narrative: 'מבין את הסקטור שלך לעומק...' },
  { fn: 'generateMissions',        text: 'מתכנן משימות לכל הסוכנים...',     narrative: 'Claude + GPT-4o בונים תוכנית עבודה מותאמת...' },
  { fn: 'generateAbout',           text: 'מכין טיוטת זהות עסקית...',        narrative: 'מנסח תיאור, קהל יעד וטון תוכן לאישורך...' },
  { fn: 'autoConfigOsint',         text: 'מגדיר מקורות מידע מותאמים...',    narrative: 'בוחר את המקורות הרלוונטיים לתחום שלך...' },
  { fn: 'resolveGooglePlace',      text: 'מחפש את הדף העסקי שלך בגוגל...', narrative: 'מקשר את העסק שלך ל-Google...' },
  { fn: 'collectWebSignals',       text: 'סורק את השוק ברשת...',            narrative: 'מחפש מה לקוחות מדברים על הסקטור שלך...' },
  { fn: 'collectSocialSignals',    text: 'אוסף אותות מרשתות חברתיות...',   narrative: 'מנתח טרנדים רלוונטיים לעסק שלך...' },
  { fn: 'synthesizeMarketInsights', text: 'מנתח תובנות שוק...',              narrative: 'מזהה הזדמנויות ספציפיות לתחום שלך...', delay: 8000 },
  { fn: 'runLeadGeneration',       text: 'מחפש לידים פוטנציאליים...',       narrative: 'מחפש אנשים שמחפשים בדיוק מה שאתה מציע...' },
  { fn: 'enrichLeads',             text: 'מדרג ומעשיר לידים...',            narrative: 'בודק כל ליד לפי קריטריונים של הסקטור שלך...' },
  { fn: 'updateSectorKnowledge',   text: 'בונה ידע על הסקטור שלך...',       narrative: 'לומד מכל העסקים בתחום דומה...' },
  { fn: 'generateProactiveAlerts', text: 'מייצר המלצות ראשונות...',         narrative: 'רק תובנות שרלוונטיות לעסק שלך בדיוק...' },
];


const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

export default function OnboardingScanning() {
  const location = useLocation();
  const navigate = useNavigate();
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [statusText, setStatusText] = useState('מתחיל ניתוח העסק שלך...');
  const [narrativeText, setNarrativeText] = useState('');
  const onboardingState = useOnboardingState(location);
  const businessProfile = onboardingState.businessProfile;
  const onboardingData = onboardingState.onboardingData || {};
  const ranRef = useRef(false);

  useEffect(() => {
    if (!businessProfile || ranRef.current) {
      if (!businessProfile) navigate('/onboarding');
      return;
    }
    ranRef.current = true;
    sessionStorage.removeItem(ONBOARDING_STATE_KEY);

    const run = async () => {
      const bp = businessProfile;
      const params = { businessProfileId: bp.id, name: bp.name, category: bp.category, city: bp.city };
      let signals = [];

      for (let i = 0; i < scanSteps.length; i++) {
        const step = scanSteps[i];

        if (step.requiresWebsite && !bp.website_url) {
          setCompletedSteps(prev => [...prev, i]);
          continue;
        }

        setCurrentStep(i);
        setStatusText(step.text);
        setNarrativeText(step.narrative);

        if (step.delay) {
          await new Promise(r => setTimeout(r, step.delay));
        }

        try {
          if (step.fn === 'parseProfile') {
            const key = window.__clerk_session_token || '';
            await fetch(`${API_BASE}/onboarding/parse-profile`, {
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
            }).catch(() => {});
          } else if (step.fn === 'generateMissions') {
            const key = window.__clerk_session_token || '';
            await fetch(`${API_BASE}/onboarding/generate-missions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
              body: JSON.stringify({ businessProfileId: bp.id }),
            }).catch(() => {});
          } else if (step.fn === 'generateAbout') {
            await base44.raw.post('/onboarding/generate-about', {
              businessProfileId: bp.id,
              ...(onboardingData.seed_info ? { seed_info: onboardingData.seed_info } : {}),
            }).catch(() => {});
          } else {
            await base44.functions.invoke(step.fn, params);
          }
        } catch (err) {
          console.error(`${step.fn} failed:`, err);
        }
        setCompletedSteps(prev => [...prev, i]);
      }

      let proactiveAlerts = [];
      let freshProfile = bp;
      try {
        const [allSignals, alertsRes, profileRes] = await Promise.all([
          base44.entities.MarketSignal.filter({ linked_business: bp.id }, '-detected_at', 10),
          base44.entities.ProactiveAlert.filter({ linked_business: bp.id }, '-created_date', 4),
          base44.entities.BusinessProfile.get(bp.id),
        ]);
        signals = (allSignals || []).slice(0, 5);
        proactiveAlerts = alertsRes || [];
        if (profileRes) freshProfile = profileRes;
      } catch (_) {}

      navigate('/onboarding/approve-identity', { state: { businessProfile: freshProfile, signals, proactiveAlerts } });
    };

    run();
  }, [businessProfile, navigate]);

  const progress = scanSteps.length > 0 ? Math.round((completedSteps.length / scanSteps.length) * 100) : 0;

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-4" style={BG_STYLE}>
      <div className="text-center max-w-sm w-full">

        {/* Kori avatar with pulse rings */}
        <div className="relative w-28 h-28 mx-auto mb-6 flex items-center justify-center">
          <div
            className="absolute inset-0 rounded-full opacity-20 animate-ping"
            style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 60%, #ff9800 100%)' }}
          />
          <div
            className="absolute inset-3 rounded-full opacity-15 animate-ping"
            style={{ background: 'linear-gradient(135deg, #9c27b0 0%, #e8344d 60%, #ff9800 100%)', animationDelay: '0.4s' }}
          />
          <KoriAvatar size="md" className="relative z-10 shadow-lg" />
        </div>

        {/* Status text */}
        <h2 className="text-[16px] font-bold text-gray-800 mb-1">{statusText}</h2>
        {narrativeText && (
          <p className="text-[12px] text-gray-500 mb-5 transition-all duration-300">{narrativeText}</p>
        )}

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-6 max-w-[200px] mx-auto">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #9c27b0, #e8344d)',
            }}
          />
        </div>

        {/* Step list */}
        <div className="space-y-2.5 text-right max-w-xs mx-auto">
          {scanSteps.map((step, index) => (
            <div
              key={index}
              className="flex items-center gap-3 transition-all duration-500"
              style={{
                opacity: index <= currentStep ? 1 : 0,
                transform: index <= currentStep ? 'translateY(0)' : 'translateY(8px)',
              }}
            >
              <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                {completedSteps.includes(index) ? (
                  <div className="w-5 h-5 rounded-full bg-[#fce4ec] flex items-center justify-center">
                    <Check className="w-3 h-3 text-[#e8344d]" />
                  </div>
                ) : index === currentStep ? (
                  <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: 'linear-gradient(135deg, #9c27b0, #e8344d)' }} />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-gray-300" />
                )}
              </div>
              <span className={`text-[12px] ${completedSteps.includes(index) ? 'text-[#e8344d]' : 'text-gray-500'}`}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
