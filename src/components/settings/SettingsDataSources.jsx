import React from 'react';
import { Save, Loader2, Globe, Search, Link2 } from 'lucide-react';

export default function SettingsDataSources({ form, setForm, onSave, saving }) {
  const inputCls = "w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg px-3 py-2 text-[13px] text-[#111111] placeholder-[#cccccc] focus:outline-none focus:border-[#dddddd]";
  const labelCls = "text-[12px] text-[#999999] mb-1 block";

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Search className="w-4 h-4 text-foreground-muted" />
        <h2 className="text-[14px] font-semibold text-[#222222]">מקורות מידע וניטור</h2>
      </div>
      <p className="text-[11px] text-[#999999] -mt-2">הגדר מילות מפתח, כתובות URL ופרופילי רשתות חברתיות לניטור מתקדם</p>

      <div>
        <label className={labelCls}>מילות מפתח למעקב</label>
        <input
          value={form.custom_keywords || ''}
          onChange={(e) => setForm({ ...form, custom_keywords: e.target.value })}
          placeholder="שיפוצים, עיצוב פנים, קבלן (מופרדות בפסיקים)"
          className={inputCls}
        />
        <p className="text-[9px] text-[#cccccc] mt-0.5">הסוכנים יחפשו מידע רלוונטי לפי מילות המפתח שלך</p>
      </div>

      <div>
        <label className={labelCls}>כתובות URL לסריקה קבועה</label>
        <textarea
          value={form.custom_urls || ''}
          onChange={(e) => setForm({ ...form, custom_urls: e.target.value })}
          rows={3}
          placeholder={"https://example.com/forum\nhttps://another-site.com/reviews"}
          className={`${inputCls} resize-none`}
        />
        <p className="text-[9px] text-[#cccccc] mt-0.5">הכנס כתובת URL אחת בכל שורה — הסוכנים יסרקו אותן באופן קבוע</p>
      </div>

      <div className="border-t border-[#f0f0f0] pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-[13px] font-semibold text-[#222222]">פרופילי רשתות חברתיות</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>קישור לפרופיל פייסבוק</label>
            <input
              value={form.facebook_url || ''}
              onChange={(e) => setForm({ ...form, facebook_url: e.target.value })}
              placeholder="https://facebook.com/your-page"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>קישור לפרופיל אינסטגרם</label>
            <input
              value={form.instagram_url || ''}
              onChange={(e) => setForm({ ...form, instagram_url: e.target.value })}
              placeholder="https://instagram.com/your-profile"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>קישור לפרופיל טיקטוק</label>
            <input
              value={form.tiktok_url || ''}
              onChange={(e) => setForm({ ...form, tiktok_url: e.target.value })}
              placeholder="https://tiktok.com/@your-profile"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>כתובת אתר העסק</label>
            <input
              value={form.website_url || ''}
              onChange={(e) => setForm({ ...form, website_url: e.target.value })}
              placeholder="https://your-website.co.il"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[#f0f0f0] pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="w-4 h-4 text-foreground-muted" />
          <h3 className="text-[13px] font-semibold text-[#222222]">ניטור מתחרים</h3>
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.monitor_competitors_social !== false}
            onChange={(e) => setForm({ ...form, monitor_competitors_social: e.target.checked })}
            className="w-4 h-4 rounded border-[#ddd] accent-primary"
          />
          <span className="text-[12px] text-[#444444]">ניטור פעילות מתחרים ברשתות חברתיות</span>
        </label>
        <p className="text-[9px] text-[#cccccc] mt-1 mr-6">הסוכנים יעקבו אחר פרסומים, ביקורות ופעילות חברתית של מתחרים</p>
      </div>

      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {saving ? 'שומר...' : 'שמור שינויים'}
      </button>
    </div>
  );
}