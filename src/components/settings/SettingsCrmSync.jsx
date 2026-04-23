import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { ArrowUpDown, Loader2, CheckCircle, Zap, Globe, Send } from 'lucide-react';
import { toast } from 'sonner';

function timeAgo(dateStr) {
  if (!dateStr) return 'טרם בוצע';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function SettingsCrmSync({ form, setForm, businessProfile, onToggle, onFieldChange }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleTestHubSpot = async () => {
    setTesting('hubspot');
    setTestResult(null);
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { 'Authorization': `Bearer ${form.crm_hubspot_api_key}` }
      });
      if (res.ok) {
        setTestResult({ type: 'hubspot', ok: true });
        toast.success('HubSpot מחובר בהצלחה ✓');
      } else {
        setTestResult({ type: 'hubspot', ok: false });
        toast.error('שגיאת חיבור HubSpot — בדוק את ה-Token');
      }
    } catch {
      toast.error('לא ניתן להתחבר ל-HubSpot');
    }
    setTesting(null);
  };

  const handleTestMonday = async () => {
    setTesting('monday');
    setTestResult(null);
    try {
      const res = await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: { 'Authorization': form.crm_monday_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ me { name } }' }),
      });
      const data = await res.json();
      if (data.data?.me?.name) {
        setTestResult({ type: 'monday', ok: true });
        toast.success(`Monday.com מחובר — ${data.data.me.name} ✓`);
      } else {
        setTestResult({ type: 'monday', ok: false });
        toast.error('שגיאת חיבור Monday — בדוק את ה-API Token');
      }
    } catch {
      toast.error('לא ניתן להתחבר ל-Monday');
    }
    setTesting(null);
  };

  const handleTestPipedrive = async () => {
    setTesting('pipedrive');
    try {
      const res = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${form.crm_pipedrive_api_key}`);
      const data = await res.json();
      if (data.success) {
        toast.success(`Pipedrive מחובר — ${data.data.name} ✓`);
      } else {
        toast.error('שגיאת חיבור Pipedrive');
      }
    } catch {
      toast.error('לא ניתן להתחבר ל-Pipedrive');
    }
    setTesting(null);
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke('crmWebhookSync', {
        event: { type: 'test' },
        data: {
          id: 'test-123',
          name: 'ליד לדוגמה',
          status: 'hot',
          score: 85,
          source: 'בדיקת מערכת',
          service_needed: 'שירות לדוגמה',
          budget_range: '₪1,000-5,000',
          contact_info: '050-0000000',
          city: businessProfile?.city || 'תל אביב',
          urgency: 'השבוע',
          linked_business: businessProfile?.id,
          created_at: new Date().toISOString(),
        },
      });
      const data = res.data;
      if (data?.synced) {
        const webhookOk = data.results?.webhook?.ok;
        const zapierOk = data.results?.zapier?.ok;
        if (webhookOk || zapierOk) {
          setTestResult('success');
          toast.success('✓ הנתונים נשלחו בהצלחה!');
        } else {
          setTestResult('error');
          toast.error('שגיאה בשליחה — בדוק את ה-URL');
        }
      } else {
        setTestResult('skip');
        toast.info(data?.reason || 'לא הוגדר חיבור CRM');
      }
    } catch (err) {
      setTestResult('error');
      toast.error('שגיאה בבדיקה');
    }
    setTesting(false);
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";
  const syncEvents = (form.crm_sync_events || 'create,update').split(',').map(s => s.trim());

  const toggleEvent = (evt) => {
    let events = [...syncEvents];
    if (events.includes(evt)) {
      events = events.filter(e => e !== evt);
    } else {
      events.push(evt);
    }
    const val = events.filter(Boolean).join(',');
    onFieldChange('crm_sync_events', val);
  };

  return (
    <div className="card-base p-5 space-y-5">
      <div className="flex items-start gap-3">
        <ArrowUpDown className="w-5 h-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="text-[13px] font-bold text-foreground mb-1">סנכרון CRM</h3>
          <p className="text-[12px] text-foreground-muted leading-relaxed">חבר את OTX ל-CRM שלך כדי שלידים יסתנכרנו אוטומטית. תומך ב-Webhook ישיר או דרך Zapier.</p>
        </div>
      </div>

      {/* Webhook Section */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-foreground-muted" />
            <span className="text-[12px] font-semibold text-foreground">Webhook ישיר</span>
          </div>
          <Switch
            checked={form.crm_webhook_enabled === true}
            onCheckedChange={(val) => onToggle('crm_webhook_enabled', val)}
          />
        </div>
        {form.crm_webhook_enabled && (
          <div>
            <label className="text-[11px] text-foreground-muted mb-1 block">כתובת Webhook (URL)</label>
            <input
              value={form.crm_webhook_url || ''}
              onChange={(e) => { setForm(f => ({ ...f, crm_webhook_url: e.target.value })); }}
              onBlur={() => onFieldChange('crm_webhook_url', form.crm_webhook_url)}
              placeholder="https://your-crm.com/api/webhook"
              dir="ltr"
              className={inputCls}
            />
            <p className="text-[10px] text-foreground-muted mt-1">הדבק את ה-URL מה-CRM שלך. המערכת תשלח POST request עם נתוני הליד בכל אירוע.</p>
          </div>
        )}
      </div>

      {/* Zapier Section */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#FF4A00]" />
            <span className="text-[12px] font-semibold text-foreground">Zapier</span>
          </div>
          <Switch
            checked={form.crm_zapier_enabled === true}
            onCheckedChange={(val) => onToggle('crm_zapier_enabled', val)}
          />
        </div>
        {form.crm_zapier_enabled && (
          <div className="space-y-2">
            <label className="text-[11px] text-foreground-muted mb-1 block">כתובת Zapier Webhook</label>
            <input
              value={form.crm_zapier_url || ''}
              onChange={(e) => { setForm(f => ({ ...f, crm_zapier_url: e.target.value })); }}
              onBlur={() => onFieldChange('crm_zapier_url', form.crm_zapier_url)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              dir="ltr"
              className={inputCls}
            />
            <div className="bg-[#FFF8F0] border border-[#FFE0C0] rounded-lg p-3">
              <p className="text-[11px] text-[#FF4A00] font-medium mb-1">איך מחברים Zapier?</p>
              <ol className="text-[10px] text-[#994400] space-y-0.5 list-decimal mr-4">
                <li>צור Zap חדש ב-Zapier</li>
                <li>בחר "Webhooks by Zapier" → "Catch Hook"</li>
                <li>העתק את ה-URL שקיבלת והדבק כאן</li>
                <li>חבר את הפלט לכל CRM שתרצה (HubSpot, Monday, Salesforce...)</li>
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Sync Events */}
      {(form.crm_webhook_enabled || form.crm_zapier_enabled) && (
        <div className="space-y-2 pt-2 border-t border-border">
          <label className="text-[11px] font-medium text-foreground-muted block">מתי לסנכרן?</label>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'create', label: 'ליד חדש', desc: 'כשנכנס ליד חדש' },
              { key: 'update', label: 'עדכון ליד', desc: 'כשנתוני ליד משתנים' },
              { key: 'status_change', label: 'שינוי סטטוס', desc: 'כשליד עובר סטטוס' },
            ].map(evt => (
              <button
                key={evt.key}
                onClick={() => toggleEvent(evt.key)}
                className={`px-3 py-2 rounded-lg text-[11px] font-medium transition-colors ${
                  syncEvents.includes(evt.key)
                    ? 'bg-foreground text-background'
                    : 'text-foreground-muted border border-border hover:border-border-hover'
                }`}
              >
                {evt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Test & Stats */}
      {(form.crm_webhook_enabled || form.crm_zapier_enabled) && (
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestWebhook}
              disabled={!!testing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50"
            >
              {testing === true ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              {testing === true ? 'שולח...' : 'שלח נתון לדוגמה'}
            </button>
            {testResult === 'success' && (
              <span className="flex items-center gap-1 text-[10px] text-[#10b981] font-medium">
                <CheckCircle className="w-3 h-3" /> עובד!
              </span>
            )}
            {testResult === 'error' && (
              <span className="text-[10px] text-[#dc2626] font-medium">שגיאה — בדוק URL</span>
            )}
          </div>
          <div className="text-left">
            <span className="text-[10px] text-foreground-muted block">
              {businessProfile?.crm_sync_count || 0} סנכרונים
            </span>
            <span className="text-[9px] text-foreground-muted opacity-60">
              אחרון: {timeAgo(businessProfile?.crm_last_sync)}
            </span>
          </div>
        </div>
      )}

      {/* HubSpot */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#ff7a59]/10 flex items-center justify-center">
              <span className="text-[11px]">🔶</span>
            </div>
            <span className="text-[12px] font-semibold text-foreground">HubSpot</span>
          </div>
          <Switch
            checked={form.crm_hubspot_enabled === true}
            onCheckedChange={(val) => onToggle('crm_hubspot_enabled', val)}
          />
        </div>
        {form.crm_hubspot_enabled && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Private App Token</label>
              <input
                type="password"
                value={form.crm_hubspot_api_key || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_hubspot_api_key: e.target.value }))}
                onBlur={() => onFieldChange('crm_hubspot_api_key', form.crm_hubspot_api_key)}
                placeholder="pat-eu1-..."
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Pipeline ID (אופציונלי)</label>
              <input
                value={form.crm_hubspot_pipeline_id || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_hubspot_pipeline_id: e.target.value }))}
                onBlur={() => onFieldChange('crm_hubspot_pipeline_id', form.crm_hubspot_pipeline_id)}
                placeholder="default"
                dir="ltr"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleTestHubSpot}
              disabled={testing === 'hubspot' || !form.crm_hubspot_api_key}
              className="flex items-center gap-1.5 text-[11px] border border-border rounded-lg px-3 py-1.5 hover:border-border-hover transition-colors disabled:opacity-40"
            >
              {testing === 'hubspot' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              בדוק חיבור
            </button>
          </div>
        )}
      </div>

      {/* Monday.com */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#f63] /10 flex items-center justify-center">
              <span className="text-[11px]">📋</span>
            </div>
            <span className="text-[12px] font-semibold text-foreground">Monday.com</span>
          </div>
          <Switch
            checked={form.crm_monday_enabled === true}
            onCheckedChange={(val) => onToggle('crm_monday_enabled', val)}
          />
        </div>
        {form.crm_monday_enabled && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">API Token</label>
              <input
                type="password"
                value={form.crm_monday_api_key || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_monday_api_key: e.target.value }))}
                onBlur={() => onFieldChange('crm_monday_api_key', form.crm_monday_api_key)}
                placeholder="eyJhbGci..."
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Board ID</label>
              <input
                value={form.crm_monday_board_id || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_monday_board_id: e.target.value }))}
                onBlur={() => onFieldChange('crm_monday_board_id', form.crm_monday_board_id)}
                placeholder="1234567890"
                dir="ltr"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleTestMonday}
              disabled={testing === 'monday' || !form.crm_monday_api_key}
              className="flex items-center gap-1.5 text-[11px] border border-border rounded-lg px-3 py-1.5 hover:border-border-hover transition-colors disabled:opacity-40"
            >
              {testing === 'monday' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              בדוק חיבור
            </button>
          </div>
        )}
      </div>

      {/* Pipedrive */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#f5f3ff] flex items-center justify-center">
              <span className="text-[11px]">🚀</span>
            </div>
            <span className="text-[12px] font-semibold text-foreground">Pipedrive</span>
          </div>
          <Switch
            checked={form.crm_pipedrive_enabled === true}
            onCheckedChange={(val) => onToggle('crm_pipedrive_enabled', val)}
          />
        </div>
        {form.crm_pipedrive_enabled && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">API Token</label>
              <input
                type="password"
                value={form.crm_pipedrive_api_key || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_pipedrive_api_key: e.target.value }))}
                onBlur={() => onFieldChange('crm_pipedrive_api_key', form.crm_pipedrive_api_key)}
                placeholder="הדבק את ה-Pipedrive API Token"
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Pipeline ID</label>
              <input
                value={form.crm_pipedrive_pipeline_id || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_pipedrive_pipeline_id: e.target.value }))}
                onBlur={() => onFieldChange('crm_pipedrive_pipeline_id', form.crm_pipedrive_pipeline_id)}
                placeholder="1"
                dir="ltr"
                className={inputCls}
              />
            </div>
            <button
              onClick={handleTestPipedrive}
              disabled={testing === 'pipedrive' || !form.crm_pipedrive_api_key}
              className="flex items-center gap-1.5 text-[11px] border border-border rounded-lg px-3 py-1.5 hover:border-border-hover transition-colors disabled:opacity-40"
            >
              {testing === 'pipedrive' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
              בדוק חיבור
            </button>
          </div>
        )}
      </div>

      {/* Salesforce */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#e8f4fd] flex items-center justify-center">
              <span className="text-[11px]">☁️</span>
            </div>
            <span className="text-[12px] font-semibold text-foreground">Salesforce</span>
          </div>
          <Switch
            checked={form.crm_salesforce_enabled === true}
            onCheckedChange={(val) => onToggle('crm_salesforce_enabled', val)}
          />
        </div>
        {form.crm_salesforce_enabled && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Instance URL</label>
              <input
                value={form.crm_salesforce_instance_url || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_salesforce_instance_url: e.target.value }))}
                onBlur={() => onFieldChange('crm_salesforce_instance_url', form.crm_salesforce_instance_url)}
                placeholder="https://yourorg.salesforce.com"
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Client ID (Connected App)</label>
              <input
                type="password"
                value={form.crm_salesforce_client_id || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_salesforce_client_id: e.target.value }))}
                onBlur={() => onFieldChange('crm_salesforce_client_id', form.crm_salesforce_client_id)}
                placeholder="3MVG9..."
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Client Secret</label>
              <input
                type="password"
                value={form.crm_salesforce_client_secret || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_salesforce_client_secret: e.target.value }))}
                onBlur={() => onFieldChange('crm_salesforce_client_secret', form.crm_salesforce_client_secret)}
                placeholder="..."
                dir="ltr"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-foreground-muted mb-1 block">Refresh Token</label>
              <input
                type="password"
                value={form.crm_salesforce_refresh_token || ''}
                onChange={(e) => setForm(f => ({ ...f, crm_salesforce_refresh_token: e.target.value }))}
                onBlur={() => onFieldChange('crm_salesforce_refresh_token', form.crm_salesforce_refresh_token)}
                placeholder="5Aep861..."
                dir="ltr"
                className={inputCls}
              />
            </div>
            <p className="text-[10px] text-foreground-muted">
              לקבלת Refresh Token: הגדר Connected App ב-Salesforce עם OAuth Scope = api, refresh_token
            </p>
          </div>
        )}
      </div>
    </div>
  );
}