import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Globe, Instagram, Check, ChevronLeft } from 'lucide-react';

// Step 2: Goal tiles
const GOAL_OPTIONS = [
  { value: 'new_customers',    icon: '🎯', label: 'להביא לקוחות חדשים',       sub: 'להגיע ליותר אנשים שמחפשים את מה שאני מציע' },
  { value: 'retain',           icon: '🔁', label: 'לשמר לקוחות קיימים',       sub: 'לגרום ללקוחות לחזור שוב ושוב' },
  { value: 'more_per_customer',icon: '📈', label: 'להרוויח יותר מכל לקוח',    sub: 'להגדיל את ערך כל עסקה' },
  { value: 'reviews',          icon: '⭐', label: 'לשפר דירוגים וביקורות',    sub: 'לבנות מוניטין חזק ואמין יותר' },
];

// Step 3: Price tiers
const PRICE_OPTIONS = [
  { value: 'budget',   label: 'מחיר נגיש',   sub: 'ללקוחות שמחפשים עסקה טובה' },
  { value: 'mid',      label: 'מחיר בינוני',  sub: 'ערך טוב לכסף' },
  { value: 'premium',  label: 'פרימיום',      sub: 'איכות גבוהה, מחיר בהתאם' },
];

// Step 3: Customer source chips
const SOURCE_OPTIONS = [
  { value: 'google',        label: 'חיפוש Google' },
  { value: 'instagram',     label: 'אינסטגרם' },
  { value: 'facebook',      label: 'פייסבוק' },
  { value: 'word_of_mouth', label: 'המלצות פה לאוזן' },
  { value: 'waze',          label: 'ווייז / מפות' },
  { value: 'tiktok',        label: 'טיקטוק' },
  { value: 'linkedin',      label: 'לינקדאין' },
  { value: 'walk_in',       label: 'עוברי אורח' },
  { value: 'referral',      label: 'הפניות מקצועיות' },
  { value: 'website',       label: 'אתר עצמאי' },
];

// Step 4: Channels with intelligence contribution
const CHANNEL_OPTIONS = [
  { key: 'website',   label: 'אתר אינטרנט',  icon: '🌐', pct: 15, field: 'website_url',   placeholder: 'https://example.co.il' },
  { key: 'instagram', label: 'אינסטגרם',      icon: '📸', pct: 25, field: 'instagram_url', placeholder: 'https://instagram.com/...' },
  { key: 'facebook',  label: 'פייסבוק',       icon: '👥', pct: 20, field: 'facebook_url',  placeholder: 'https://facebook.com/...' },
  { key: 'tiktok',    label: 'טיקטוק',        icon: '🎵', pct: 15, field: 'tiktok_url',    placeholder: 'https://tiktok.com/@...' },
];

const BASE_INTEL = 45; // base accuracy from name/description/city alone

export default function OnboardingForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '', description: '', city: '',
    goal: '', price_tier: '', customer_sources: [],
    website_url: '', instagram_url: '', facebook_url: '', tiktok_url: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute intelligence meter value
  const intelPct = Math.min(
    100,
    BASE_INTEL +
    CHANNEL_OPTIONS.reduce((acc, ch) => acc + (formData[ch.field] ? ch.pct : 0), 0)
  );

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2.5 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#bbbbbb] transition-colors";

  const toggleSource = (val) => {
    setFormData(prev => ({
      ...prev,
      customer_sources: prev.customer_sources.includes(val)
        ? prev.customer_sources.filter(s => s !== val)
        : [...prev.customer_sources, val],
    }));
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const profileData = {
      name:                formData.name,
      category:            formData.description, // use description as category for LLM
      city:                formData.city,
      description:         formData.description,
      business_goal:       formData.goal,
      price_tier:          formData.price_tier,
      customer_sources:    JSON.stringify(formData.customer_sources),
      website_url:         formData.website_url  || undefined,
      instagram_url:       formData.instagram_url || undefined,
      facebook_url:        formData.facebook_url  || undefined,
      tiktok_url:          formData.tiktok_url    || undefined,
      onboarding_completed: false,
      created_at:          new Date().toISOString(),
    };

    try {
      const profile = await base44.entities.BusinessProfile.create(profileData);
      navigate('/onboarding/scanning', {
        state: {
          businessProfile: profile,
          onboardingData: {
            goal:             formData.goal,
            price_tier:       formData.price_tier,
            customer_sources: formData.customer_sources,
          },
        },
      });
    } catch (err) {
      console.error('Failed to create business profile:', err);
      toast.error('שגיאה בשמירת הפרטים. נסה שוב.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[10px] p-8 border border-[#f0f0f0]">

          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex gap-1.5 mb-3">
              {[1,2,3,4].map(n => (
                <div key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${n <= step ? 'bg-[#111111]' : 'bg-[#eeeeee]'}`} />
              ))}
            </div>
            <p className="text-[11px] text-[#cccccc]">שלב {step} מתוך 4</p>
          </div>

          {/* ── STEP 1: Identity ─────────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold text-[#111111] mb-1">ספר לנו על העסק שלך</h1>
              <p className="text-[#999999] text-sm mb-7">כתוב בחופשיות — ככל שתפרט יותר, הסוכנים שלנו יהיו מדויקים יותר</p>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-[#111111] mb-2">שם העסק</label>
                  <input
                    placeholder="לדוגמה: סטודיו לעיצוב UI — מיכל לוי"
                    value={formData.name}
                    onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111111] mb-2">
                    תאר את העסק שלך
                    <span className="text-[#cccccc] font-normal mr-1">(מה אתה עושה, למי, ומה מייחד אותך)</span>
                  </label>
                  <textarea
                    placeholder={`לדוגמה:\n"אני מעצב UI/UX לסטרטאפים ב-SaaS. עובד בעיקר עם חברות שמחפשות לשפר את מוצר הדיגיטלי שלהן. מתמחה בעיצוב מערכות מורכבות."\n\nאו:\n"בית קפה קטן ואינטימי בתל אביב. אנחנו מתמחים בקפה מיוחד ועוגות ביתיות. הקהל שלנו הוא אנשי הייטק שעובדים מהבית."`}
                    value={formData.description}
                    onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                    className={inputCls + " resize-none"}
                    rows={5}
                  />
                  <p className="text-[10px] text-[#cccccc] mt-1">מידע זה עוזר לסוכנים להבין בדיוק מה העסק שלך ולמי לא לשלוח תובנות לא רלוונטיות</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111111] mb-2">עיר</label>
                  <input
                    placeholder="לדוגמה: תל אביב"
                    value={formData.city}
                    onChange={e => setFormData(p => ({ ...p, city: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <button
                  disabled={!formData.name || !formData.description || !formData.city}
                  onClick={() => setStep(2)}
                  className="w-full h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md mt-4 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  המשך <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Goal ─────────────────────────────────────────────────── */}
          {step === 2 && (
            <div>
              <h1 className="text-2xl font-bold text-[#111111] mb-1">מה הכי חשוב לך עכשיו?</h1>
              <p className="text-[#999999] text-sm mb-7">הסוכנים יתמקדו בהתאם לעדיפות שלך</p>
              <div className="grid grid-cols-1 gap-3">
                {GOAL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setFormData(p => ({ ...p, goal: opt.value })); setStep(3); }}
                    className={`text-right p-4 rounded-xl border-2 transition-all duration-150 ${
                      formData.goal === opt.value
                        ? 'border-[#111111] bg-[#fafafa]'
                        : 'border-[#eeeeee] hover:border-[#cccccc]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{opt.icon}</span>
                      <div>
                        <div className="font-medium text-[#111111] text-[14px]">{opt.label}</div>
                        <div className="text-[11px] text-[#999999] mt-0.5">{opt.sub}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(1)} className="mt-6 text-[12px] text-[#cccccc] hover:text-[#999999] transition-colors">
                ← חזרה
              </button>
            </div>
          )}

          {/* ── STEP 3: Price + Sources ───────────────────────────────────────── */}
          {step === 3 && (
            <div>
              <h1 className="text-2xl font-bold text-[#111111] mb-1">כמה עוד פרטים</h1>
              <p className="text-[#999999] text-sm mb-7">עוזר לנו לכוון את הניתוח לתחרות ולאסטרטגיה הנכונה לך</p>
              <div className="space-y-7">
                {/* Price tier */}
                <div>
                  <label className="block text-sm font-medium text-[#111111] mb-3">מיקום מחיר בשוק</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRICE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setFormData(p => ({ ...p, price_tier: opt.value }))}
                        className={`p-3 rounded-xl border-2 transition-all text-center ${
                          formData.price_tier === opt.value
                            ? 'border-[#111111] bg-[#fafafa]'
                            : 'border-[#eeeeee] hover:border-[#cccccc]'
                        }`}
                      >
                        <div className="font-medium text-[#111111] text-[13px]">{opt.label}</div>
                        <div className="text-[10px] text-[#999999] mt-0.5">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer sources */}
                <div>
                  <label className="block text-sm font-medium text-[#111111] mb-3">
                    מאיפה מגיעים הלקוחות שלך?
                    <span className="text-[#cccccc] font-normal mr-1">(בחר את כל שרלוונטי)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map(opt => {
                      const selected = formData.customer_sources.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => toggleSource(opt.value)}
                          className={`px-3 py-1.5 rounded-full text-[12px] border transition-all ${
                            selected
                              ? 'bg-[#111111] text-white border-[#111111]'
                              : 'border-[#eeeeee] text-[#666666] hover:border-[#cccccc]'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3 inline ml-1" />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button onClick={() => setStep(2)} className="text-[12px] text-[#cccccc] hover:text-[#999999] transition-colors">
                  ← חזרה
                </button>
                <button
                  disabled={!formData.price_tier || formData.customer_sources.length === 0}
                  onClick={() => setStep(4)}
                  className="flex-1 h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  המשך <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Channels + Intelligence Meter ────────────────────────── */}
          {step === 4 && (
            <div>
              <h1 className="text-2xl font-bold text-[#111111] mb-1">חבר מקורות מידע</h1>
              <p className="text-[#999999] text-sm mb-2">אופציונלי — ברגע שהמקורות יחוברו הסוכנים ילמדו יותר טוב על העסק</p>

              {/* Intelligence meter */}
              <div className="bg-[#fafafa] border border-[#eeeeee] rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] text-[#666666] font-medium">דיוק אינטליגנציה</span>
                  <span className="text-[14px] font-bold text-[#111111]">{intelPct}%</span>
                </div>
                <div className="h-2 bg-[#eeeeee] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${intelPct}%`,
                      background: intelPct >= 80 ? '#10b981' : intelPct >= 60 ? '#f59e0b' : '#6366f1',
                    }}
                  />
                </div>
                <p className="text-[10px] text-[#cccccc] mt-1.5">
                  {intelPct < 60
                    ? 'חבר מקורות כדי שהסוכנים יוכלו לסרוק ולנתח בצורה מדויקת יותר'
                    : intelPct < 85
                    ? 'טוב! עוד מקור אחד יגביר משמעותית את הדיוק'
                    : 'מצוין! הסוכנים יוכלו לנתח את העסק שלך ברמה גבוהה מאוד'}
                </p>
              </div>

              <div className="space-y-3">
                {CHANNEL_OPTIONS.map(ch => (
                  <div key={ch.key} className={`border rounded-xl p-3 transition-all ${formData[ch.field] ? 'border-[#111111] bg-[#fafafa]' : 'border-[#eeeeee]'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{ch.icon}</span>
                        <span className="text-[13px] font-medium text-[#111111]">{ch.label}</span>
                      </div>
                      <span className="text-[11px] text-[#999999]">+{ch.pct}% דיוק</span>
                    </div>
                    <input
                      placeholder={ch.placeholder}
                      value={formData[ch.field]}
                      onChange={e => setFormData(p => ({ ...p, [ch.field]: e.target.value }))}
                      className={inputCls}
                      dir="ltr"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-7">
                <button onClick={() => setStep(3)} className="text-[12px] text-[#cccccc] hover:text-[#999999] transition-colors">
                  ← חזרה
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1 h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> שומר...</>
                  ) : (
                    'התחל סריקה'
                  )}
                </button>
              </div>
              <p className="text-[11px] text-[#cccccc] text-center mt-3">
                ניתן לחבר מקורות נוספים גם לאחר הרישום
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
