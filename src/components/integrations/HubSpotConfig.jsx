import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Send, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import IntegrationCard from './IntegrationCard';

const DEFAULT_FIELD_MAP = {
  name: 'firstname',
  phone: 'phone',
  city: 'city',
  service: 'jobtitle',
  source: 'hs_lead_status',
};

export default function HubSpotConfig({ bp, saveField }) {
  const [apiKey, setApiKey] = useState(bp?.crm_hubspot_api_key || '');
  const [pipelineId, setPipelineId] = useState(bp?.crm_hubspot_pipeline_id || '');
  const [fieldMap, setFieldMap] = useState(DEFAULT_FIELD_MAP);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(null);

  useEffect(() => {
    setApiKey(bp?.crm_hubspot_api_key || '');
    setPipelineId(bp?.crm_hubspot_pipeline_id || '');
    try { setFieldMap(JSON.parse(bp?.crm_hubspot_field_map || '{}')); } catch (_) {}
  }, [bp?.id]);

  const handleSave = () => {
    saveField({
      crm_hubspot_api_key: apiKey,
      crm_hubspot_pipeline_id: pipelineId,
      crm_hubspot_field_map: JSON.stringify({ ...DEFAULT_FIELD_MAP, ...fieldMap }),
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestOk(null);
    const res = await base44.functions.invoke('syncLeadToCrm', {
      event: { type: 'create' },
      data: { id: 'test', name: 'בדיקת חיבור', status: 'warm', score: 50, source: 'test', service_needed: 'בדיקה', contact_info: '050-0000000', city: bp?.city || 'תל אביב', linked_business: bp?.id, created_at: new Date().toISOString() },
    });
    setTestOk(res.data?.results?.hubspot?.ok === true);
    if (res.data?.results?.hubspot?.ok) toast.success('HubSpot מחובר בהצלחה!');
    else toast.error('שגיאה בחיבור — בדוק את ה-Token');
    setTesting(false);
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <IntegrationCard
      icon={<span className="text-[18px] font-bold text-[#FF7A59]">H</span>}
      title="HubSpot"
      description="סנכרון אנשי קשר ועסקאות"
      enabled={bp?.crm_hubspot_enabled === true}
      onToggle={(val) => saveField({ crm_hubspot_enabled: val })}
      accentColor="#FF7A59"
    >
      <div>
        <label className="text-[11px] text-foreground-muted mb-1 block">Private App Token *</label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} onBlur={handleSave}
          placeholder="pat-na1-xxxxxxxx-xxxx" dir="ltr" type="password" className={inputCls} />
        <p className="text-[9px] text-foreground-muted mt-1">
          צור ב-HubSpot → Settings → Integrations → Private Apps → Create
        </p>
      </div>
      <div>
        <label className="text-[11px] text-foreground-muted mb-1 block">Pipeline ID (אופציונלי)</label>
        <input value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} onBlur={handleSave}
          placeholder="default" dir="ltr" className={inputCls} />
      </div>

      <div className="bg-secondary rounded-lg p-3">
        <p className="text-[11px] font-semibold text-foreground mb-2">מיפוי שדות</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'name', label: 'שם', default: 'firstname' },
            { key: 'phone', label: 'טלפון', default: 'phone' },
            { key: 'city', label: 'עיר', default: 'city' },
            { key: 'service', label: 'שירות', default: 'jobtitle' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[9px] text-foreground-muted block mb-0.5">{f.label} → HubSpot</label>
              <input value={fieldMap[f.key] || f.default}
                onChange={(e) => setFieldMap({ ...fieldMap, [f.key]: e.target.value })}
                onBlur={handleSave} dir="ltr"
                className="w-full bg-white border border-[#eeeeee] rounded px-2 py-1 text-[11px] text-foreground" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleTest} disabled={testing || !apiKey}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-[#FF7A59] text-white hover:opacity-90 transition-all disabled:opacity-50">
          {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {testing ? 'בודק...' : 'בדוק חיבור'}
        </button>
        {testOk === true && <span className="flex items-center gap-1 text-[10px] text-success font-medium"><CheckCircle className="w-3 h-3" /> מחובר!</span>}
        {testOk === false && <span className="text-[10px] text-danger font-medium">שגיאה</span>}
      </div>
    </IntegrationCard>
  );
}