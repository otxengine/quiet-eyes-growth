import React from 'react';
import { Switch } from '@/components/ui/switch';

const alerts = [
  { key: 'weekly_report', label: 'דוח שבועי', desc: 'קבל סיכום שבועי עם תובנות מרכזיות' },
  { key: 'hot_lead_alerts', label: 'התראות לידים חמים', desc: 'קבל התראה מיידית כשנכנס ליד חם' },
  { key: 'monthly_summary', label: 'סיכום חודשי', desc: 'קבל דוח חודשי מפורט עם מגמות' },
];

export default function SettingsAlerts({ form, onToggle }) {
  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <h2 className="text-[14px] font-semibold text-[#222222]">התראות</h2>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <div key={alert.key} className="flex items-center justify-between">
            <div>
              <span className="text-[13px] font-medium text-[#222222] block">{alert.label}</span>
              <span className="text-[11px] text-[#999999]">{alert.desc}</span>
            </div>
            <Switch checked={!!form[alert.key]} onCheckedChange={(val) => onToggle(alert.key, val)} />
          </div>
        ))}
      </div>
    </div>
  );
}