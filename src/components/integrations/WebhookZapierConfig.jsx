import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Globe, Zap, Loader2, Send, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import IntegrationCard from './IntegrationCard';

export default function WebhookZapierConfig({ bp, saveField }) {
  const [webhookUrl, setWebhookUrl] = useState(bp?.crm_webhook_url || '');
  const [zapierUrl, setZapierUrl] = useState(bp?.crm_zapier_url || '');
  const [testing, setTesting] = useState(null);

  useEffect(() => {
    setWebhookUrl(bp?.crm_webhook_url || '');
    setZapierUrl(bp?.crm_zapier_url || '');
  }, [bp?.id]);

  const handleTest = async (type) => {
    setTesting(type);
    const res = await base44.functions.invoke('syncLeadToCrm', {
      event: { type: 'create' },
      data: { id: 'test', name: 'בדיקת חיבור', status: 'hot', score: 85, source: 'test', service_needed: 'בדיקה', contact_info: '050-0000000', city: bp?.city || '', linked_business: bp?.id, created_at: new Date().toISOString() },
    });
    const ok = type === 'webhook' ? res.data?.results?.webhook?.ok : res.data?.results?.zapier?.ok;
    if (ok) toast.success('✓ נשלח בהצלחה!');
    else toast.error('שגיאה — בדוק URL');
    setTesting(null);
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="space-y-4">
      <IntegrationCard
        icon={<Globe className="w-5 h-5 text-foreground-muted" />}
        title="Webhook ישיר"
        description="שלח נתונים לכל כתובת URL"
        enabled={bp?.crm_webhook_enabled === true}
        onToggle={(val) => saveField({ crm_webhook_enabled: val })}
        accentColor="#333333"
      >
        <div>
          <label className="text-[11px] text-foreground-muted mb-1 block">כתובת Webhook</label>
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
            onBlur={() => saveField({ crm_webhook_url: webhookUrl })}
            placeholder="https://your-crm.com/api/webhook" dir="ltr" className={inputCls} />
        </div>
        <button onClick={() => handleTest('webhook')} disabled={testing === 'webhook' || !webhookUrl}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50">
          {testing === 'webhook' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          שלח בדיקה
        </button>
      </IntegrationCard>

      <IntegrationCard
        icon={<Zap className="w-5 h-5 text-[#FF4A00]" />}
        title="Zapier"
        description="חבר לאלפי אפליקציות דרך Zapier"
        enabled={bp?.crm_zapier_enabled === true}
        onToggle={(val) => saveField({ crm_zapier_enabled: val })}
        accentColor="#FF4A00"
      >
        <div>
          <label className="text-[11px] text-foreground-muted mb-1 block">Zapier Webhook URL</label>
          <input value={zapierUrl} onChange={(e) => setZapierUrl(e.target.value)}
            onBlur={() => saveField({ crm_zapier_url: zapierUrl })}
            placeholder="https://hooks.zapier.com/hooks/catch/..." dir="ltr" className={inputCls} />
        </div>
        <div className="bg-[#FFF8F0] border border-[#FFE0C0] rounded-lg p-3">
          <p className="text-[11px] text-[#FF4A00] font-medium mb-1">איך מחברים?</p>
          <ol className="text-[10px] text-[#994400] space-y-0.5 list-decimal mr-4">
            <li>צור Zap חדש → Trigger: "Webhooks by Zapier" → "Catch Hook"</li>
            <li>העתק את ה-URL והדבק כאן</li>
            <li>לחץ "שלח בדיקה" כדי שה-Zap יקבל מבנה נתונים</li>
            <li>חבר ל-Action: HubSpot / Monday / Salesforce / כל CRM</li>
          </ol>
        </div>
        <button onClick={() => handleTest('zapier')} disabled={testing === 'zapier' || !zapierUrl}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-[#FF4A00] text-white hover:opacity-90 disabled:opacity-50">
          {testing === 'zapier' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          שלח בדיקה
        </button>
      </IntegrationCard>
    </div>
  );
}