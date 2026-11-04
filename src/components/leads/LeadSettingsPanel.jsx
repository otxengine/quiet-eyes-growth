/**
 * LeadSettingsPanel — Slide-in panel for defining ideal lead criteria.
 * Design: dropdown-style fields with chevron indicators + AI recommendation tags.
 */
import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const AI_RECOMMENDATION_TAGS = ['ישראל', 'SaaS', '11-50 עובדים', 'VP Marketing'];

const FIELD_OPTIONS = {
  industry:    ['Cyber Security', 'FinTech', 'HealthTech', 'E-commerce', 'SaaS', 'Real Estate', 'Retail', 'Education', 'Food & Beverage', 'Other'],
  client_type: ['עסקי (B2B)', 'פרטי (B2C)', 'ממשלתי', 'עמותות'],
  company_size:['1-10', '11-50', '51-200', '201-500', '500+'],
  role:        ['CEO', 'CMO', 'VP Marketing', 'VP Sales', 'CTO', 'Owner', 'Manager', 'Director', 'Other'],
  location:    ['ישראל', 'תל אביב', 'ירושלים', 'חיפה', 'ראשון לציון', 'פתח תקווה', 'נתניה', 'בני ברק'],
  technologies:['AI', 'SaaS', 'React', 'Node.js', 'AWS', 'Salesforce', 'HubSpot', 'Shopify', 'WordPress'],
};

// Multi-select dropdown with tags
function MultiSelectField({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = value ? value.split(',').map(t => t.trim()).filter(Boolean) : [];

  const toggle = (opt) => {
    const next = selected.includes(opt)
      ? selected.filter(t => t !== opt)
      : [...selected, opt];
    onChange(next.join(', '));
  };

  const removeTag = (tag) => {
    onChange(selected.filter(t => t !== tag).join(', '));
  };

  return (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 block mb-1 text-right">{label}</label>
      <div className="relative">
        {/* Trigger */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="w-full min-h-[38px] border border-gray-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 focus:border-[#e8344d] transition-colors bg-white hover:bg-gray-50"
          dir="rtl"
        >
          <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          <div className="flex flex-wrap gap-1 flex-1 justify-end min-h-[20px]">
            {selected.length === 0 ? (
              <span className="text-[12px] text-gray-400">בחר...</span>
            ) : selected.map(tag => (
              <span key={tag} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-[11px] px-2 py-0.5 rounded-full">
                {tag}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeTag(tag); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        </button>

        {/* Dropdown */}
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute top-full mt-1 right-0 left-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 max-h-[180px] overflow-y-auto" dir="rtl">
              {options.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { toggle(opt); }}
                  className={`w-full flex items-center justify-between px-4 py-2 text-[12px] hover:bg-gray-50 transition-colors ${selected.includes(opt) ? 'text-[#e8344d] font-semibold' : 'text-gray-700'}`}
                >
                  <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${selected.includes(opt) ? 'bg-[#e8344d] border-[#e8344d]' : 'border-gray-300'}`}>
                    {selected.includes(opt) && <span className="text-white text-[9px]">✓</span>}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function LeadSettingsPanel({ businessProfile, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [criteria, setCriteria] = useState({
    industry:    '',
    client_type: '',
    company_size:'',
    role:        '',
    location:    '',
    technologies:'',
    keywords:    '',
  });

  useEffect(() => {
    try {
      const stored = JSON.parse(businessProfile?.lead_criteria || '{}');
      if (stored) setCriteria(prev => ({ ...prev, ...stored }));
    } catch {}
  }, [businessProfile?.lead_criteria]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.BusinessProfile.update(businessProfile.id, {
        lead_criteria: JSON.stringify(criteria),
      });
      toast.success('קריטריוני ליד נשמרו ✓');
      onSaved?.();
      onClose();
    } catch {
      toast.error('שגיאה בשמירה');
    }
    setSaving(false);
  };

  const applyRecommendation = () => {
    setCriteria({
      industry:    'Cyber Security',
      client_type: 'עסקי (B2B)',
      company_size:'11-50',
      role:        'VP Marketing',
      location:    'ישראל',
      technologies:'AI, SaaS',
      keywords:    '',
    });
  };

  const set = (key, val) => setCriteria(prev => ({ ...prev, [key]: val }));

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel slides in from left */}
      <div
        className="fixed top-0 left-0 h-full w-[400px] max-w-[92vw] bg-white z-50 shadow-2xl flex flex-col"
        dir="rtl"
        style={{ animation: 'slideInLeft 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-[16px] font-bold text-gray-900">הגדרת ליד אידיאלי</h2>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ scrollbarWidth: 'none' }}>

          {/* AI Recommendation card */}
          <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-violet-800 mb-1 text-right">המלצה לעבוד</p>
            <p className="text-[11px] text-violet-600 mb-3 leading-relaxed text-right">
              ניתחנו את העסק שלך ובנינו עבורך קריטריוני חיפוש ממולצים. המערכת תשתמש בקריטריונים האלה כדי לאתר לידים חדשים.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3 justify-end">
              {AI_RECOMMENDATION_TAGS.map(tag => (
                <span key={tag} className="text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
            <button
              onClick={applyRecommendation}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#e8344d] px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
            >
              <Sparkles className="w-3.5 h-3.5" />
              החל המלצה
            </button>
          </div>

          {/* Criteria fields */}
          <div className="space-y-4">
            <h3 className="text-[13px] font-bold text-gray-700 text-right">קריטריונים לחיפוש</h3>

            <MultiSelectField
              label="תעשייה/תחום"
              options={FIELD_OPTIONS.industry}
              value={criteria.industry}
              onChange={v => set('industry', v)}
            />
            <MultiSelectField
              label="סוג לקוח"
              options={FIELD_OPTIONS.client_type}
              value={criteria.client_type}
              onChange={v => set('client_type', v)}
            />
            <MultiSelectField
              label="גודל חברה"
              options={FIELD_OPTIONS.company_size}
              value={criteria.company_size}
              onChange={v => set('company_size', v)}
            />
            <MultiSelectField
              label="תפקיד"
              options={FIELD_OPTIONS.role}
              value={criteria.role}
              onChange={v => set('role', v)}
            />
            <MultiSelectField
              label="מיקום"
              options={FIELD_OPTIONS.location}
              value={criteria.location}
              onChange={v => set('location', v)}
            />
            <MultiSelectField
              label="טכנולוגיות"
              options={FIELD_OPTIONS.technologies}
              value={criteria.technologies}
              onChange={v => set('technologies', v)}
            />

            <div>
              <label className="text-[11px] font-semibold text-gray-500 block mb-1 text-right">מילות מפתח נוספות (אופציונלי)</label>
              <input
                value={criteria.keywords}
                onChange={e => set('keywords', e.target.value)}
                placeholder="הוסף מילות מפתח..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-700 focus:outline-none focus:border-[#e8344d] transition-colors text-right"
                dir="rtl"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            שמור ועדכן
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </>
  );
}
