import React from 'react';
import { Switch } from '@/components/ui/switch';
import { MessageSquare } from 'lucide-react';

export default function SettingsAutoRespond({ form, onToggle, onFieldChange }) {
  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="text-[13px] font-bold text-foreground mb-1">תגובות אוטומטיות לביקורות חיוביות</h3>
          <p className="text-[13px] text-foreground-muted">המערכת תגיב אוטומטית על ביקורות 4-5 כוכבים בטון שלך. ביקורות שליליות תמיד ידרשו אישור שלך.</p>
        </div>
      </div>

      <div className="flex items-center justify-between py-2 border-t border-border">
        <span className="text-[12px] font-medium text-foreground">הפעל תגובות אוטומטיות</span>
        <Switch
          checked={form.auto_respond_enabled === true}
          onCheckedChange={(val) => onToggle('auto_respond_enabled', val)}
        />
      </div>

      {form.auto_respond_enabled && (
        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-foreground-muted">הגב על ביקורות עם דירוג:</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="auto_respond_min" checked={form.auto_respond_min_rating === 5}
                  onChange={() => onFieldChange('auto_respond_min_rating', 5)}
                  className="accent-foreground" />
                <span className="text-[12px] text-foreground">5 כוכבים בלבד</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="auto_respond_min" checked={form.auto_respond_min_rating === 4}
                  onChange={() => onFieldChange('auto_respond_min_rating', 4)}
                  className="accent-foreground" />
                <span className="text-[12px] text-foreground">4-5 כוכבים</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-t border-border">
            <span className="text-[12px] text-foreground">הודע לי כשהמערכת הגיבה</span>
            <Switch
              checked={form.auto_respond_notify !== false}
              onCheckedChange={(val) => onToggle('auto_respond_notify', val)}
            />
          </div>
        </div>
      )}
    </div>
  );
}