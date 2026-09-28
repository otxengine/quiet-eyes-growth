import React from 'react';

// Same vocabulary as the identity draft's content_tone (server/src/routes/onboarding.ts TONES),
// which writes tone_preference on approve.
const toneOptions = [
  { value: 'friendly', label: 'חברי 😊' },
  { value: 'professional', label: 'מקצועי 👔' },
  { value: 'casual', label: 'קליל 😎' },
  { value: 'inspirational', label: 'מעורר השראה ✨' },
  { value: 'technical', label: 'טכני 🔧' },
];

const toneExamples = {
  friendly: 'היי דני! תודה שכתבת. חשוב לנו לשמוע, ונשמח לתקן. בוא נדבר? 😊',
  professional: 'שלום דני, תודה על הפנייה. אנו מתנצלים על חוויתך ונשמח לטפל בנושא בהקדם.',
  casual: 'דני, אאוץ\'! זה לא אנחנו בדרך כלל 😅 בוא נתקן את זה — קפה עלינו בביקור הבא!',
  inspirational: 'דני, תודה שאתה עוזר לנו להשתפר. כל הערה כזו מקרבת אותנו לחוויה שמגיעה לך — נשמח לראות אותך שוב.',
  technical: 'דני, תודה על הפירוט. בדקנו את המקרה, זיהינו את מקור התקלה ועדכנו את התהליך כדי שזה לא יחזור.',
};

export default function SettingsTone({ form, onToneChange }) {
  return (
    <div className="bg-white rounded-[10px] border border-border/50 p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">טון תקשורת</h2>
      <p className="text-[12px] text-foreground-muted">איך אתה רוצה שנדבר עם הלקוחות שלך?</p>
      <div className="flex flex-wrap gap-2">
        {toneOptions.map((tone) => (
          <button key={tone.value} onClick={() => onToneChange(tone.value)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              form.tone_preference === tone.value ? 'bg-[#111111] text-white' : 'text-foreground-muted/70 border border-border/60 hover:border-border-hover'
            }`}>
            {tone.label}
          </button>
        ))}
      </div>
      {toneExamples[form.tone_preference] && (
        <div className="bg-secondary/50 rounded-lg border border-border/60 p-3">
          <p className="text-[10px] text-foreground-muted mb-1.5">דוגמה: כך תיראה תגובה בטון {toneOptions.find(t => t.value === form.tone_preference)?.label?.replace(/\s*\S+$/, '')}:</p>
          <p className="text-[12px] text-foreground-secondary leading-relaxed">"{toneExamples[form.tone_preference]}"</p>
        </div>
      )}
    </div>
  );
}