import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Bell } from 'lucide-react';

export default function SettingsWhatsAppAlerts({ form, onToggle, onFieldChange }) {
  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Bell className="w-5 h-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="text-[13px] font-bold text-foreground mb-1">התראות ב-WhatsApp</h3>
          <p className="text-[13px] text-foreground-muted">קבל התראה ישירות לוואטסאפ שלך כשקורה משהו חשוב</p>
        </div>
      </div>

      <div>
        <label className="text-[12px] text-foreground-muted mb-1 block">מספר WhatsApp שלך</label>
        <input
          value={form.wa_alert_phone || ''}
          onChange={(e) => onFieldChange('wa_alert_phone', e.target.value)}
          placeholder="05X-XXXXXXX"
          dir="ltr"
          className="w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]"
        />
      </div>

      <div className="space-y-0">
        <div className="flex items-center justify-between py-3 border-t border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#dc2626]" />
            <div>
              <span className="text-[12px] font-medium text-foreground block">ביקורת שלילית חדשה</span>
              <span className="text-[11px] text-foreground-muted">התראה מיידית כשמישהו משאיר ביקורת 1-2 כוכבים</span>
            </div>
          </div>
          <Switch
            checked={form.wa_alert_negative_review !== false}
            onCheckedChange={(val) => onToggle('wa_alert_negative_review', val)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-t border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#10b981]" />
            <div>
              <span className="text-[12px] font-medium text-foreground block">ליד חם חדש</span>
              <span className="text-[11px] text-foreground-muted">התראה כשנכנס ליד עם ציון 80+</span>
            </div>
          </div>
          <Switch
            checked={form.wa_alert_hot_lead !== false}
            onCheckedChange={(val) => onToggle('wa_alert_hot_lead', val)}
          />
        </div>

        <div className="flex items-center justify-between py-3 border-t border-border">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#d97706]" />
            <div>
              <span className="text-[12px] font-medium text-foreground block">תובנה בהשפעה גבוהה</span>
              <span className="text-[11px] text-foreground-muted">התראה על תובנה שדורשת תגובה מיידית</span>
            </div>
          </div>
          <Switch
            checked={form.wa_alert_high_impact === true}
            onCheckedChange={(val) => onToggle('wa_alert_high_impact', val)}
          />
        </div>
      </div>
    </div>
  );
}