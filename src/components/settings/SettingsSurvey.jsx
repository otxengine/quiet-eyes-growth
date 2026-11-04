import React from 'react';
import { Switch } from '@/components/ui/switch';
import { ClipboardList } from 'lucide-react';

export default function SettingsSurvey({ form, setForm, onSave, saving }) {
  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-primary" />
        <h3 className="text-[13px] font-semibold text-foreground">סקר שביעות רצון</h3>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-foreground">הפעל סקר אוטומטי</p>
          <p className="text-[10px] text-foreground-muted">נשלח 24 שעות אחרי סגירת ליד</p>
        </div>
        <Switch checked={form.survey_enabled || false} onCheckedChange={(val) => setForm(f => ({ ...f, survey_enabled: val }))} />
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-foreground-muted block mb-1">שאלה 1 (דירוג 1-5)</label>
          <input value={form.survey_q1 || 'איך היית מדרג/ת את החוויה שלך?'} onChange={e => setForm(f => ({ ...f, survey_q1: e.target.value }))}
            className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-foreground-muted block mb-1">שאלה 2 (טקסט חופשי)</label>
          <input value={form.survey_q2 || 'מה הכי אהבת?'} onChange={e => setForm(f => ({ ...f, survey_q2: e.target.value }))}
            className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
        </div>
        <div>
          <label className="text-[11px] font-medium text-foreground-muted block mb-1">שאלה 3 (טקסט חופשי)</label>
          <input value={form.survey_q3 || 'מה אפשר לשפר?'} onChange={e => setForm(f => ({ ...f, survey_q3: e.target.value }))}
            className="w-full text-[12px] px-3 py-2 rounded-lg border border-border bg-white" />
        </div>
      </div>

      <button onClick={onSave} disabled={saving}
        className="text-[12px] px-4 py-2 rounded-lg bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-50">
        {saving ? 'שומר...' : 'שמור הגדרות סקר'}
      </button>
    </div>
  );
}