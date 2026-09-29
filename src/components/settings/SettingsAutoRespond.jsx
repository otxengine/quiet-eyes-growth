import React from 'react';
import { Switch } from '@/components/ui/switch';
import { MessageSquare } from 'lucide-react';

export default function SettingsAutoRespond({ form, onToggle }) {
  return (
    <div className="card-base p-5 space-y-4">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-primary mt-0.5" />
        <div className="flex-1">
          <h3 className="text-[13px] font-bold text-foreground mb-1">טיוטות תגובה אוטומטיות לביקורות</h3>
          <p className="text-[13px] text-foreground-muted">המערכת תכין בטון שלך טיוטת תגובה לכל ביקורת חדשה, חיובית או שלילית. כל תגובה ממתינה לאישורך לפני שהיא מתפרסמת.</p>
        </div>
      </div>

      <div className="flex items-center justify-between py-2 border-t border-border">
        <span className="text-[12px] font-medium text-foreground">הפעל טיוטות תגובה אוטומטיות</span>
        <Switch
          checked={form.auto_respond_enabled === true}
          onCheckedChange={(val) => onToggle('auto_respond_enabled', val)}
        />
      </div>
    </div>
  );
}