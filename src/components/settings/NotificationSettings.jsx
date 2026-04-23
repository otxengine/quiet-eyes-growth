import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';

const STORAGE_KEY = 'otx_notification_settings';

const DEFAULT_SETTINGS = {
  whatsapp_number: '',
  email: '',
  notify_on_insight:    true,
  notify_on_lead:       true,
  notify_on_review:     true,
  notify_on_competitor: true,
  quiet_hours_start:    22,
  quiet_hours_end:      8,
};

const TOGGLE_ITEMS = [
  { key: 'notify_on_insight',    label: 'תובנות חדשות',          icon: '💡' },
  { key: 'notify_on_lead',       label: 'לידים חדשים',           icon: '🎯' },
  { key: 'notify_on_review',     label: 'ביקורות חדשות',         icon: '⭐' },
  { key: 'notify_on_competitor', label: 'שינויים אצל מתחרים',   icon: '🔍' },
];

export default function NotificationSettings({ businessId }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}_${businessId}`);
      if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
    } catch (_) {}
  }, [businessId]);

  function update(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function saveSettings() {
    try {
      localStorage.setItem(`${STORAGE_KEY}_${businessId}`, JSON.stringify(settings));
      setSaved(true);
      toast.success('הגדרות נשמרו ✓');
      setTimeout(() => setSaved(false), 2000);
    } catch (_) {
      toast.error('שגיאה בשמירת הגדרות');
    }
  }

  return (
    <div className="space-y-5" style={{ direction: 'rtl', maxWidth: 480 }}>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground mb-1">ערוצי התראה</h3>
        <p className="text-[11px] text-foreground-muted mb-4">קבל התראות על אירועים חשובים ישירות לטלפון או למייל</p>

        {/* WhatsApp */}
        <div className="mb-4">
          <label className="text-[12px] font-medium text-foreground block mb-1.5">
            💬 מספר WhatsApp
          </label>
          <input
            type="tel"
            placeholder="+972501234567"
            value={settings.whatsapp_number}
            onChange={e => update('whatsapp_number', e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            style={{ direction: 'ltr' }}
          />
          <p className="text-[10px] text-foreground-muted mt-1">פורמט בינלאומי עם +972</p>
        </div>

        {/* Email */}
        <div className="mb-5">
          <label className="text-[12px] font-medium text-foreground block mb-1.5">
            📧 כתובת מייל
          </label>
          <input
            type="email"
            placeholder="name@email.com"
            value={settings.email}
            onChange={e => update('email', e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-border text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            style={{ direction: 'ltr' }}
          />
        </div>
      </div>

      {/* Toggle items */}
      <div>
        <h3 className="text-[13px] font-semibold text-foreground mb-3">סוגי התראות</h3>
        <div className="space-y-2.5">
          {TOGGLE_ITEMS.map(item => (
            <label key={item.key}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-secondary cursor-pointer hover:bg-secondary/70 transition-all">
              <span className="flex items-center gap-2 text-[13px] text-foreground">
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              <div
                onClick={() => update(item.key, !settings[item.key])}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  settings[item.key] ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  settings[item.key] ? 'translate-x-5' : 'translate-x-0.5'
                }`} />
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Quiet hours */}
      <div>
        <h3 className="text-[13px] font-semibold text-foreground mb-1">שעות שקטות</h3>
        <p className="text-[11px] text-foreground-muted mb-3">לא יישלחו התראות בשעות אלה</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[11px] text-foreground-muted block mb-1">מ-</label>
            <select
              value={settings.quiet_hours_start}
              onChange={e => update('quiet_hours_start', Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-border text-[12px] bg-white focus:outline-none"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-foreground-muted block mb-1">עד-</label>
            <select
              value={settings.quiet_hours_end}
              onChange={e => update('quiet_hours_end', Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-border text-[12px] bg-white focus:outline-none"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        onClick={saveSettings}
        className="w-full py-3 rounded-xl text-[13px] font-semibold transition-all"
        style={{ background: saved ? '#10b981' : '#4f46e5', color: '#fff' }}
      >
        {saved ? '✓ נשמר' : 'שמור הגדרות ←'}
      </button>

      <p className="text-[10px] text-foreground-muted text-center">
        התראות WhatsApp ומייל יופעלו בגרסה הבאה
      </p>
    </div>
  );
}
