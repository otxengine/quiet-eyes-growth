import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const SOURCE_OPTIONS = [
  { value: 'Google',    label: 'Google' },
  { value: 'Facebook',  label: 'Facebook' },
  { value: 'WhatsApp',  label: 'WhatsApp' },
  { value: 'Instagram', label: 'Instagram' },
  { value: 'other',     label: 'אחר' },
  { value: 'referral',  label: 'המלצה' },
];

function calculateScore(form, bp) {
  let score = 0;
  if (form.city && bp?.city) {
    if (form.city === bp.city) score += 20;
    else if (form.city.trim()) score += 10;
  }
  if (['WhatsApp', 'Instagram'].includes(form.source)) score += 15;
  else if (form.source === 'Google') score += 10;
  else if (form.source === 'referral') score += 15;
  else score += 5;
  if (form.phone) score += 20;
  if (form.email) score += 15;
  if (form.name.trim()) score += 15;
  return Math.max(0, Math.min(100, score));
}

const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#e8344d]/40 transition-colors';

export default function AddLeadModal({ businessProfile, onClose, onAdded }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', company: '', role: '', phone: '', email: '', notes: '', source: 'Google',
  });

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const score = calculateScore(form, businessProfile);
      const status = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
      await base44.entities.Lead.create({
        name: form.name,
        company: form.company,
        role: form.role,
        contact_info: [form.phone, form.email].filter(Boolean).join(' | '),
        contact_phone: form.phone,
        source: form.source,
        notes: form.notes,
        score,
        status,
        created_at: new Date().toISOString(),
        linked_business: businessProfile?.id,
      });
      const statusLabel = status === 'hot' ? 'חם 🔥' : status === 'warm' ? 'פושר' : 'קר';
      toast.success(`ליד נשמר — ציון: ${score} (${statusLabel})`);
      onAdded();
    } catch {
      toast.error('שגיאה בשמירת הליד');
    }
    setSaving(false);
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/25 z-40" onClick={onClose} />

      {/* Drawer — slides from right */}
      <div
        className="fixed top-0 right-0 h-full w-[400px] max-w-[92vw] bg-white z-50 flex flex-col shadow-2xl"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">ליד חדש</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">הוסף ליד חדש למערכת.</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4" style={{ scrollbarWidth: 'none' }}>

          {/* פרטי איש קשר */}
          <div>
            <h3 className="text-[12px] font-bold text-gray-700 mb-3">פרטי איש קשר</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">שם מלא</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="הכנס שם מלא"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">חברה</label>
                <input
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                  placeholder="הכנס שם חברה"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">תפקיד</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className={inputCls}
                >
                  <option value="">הכנס תפקיד</option>
                  <option value="מנכ״ל">מנכ״ל</option>
                  <option value="מנהל שיווק">מנהל שיווק</option>
                  <option value="בעל עסק">בעל עסק</option>
                  <option value="מנהל מכירות">מנהל מכירות</option>
                  <option value="אחר">אחר</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">טלפון</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                  placeholder="הכנס טלפון"
                  className={inputCls}
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">אימייל</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="הכנס כתובת אימייל"
                  className={inputCls}
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 block mb-1">אחר</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="הוסף מידע נוסף על הליד..."
                  rows={3}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>
          </div>

          {/* מקור הליד */}
          <div>
            <h3 className="text-[12px] font-bold text-gray-700 mb-3">מקור הליד</h3>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full border text-[12px] cursor-pointer transition-colors ${
                    form.source === opt.value
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    value={opt.value}
                    checked={form.source === opt.value}
                    onChange={() => setForm({ ...form, source: opt.value })}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-gray-100 px-5 py-4 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim() || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            שמור ליד
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
