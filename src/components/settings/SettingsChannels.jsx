import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle, MessageSquare, ExternalLink, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

const channels = [
  {
    key: 'whatsapp',
    label: 'וואטסאפ',
    icon: '💬',
    activeBg: 'bg-[#dcfce7]',
    activeBorder: 'border-[#bbf7d0]',
    placeholder: '05X-XXXXXXX',
    helpText: 'הכנס את מספר הוואטסאפ העסקי שלך',
    inputType: 'tel',
  },
  {
    key: 'instagram',
    label: 'אינסטגרם',
    icon: '📸',
    activeBg: 'bg-[#fce7f3]',
    activeBorder: 'border-[#fbcfe8]',
    placeholder: 'שם המשתמש שלך',
    helpText: 'הכנס את שם המשתמש של חשבון האינסטגרם העסקי',
    inputType: 'text',
  },
  {
    key: 'facebook',
    label: 'פייסבוק',
    icon: '👤',
    activeBg: 'bg-[#dbeafe]',
    activeBorder: 'border-[#bfdbfe]',
    placeholder: 'שם העמוד העסקי',
    helpText: 'הכנס את שם עמוד הפייסבוק של העסק',
    inputType: 'text',
  },
  {
    key: 'tiktok',
    label: 'טיקטוק',
    icon: '🎵',
    activeBg: 'bg-[#f3e8ff]',
    activeBorder: 'border-[#e9d5ff]',
    placeholder: 'שם המשתמש שלך',
    helpText: 'הכנס את שם המשתמש בטיקטוק',
    inputType: 'text',
  },
  {
    key: 'website',
    label: 'האתר שלי',
    icon: '🌐',
    activeBg: 'bg-[#f0fdf4]',
    activeBorder: 'border-[#dcfce7]',
    placeholder: 'www.example.co.il',
    helpText: 'הכנס את כתובת האתר שלך',
    inputType: 'url',
  },
];

export default function SettingsChannels({ form, setForm, onSave, saving }) {
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2.5 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  const enabledCount = channels.filter(ch => form[`channels_${ch.key}_enabled`]).length;

  const whatsappBotUrl = base44.agents?.getWhatsAppConnectURL
    ? base44.agents.getWhatsAppConnectURL('whatsapp_lead_bot')
    : null;

  const copyWhatsAppLink = () => {
    if (whatsappBotUrl) {
      navigator.clipboard.writeText(whatsappBotUrl);
      setCopiedWhatsApp(true);
      toast.success('לינק הבוט הועתק!');
      setTimeout(() => setCopiedWhatsApp(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#f0f4ff] flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-[#3b82f6]" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-[#222222]">ערוצי תקשורת</h2>
            <p className="text-[11px] text-[#999999]">חבר את הערוצים שלך — הבוט יענה ללקוחות ויזין לידים אוטומטית</p>
          </div>
        </div>
        {enabledCount > 0 && (
          <span className="text-[10px] text-[#10b981] bg-[#f0fdf8] px-2 py-1 rounded-full font-medium">
            {enabledCount} ערוצים פעילים ✓
          </span>
        )}
      </div>

      {/* Channel Cards */}
      <div className="space-y-2.5">
        {channels.map((ch) => {
          const enabledKey = `channels_${ch.key}_enabled`;
          const valueKey = `channels_${ch.key}`;
          const isEnabled = !!form[enabledKey];
          const hasValue = !!form[valueKey];

          return (
            <div key={ch.key}
              className={`rounded-xl border-2 transition-all duration-200 ${
                isEnabled 
                  ? `${ch.activeBg} ${ch.activeBorder}` 
                  : 'border-[#f0f0f0] bg-white hover:border-[#e0e0e0]'
              }`}>
              {/* Toggle row */}
              <div className="flex items-center justify-between p-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-[22px]">{ch.icon}</span>
                  <div>
                    <span className="text-[13px] font-semibold text-[#222222]">{ch.label}</span>
                    {isEnabled && hasValue && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <CheckCircle className="w-3 h-3 text-[#10b981]" />
                        <span className="text-[10px] text-[#10b981] font-medium">מחובר</span>
                      </div>
                    )}
                    {isEnabled && !hasValue && (
                      <span className="text-[10px] text-[#d97706]">⚠️ הזן פרטים</span>
                    )}
                  </div>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(val) => setForm(f => ({ ...f, [enabledKey]: val }))}
                />
              </div>

              {/* Input area - only visible when enabled */}
              {isEnabled && (
                <div className="px-3.5 pb-3.5">
                  <input
                    value={form[valueKey] || ''}
                    onChange={(e) => setForm(f => ({ ...f, [valueKey]: e.target.value }))}
                    placeholder={ch.placeholder}
                    type={ch.inputType}
                    dir={ch.inputType === 'tel' || ch.inputType === 'url' ? 'ltr' : 'rtl'}
                    className={inputCls}
                  />
                  <p className="text-[10px] text-[#aaaaaa] mt-1">{ch.helpText}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* WhatsApp Bot Link - if bot is enabled */}
      {form.bot_enabled && whatsappBotUrl && (
        <div className="bg-[#f0fdf8] border border-[#d1fae5] rounded-xl p-3.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] font-medium text-[#10b981]">🤖 לינק לבוט הוואטסאפ</span>
            <div className="flex gap-1.5">
              <button onClick={copyWhatsAppLink}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-white border border-[#d1fae5] text-[#10b981] hover:bg-[#f0fdf8] transition-colors">
                {copiedWhatsApp ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedWhatsApp ? 'הועתק!' : 'העתק לינק'}
              </button>
              <a href={whatsappBotUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#10b981] text-white hover:bg-[#059669] transition-colors">
                <ExternalLink className="w-3 h-3" /> נסה
              </a>
            </div>
          </div>
          <p className="text-[10px] text-[#10b981]/70">שתף את הלינק הזה בפרסומות, ברשתות חברתיות, או באתר שלך</p>
        </div>
      )}

      {/* Simple explanation */}
      <div className="bg-[#fafafa] rounded-xl p-3.5">
        <p className="text-[11px] text-[#999999] leading-relaxed">
          <strong className="text-[#666666]">איך זה עובד?</strong> ברגע שתחבר ערוץ ותפעיל את הבוט, הוא יתחיל לענות אוטומטית להודעות של לקוחות. 
          לידים מוסמכים יתווספו אוטומטית למערכת — בלי שתצטרך לעשות כלום. 🚀
        </p>
      </div>

      {/* Save Button */}
      <button onClick={onSave} disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold bg-[#111111] text-white hover:bg-[#333333] transition-colors disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
        {saving ? 'שומר...' : 'שמור ערוצים'}
      </button>
    </div>
  );
}