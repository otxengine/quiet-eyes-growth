import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { X, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const sources = ['Google', 'Instagram', 'Facebook', 'WhatsApp', 'אתר', 'המלצה', 'אחר'];
const budgets = ['עד 500₪', '500-1,000₪', '1,000-3,000₪', '3,000-5,000₪', 'מעל 5,000₪'];
const urgencies = ['היום', 'השבוע', 'החודש', 'רק מתעניין'];

function calculateScore(data, bp) {
  let score = 0;
  // City: exact match +20, nearby +10
  if (data.city && bp?.city) {
    if (data.city === bp.city) score += 20;
    else if (data.city.trim()) score += 10;
  }
  // Budget
  if (data.budget === 'מעל 5,000₪') score += 30;
  else if (data.budget === '3,000-5,000₪') score += 30;
  else if (data.budget === '1,000-3,000₪') score += 20;
  // Service — always give points if filled, extra if matches category
  if (data.service && bp?.category && data.service.includes(bp.category)) score += 25;
  else if (data.service) score += 25;
  // Urgency
  if (data.urgency === 'היום') score += 15;
  else if (data.urgency === 'השבוע') score += 10;
  else if (data.urgency === 'החודש') score += 5;
  // Source
  if (['Instagram', 'WhatsApp'].includes(data.source)) score += 15;
  else if (data.source === 'Google') score += 10;
  else if (data.source === 'המלצה') score += 15;
  else score += 5;
  return Math.max(0, Math.min(100, score));
}

export default function AddLeadModal({ businessProfile, onClose, onAdded }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', service: '', source: 'Google', budget: '', urgency: '', city: '' });
  const canProceed = step === 1 ? form.name.trim() : true;
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  const chipCls = (active) => active
    ? 'bg-[#111111] text-white border border-[#111111]'
    : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]';

  const handleSubmit = async () => {
    setSaving(true);
    const score = calculateScore(form, businessProfile);
    const status = score >= 80 ? 'hot' : score >= 40 ? 'warm' : 'cold';
    const answers = [`תקציב: ${form.budget || 'לא צוין'}`, `דחיפות: ${form.urgency || 'לא צוין'}`, `אזור: ${form.city || 'לא צוין'}`].join('\n');
    await base44.entities.Lead.create({
      name: form.name, source: form.source, score, status, budget_range: form.budget,
      service_needed: form.service, contact_info: form.phone, questionnaire_answers: answers,
      city: form.city, urgency: form.urgency, created_at: new Date().toISOString(), linked_business: businessProfile?.id,
    });
    const statusLabel = status === 'hot' ? 'חם 🔥' : status === 'warm' ? 'פושר' : 'קר';
    toast.success(`ליד נשמר — ציון: ${score} (${statusLabel})`);
    setSaving(false);
    onAdded();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white border border-[#f0f0f0] rounded-[10px] p-5 w-full max-w-md mx-4 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-[#111111]">ליד חדש — שלב {step}/2</h3>
          <button onClick={onClose} className="text-[#cccccc] hover:text-[#999999]"><X className="w-4 h-4" /></button>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div><label className="text-[12px] text-[#999999] mb-1 block">שם הלקוח *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="שם..." /></div>
            <div><label className="text-[12px] text-[#999999] mb-1 block">טלפון</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="050-0000000" /></div>
            <div><label className="text-[12px] text-[#999999] mb-1 block">שירות מבוקש</label><input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} className={inputCls} placeholder="סוג השירות..." /></div>
            <div>
              <label className="text-[12px] text-[#999999] mb-1 block">מקור</label>
              <div className="flex flex-wrap gap-1.5">{sources.map((s) => <button key={s} onClick={() => setForm({ ...form, source: s })} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${chipCls(form.source === s)}`}>{s}</button>)}</div>
            </div>
            <button onClick={() => setStep(2)} disabled={!canProceed} className="w-full py-2.5 rounded-md text-[12px] font-medium bg-[#111111] hover:bg-[#333333] text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">המשך <ArrowLeft className="w-4 h-4" /></button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="text-[12px] text-[#999999] mb-1 block">מה התקציב המשוער?</label>
              <div className="flex flex-wrap gap-1.5">{budgets.map((b) => <button key={b} onClick={() => setForm({ ...form, budget: b })} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${chipCls(form.budget === b)}`}>{b}</button>)}</div>
            </div>
            <div>
              <label className="text-[12px] text-[#999999] mb-1 block">מתי צריך את השירות?</label>
              <div className="flex flex-wrap gap-1.5">{urgencies.map((u) => <button key={u} onClick={() => setForm({ ...form, urgency: u })} className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${chipCls(form.urgency === u)}`}>{u}</button>)}</div>
            </div>
            <div><label className="text-[12px] text-[#999999] mb-1 block">באיזה אזור?</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} placeholder="עיר / אזור..." /></div>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-md text-[12px] font-medium text-[#aaaaaa] bg-white border border-[#eeeeee] hover:border-[#cccccc] transition-colors">חזרה</button>
              <button onClick={handleSubmit} disabled={saving} className="flex-1 py-2.5 rounded-md text-[12px] font-medium bg-[#111111] hover:bg-[#333333] text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} {saving ? 'מחשב ניקוד...' : 'שמור ליד'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}