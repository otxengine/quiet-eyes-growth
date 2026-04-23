import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Bell, Mail, MessageSquare, Zap, Info } from 'lucide-react';

const scoreOptions = [60, 70, 80, 90];

export default function SettingsPushNotifications({ form, onToggle, onFieldChange }) {
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-5">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[#f0fdf8] flex items-center justify-center">
          <Zap className="w-4 h-4 text-[#10b981]" />
        </div>
        <div>
          <h2 className="text-[14px] font-semibold text-[#222222]">התראות בזמן אמת — לידים חמים</h2>
          <p className="text-[11px] text-[#999999]">קבל התראה מיידית כשנכנס ליד חם כדי ליצור קשר תוך דקות</p>
        </div>
      </div>

      {/* Why it matters */}
      <div className="bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-3 flex gap-2">
        <Info className="w-4 h-4 text-[#10b981] flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-[#10b981] leading-relaxed">
          מחקרים מראים שיצירת קשר תוך 5 דקות מרגע קבלת ליד מגדילה את סיכויי הסגירה פי 9. הפעל התראות בזמן אמת כדי לא לפספס אף הזדמנות.
        </p>
      </div>

      {/* Email alerts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Mail className="w-4 h-4 text-[#999999]" />
            <div>
              <span className="text-[13px] font-medium text-[#222222] block">התראה במייל</span>
              <span className="text-[11px] text-[#999999]">קבל מייל מיידי עם פרטי הליד ולינק ליצירת קשר</span>
            </div>
          </div>
          <Switch
            checked={!!form.push_email_alerts}
            onCheckedChange={(val) => onToggle('push_email_alerts', val)}
          />
        </div>

        {/* WhatsApp alerts */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="w-4 h-4 text-[#999999]" />
            <div>
              <span className="text-[13px] font-medium text-[#222222] block">התראה בוואטסאפ</span>
              <span className="text-[11px] text-[#999999]">קבל הודעת וואטסאפ מיידית עם פרטי הליד</span>
            </div>
          </div>
          <Switch
            checked={!!form.push_whatsapp_alerts}
            onCheckedChange={(val) => onToggle('push_whatsapp_alerts', val)}
          />
        </div>

        {/* WhatsApp number input - shown only when WhatsApp alerts are on */}
        {form.push_whatsapp_alerts && (
          <div className="mr-7">
            <label className="text-[12px] text-[#999999] mb-1 block">מספר וואטסאפ לקבלת התראות</label>
            <input
              value={form.push_whatsapp_number || ''}
              onChange={(e) => onFieldChange('push_whatsapp_number', e.target.value)}
              placeholder="05X-XXXXXXX"
              className={inputCls}
              dir="ltr"
            />
            <p className="text-[10px] text-[#cccccc] mt-1">הזן את המספר שבו תרצה לקבל הודעות וואטסאפ</p>
          </div>
        )}
      </div>

      {/* Minimum score threshold */}
      <div>
        <label className="text-[12px] text-[#999999] mb-2 block">ניקוד מינימלי להתראה</label>
        <div className="flex gap-2">
          {scoreOptions.map((score) => (
            <button
              key={score}
              onClick={() => onFieldChange('push_min_score', score)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                (form.push_min_score || 80) === score
                  ? 'bg-[#111111] text-white'
                  : 'text-[#aaaaaa] border border-[#eeeeee] hover:border-[#cccccc]'
              }`}
            >
              {score}+
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[#cccccc] mt-1.5">
          תקבל התראה רק על לידים עם ניקוד {form.push_min_score || 80} ומעלה (מתוך 100)
        </p>
      </div>

      {/* Status indicator */}
      {(form.push_email_alerts || form.push_whatsapp_alerts) && (
        <div className="flex items-center gap-2 pt-2 border-t border-[#f5f5f5]">
          <span className="w-2 h-2 rounded-full bg-[#10b981] pulse-glow" />
          <span className="text-[11px] text-[#10b981] font-medium">
            התראות בזמן אמת פעילות — 
            {[
              form.push_email_alerts && 'מייל',
              form.push_whatsapp_alerts && 'וואטסאפ',
            ].filter(Boolean).join(' + ')}
          </span>
        </div>
      )}
    </div>
  );
}