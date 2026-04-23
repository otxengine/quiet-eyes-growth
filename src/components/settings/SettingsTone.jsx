import React from 'react';

const toneOptions = [
  { value: 'friendly', label: 'חברי 😊' },
  { value: 'formal', label: 'רשמי 👔' },
  { value: 'direct', label: 'ישיר 🎯' },
  { value: 'humorous', label: 'הומוריסטי 😄' },
];

const toneExamples = {
  friendly: 'היי דני! תודה שכתבת. חשוב לנו לשמוע, ונשמח לתקן. בוא נדבר? 😊',
  formal: 'שלום דני, תודה על הפנייה. אנו מתנצלים על חוויתך ונשמח לטפל בנושא בהקדם.',
  direct: 'דני, קיבלנו. מתנצלים. נתקן. מוזמן לחזור ולקבל 10% הנחה.',
  humorous: 'דני, אאוץ\'! זה לא אנחנו בדרך כלל 😅 בוא נתקן את זה — קפה עלינו בביקור הבא!',
};

export default function SettingsTone({ form, onToneChange }) {
  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">טון תקשורת</h2>
      <p className="text-[12px] text-[#999999]">איך אתה רוצה שנדבר עם הלקוחות שלך?</p>
      <div className="flex gap-2">
        {toneOptions.map((tone) => (
          <button key={tone.value} onClick={() => onToneChange(tone.value)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              form.tone_preference === tone.value ? 'bg-[#111111] text-white' : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]'
            }`}>
            {tone.label}
          </button>
        ))}
      </div>
      <div className="bg-[#fafafa] rounded-lg border border-[#eeeeee] p-3">
        <p className="text-[10px] text-[#999999] mb-1.5">דוגמה: כך תיראה תגובה בטון {toneOptions.find(t => t.value === form.tone_preference)?.label?.split(' ')[0]}:</p>
        <p className="text-[12px] text-[#444444] leading-relaxed">"{toneExamples[form.tone_preference]}"</p>
      </div>
    </div>
  );
}