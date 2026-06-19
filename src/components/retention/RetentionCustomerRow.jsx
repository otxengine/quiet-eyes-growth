import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Loader2 } from 'lucide-react';

const templateFocus = {
  'חסרת לנו!': 'Focus on how much we miss them',
  'הצעה מיוחדת': 'Focus on a special exclusive offer',
  'חדש אצלנו': 'Focus on new services/products',
};

export default function RetentionCustomerRow({ customer, businessProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sent, setSent] = useState(false);

  const alertColor = customer.alertColor === 'danger' ? 'text-[#dc2626] bg-[#fef2f2]' : 'text-[#d97706] bg-[#fffbeb]';

  const generateMessage = async (focus) => {
    setGenerating(true);
    const tone = businessProfile?.tone_preference || 'friendly';
    const bName = businessProfile?.name || '';
    const focusInstruction = focus ? `\nAdditional focus: ${templateFocus[focus]}` : '';
    const focusGuide = focus === 'חסרת לנו!' ? 'הדגש שהלקוח חסר לך — אנושי ואמיתי, לא שיווקי'
      : focus === 'הצעה מיוחדת' ? 'הצע הטבה ספציפית לחזרה — מבצע / שירות מיוחד / עדיפות'
      : focus === 'חדש אצלנו' ? 'ספר על חדשות/שיפורים ספציפיים שיעניינו אותם'
      : 'הזמן לחזור עם נימוק אנושי';
    const result = await base44.integrations.Core.InvokeLLM({
      model: 'sonnet',
      maxTokens: 250,
      prompt: `אתה מומחה לשימור לקוחות בעסקים קטנים ישראלים. כתוב הודעת WhatsApp שתגרום ללקוח לחזור.

עסק: ${bName} | תחום: ${businessProfile?.category || ''} | טון: ${tone}
לקוח: ${customer.name} | סיבת הנטישה: ${customer.detail}
מיקוד ההודעה: ${focusGuide}${focusInstruction}

מבנה (3 שורות מקסימום):
- שורה 1: פנייה אישית בשם עם תחושה שחסר לנו
- שורה 2: הסיבה הספציפית לחזור עכשיו (קשורה למיקוד)
- שורה 3: CTA קל ולא מחייב
עברית טבעית, עם אמוג'י בצנעה. ללא "שלום לקוח יקר".`
    });
    setMessageText(result);
    setGenerating(false);
    setExpanded(true);
  };

  const handleSend = () => { setSent(true); setExpanded(false); setTimeout(() => setSent(false), 3000); };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className={`w-8 h-8 rounded-full ${alertColor} flex items-center justify-center flex-shrink-0`}>
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-[#222222] block">{customer.name}</span>
          <span className="text-[12px] text-foreground-muted block truncate">{customer.detail}</span>
        </div>
        {sent ? (
          <span className="text-[11px] font-medium text-[#10b981]">ההודעה נשמרה ✓</span>
        ) : (
          <button onClick={() => generateMessage(null)} disabled={generating}
            className="px-3 py-1.5 text-[12px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors flex items-center gap-1.5 flex-shrink-0">
            {generating && <Loader2 className="w-3 h-3 animate-spin" />} {generating ? 'מכין הודעה...' : 'שלח הודעה'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 mr-11">
          <div className="flex gap-1.5 mb-2">
            {Object.keys(templateFocus).map((label) => (
              <button key={label} onClick={() => generateMessage(label)} disabled={generating}
                className="px-2 py-1 text-[11px] font-medium text-foreground-muted/70 border border-border/60 rounded-md hover:border-border-hover hover:text-foreground-secondary transition-colors">{label}</button>
            ))}
          </div>
          <label className="text-[12px] text-[#222222] font-medium mb-1.5 block">הודעת שימור מוצעת:</label>
          <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={4}
            className="w-full bg-secondary/50 border border-border/60 rounded-lg p-3 text-[13px] text-foreground-secondary resize-none focus:outline-none focus:border-border" />
          <div className="flex gap-2 mt-2">
            <button onClick={handleSend} className="px-4 py-2 text-[12px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors">שלח ✓</button>
            <button onClick={() => setExpanded(false)} className="px-3 py-1.5 text-[12px] font-medium text-foreground-muted/70 border border-border/60 rounded-md hover:border-border-hover transition-colors">בטל</button>
          </div>
        </div>
      )}
    </div>
  );
}