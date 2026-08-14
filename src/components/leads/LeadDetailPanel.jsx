/**
 * LeadDetailPanel — Right-side drawer showing full lead details.
 * Design: clean sections (פרטי איש קשר / פרטי חברה / מקור / הערות) + footer CTA.
 */
import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, Phone, Mail, Briefcase, Globe, Building2, Users, MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const PLATFORM_ICONS = {
  google:    'https://www.google.com/favicon.ico',
  facebook:  'https://www.facebook.com/favicon.ico',
  instagram: 'https://www.instagram.com/favicon.ico',
  linkedin:  'https://www.linkedin.com/favicon.ico',
};

function FieldRow({ icon: Icon, label, value, href }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0" dir="rtl">
      <div className="flex items-center gap-2 text-[12px] text-gray-500 min-w-0 flex-1">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate">{value}</a>
        ) : (
          <span className="text-gray-800 truncate">{value}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[11px] text-gray-400 font-medium">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-300" />}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden" dir="rtl">
      <div className="px-4 py-3 border-b border-gray-50">
        <h3 className="text-[13px] font-bold text-gray-800">{title}</h3>
      </div>
      <div className="px-4 py-1">
        {children}
      </div>
    </div>
  );
}

export default function LeadDetailPanel({ lead, businessProfile, stages, onClose, onStageChange }) {
  const queryClient = useQueryClient();
  const [notes, setNotes]   = useState(lead.notes || '');
  const [saving, setSaving] = useState(false);

  // Extract phone/email from contact_info string
  const phoneMatch = (lead.contact_info || '').match(/[\d\-+()]{7,}/);
  const phone      = phoneMatch ? phoneMatch[0] : null;
  const emailMatch = (lead.contact_info || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  const email      = emailMatch ? emailMatch[0] : null;

  const sourcePlatform = (lead.source || '').toLowerCase().replace(/[^a-z]/g, '');
  const platformIconUrl = PLATFORM_ICONS[sourcePlatform] || null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Lead.update(lead.id, { notes });
      queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
      toast.success('הליד עודכן ✓');
      onClose();
    } catch {
      toast.error('שגיאה בשמירה');
    }
    setSaving(false);
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/25 z-40" onClick={onClose} />

      {/* Panel — slides from left (RTL start side) */}
      <div
        className="fixed top-0 left-0 h-full w-[400px] max-w-[92vw] bg-[#f5f5f7] z-50 flex flex-col shadow-2xl"
        style={{ animation: 'slideInLeft 0.25s ease-out' }}
        dir="rtl"
      >
        {/* Header */}
        <div className="bg-white px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-bold text-gray-900">הצגת ליד</h2>
              {lead.status === 'hot' && (
                <span className="text-[10px] font-bold text-white bg-[#e8344d] px-2 py-0.5 rounded-full">חם</span>
              )}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 text-right">
            כל המידע שאנחנו יודעים על הליד במקום אחד. ניתן לעבור לכלי נוסף לעיבוד הליד.
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: 'none' }}>

          {/* פרטי איש קשר */}
          <Section title="פרטי איש קשר">
            <FieldRow icon={Briefcase} label="תפקיד"  value={lead.role || lead.job_title} />
            <FieldRow icon={null}      label="שם"      value={lead.name} />
            <FieldRow icon={Phone}     label="טלפון"   value={phone} href={phone ? `tel:${phone}` : null} />
            <FieldRow icon={Mail}      label="אימייל"  value={email} href={email ? `mailto:${email}` : null} />
            {!phone && !email && lead.contact_info && (
              <FieldRow icon={null} label="יצירת קשר" value={lead.contact_info} />
            )}
            {lead.city && <FieldRow icon={MapPin} label="מיקום" value={lead.city} />}
          </Section>

          {/* פרטי חברה */}
          <Section title="פרטי חברה">
            <FieldRow icon={Building2} label="שם החברה"    value={lead.company} />
            <FieldRow icon={Globe}     label="אתר"          value={lead.website} href={lead.website} />
            <FieldRow icon={Briefcase} label="תחום"         value={lead.industry || lead.sector} />
            <FieldRow icon={Users}     label="גודל החברה"   value={lead.company_size} />
            {lead.budget_range && (
              <FieldRow icon={null} label="תקציב" value={lead.budget_range} />
            )}
          </Section>

          {/* מקור הליד */}
          {lead.source && (
            <Section title="מקור הליד">
              <div className="flex items-center justify-end gap-2 py-2">
                <span className="text-[12px] text-gray-700 font-medium">{lead.source}</span>
                {platformIconUrl && (
                  <img src={platformIconUrl} alt={lead.source} className="w-4 h-4 rounded" />
                )}
              </div>
            </Section>
          )}

          {/* הערות */}
          <Section title="הערות">
            <div className="py-2">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                placeholder="הוסף הערות לגבי הליד..."
                className="w-full text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#e8344d] transition-colors"
                dir="rtl"
              />
            </div>
          </Section>

          {/* Stage selector (if stages provided) */}
          {stages?.length > 0 && (
            <Section title="שלב בפאנל">
              <div className="py-2">
                <select
                  defaultValue={lead.lifecycle_stage || ''}
                  onChange={e => { if (e.target.value) onStageChange?.(e.target.value); }}
                  className="w-full text-[12px] px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:border-[#e8344d] transition-colors"
                  dir="rtl"
                >
                  <option value="">בחר שלב...</option>
                  {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white border-t border-gray-100 px-5 py-4 flex gap-3 flex-shrink-0">
          {email ? (
            <a
              href={`mailto:${email}`}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
            >
              שלח מייל
            </a>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#e8344d] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              שמור הערות
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            סגור
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
