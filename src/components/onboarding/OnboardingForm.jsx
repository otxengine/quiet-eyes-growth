import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { MapPin, Search } from 'lucide-react';
import KoriAvatar from './KoriAvatar';
import { AiBubble, UserBubble } from './ConversationBubble';
import PillSelector from './PillSelector';

// ── Static data ────────────────────────────────────────────────────────────────

const CITIES = [
  'תל אביב', 'ירושלים', 'חיפה', 'ראשון לציון', 'פתח תקווה', 'אשדוד', 'נתניה', 'באר שבע',
  'בני ברק', 'רמת גן', 'הרצליה', 'חולון', 'רחובות', 'אשקלון', 'בת ים', 'הוד השרון',
  'כפר סבא', 'רעננה', 'מודיעין', 'עפולה', 'עכו', 'נהריה', 'נצרת', 'כרמיאל', 'טבריה',
  'צפת', 'קריית שמונה', 'אילת', 'אריאל', 'רמלה', 'לוד', 'יבנה', 'קריית גת',
  'שוהם', 'אלעד', 'גבעתיים', 'רמת השרון', 'כפר יונה', 'קריית אונו', 'גדרה',
  'זכרון יעקב', 'נס ציונה', 'ראש העין', 'ירוחם', 'דימונה', 'אור יהודה', 'גבעת שמואל',
];

const SERVICES = [
  { value: 'consulting', label: 'ייעוץ' },
  { value: 'installation', label: 'התקנה' },
  { value: 'design', label: 'עיצוב' },
  { value: 'marketing', label: 'שיווק' },
  { value: 'development', label: 'פיתוח' },
  { value: 'repair', label: 'תיקונים' },
  { value: 'training', label: 'הדרכה' },
  { value: 'delivery', label: 'משלוחים' },
  { value: 'maintenance', label: 'אחזקה' },
  { value: 'photography', label: 'צילום' },
  { value: 'events', label: 'אירועים' },
  { value: 'therapy', label: 'טיפולים' },
  { value: 'cleaning', label: 'ניקיון' },
  { value: 'catering', label: 'קייטרינג' },
];

const PRICE_OPTIONS = [
  { value: 'budget',     label: 'מחיר נגיש',   sub: 'ללקוחות שמחפשים עסקה טובה' },
  { value: 'mid',        label: 'מחיר בינוני',  sub: 'ערך טוב לכסף' },
  { value: 'premium',    label: 'פרימיום',       sub: 'איכות גבוהה, מחיר בהתאם' },
  { value: 'enterprise', label: 'ארגוני',        sub: 'עסקים ופרויקטים גדולים' },
];

const SOURCE_OPTIONS = [
  { value: 'google',        label: 'חיפוש Google' },
  { value: 'instagram',     label: 'אינסטגרם' },
  { value: 'facebook',      label: 'פייסבוק' },
  { value: 'word_of_mouth', label: 'המלצות' },
  { value: 'waze',          label: 'ווייז / מפות' },
  { value: 'tiktok',        label: 'טיקטוק' },
  { value: 'linkedin',      label: 'לינקדאין' },
  { value: 'walk_in',       label: 'עוברי אורח' },
  { value: 'referral',      label: 'הפניות מקצועיות' },
  { value: 'website',       label: 'אתר עצמאי' },
];

const GOAL_OPTIONS = [
  { value: 'new_customers',     label: 'להביא לקוחות חדשים' },
  { value: 'retain',            label: 'לשמר לקוחות קיימים' },
  { value: 'more_per_customer', label: 'להרוויח יותר מכל לקוח' },
  { value: 'reviews',           label: 'לשפר דירוגים וביקורות' },
];

const SOCIAL_CHANNELS = [
  { key: 'website_url',   label: 'אתר',             icon: '🌐', placeholder: 'https://example.co.il' },
  { key: 'instagram_url', label: 'אינסטגרם',         icon: '📸', placeholder: 'https://instagram.com/...' },
  { key: 'facebook_url',  label: 'פייסבוק',          icon: '👥', placeholder: 'https://facebook.com/...' },
  { key: 'tiktok_url',    label: 'טיקטוק',           icon: '🎵', placeholder: 'https://tiktok.com/@...' },
  { key: 'google_url',    label: 'Google Business',  icon: '📍', placeholder: 'https://g.page/...' },
];

const SECTIONS = [
  { id: 'business', label: 'על העסק',          steps: [1, 2] },
  { id: 'service',  label: 'על השירות/מוצר',   steps: [4, 5, 6] },
  { id: 'audience', label: 'על קהל היעד',       steps: [7, 8, 9] },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  if (h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

const BG_STYLE = {
  backgroundColor: '#f5f5f7',
  backgroundImage: 'radial-gradient(circle, #d1d1d1 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

// ── Progress Tracker ────────────────────────────────────────────────────────────
function ProgressTracker({ step }) {
  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">התקדמות</div>
      {SECTIONS.map((section, idx) => {
        const minStep = section.steps[0];
        const maxStep = section.steps[section.steps.length - 1];
        const completed = step > maxStep;
        const active = step >= minStep && step <= maxStep;
        return (
          <div key={section.id} className="flex items-start gap-3">
            {/* Line + dot */}
            <div className="flex flex-col items-center">
              <div
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors duration-300 ${
                  completed || active ? 'bg-[#e8344d]' : 'bg-gray-300'
                }`}
              />
              {idx < SECTIONS.length - 1 && (
                <div className={`w-0.5 h-10 mt-1 transition-colors duration-300 ${completed ? 'bg-[#e8344d]' : 'bg-gray-200'}`} />
              )}
            </div>
            {/* Label */}
            <div className={`text-[13px] mt-[-2px] transition-colors duration-300 ${active ? 'font-bold text-gray-900' : completed ? 'font-medium text-gray-500' : 'text-gray-400'}`}>
              {section.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── City autocomplete ────────────────────────────────────────────────────────────
function CityInput({ value, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const filtered = CITIES.filter(c => c.includes(value) && c !== value).slice(0, 8);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-4 py-2.5 focus-within:border-[#e8344d] transition-colors">
        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // don't let this bubble to the outer form's native submit
            if (value.trim()) { setOpen(false); onSelect(value.trim()); }
          }}
          placeholder="הקלד עיר או יישוב"
          className="flex-1 bg-transparent text-[13px] outline-none text-gray-700"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden z-10 max-h-48 overflow-y-auto">
          {filtered.map(city => (
            <button
              key={city}
              type="button"
              onMouseDown={() => { onSelect(city); setOpen(false); }}
              className="w-full text-right px-4 py-2.5 text-[13px] text-gray-700 hover:bg-[#fce4ec] hover:text-[#e8344d] transition-colors"
            >
              {city}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────────
export default function OnboardingForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [tempServices, setTempServices] = useState([]);
  const [tempSources, setTempSources] = useState([]);
  const [otherService, setOtherService] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingStep, setEditingStep] = useState(null); // step number of the answer bubble being edited, or null
  const [editDraft, setEditDraft] = useState(null);
  const [formData, setFormData] = useState({
    name: '', city: '', category: '',
    relevant_services: [], description: '', price_tier: '',
    customer_sources: [], business_goal: '',
    website_url: '', instagram_url: '', facebook_url: '', tiktok_url: '',
    seed_info: '',
  });
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const getQuestion = (s) => {
    switch (s) {
      case 1: return 'בואו נתחיל! מה שם העסק שלך?';
      case 2: return `מעולה! באיזה עיר נמצא "${formData.name}"?`;
      case 4: return 'מה בדיוק אתה מציע? (בחר הכל שרלוונטי)';
      case 5: return 'ספר לנו קצת על העסק שלך בחופשיות... (אופציונלי)';
      case 6: return 'איפה העסק שלך ממוקם מבחינת מחיר?';
      case 7: return 'מאיפה רוב הלקוחות שלך מגיעים?';
      case 8: return 'מה הכי חשוב לך לשפר ב-30 הימים הקרובים?';
      case 9: return 'ספק קישורים לנוכחות הדיגיטלית שלך — נשתמש בהם לבניית הזהות העסקית';
      default: return '';
    }
  };

  // Add AI question when step advances (skip step 3 — category removed)
  useEffect(() => {
    if (step === 3) { setStep(4); return; }
    if (step >= 1 && step <= 9) {
      const q = getQuestion(step);
      if (q) setMessages(prev => [...prev, { type: 'ai', text: q }]);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [step]);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const advance = (field, value, displayLabel) => {
    if (field) setFormData(prev => ({ ...prev, [field]: value }));
    if (displayLabel) setMessages(prev => [...prev, { type: 'user', text: displayLabel, step }]);
    setTextInput('');
    setCitySearch('');
    setTempServices([]);
    setTempSources([]);
    setStep(prev => prev + 1);
  };

  const skipStep = () => {
    setTextInput('');
    setTempServices([]);
    setTempSources([]);
    setStep(prev => prev + 1);
  };

  const toggleService = (val) => {
    setTempServices(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  const toggleSource = (val) => {
    setTempSources(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  // ── Editing a previously-submitted answer bubble ──────────────────────────
  const EDIT_FIELD_BY_STEP = {
    1: 'name', 2: 'city', 4: 'relevant_services', 5: 'description',
    6: 'price_tier', 7: 'customer_sources', 8: 'business_goal',
  };

  const startEdit = (targetStep) => {
    if (editingStep !== null || isSubmitting || targetStep == null) return;
    setEditingStep(targetStep);
    switch (targetStep) {
      case 1: setEditDraft(formData.name); break;
      case 2: setEditDraft(formData.city); break;
      case 4: setEditDraft({ services: formData.relevant_services || [], other: '' }); break;
      case 5: setEditDraft(formData.description || ''); break;
      case 6: setEditDraft(formData.price_tier); break;
      case 7: setEditDraft(formData.customer_sources || []); break;
      case 8: setEditDraft(formData.business_goal); break;
      default: setEditDraft(null);
    }
  };

  const cancelEdit = () => { setEditingStep(null); setEditDraft(null); };

  const commitEdit = (value, displayLabel) => {
    const field = EDIT_FIELD_BY_STEP[editingStep];
    setFormData(prev => ({ ...prev, [field]: value }));
    setMessages(prev => prev.map(m => (m.type === 'user' && m.step === editingStep) ? { ...m, text: displayLabel } : m));
    setEditingStep(null);
    setEditDraft(null);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const tempCat = formData.category || formData.description.split('\n')[0].slice(0, 60).trim();
    try {
      const profile = await base44.entities.BusinessProfile.create({
        name:                formData.name,
        category:            tempCat,
        city:                formData.city,
        description:         formData.description,
        business_goal:       formData.business_goal,
        price_tier:          formData.price_tier,
        customer_sources:    JSON.stringify(formData.customer_sources),
        relevant_services:   JSON.stringify(formData.relevant_services),
        website_url:         formData.website_url  || undefined,
        instagram_url:       formData.instagram_url || undefined,
        facebook_url:        formData.facebook_url  || undefined,
        tiktok_url:          formData.tiktok_url    || undefined,
        onboarding_completed: false,
        created_at:          new Date().toISOString(),
      });
      navigate('/onboarding/select-plan', {
        state: {
          businessProfile: profile,
          onboardingData: {
            goal:             formData.business_goal,
            price_tier:       formData.price_tier,
            customer_sources: formData.customer_sources,
            seed_info:        formData.seed_info || undefined,
          },
        },
      });
    } catch (err) {
      console.error('Failed to create business profile:', err);
      toast.error('שגיאה בשמירת הפרטים. נסה שוב.');
      setIsSubmitting(false);
    }
  };

  // ── Render current step input ────────────────────────────────────────────────
  const renderInput = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-3">
            <input
              ref={inputRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder="שם העסק שלך"
              className="w-full bg-white border border-gray-200 rounded-full px-5 py-3 text-[14px] text-gray-700 outline-none focus:border-[#e8344d] transition-colors max-w-sm"
            />
          </div>
        );

      case 2:
        return (
          <div className="max-w-sm">
            <CityInput
              value={citySearch}
              onChange={setCitySearch}
              onSelect={city => { setCitySearch(city); advance('city', city, city); }}
            />
          </div>
        );

      case 4:
        return (
          <div className="space-y-3 max-w-md">
            <PillSelector
              options={SERVICES}
              selected={tempServices}
              onSelect={toggleService}
              multi
            />
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={otherService}
                onChange={e => setOtherService(e.target.value)}
                placeholder='אחר — הקלד שירות וגש Enter'
                className="w-full bg-white border border-gray-200 rounded-full pr-10 pl-4 py-2 text-[13px] outline-none focus:border-[#e8344d] transition-colors"
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = e.target.value.trim();
                  if (v) {
                    if (!tempServices.includes(v)) setTempServices(prev => [...prev, v]);
                    setOtherService('');
                  } else if (tempServices.length > 0) {
                    // nothing typed but at least one service already picked — Enter advances
                    handlePrimaryAction();
                  }
                }}
              />
            </div>
          </div>
        );

      case 5:
        return (
          <div className="max-w-sm">
            <textarea
              ref={inputRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              placeholder={'מה אתה עושה, למי, ומה מייחד אותך...\n\nלמשל: "בית קפה קטן בתל אביב, מתמחה בקפה מיוחד ועוגות ביתיות."'}
              rows={4}
              className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-700 outline-none focus:border-[#e8344d] transition-colors resize-none"
            />
          </div>
        );

      case 6:
        return (
          <div className="grid grid-cols-2 gap-2 max-w-sm">
            {PRICE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => advance('price_tier', opt.value, opt.label)}
                className={`text-right p-3.5 rounded-2xl border transition-all ${
                  formData.price_tier === opt.value
                    ? 'border-[#e8344d] bg-[#fce4ec]'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="font-semibold text-[13px] text-gray-800">{opt.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{opt.sub}</div>
              </button>
            ))}
          </div>
        );

      case 7:
        return (
          <div
            className="space-y-3 max-w-md"
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault(); // also blocks the native Enter-toggles-focused-pill behavior
              if (tempSources.length > 0) handlePrimaryAction();
            }}
          >
            <PillSelector
              options={SOURCE_OPTIONS}
              selected={tempSources}
              onSelect={toggleSource}
              multi
            />
          </div>
        );

      case 8:
        return (
          <div className="max-w-md">
            <PillSelector
              options={GOAL_OPTIONS}
              selected={formData.business_goal}
              onSelect={val => {
                const opt = GOAL_OPTIONS.find(g => g.value === val);
                advance('business_goal', val, opt?.label || val);
              }}
            />
          </div>
        );

      case 9: {
        const hasIdentityInput = !!(formData.website_url || formData.instagram_url || formData.facebook_url || formData.tiktok_url || formData.seed_info?.trim());
        return (
          <div className="space-y-2.5 max-w-sm">
            {SOCIAL_CHANNELS.map(ch => (
              <div key={ch.key} className="flex items-center gap-3 bg-white border border-gray-200 rounded-full px-4 py-2.5 focus-within:border-[#e8344d] transition-colors">
                <span className="text-lg flex-shrink-0">{ch.icon}</span>
                <input
                  value={formData[ch.key]}
                  onChange={e => setFormData(prev => ({ ...prev, [ch.key]: e.target.value }))}
                  placeholder={ch.placeholder}
                  className="flex-1 bg-transparent text-[12px] text-gray-700 outline-none"
                  dir="ltr"
                />
              </div>
            ))}
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 focus-within:border-[#e8344d] transition-colors">
              <textarea
                value={formData.seed_info}
                onChange={e => setFormData(prev => ({ ...prev, seed_info: e.target.value }))}
                placeholder="או ספר לנו בקצרה — מה אתה מציע, למי, ואיפה (גם זה מספיק)"
                rows={3}
                className="w-full bg-transparent text-[12px] text-gray-700 outline-none resize-none"
              />
            </div>
            {!hasIdentityInput && (
              <p className="text-[11px] text-[#e8344d] text-right">יש להזין לפחות קישור אחד או כמה מילים על העסק כדי להמשיך</p>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  // ── Inline editor for a past answer bubble (Save/Cancel, no form-submit) ─────
  const renderEditInput = () => {
    const cancelBtn = (
      <button type="button" onClick={cancelEdit} className="text-gray-400 text-[12px] hover:text-gray-600 transition-colors">
        ביטול
      </button>
    );

    switch (editingStep) {
      case 1:
        return (
          <div className="flex items-center gap-2 max-w-sm">
            <input
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (editDraft.trim()) commitEdit(editDraft.trim(), editDraft.trim());
              }}
              className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2 text-[13px] outline-none focus:border-[#e8344d] transition-colors"
            />
            <button
              type="button"
              disabled={!editDraft.trim()}
              onClick={() => commitEdit(editDraft.trim(), editDraft.trim())}
              className="text-[#e8344d] text-[12px] font-semibold disabled:opacity-40"
            >
              שמור
            </button>
            {cancelBtn}
          </div>
        );

      case 2:
        return (
          <div className="flex items-center gap-2 max-w-sm">
            <div className="flex-1">
              <CityInput value={editDraft} onChange={setEditDraft} onSelect={city => commitEdit(city, city)} />
            </div>
            {cancelBtn}
          </div>
        );

      case 4: {
        const allServices = editDraft.other.trim() ? [...editDraft.services, editDraft.other.trim()] : editDraft.services;
        const save = () => {
          const knownLabels = SERVICES.filter(s => allServices.includes(s.value)).map(s => s.label);
          const customLabels = allServices.filter(v => !SERVICES.find(s => s.value === v));
          commitEdit(allServices, [...knownLabels, ...customLabels].join(', '));
        };
        return (
          <div className="space-y-3 max-w-md">
            <PillSelector
              options={SERVICES}
              selected={editDraft.services}
              multi
              onSelect={val => setEditDraft(d => ({
                ...d,
                services: d.services.includes(val) ? d.services.filter(v => v !== val) : [...d.services, val],
              }))}
            />
            <input
              value={editDraft.other}
              onChange={e => setEditDraft(d => ({ ...d, other: e.target.value }))}
              placeholder='אחר — הקלד שירות וגש Enter'
              className="w-full bg-white border border-gray-200 rounded-full px-4 py-2 text-[13px] outline-none focus:border-[#e8344d] transition-colors"
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = e.target.value.trim();
                if (v && !editDraft.services.includes(v)) setEditDraft(d => ({ services: [...d.services, v], other: '' }));
                else setEditDraft(d => ({ ...d, other: '' }));
              }}
            />
            <div className="flex items-center gap-3">
              <button type="button" disabled={allServices.length === 0} onClick={save} className="text-[#e8344d] text-[12px] font-semibold disabled:opacity-40">
                שמור
              </button>
              {cancelBtn}
            </div>
          </div>
        );
      }

      case 5:
        return (
          <div className="space-y-2 max-w-sm">
            <textarea
              autoFocus
              value={editDraft}
              onChange={e => setEditDraft(e.target.value)}
              rows={3}
              className="w-full bg-white border border-gray-200 rounded-2xl px-4 py-3 text-[13px] text-gray-700 outline-none focus:border-[#e8344d] transition-colors resize-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const txt = editDraft.trim();
                  commitEdit(txt, txt ? txt.slice(0, 30) + (txt.length > 30 ? '...' : '') : '(ריק)');
                }}
                className="text-[#e8344d] text-[12px] font-semibold"
              >
                שמור
              </button>
              {cancelBtn}
            </div>
          </div>
        );

      case 6:
        return (
          <div className="space-y-2 max-w-sm">
            <div className="grid grid-cols-2 gap-2">
              {PRICE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => commitEdit(opt.value, opt.label)}
                  className={`text-right p-3.5 rounded-2xl border transition-all ${
                    editDraft === opt.value ? 'border-[#e8344d] bg-[#fce4ec]' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-[13px] text-gray-800">{opt.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
            {cancelBtn}
          </div>
        );

      case 7: {
        const save = () => {
          const labels = SOURCE_OPTIONS.filter(s => editDraft.includes(s.value)).map(s => s.label);
          commitEdit(editDraft, labels.join(', '));
        };
        return (
          <div className="space-y-3 max-w-md">
            <PillSelector
              options={SOURCE_OPTIONS}
              selected={editDraft}
              multi
              onSelect={val => setEditDraft(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val])}
            />
            <div className="flex items-center gap-3">
              <button type="button" disabled={editDraft.length === 0} onClick={save} className="text-[#e8344d] text-[12px] font-semibold disabled:opacity-40">
                שמור
              </button>
              {cancelBtn}
            </div>
          </div>
        );
      }

      case 8:
        return (
          <div className="space-y-2 max-w-md">
            <PillSelector
              options={GOAL_OPTIONS}
              selected={editDraft}
              onSelect={val => {
                const opt = GOAL_OPTIONS.find(g => g.value === val);
                commitEdit(val, opt?.label || val);
              }}
            />
            {cancelBtn}
          </div>
        );

      default:
        return null;
    }
  };

  // Should the "בואו נתקדם" button be shown and enabled?
  const canAdvance = () => {
    if (step === 1) return textInput.trim().length > 0;
    if (step === 2) return citySearch.trim().length > 0;
    if (step === 4) return tempServices.length > 0 || otherService.trim().length > 0;
    if (step === 5) return true; // optional — description is no longer required
    if (step === 7) return tempSources.length > 0;
    if (step === 9) return !!(formData.website_url || formData.instagram_url || formData.facebook_url || formData.tiktok_url || formData.seed_info?.trim());
    return false; // auto-advance steps (3, 6, 8)
  };

  const isAutoAdvanceStep = [6, 8].includes(step);

  // Enter key in any single-line input submits the form (native behavior);
  // textareas keep Enter as newline since browsers don't submit forms from them.
  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!canAdvance() || isSubmitting) return;
    handlePrimaryAction();
  };

  const handlePrimaryAction = () => {
    if (step === 9) {
      handleSubmit();
    } else if (step === 1) {
      if (textInput.trim()) advance('name', textInput.trim(), textInput.trim());
    } else if (step === 2) {
      if (citySearch.trim()) advance('city', citySearch.trim(), citySearch.trim());
    } else if (step === 4) {
      const allServices = otherService.trim()
        ? [...tempServices, otherService.trim()]
        : tempServices;
      const knownLabels = SERVICES.filter(s => allServices.includes(s.value)).map(s => s.label);
      const customLabels = allServices.filter(v => !SERVICES.find(s => s.value === v));
      const labels = [...knownLabels, ...customLabels];
      advance('relevant_services', allServices, labels.join(', '));
    } else if (step === 5) {
      const txt = textInput.trim();
      advance('description', txt, txt ? txt.slice(0, 30) + (txt.length > 30 ? '...' : '') : null);
    } else if (step === 7) {
      const labels = SOURCE_OPTIONS.filter(s => tempSources.includes(s.value)).map(s => s.label);
      advance('customer_sources', tempSources, labels.join(', '));
    }
  };

  // ── WELCOME SCREEN (step 0) ─────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6" style={BG_STYLE}>
        <div className="text-center space-y-7 max-w-sm w-full">
          <KoriAvatar size="lg" className="mx-auto shadow-lg" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-snug">
              {getGreeting()},<br />
              בואו נכיר את העסק שלך
            </h1>
            <p className="text-sm text-gray-500 mt-2">קורי כאן לעזור לך לצמוח</p>
          </div>

          {/* Terms & Privacy consent — required for registration */}
          <label className="flex items-start gap-3 text-right cursor-pointer bg-white/70 border border-gray-200 rounded-2xl px-4 py-3">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={e => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 flex-shrink-0 w-4 h-4 accent-[#e8344d] cursor-pointer"
            />
            <span className="text-[12px] text-gray-600 leading-relaxed">
              קראתי ואני מסכים/ה ל
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[#e8344d] hover:underline font-medium"
              >
                תנאי השימוש
              </a>
              {' '}ול
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[#e8344d] hover:underline font-medium"
              >
                מדיניות הפרטיות
              </a>
              {' '}של CORTEXI, כולל אגירת נתונים ואימון מודלים כמתואר בהן
            </span>
          </label>

          <div className="flex justify-center gap-3">
            <button
              onClick={() => agreedToTerms && setStep(1)}
              disabled={!agreedToTerms}
              title={!agreedToTerms ? 'יש לאשר את תנאי השימוש ומדיניות הפרטיות' : ''}
              className="bg-[#e8344d] text-white rounded-full px-8 py-3 font-semibold text-[14px] hover:bg-[#c92b40] transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              בואו נתחיל
            </button>
          </div>

          {!agreedToTerms && (
            <p className="text-[11px] text-gray-400">
              יש לאשר את תנאי השימוש ומדיניות הפרטיות לפני ההרשמה
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── CONVERSATIONAL LAYOUT (steps 1–9) ──────────────────────────────────────
  return (
    <div dir="rtl" className="min-h-screen flex" style={BG_STYLE}>
      {/* Right: Conversation area (flex-1) */}
      <form className="flex-1 flex flex-col h-screen" onSubmit={handleFormSubmit}>
        {/* Scrollable conversation history */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 pt-8 pb-4 space-y-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          {messages.map((msg, i) => {
            if (msg.type === 'ai') return <AiBubble key={i}>{msg.text}</AiBubble>;
            if (editingStep === msg.step) {
              return (
                <div key={i} className="pt-1" style={{ paddingRight: '52px' }}>
                  {renderEditInput()}
                </div>
              );
            }
            return (
              <UserBubble
                key={i}
                editable={editingStep === null && !isSubmitting && msg.step != null}
                onClick={() => startEdit(msg.step)}
              >
                {msg.text}
              </UserBubble>
            );
          })}

          {/* Current step input area */}
          {step >= 1 && step <= 9 && (
            <div className="pt-2" style={{ paddingRight: '52px' }}>
              {renderInput()}
            </div>
          )}
        </div>

        {/* Bottom CTAs */}
        {!isAutoAdvanceStep && step >= 1 && step <= 9 && (
          <div className="border-t border-gray-200/60 bg-white/80 backdrop-blur-sm px-6 py-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={skipStep}
              className="border border-gray-300 text-gray-500 rounded-full px-6 py-2.5 text-[13px] font-medium hover:border-gray-400 transition-colors"
            >
              מלאו אחר כך
            </button>
            <button
              type="submit"
              disabled={!canAdvance() || isSubmitting}
              className="bg-[#e8344d] text-white rounded-full px-8 py-2.5 text-[14px] font-semibold hover:bg-[#c92b40] transition-colors disabled:opacity-40 flex items-center gap-2 shadow-sm"
            >
              {isSubmitting ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> שומר...</>
              ) : step === 9 ? 'בואו נתקדם' : 'בואו נתקדם'}
            </button>
          </div>
        )}
      </form>

      {/* Left: Progress tracker */}
      <div className="w-56 border-r border-gray-200/70 bg-white/50 px-5 py-8 flex-shrink-0 hidden md:block">
        <ProgressTracker step={step} />
      </div>
    </div>
  );
}
