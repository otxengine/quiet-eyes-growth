import React from 'react';
import { Save, Loader2 } from 'lucide-react';

export default function SettingsBusinessDetails({ form, setForm, onSave, saving }) {
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">פרטי עסק</h2>
      <div><label className="text-[12px] text-[#999999] mb-1 block">שם העסק</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">קטגוריה</label><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} /></div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">עיר</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} /></div>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">כתובת מלאה</label>
        <input value={form.full_address || ''} onChange={(e) => setForm({ ...form, full_address: e.target.value })} placeholder="רחוב, מספר, עיר" className={inputCls} />
        <p className="text-[9px] text-[#cccccc] mt-0.5">משמש לזיהוי מתחרים ולידים באזור שלך</p>
      </div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">תיאור העסק</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="ספר בקצרה על העסק שלך..." className={`${inputCls} resize-none`} /></div>
      <div><label className="text-[12px] text-[#999999] mb-1 block">קהל יעד</label><input value={form.target_market} onChange={(e) => setForm({ ...form, target_market: e.target.value })} placeholder="לדוגמה: משפחות צעירות באזור המרכז" className={inputCls} /></div>
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {saving ? 'שומר...' : 'שמור שינויים'}
      </button>
    </div>
  );
}