import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Switch } from '@/components/ui/switch';
import { Bot, MessageSquare, ThumbsUp, ThumbsDown, Sparkles, Save, Loader2, Copy, Check, ExternalLink, Send } from 'lucide-react';
import { toast } from 'sonner';

const defaultGreeting = 'היי! 👋 ברוכים הבאים. אשמח לעזור לך. ספר לי במה אוכל לסייע?';

const defaultQuestions = `מה השירות שאתה מחפש?
מה התקציב המשוער שלך?
מתי אתה צריך את השירות?
באיזה אזור אתה נמצא?`;

export default function SettingsWhatsAppBot({ form, setForm, onSave, saving, businessProfile }) {
  const [copied, setCopied] = useState(false);
  const [generatingDefaults, setGeneratingDefaults] = useState(false);

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";
  const textareaCls = `${inputCls} resize-none`;

  const whatsappUrl = base44.agents?.getWhatsAppConnectURL
    ? base44.agents.getWhatsAppConnectURL('whatsapp_lead_bot')
    : null;

  const copyLink = () => {
    if (whatsappUrl) {
      navigator.clipboard.writeText(whatsappUrl);
      setCopied(true);
      toast.success('הלינק הועתק!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const generateSmartDefaults = async () => {
    setGeneratingDefaults(true);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `אתה יועץ שיווקי לעסקים קטנים בישראל.
עסק: ${form.name || 'עסק'}, קטגוריה: ${form.category || 'כללי'}, עיר: ${form.city || ''}, שירותים: ${form.relevant_services || ''}, תקציב מינימום: ${form.min_budget || 'לא הוגדר'}, אזור מועדף: ${form.preferred_area || ''}

צור הגדרות לבוט וואטסאפ שמשוחח עם לקוחות פוטנציאליים. החזר JSON בלבד:`,
      response_json_schema: {
        type: "object",
        properties: {
          greeting: { type: "string", description: "הודעת פתיחה חמה ב-2 משפטים בעברית" },
          questions: { type: "string", description: "4-5 שאלות סינון רלוונטיות לעסק, מופרדות בשורות חדשות" },
          good_criteria: { type: "string", description: "3-4 קריטריונים לליד טוב, מופרדים בשורות חדשות" },
          bad_criteria: { type: "string", description: "3-4 קריטריונים לליד לא מתאים, מופרדים בשורות חדשות" },
          services_info: { type: "string", description: "סיכום קצר של השירותים שהבוט יספר ללקוחות" }
        }
      }
    });

    setForm(f => ({
      ...f,
      bot_greeting: result.greeting || f.bot_greeting,
      bot_qualification_questions: result.questions || f.bot_qualification_questions,
      bot_good_lead_criteria: result.good_criteria || f.bot_good_lead_criteria,
      bot_bad_lead_criteria: result.bad_criteria || f.bot_bad_lead_criteria,
      bot_services_info: result.services_info || f.bot_services_info,
    }));
    setGeneratingDefaults(false);
    toast.success('ההגדרות נוצרו בהצלחה! בדוק אותן ושמור.');
  };

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#f0fdf8] flex items-center justify-center">
            <Bot className="w-5 h-5 text-[#10b981]" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-[#222222]">בוט וואטסאפ חכם</h2>
            <p className="text-[11px] text-[#999999]">הבוט משוחח עם לקוחות, מסנן אותם ומזין לידים למערכת</p>
          </div>
        </div>
        <Switch
          checked={!!form.bot_enabled}
          onCheckedChange={(val) => setForm(f => ({ ...f, bot_enabled: val }))}
        />
      </div>

      {form.bot_enabled && (
        <>
          {/* WhatsApp Link */}
          {whatsappUrl && (
            <div className="bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-medium text-[#10b981]">🔗 לינק וואטסאפ לשיתוף</span>
                <div className="flex gap-1.5">
                  <button onClick={copyLink}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-white border border-[#d1fae5] text-[#10b981] hover:bg-[#f0fdf8] transition-colors">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'הועתק!' : 'העתק'}
                  </button>
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[#10b981] text-white hover:bg-[#059669] transition-colors">
                    <ExternalLink className="w-3 h-3" /> פתח
                  </a>
                </div>
              </div>
              <p className="text-[10px] text-[#10b981]/70">שתף את הלינק הזה בפרסומות, אתר, כרטיס ביקור, או רשתות חברתיות</p>
            </div>
          )}

          {/* Meta Cloud API — optional real sending */}
          <div className="border border-[#f0f0f0] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#f0fdf8] flex items-center justify-center">
                <Send className="w-3.5 h-3.5 text-[#10b981]" />
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[#222]">שליחה אמיתית דרך Meta API</p>
                <p className="text-[10px] text-[#999]">אופציונלי — ללא הגדרה הבוט ישלח קישורי WhatsApp</p>
              </div>
              <Switch
                checked={!!form.meta_wa_real_send_enabled}
                onCheckedChange={(val) => setForm(f => ({ ...f, meta_wa_real_send_enabled: val }))}
              />
            </div>

            {form.meta_wa_real_send_enabled && (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-medium text-[#666] mb-1 block">Phone Number ID</label>
                  <input
                    value={form.meta_wa_phone_number_id || ''}
                    onChange={(e) => setForm(f => ({ ...f, meta_wa_phone_number_id: e.target.value }))}
                    placeholder="123456789012345"
                    dir="ltr"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-[#666] mb-1 block">Access Token</label>
                  <input
                    type="password"
                    value={form.meta_wa_access_token || ''}
                    onChange={(e) => setForm(f => ({ ...f, meta_wa_access_token: e.target.value }))}
                    placeholder="EAABsY..."
                    dir="ltr"
                    className={inputCls}
                  />
                </div>
                <div className="bg-[#fffbeb] border border-[#fef3c7] rounded-lg p-3">
                  <p className="text-[10px] text-[#92400e] leading-relaxed">
                    <strong>איך להגדיר:</strong> פתח את Meta Developers, צור WhatsApp Business App, קבל Phone Number ID ו-System User Token.
                    ה-Webhook URL שלך: <code className="bg-white px-1 rounded text-[9px]">[Function URL]/channelWebhook</code>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Smart generate */}
          <button onClick={generateSmartDefaults} disabled={generatingDefaults}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-medium bg-[#fafafa] border border-[#eeeeee] text-[#444444] hover:bg-[#f5f5f5] hover:border-[#dddddd] transition-colors">
            {generatingDefaults ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generatingDefaults ? 'יוצר הגדרות חכמות...' : '✨ צור הגדרות חכמות אוטומטית'}
          </button>

          {/* Greeting */}
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">הודעת פתיחה</label>
            <textarea
              value={form.bot_greeting || ''}
              onChange={(e) => setForm(f => ({ ...f, bot_greeting: e.target.value }))}
              placeholder={defaultGreeting}
              rows={2}
              className={textareaCls}
            />
            <p className="text-[10px] text-[#cccccc] mt-0.5">ההודעה הראשונה שהלקוח יקבל כשפונה לבוט</p>
          </div>

          {/* Qualification questions */}
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">שאלות סינון</label>
            <textarea
              value={form.bot_qualification_questions || ''}
              onChange={(e) => setForm(f => ({ ...f, bot_qualification_questions: e.target.value }))}
              placeholder={defaultQuestions}
              rows={4}
              className={textareaCls}
            />
            <p className="text-[10px] text-[#cccccc] mt-0.5">שאלה אחת בכל שורה — הבוט ישאל אותן בצורה טבעית בשיחה</p>
          </div>

          {/* Good lead / Bad lead criteria side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <ThumbsUp className="w-3.5 h-3.5 text-[#10b981]" />
                <label className="text-[12px] text-[#10b981] font-medium">ליד טוב — קריטריונים</label>
              </div>
              <textarea
                value={form.bot_good_lead_criteria || ''}
                onChange={(e) => setForm(f => ({ ...f, bot_good_lead_criteria: e.target.value }))}
                placeholder={`תקציב מעל 1,000₪\nצריך את השירות בשבועיים הקרובים\nגר באזור המרכז\nמחפש שירות ספציפי שאנחנו מציעים`}
                rows={4}
                className={textareaCls}
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <ThumbsDown className="w-3.5 h-3.5 text-[#dc2626]" />
                <label className="text-[12px] text-[#dc2626] font-medium">ליד לא מתאים — קריטריונים</label>
              </div>
              <textarea
                value={form.bot_bad_lead_criteria || ''}
                onChange={(e) => setForm(f => ({ ...f, bot_bad_lead_criteria: e.target.value }))}
                placeholder={`תקציב מתחת ל-500₪\nלא באזור שלנו\nמחפש שירות שאנחנו לא מציעים\nלא דחוף — רק בודק`}
                rows={4}
                className={textareaCls}
              />
            </div>
          </div>

          {/* Services info for bot */}
          <div>
            <label className="text-[12px] text-[#999999] mb-1 block">מידע על שירותים ומחירים</label>
            <textarea
              value={form.bot_services_info || ''}
              onChange={(e) => setForm(f => ({ ...f, bot_services_info: e.target.value }))}
              placeholder="תאר את השירותים, המחירים, וזמני אספקה — הבוט ישתמש במידע הזה בשיחה עם הלקוחות"
              rows={3}
              className={textareaCls}
            />
          </div>

          {/* Working Hours + Off-Hours Message */}
          <div className="space-y-2.5">
            <h4 className="text-[12px] font-semibold text-[#333]">שעות פעילות ותגובה מחוץ לשעות</h4>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-medium text-[#666] mb-1 block">פתיחה</label>
                <input
                  type="time"
                  value={form.bot_working_hours_start || '09:00'}
                  onChange={(e) => setForm(f => ({ ...f, bot_working_hours_start: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-medium text-[#666] mb-1 block">סגירה</label>
                <input
                  type="time"
                  value={form.bot_working_hours_end || '20:00'}
                  onChange={(e) => setForm(f => ({ ...f, bot_working_hours_end: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-[#666] mb-1 block">
                הודעה מחוץ לשעות פעילות
                <span className="text-[#aaa] font-normal mr-1">(ריק = ללא הודעה)</span>
              </label>
              <textarea
                rows={2}
                value={form.bot_off_hours_message || ''}
                onChange={(e) => setForm(f => ({ ...f, bot_off_hours_message: e.target.value }))}
                placeholder={`שלום! 🌙 אנחנו סגורים כרגע. נחזור אליך מחר בשעות 09:00-20:00`}
                className={textareaCls}
              />
            </div>
          </div>

          {/* Bot Flow Preview */}
          <div className="border border-[#f0f0f0] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#10b981]" />
              <h3 className="text-[12px] font-semibold text-[#222]">תצוגה מקדימה של השיחה</h3>
            </div>
            <div className="bg-[#ece5dd] rounded-xl p-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="flex justify-end">
                <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2 max-w-[85%]">
                  <p className="text-[11px] text-[#111] leading-relaxed whitespace-pre-wrap">
                    {form.bot_greeting || 'שלום! 👋 ברוכים הבאים.'}
                  </p>
                  <p className="text-[9px] text-[#888] text-left mt-1">בוט ✓</p>
                </div>
              </div>
              {(form.bot_qualification_questions || '').split('\n').filter(Boolean).slice(0, 3).map((q, i) => (
                <React.Fragment key={i}>
                  <div className="flex justify-start">
                    <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 max-w-[70%]">
                      <p className="text-[10px] text-[#888] italic">תשובת לקוח...</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2 max-w-[85%]">
                      <p className="text-[11px] text-[#111]">{q}</p>
                      <p className="text-[9px] text-[#888] text-left mt-1">בוט ✓</p>
                    </div>
                  </div>
                </React.Fragment>
              ))}
              <div className="flex justify-start">
                <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 max-w-[70%]">
                  <p className="text-[10px] text-[#888] italic">תשובה אחרונה...</p>
                </div>
              </div>
              <div className="flex justify-end">
                <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2 max-w-[85%]">
                  <p className="text-[11px] text-[#111]">תודה! 🙏 נחזור אליך בהקדם ונתאם שיחה.</p>
                  <p className="text-[9px] text-[#888] text-left mt-1">בוט ✓</p>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-[#aaa]">
              * לאחר הסינון, לידים חמים מקבלים התראה ישירות לבעל העסק
            </p>
          </div>

          {/* Meta Setup Guide */}
          <details className="border border-[#f0f0f0] rounded-xl">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-[12px] font-semibold text-[#444] list-none">
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              מדריך הגדרת WhatsApp Cloud API — צעד אחר צעד
            </summary>
            <div className="px-4 pb-4 pt-2 space-y-3">
              <div className="space-y-2">
                {[
                  'צור Business Account ב-Meta Business Suite',
                  'היכנס ל-Meta Developers → צור App חדש → בחר "Business"',
                  'הוסף מוצר "WhatsApp" ל-App',
                  'ב-WhatsApp → Getting Started: קבל Phone Number ID ו-Token',
                  'הוסף את מספר הטלפון העסקי שלך (WhatsApp Business)',
                  'ב-Configuration: הגדר Webhook URL + Verify Token',
                  'הרץ Verification → Subscribe לשדה "messages"',
                  'צור System User → קבל Access Token עם הרשאת whatsapp_business_messaging',
                  'הדבק Phone Number ID + Access Token בשדות למעלה ושמור',
                ].map((step, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-[#f0fdf8] text-[#10b981] text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span className="text-[11px] text-[#666] leading-relaxed">{step}</span>
                  </div>
                ))}
              </div>
              <div className="bg-[#f8f8f8] rounded-lg p-3 space-y-2">
                <p className="text-[10px] font-medium text-[#999]">Webhook URL</p>
                <code className="text-[10px] text-[#444] block break-all">
                  [Base44 Project URL]/functions/channelWebhook
                </code>
                <p className="text-[10px] font-medium text-[#999] mt-2">Verify Token</p>
                <code className="text-[10px] text-[#444] block">
                  {form.channels_webhook_secret || '[הגדר Webhook Secret בהגדרות ערוצים]'}
                </code>
                <p className="text-[10px] font-medium text-[#999] mt-2">Webhook Fields</p>
                <code className="text-[10px] text-[#444] block">messages</code>
              </div>
            </div>
          </details>

          {/* Save button */}
          <button onClick={onSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'שומר...' : 'שמור הגדרות בוט'}
          </button>
        </>
      )}
    </div>
  );
}