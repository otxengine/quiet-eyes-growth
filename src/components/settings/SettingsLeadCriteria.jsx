import React from 'react';
import { Save } from 'lucide-react';

const budgetOptions = ['ללא מינימום', '500₪', '1,000₪', '3,000₪', '5,000₪'];

export default function SettingsLeadCriteria({ form, setForm, onSave }) {
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";
  const textareaCls = `${inputCls} resize-none min-h-[72px]`;

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">קריטריונים ללידים</h2>
      <p className="text-[12px] text-[#999999]">הגדר מה נחשב ליד איכותי עבורך — הנתונים מועברים לסוכני ה-AI</p>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">תקציב מינימום</label>
        <div className="flex flex-wrap gap-1.5">
          {budgetOptions.map((b) => (
            <button key={b} onClick={() => setForm({ ...form, min_budget: b })}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${form.min_budget === b ? 'bg-[#111111] text-white' : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]'}`}>{b}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">סוגי שירות רלוונטיים</label>
        <input value={form.relevant_services || ''} onChange={(e) => setForm({ ...form, relevant_services: e.target.value })}
          placeholder="הפרד בפסיקים: טיפול פנים, מניקור..." className={inputCls} />
      </div>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">אזור גיאוגרפי מועדף</label>
        <input value={form.preferred_area || ''} onChange={(e) => setForm({ ...form, preferred_area: e.target.value })}
          placeholder="לדוגמה: תל אביב והמרכז" className={inputCls} />
      </div>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">סימני כוונת קנייה</label>
        <textarea
          value={form.lead_intent_signals || ''}
          onChange={(e) => setForm({ ...form, lead_intent_signals: e.target.value })}
          placeholder={'פרסמי: "מחפשת מטפלת", "מישהי ממליצה?", "כמה עולה?"\nמילות מפתח: דחוף, מחפש, צריך, ממליץ, קיבלתי הצעת מחיר'}
          className={textareaCls}
        />
        <p className="text-[10px] text-[#cccccc] mt-1">ביטויים שמצביעים על כוונת רכישה — הסוכן ישתמש בהם לסינון לידים איכותיים</p>
      </div>
      <div>
        <label className="text-[12px] text-[#999999] mb-1 block">הגדרת ליד איכותי (בשפה חופשית)</label>
        <textarea
          value={form.lead_quality_notes || ''}
          onChange={(e) => setForm({ ...form, lead_quality_notes: e.target.value })}
          placeholder={'לדוגמה: "רק אנשים שמזכירים כאב גב ספציפי, לא תיירי כושר"\nאו: "לקוח שרוצה חבילת חודשי, לא מנוי חד-פעמי"'}
          className={textareaCls}
        />
        <p className="text-[10px] text-[#cccccc] mt-1">הסבר לסוכן ה-AI מה הופך ליד לאיכותי עבורך</p>
      </div>
      <button onClick={onSave} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors">
        <Save className="w-3.5 h-3.5" /> שמור קריטריונים
      </button>
      <p className="text-[11px] text-[#cccccc]">הקריטריונים מועברים לסוכני ה-AI ומשפיעים על ניקוד הלידים האוטומטי</p>
    </div>
  );
}
