import React from 'react';
import { Copy, Send } from 'lucide-react';
import { toast } from 'sonner';

const templates = [
  {
    id: 'greeting',
    label: 'ברכה ראשונית',
    icon: '👋',
    getText: (lead, bp) => `שלום ${lead.name}, פונה אליך מ${bp?.name || 'העסק שלנו'}. ראיתי שהתעניינת ב${lead.service_needed || 'השירותים שלנו'} — אשמח לעזור! מתי נוח לך לדבר?`,
  },
  {
    id: 'followup',
    label: 'מעקב',
    icon: '🔄',
    getText: (lead, bp) => `היי ${lead.name}, חוזר/ת אליך מ${bp?.name || 'העסק'}. רציתי לבדוק אם יש לך שאלות בנוגע ל${lead.service_needed || 'מה שדיברנו'}. אני כאן לכל דבר!`,
  },
  {
    id: 'offer',
    label: 'הצעה מיוחדת',
    icon: '🎁',
    getText: (lead, bp) => `${lead.name} שלום! יש לנו הצעה מיוחדת ב${bp?.name || 'העסק'} על ${lead.service_needed || 'השירותים שלנו'}. מעוניין/ת לשמוע פרטים?`,
  },
  {
    id: 'reminder',
    label: 'תזכורת פגישה',
    icon: '📅',
    getText: (lead, bp) => `שלום ${lead.name}, רק תזכורת קטנה — יש לנו פגישה מתוכננת. מחכים לראות אותך ב${bp?.name || 'העסק'}! אם צריך לשנות, אפשר להודיע 😊`,
  },
  {
    id: 'thankyou',
    label: 'תודה',
    icon: '🙏',
    getText: (lead, bp) => `${lead.name}, רצינו להגיד תודה שבחרת ב${bp?.name || 'העסק שלנו'}! מקווים שנהנית. נשמח לביקורת קצרה אם יש לך דקה 🌟`,
  },
];

export default function WhatsAppTemplates({ lead, businessProfile, onSend }) {
  const phone = lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0];
  if (!phone) return null;

  const cleanPhone = phone.replace(/[^0-9+]/g, '');

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('ההודעה הועתקה ✓');
  };

  const handleSend = (template) => {
    const text = template.getText(lead, businessProfile);
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    if (onSend) onSend(template.id, text);
  };

  return (
    <div>
      <h4 className="text-[11px] font-semibold text-foreground mb-2">תבניות הודעות WhatsApp</h4>
      <div className="space-y-1.5">
        {templates.map(t => {
          const text = t.getText(lead, businessProfile);
          return (
            <div key={t.id} className="group flex items-start gap-2 p-2.5 rounded-lg bg-secondary/40 border border-border hover:border-border-hover transition-all">
              <span className="text-[14px] mt-0.5">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-foreground mb-0.5">{t.label}</p>
                <p className="text-[10px] text-foreground-muted leading-relaxed line-clamp-2">{text}</p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <button onClick={() => handleCopy(text)} className="p-1.5 rounded-md hover:bg-secondary transition-colors" title="העתק">
                  <Copy className="w-3 h-3 text-foreground-muted" />
                </button>
                <button onClick={() => handleSend(t)} className="p-1.5 rounded-md hover:bg-success/10 transition-colors" title="שלח בוואטסאפ">
                  <Send className="w-3 h-3 text-success" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}