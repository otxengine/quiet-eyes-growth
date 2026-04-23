import React from 'react';
import { Save } from 'lucide-react';

const budgetOptions = ['ללא מינימום', '500₪', '1,000₪', '3,000₪', '5,000₪'];

export default function SettingsLeadCriteria({ form, setForm, onSave }) {
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">קריטריונים ללידים</h2>
      <p className="text-[12px] text-[#999999]">הגדר מה נחשב ליד איכותי עבורך</p>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">תקציב מינימום</label>
        <div className="flex flex-wrap gap-1.5">
          {budgetOptions.map((b) => (
            <button key={b} onClick={() => setForm({ ...form, min_budget: b })}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${form.min_budget === b ? 'bg-[#111111] text-white' : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]'}`}>{b}</button>
          ))}
        </div>
      </div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">סוגי שירות רלוונטיים</label><input value={form.relevant_services} onChange={(e) => setForm({ ...form, relevant_services: e.target.value })} placeholder="הפרד בפסיקים: טיפול פנים, מניקור..." className={inputCls} /></div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">אזור גיאוגרפי מועדף</label><input value={form.preferred_area} onChange={(e) => setForm({ ...form, preferred_area: e.target.value })} placeholder="לדוגמה: תל אביב והמרכז" className={inputCls} /></div>
      <button onClick={onSave} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors"><Save className="w-3.5 h-3.5" /> שמור קריטריונים</button>
      <p className="text-[11px] text-[#cccccc]">הקריטריונים משפיעים על ניקוד הלידים האוטומטי</p>
    </div>
  );
}