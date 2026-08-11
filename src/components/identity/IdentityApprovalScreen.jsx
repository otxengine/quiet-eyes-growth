import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Sparkles, Check, RotateCcw, X } from 'lucide-react';

// Must match ABOUT_KEYS in server/src/routes/onboarding.ts
const REQUIRED_KEYS = ['business_description', 'business_name', 'sector_key', 'sub_sector_key', 'business_type', 'service_model', 'target_audience', 'relevant_topics', 'content_tone'];

const SECTOR_KEYS = ['restaurant', 'beauty', 'fitness', 'legal', 'medical', 'real_estate', 'retail', 'auto', 'cleaning', 'education', 'tech_services', 'accounting', 'construction', 'events', 'design', 'marketing', 'photography', 'childcare', 'health', 'other'];
const BUSINESS_TYPES = ['B2B', 'B2C', 'B2B2C'];
const SERVICE_MODELS = ['project_based', 'subscription', 'appointment', 'walk_in', 'ecommerce'];
const TONES = ['professional', 'friendly', 'inspirational', 'technical', 'casual'];

// ponytail: backend only tracks the coarse 'social' bucket, not per-platform (IG/FB/TikTok) —
// upgrade path is having generate-about tag which platform it actually read from.
const SOURCE_LABELS = {
  profile_description: { label: 'פרופיל קיים', scrape: false },
  website: { label: 'אתר', scrape: false },
  social: { label: 'רשתות חברתיות', scrape: true },
  google_place: { label: 'גוגל', scrape: false },
  seed_info: { label: 'פרטי בעלים', scrape: false },
};

const inputCls = 'w-full bg-secondary/50 border border-border/60 rounded-lg px-3 py-2 text-[12px] text-[#111111] focus:outline-none focus:border-border';

const emptyDraft = () => ({
  business_description: '', business_name: '', sector_key: '', sub_sector_key: '',
  business_type: '', service_model: '', target_audience: '', relevant_topics: [], content_tone: '',
});

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-foreground-secondary block mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function IdentityApprovalScreen({ businessProfileId, onApproved, onCancel = () => {} }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [sources, setSources] = useState([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [approvedAt, setApprovedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    const profile = await base44.entities.BusinessProfile.get(businessProfileId);
    setStatus(profile?.about_status || null);
    setApprovedAt(profile?.about_approved_at || null);
    try { setSources(JSON.parse(profile?.about_sources || '[]')); } catch { setSources([]); }
    // After approval, show what was actually approved (possibly edited), not a newer/older draft.
    const source = profile?.about_status === 'approved' ? profile?.about_approved : profile?.about_draft;
    if (source) {
      try { setDraft({ ...emptyDraft(), ...JSON.parse(source) }); } catch { /* keep empty draft */ }
    }
    setLoading(false);
  };

  useEffect(() => { if (businessProfileId) load(); }, [businessProfileId]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await base44.raw.post('/onboarding/generate-about', { businessProfileId });
      if (res.needs_seed) {
        toast.error(res.prompt || 'צריך עוד מידע כדי לייצר טיוטה');
      } else if (res.ok) {
        setDraft({ ...emptyDraft(), ...res.draft });
        setStatus('pending');
        const p = await base44.entities.BusinessProfile.get(businessProfileId);
        try { setSources(JSON.parse(p?.about_sources || '[]')); } catch { /* keep prior sources */ }
      } else {
        toast.error(res.error || 'יצירת הטיוטה נכשלה');
      }
    } catch (err) {
      toast.error('שגיאה: ' + (err.message || 'נסה שוב'));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const res = await base44.raw.post('/onboarding/approve-about', { businessProfileId, draft });
      if (res.ok) {
        toast.success('הזהות העסקית אושרה ✓');
        setStatus('approved');
        onApproved?.(draft);
      } else {
        toast.error(res.error || 'האישור נכשל');
      }
    } catch (err) {
      toast.error('שגיאה: ' + (err.message || 'נסה שוב'));
    } finally {
      setBusy(false);
    }
  };

  // AC6: Cancel makes no API call — the previously-approved identity (about_approved) is left untouched.
  const cancel = () => onCancel?.();

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  if (loading) {
    return <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin text-foreground-muted mx-auto" /></div>;
  }

  const hasDraft = REQUIRED_KEYS.some((k) => (Array.isArray(draft[k]) ? draft[k].length : draft[k]));

  return (
    <div dir="rtl" className="bg-white rounded-[10px] border border-border/50 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-[#222222]">זהות עסקית — סקירה לאישור</h2>
          <p className="text-[11px] text-foreground-muted mt-0.5">בדוק ועדכן את הפרטים שנוצרו אוטומטית לפני שהם הופכים לרשמיים</p>
        </div>
        {status === 'approved' && approvedAt ? (
          <span className="text-[10px] text-foreground-muted flex-shrink-0 whitespace-nowrap">
            אושר {new Date(approvedAt).toLocaleDateString('he-IL')}
          </span>
        ) : status !== 'approved' && (
          <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 flex-shrink-0 whitespace-nowrap">
            טיוטה — טרם אושר
          </span>
        )}
      </div>

      {!hasDraft ? (
        <div className="text-center py-6">
          <p className="text-[12px] text-foreground-muted mb-3">עדיין לא נוצרה טיוטת זהות עבור העסק</p>
          <button onClick={generate} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-semibold bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            צור טיוטה
          </button>
        </div>
      ) : (
        <>
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => {
                const meta = SOURCE_LABELS[s] || { label: s, scrape: false };
                return (
                  <span key={s} className="text-[10px] bg-secondary/60 border border-border/50 rounded-full px-2.5 py-1 text-foreground-secondary">
                    {meta.label}{meta.scrape ? ' (סריקה)' : ''}
                  </span>
                );
              })}
            </div>
          )}

          <Field label="תיאור העסק">
            <textarea
              value={draft.business_description}
              onChange={(e) => set('business_description', e.target.value)}
              rows={3}
              className={`${inputCls} resize-none text-[13px] py-2.5`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="שם העסק">
              <input value={draft.business_name} onChange={(e) => set('business_name', e.target.value)} className={inputCls} />
            </Field>
            <Field label="קהל יעד">
              <input value={draft.target_audience} onChange={(e) => set('target_audience', e.target.value)} className={inputCls} />
            </Field>
            <Field label="סקטור">
              <select value={draft.sector_key} onChange={(e) => set('sector_key', e.target.value)} className={inputCls}>
                {SECTOR_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="תת-סקטור">
              <input value={draft.sub_sector_key} onChange={(e) => set('sub_sector_key', e.target.value)} className={inputCls} />
            </Field>
            <Field label="סוג עסק">
              <select value={draft.business_type} onChange={(e) => set('business_type', e.target.value)} className={inputCls}>
                {BUSINESS_TYPES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="מודל שירות">
              <select value={draft.service_model} onChange={(e) => set('service_model', e.target.value)} className={inputCls}>
                {SERVICE_MODELS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="טון תוכן">
              <select value={draft.content_tone} onChange={(e) => set('content_tone', e.target.value)} className={inputCls}>
                {TONES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="נושאים רלוונטיים (מופרדים בפסיק)">
              <input
                value={(draft.relevant_topics || []).join(', ')}
                onChange={(e) => set('relevant_topics', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={approve} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-semibold bg-[#10b981] text-white hover:bg-[#059669] transition-colors disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} אשר
            </button>
            <button onClick={generate} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-secondary border border-border text-foreground-secondary hover:text-foreground transition-colors disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> צור מחדש
            </button>
            <button onClick={cancel} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-foreground-muted hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" /> ביטול
            </button>
          </div>
        </>
      )}
    </div>
  );
}
