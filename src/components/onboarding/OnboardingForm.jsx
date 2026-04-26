import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, ArrowRight, Globe, Instagram } from 'lucide-react';
import Autocomplete from '@/components/ui/Autocomplete';

const categorySuggestions = [
  'מסעדה', 'בית קפה', 'מאפייה', 'מספרה', 'מכון יופי', 'חנות בגדים',
  'חנות ספורט', 'חנות אלקטרוניקה', 'חנות פרחים', 'מכון כושר',
  'סטודיו ליוגה', 'סטודיו לפילאטיס', 'רופא שיניים', 'רופא משפחה',
  'עורך דין', 'רואה חשבון', 'יועץ מס', 'מוסך', 'חשמלאי', 'שרברב',
  'קבלן שיפוצים', 'אדריכל', 'מעצב פנים', 'סטודיו לצילום',
  'סוכנות ביטוח', 'סוכנות נדלן', 'משרד תיווך', 'חנות רהיטים',
  'מכבסה', 'חנות בשר', 'מינימרקט', 'סופרמרקט', 'בית מרקחת',
  'אופטיקה', 'חנות תכשיטים', 'חנות צעצועים', 'גן ילדים',
  'מכללה', 'בית ספר לנהיגה', 'מכון לימודים', 'דפוס',
  'חנות חיות', 'וטרינר', 'פיצרייה', 'פלאפל', 'שווארמה',
  'קייטרינג', 'אולם אירועים', 'DJ', 'צלם אירועים'
];

const citySuggestions = [
  'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'בני ברק', 'רמת גן', 'פתח תקווה',
  'נתניה', 'אשדוד', 'ראשון לציון', 'הרצליה', 'רעננה', 'כפר סבא', 'חולון', 'בת ים',
  'אשקלון', 'מודיעין', 'רחובות', 'לוד', 'רמלה', 'נצרת', 'עכו', 'קריית שמונה',
  'טבריה', 'אילת', 'דימונה', 'ערד', 'אופקים', 'שדרות', 'קריית גת', 'קריית ים',
  'קריית ביאליק', 'קריית מוצקין', 'קריית אתא', 'נשר', 'טירת כרמל',
  'יוקנעם', 'עפולה', 'בית שאן', 'כרמיאל', 'מעלות', 'נהריה', 'גבעתיים',
  'הוד השרון', 'יבנה', 'נס ציונה', 'קריית אונו', 'גבעת שמואל',
  'אור יהודה', 'אריאל', 'מעלה אדומים', 'בית שמש', 'אלעד', 'ביתר עילית'
];

export default function OnboardingForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '', category: '', city: '', full_address: '',
    website_url: '', facebook_url: '', instagram_url: '', tiktok_url: '',
    owner_name: '', phone: '', description: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const step1Valid = formData.name && formData.category && formData.city;
  const step2Valid = formData.owner_name && formData.phone;

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2.5 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!step2Valid || isSubmitting) return;
    setIsSubmitting(true);

    const profileData = {
      name: formData.name, category: formData.category, city: formData.city,
      full_address: formData.full_address || '',
      owner_name: formData.owner_name,
      phone: formData.phone,
      onboarding_completed: false, created_at: new Date().toISOString(),
    };
    if (formData.description) profileData.description = formData.description;
    if (formData.website_url) profileData.website_url = formData.website_url;
    if (formData.facebook_url) profileData.facebook_url = formData.facebook_url;
    if (formData.instagram_url) profileData.instagram_url = formData.instagram_url;
    if (formData.tiktok_url) profileData.tiktok_url = formData.tiktok_url;

    try {
      const profile = await base44.entities.BusinessProfile.create(profileData);
      navigate('/onboarding/scanning', { state: { businessProfile: profile } });
    } catch (err) {
      console.error('Failed to create business profile:', err);
      alert('שגיאה בשמירת הפרטים: ' + (err.message || 'נסה שוב'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[10px] p-8 border border-[#f0f0f0] card-enter">
          {/* Step indicator */}
          <div className="text-center mb-6">
            <p className="text-[11px] text-[#cccccc] mb-3">שלב {step} מתוך 2</p>
            <div className="flex gap-1.5 justify-center mb-4">
              <div className={`h-1 w-16 rounded-full transition-colors ${step >= 1 ? 'bg-[#111111]' : 'bg-[#eeeeee]'}`} />
              <div className={`h-1 w-16 rounded-full transition-colors ${step >= 2 ? 'bg-[#111111]' : 'bg-[#eeeeee]'}`} />
            </div>
            {step === 1 ? (
              <>
                <h1 className="text-2xl font-bold text-[#111111] mb-3">בוא נכיר את העסק שלך</h1>
                <p className="text-[#999999] text-sm">כמה פרטים ו-60 שניות — וכבר נראה לך מה קורה בשוק</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-[#111111] mb-3">קצת עליך</h1>
                <p className="text-[#999999] text-sm">פרטי יצירת קשר ותיאור קצר של העסק</p>
              </>
            )}
          </div>

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">שם העסק</label>
                <input placeholder="לדוגמה: מספרת דוד" value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">קטגוריה</label>
                <Autocomplete value={formData.category} onChange={(val) => setFormData({ ...formData, category: val })}
                  placeholder="הקלד קטגוריה" suggestions={categorySuggestions} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">עיר</label>
                <Autocomplete value={formData.city} onChange={(val) => setFormData({ ...formData, city: val })}
                  placeholder="הקלד שם עיר" suggestions={citySuggestions} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">כתובת מלאה</label>
                <input placeholder="רחוב, מספר, עיר — לדוגמה: הרצל 5, תל אביב" value={formData.full_address}
                  onChange={(e) => setFormData({ ...formData, full_address: e.target.value })} className={inputCls} />
                <p className="text-[10px] text-[#cccccc] mt-1">עוזר לזהות מתחרים ולידים באזור המדויק שלך</p>
              </div>

              {/* Social & Website links */}
              <div className="pt-2 border-t border-[#f0f0f0]">
                <p className="text-[12px] text-[#999999] mb-3">קישורים לנוכחות דיגיטלית <span className="text-[#cccccc]">(אופציונלי — עוזר לסוכנים ללמוד את העסק)</span></p>
                <div className="space-y-3">
                  <div className="relative">
                    <Globe className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#cccccc]" />
                    <input placeholder="כתובת אתר — example.co.il" value={formData.website_url}
                      onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                      className={inputCls + " pr-10"} dir="ltr" />
                  </div>
                  <div className="relative">
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#cccccc]" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    <input placeholder="קישור לעמוד פייסבוק" value={formData.facebook_url}
                      onChange={(e) => setFormData({ ...formData, facebook_url: e.target.value })}
                      className={inputCls + " pr-10"} dir="ltr" />
                  </div>
                  <div className="relative">
                    <Instagram className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#cccccc]" />
                    <input placeholder="קישור לפרופיל אינסטגרם" value={formData.instagram_url}
                      onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                      className={inputCls + " pr-10"} dir="ltr" />
                  </div>
                  <div className="relative">
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#cccccc]" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.87a8.16 8.16 0 0 0 4.76 1.52v-3.4a4.85 4.85 0 0 1-1-.3z"/></svg>
                    <input placeholder="קישור לפרופיל טיקטוק" value={formData.tiktok_url}
                      onChange={(e) => setFormData({ ...formData, tiktok_url: e.target.value })}
                      className={inputCls + " pr-10"} dir="ltr" />
                  </div>
                </div>
              </div>

              <button type="button" disabled={!step1Valid}
                onClick={() => setStep(2)}
                className="w-full h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md mt-6 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                המשך <ArrowLeft className="w-5 h-5" />
              </button>
            </div>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">שם בעל העסק / איש קשר</label>
                <input placeholder="לדוגמה: דוד כהן" value={formData.owner_name}
                  onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">מספר טלפון</label>
                <input placeholder="050-0000000" value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className={inputCls} dir="ltr" type="tel" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111111] mb-2">
                  תיאור קצר של העסק <span className="text-[#cccccc] font-normal">(אופציונלי)</span>
                </label>
                <textarea placeholder="ספר לנו מה מיוחד בעסק שלך, שירותים עיקריים, קהל יעד..." value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className={inputCls + " resize-none"} rows={3} />
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 h-12 text-[13px] font-semibold border border-[#eeeeee] text-[#111111] rounded-md transition-colors hover:bg-[#fafafa] flex items-center justify-center gap-2">
                  <ArrowRight className="w-5 h-5" /> חזרה
                </button>
                <button type="submit" disabled={!step2Valid || isSubmitting}
                  className="flex-[2] h-12 text-[13px] font-semibold bg-[#111111] hover:bg-[#333333] text-white rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {isSubmitting ? (
                    <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> שומר...</>
                  ) : (
                    <>התחל סריקה <ArrowLeft className="w-5 h-5" /></>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
