import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Send, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import IntegrationCard from './IntegrationCard';

const DEFAULT_FIELD_MAP = {
  phone_col: '', city_col: '', service_col: '', budget_col: '',
  source_col: '', score_col: '', status_col: '', urgency_col: '',
  status_hot: 'חם', status_warm: 'פושר', status_cold: 'קר',
  status_contacted: 'נוצר קשר', status_completed: 'טופל', status_lost: 'לא רלוונטי',
};

export default function MondayConfig({ bp, saveField }) {
  const [apiKey, setApiKey] = useState(bp?.crm_monday_api_key || '');
  const [boardId, setBoardId] = useState(bp?.crm_monday_board_id || '');
  const [fieldMap, setFieldMap] = useState(DEFAULT_FIELD_MAP);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(null);

  useEffect(() => {
    setApiKey(bp?.crm_monday_api_key || '');
    setBoardId(bp?.crm_monday_board_id || '');
    try { setFieldMap({ ...DEFAULT_FIELD_MAP, ...JSON.parse(bp?.crm_monday_field_map || '{}') }); } catch (_) {}
  }, [bp?.id]);

  const handleSave = () => {
    saveField({
      crm_monday_api_key: apiKey,
      crm_monday_board_id: boardId,
      crm_monday_field_map: JSON.stringify(fieldMap),
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestOk(null);
    const res = await base44.functions.invoke('syncLeadToCrm', {
      event: { type: 'create' },
      data: { id: 'test', name: 'בדיקת חיבור', status: 'warm', score: 50, source: 'test', service_needed: 'בדיקה', budget_range: '₪1,000', contact_info: '050-0000000', city: bp?.city || 'תל אביב', linked_business: bp?.id, created_at: new Date().toISOString() },
    });
    setTestOk(res.data?.results?.monday?.ok === true);
    if (res.data?.results?.monday?.ok) toast.success('Monday.com מחובר בהצלחה!');
    else toast.error('שגיאה — בדוק Token ו-Board ID');
    setTesting(false);
  };

  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <IntegrationCard
      icon={<span className="text-[18px] font-bold text-[#6C41DC]">M</span>}
      title="Monday.com"
      description="סנכרון לידים ללוח ב-Monday"
      enabled={bp?.crm_monday_enabled === true}
      onToggle={(val) => saveField({ crm_monday_enabled: val })}
      accentColor="#6C41DC"
    >
      <div>
        <label className="text-[11px] text-foreground-muted mb-1 block">API Token *</label>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} onBlur={handleSave}
          placeholder="eyJhbG..." dir="ltr" type="password" className={inputCls} />
        <p className="text-[9px] text-foreground-muted mt-1">Monday → Avatar → Developers → My Access Tokens</p>
      </div>
      <div>
        <label className="text-[11px] text-foreground-muted mb-1 block">Board ID *</label>
        <input value={boardId} onChange={(e) => setBoardId(e.target.value)} onBlur={handleSave}
          placeholder="1234567890" dir="ltr" className={inputCls} />
        <p className="text-[9px] text-foreground-muted mt-1">ניתן למצוא ב-URL של הלוח: monday.com/boards/<strong>BOARD_ID</strong></p>
      </div>

      <div className="bg-secondary rounded-lg p-3">
        <p className="text-[11px] font-semibold text-foreground mb-2">מיפוי עמודות (Column IDs)</p>
        <p className="text-[9px] text-foreground-muted mb-2">הזן את ה-Column ID מהלוח שלך עבור כל שדה. השאר ריק לדלג.</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'phone_col', label: 'טלפון' },
            { key: 'city_col', label: 'עיר' },
            { key: 'service_col', label: 'שירות' },
            { key: 'budget_col', label: 'תקציב' },
            { key: 'source_col', label: 'מקור' },
            { key: 'score_col', label: 'ציון' },
            { key: 'status_col', label: 'סטטוס' },
            { key: 'urgency_col', label: 'דחיפות' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-[9px] text-foreground-muted block mb-0.5">{f.label}</label>
              <input value={fieldMap[f.key] || ''}
                onChange={(e) => setFieldMap({ ...fieldMap, [f.key]: e.target.value })}
                onBlur={handleSave} dir="ltr" placeholder="column_id"
                className="w-full bg-white border border-[#eeeeee] rounded px-2 py-1 text-[11px] text-foreground" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleTest} disabled={testing || !apiKey || !boardId}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-medium bg-[#6C41DC] text-white hover:opacity-90 transition-all disabled:opacity-50">
          {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          {testing ? 'בודק...' : 'בדוק חיבור'}
        </button>
        {testOk === true && <span className="flex items-center gap-1 text-[10px] text-success font-medium"><CheckCircle className="w-3 h-3" /> מחובר!</span>}
        {testOk === false && <span className="text-[10px] text-danger font-medium">שגיאה</span>}
      </div>
    </IntegrationCard>
  );
}