import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Save, Loader2, Zap, KeyRound, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

const AUTONOMY_OPTIONS = [
  {
    value: 'manual',
    label: 'ידני',
    desc: 'כל פעולה מחכה לאישורך. שום דבר לא קורה אוטומטית.',
    color: '#6366f1',
  },
  {
    value: 'semi_auto',
    label: 'חצי אוטומטי',
    desc: 'הסוכנים מציעים פעולות — ואחרי 24 שעות (או לפי הגדרה) מבצעים אוטומטית אם לא דחית.',
    color: '#d97706',
  },
  {
    value: 'full_auto',
    label: 'מלא אוטומטי',
    desc: 'הסוכנים פועלים מיד — תגובות לביקורות, שליחת WhatsApp, פרסום תוכן. לידים תמיד ידניים.',
    color: '#10b981',
  },
];

function AutonomySelector({ businessProfile, onSave }) {
  const current = businessProfile?.autonomy_level || 'semi_auto';
  const [selected, setSelected] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(businessProfile?.autonomy_level || 'semi_auto');
  }, [businessProfile?.autonomy_level]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ autonomy_level: selected });
      toast.success('רמת האוטונומיה עודכנה ✓');
    } catch {
      toast.error('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-4 h-4 text-primary" />
        <h2 className="text-[14px] font-semibold text-foreground">רמת אוטונומיה של הסוכנים</h2>
      </div>
      <p className="text-[11px] text-foreground-muted mb-4">
        קבע כמה כסף ומאמץ הסוכנים יחסכו לך אוטומטית. לידים תמיד ידניים ללא קשר להגדרה זו.
      </p>
      <div className="flex flex-col gap-2">
        {AUTONOMY_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelected(opt.value)}
            className={`flex items-start gap-3 p-3 rounded-lg border text-right transition-all ${
              selected === opt.value
                ? 'border-2 bg-white'
                : 'border border-border bg-secondary/30 hover:bg-secondary/60'
            }`}
            style={selected === opt.value ? { borderColor: opt.color } : {}}
          >
            <span
              className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-0.5"
              style={{ background: selected === opt.value ? opt.color : '#cbd5e1' }}
            />
            <div>
              <p className="text-[12px] font-semibold text-foreground">{opt.label}</p>
              <p className="text-[10px] text-foreground-muted mt-0.5">{opt.desc}</p>
            </div>
          </button>
        ))}
      </div>
      {selected !== current && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-medium hover:opacity-90 transition-all disabled:opacity-60"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saving ? 'שומר...' : 'שמור רמת אוטונומיה'}
        </button>
      )}
    </div>
  );
}
import SettingsBusinessDetails from '@/components/settings/SettingsBusinessDetails';
import SettingsTone from '@/components/settings/SettingsTone';
import SettingsLeadCriteria from '@/components/settings/SettingsLeadCriteria';
import SettingsAlerts from '@/components/settings/SettingsAlerts';
import SettingsPushNotifications from '@/components/settings/SettingsPushNotifications';
import SettingsWhatsAppBot from '@/components/settings/SettingsWhatsAppBot';
import SettingsChannels from '@/components/settings/SettingsChannels';
import SettingsLearnBusiness from '@/components/settings/SettingsLearnBusiness.jsx';
import SettingsDataSources from '@/components/settings/SettingsDataSources.jsx';
import SettingsAutoRespond from '@/components/settings/SettingsAutoRespond.jsx';
import SettingsWhatsAppAlerts from '@/components/settings/SettingsWhatsAppAlerts.jsx';
import SettingsCrmSync from '@/components/settings/SettingsCrmSync.jsx';
import SettingsSurvey from '@/components/settings/SettingsSurvey.jsx';
import SettingsLocations from '@/components/settings/SettingsLocations.jsx';
import AiInsightBox from '@/components/ai/AiInsightBox';
import NotificationSettings from '@/components/settings/NotificationSettings';

function ApiCredentialsCard({ form, setForm, onSave }) {
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        whatsapp_phone_number_id: form.whatsapp_phone_number_id,
        whatsapp_access_token: form.whatsapp_access_token,
      });
      toast.success('פרטי WhatsApp נשמרו ✓');
    } catch {
      toast.error('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-4 h-4 text-primary" />
        <h2 className="text-[14px] font-semibold text-foreground">WhatsApp Business API</h2>
      </div>
      <p className="text-[11px] text-foreground-muted mb-4">
        נדרש לשליחת WhatsApp אוטומטית. ללא זה, הודעות ינותבו לאישור ידני. Facebook, Instagram וגוגל מחוברים דרך <span className="text-primary">אינטגרציות</span>.
      </p>
      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-[11px] text-foreground-muted mb-1">Phone Number ID</label>
          <input
            type="text"
            value={form.whatsapp_phone_number_id || ''}
            onChange={e => setForm(f => ({ ...f, whatsapp_phone_number_id: e.target.value }))}
            placeholder="1234567890 (מתוך Meta Business Suite)"
            className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-primary"
            dir="ltr"
          />
        </div>
        <div>
          <label className="block text-[11px] text-foreground-muted mb-1">Access Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.whatsapp_access_token || ''}
              onChange={e => setForm(f => ({ ...f, whatsapp_access_token: e.target.value }))}
              placeholder="EAAxxxxx..."
              className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-secondary/30 focus:outline-none focus:ring-1 focus:ring-primary pr-8"
              dir="ltr"
            />
            <button type="button" onClick={() => setShowToken(v => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground">
              {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-medium hover:opacity-90 transition-all disabled:opacity-60"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
        {saving ? 'שומר...' : 'שמור'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { businessProfile } = useOutletContext();
  const [form, setForm] = useState({
    name: '', category: '', city: '', full_address: '', description: '', target_market: '',
    tone_preference: 'friendly', min_budget: '', relevant_services: '', preferred_area: '',
    weekly_report: true, hot_lead_alerts: true, monthly_summary: false,
    push_email_alerts: false, push_whatsapp_alerts: false, push_whatsapp_number: '', push_min_score: 80,
    auto_respond_enabled: false, auto_respond_min_rating: 5, auto_respond_notify: true,
    wa_alert_phone: '', wa_alert_negative_review: true, wa_alert_hot_lead: true, wa_alert_high_impact: false,
    crm_webhook_url: '', crm_webhook_enabled: false, crm_sync_events: 'create,update',
    crm_zapier_url: '', crm_zapier_enabled: false,
    bot_enabled: false, bot_greeting: '', bot_qualification_questions: '', bot_good_lead_criteria: '', bot_bad_lead_criteria: '', bot_services_info: '',
    channels_whatsapp: '', channels_whatsapp_enabled: false,
    channels_instagram: '', channels_instagram_enabled: false,
    channels_facebook: '', channels_facebook_enabled: false,
    channels_tiktok: '', channels_tiktok_enabled: false,
    channels_website: '', channels_website_enabled: false,
    channels_webhook_secret: '',
    custom_keywords: '', custom_urls: '',
    facebook_url: '', instagram_url: '', tiktok_url: '', website_url: '',
    monitor_competitors_social: true,
    survey_enabled: false, survey_q1: '', survey_q2: '', survey_q3: '',
    whatsapp_phone_number_id: '', whatsapp_access_token: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (businessProfile) {
      setForm({
        name: businessProfile.name || '', category: businessProfile.category || '', city: businessProfile.city || '',
        full_address: businessProfile.full_address || '',
        description: businessProfile.description || '', target_market: businessProfile.target_market || '',
        tone_preference: businessProfile.tone_preference || 'friendly', min_budget: businessProfile.min_budget || '',
        relevant_services: businessProfile.relevant_services || '', preferred_area: businessProfile.preferred_area || '',
        weekly_report: businessProfile.weekly_report !== false, hot_lead_alerts: businessProfile.hot_lead_alerts !== false,
        monthly_summary: businessProfile.monthly_summary === true,
        push_email_alerts: businessProfile.push_email_alerts === true,
        push_whatsapp_alerts: businessProfile.push_whatsapp_alerts === true,
        push_whatsapp_number: businessProfile.push_whatsapp_number || '',
        push_min_score: businessProfile.push_min_score || 80,
        auto_respond_enabled: businessProfile.auto_respond_enabled === true,
        auto_respond_min_rating: businessProfile.auto_respond_min_rating || 5,
        auto_respond_notify: businessProfile.auto_respond_notify !== false,
        wa_alert_phone: businessProfile.wa_alert_phone || '',
        wa_alert_negative_review: businessProfile.wa_alert_negative_review !== false,
        wa_alert_hot_lead: businessProfile.wa_alert_hot_lead !== false,
        wa_alert_high_impact: businessProfile.wa_alert_high_impact === true,
        crm_webhook_url: businessProfile.crm_webhook_url || '',
        crm_webhook_enabled: businessProfile.crm_webhook_enabled === true,
        crm_sync_events: businessProfile.crm_sync_events || 'create,update',
        crm_zapier_url: businessProfile.crm_zapier_url || '',
        crm_zapier_enabled: businessProfile.crm_zapier_enabled === true,
        channels_whatsapp: businessProfile.channels_whatsapp || '',
        channels_whatsapp_enabled: businessProfile.channels_whatsapp_enabled === true,
        channels_instagram: businessProfile.channels_instagram || '',
        channels_instagram_enabled: businessProfile.channels_instagram_enabled === true,
        channels_facebook: businessProfile.channels_facebook || '',
        channels_facebook_enabled: businessProfile.channels_facebook_enabled === true,
        channels_tiktok: businessProfile.channels_tiktok || '',
        channels_tiktok_enabled: businessProfile.channels_tiktok_enabled === true,
        channels_website: businessProfile.channels_website || '',
        channels_website_enabled: businessProfile.channels_website_enabled === true,
        channels_webhook_secret: businessProfile.channels_webhook_secret || '',
        custom_keywords: businessProfile.custom_keywords || '',
        custom_urls: businessProfile.custom_urls || '',
        facebook_url: businessProfile.facebook_url || '',
        instagram_url: businessProfile.instagram_url || '',
        tiktok_url: businessProfile.tiktok_url || '',
        website_url: businessProfile.website_url || '',
        monitor_competitors_social: businessProfile.monitor_competitors_social !== false,
        survey_enabled: businessProfile.survey_enabled === true,
        survey_q1: businessProfile.survey_q1 || 'איך היית מדרג/ת את החוויה שלך?',
        survey_q2: businessProfile.survey_q2 || 'מה הכי אהבת?',
        survey_q3: businessProfile.survey_q3 || 'מה אפשר לשפר?',
        bot_enabled: businessProfile.bot_enabled === true,
        bot_greeting: businessProfile.bot_greeting || '',
        bot_qualification_questions: businessProfile.bot_qualification_questions || '',
        bot_good_lead_criteria: businessProfile.bot_good_lead_criteria || '',
        bot_bad_lead_criteria: businessProfile.bot_bad_lead_criteria || '',
        bot_services_info: businessProfile.bot_services_info || '',
        whatsapp_phone_number_id: businessProfile.whatsapp_phone_number_id || '',
        whatsapp_access_token: businessProfile.whatsapp_access_token || '',
      });
    }
  }, [businessProfile]);

  const saveField = async (partial) => {
    if (!businessProfile?.id) return;
    setForm(f => ({ ...f, ...partial }));
    await base44.entities.BusinessProfile.update(businessProfile.id, partial);
  };

  const handleSaveAll = async () => {
    if (!businessProfile?.id) return;
    setSaving(true);
    await base44.entities.BusinessProfile.update(businessProfile.id, form);
    setSaving(false);
    toast.success('ההגדרות נשמרו בהצלחה');
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-[16px] font-bold text-foreground tracking-tight">הגדרות</h1>
      <SettingsBusinessDetails form={form} setForm={setForm} onSave={handleSaveAll} saving={saving} />
      <SettingsTone form={form} onToneChange={(tone) => { setForm({ ...form, tone_preference: tone }); saveField({ tone_preference: tone }); toast.success('הטון עודכן ✓'); }} />
      <SettingsLeadCriteria form={form} setForm={setForm} onSave={() => saveField({ min_budget: form.min_budget, relevant_services: form.relevant_services, preferred_area: form.preferred_area })} />
      <SettingsChannels
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          await saveField({
            channels_whatsapp: form.channels_whatsapp,
            channels_whatsapp_enabled: form.channels_whatsapp_enabled,
            channels_instagram: form.channels_instagram,
            channels_instagram_enabled: form.channels_instagram_enabled,
            channels_facebook: form.channels_facebook,
            channels_facebook_enabled: form.channels_facebook_enabled,
            channels_tiktok: form.channels_tiktok,
            channels_tiktok_enabled: form.channels_tiktok_enabled,
            channels_website: form.channels_website,
            channels_website_enabled: form.channels_website_enabled,
            channels_webhook_secret: form.channels_webhook_secret,
          });
          setSaving(false);
          toast.success('הגדרות ערוצים נשמרו ✓');
        }}
      />
      <SettingsWhatsAppBot
        form={form}
        setForm={setForm}
        businessProfile={businessProfile}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          await saveField({
            bot_enabled: form.bot_enabled,
            bot_greeting: form.bot_greeting,
            bot_qualification_questions: form.bot_qualification_questions,
            bot_good_lead_criteria: form.bot_good_lead_criteria,
            bot_bad_lead_criteria: form.bot_bad_lead_criteria,
            bot_services_info: form.bot_services_info,
          });
          setSaving(false);
          toast.success('הגדרות הבוט נשמרו ✓');
        }}
      />
      <SettingsPushNotifications
        form={form}
        onToggle={(key, val) => saveField({ [key]: val })}
        onFieldChange={(key, val) => {
          setForm(f => ({ ...f, [key]: val }));
          saveField({ [key]: val });
        }}
      />
      <SettingsDataSources
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          await saveField({
            custom_keywords: form.custom_keywords,
            custom_urls: form.custom_urls,
            facebook_url: form.facebook_url,
            instagram_url: form.instagram_url,
            tiktok_url: form.tiktok_url,
            website_url: form.website_url,
            monitor_competitors_social: form.monitor_competitors_social,
          });
          setSaving(false);
          toast.success('הגדרות מקורות מידע נשמרו ✓');
        }}
      />
      <SettingsAutoRespond
        form={form}
        onToggle={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
        onFieldChange={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
      />
      <SettingsWhatsAppAlerts
        form={form}
        onToggle={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
        onFieldChange={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
      />
      <SettingsCrmSync
        form={form}
        setForm={setForm}
        businessProfile={businessProfile}
        onToggle={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
        onFieldChange={(key, val) => { setForm(f => ({ ...f, [key]: val })); saveField({ [key]: val }); }}
      />
      <SettingsSurvey
        form={form}
        setForm={setForm}
        saving={saving}
        onSave={async () => {
          setSaving(true);
          await saveField({
            survey_enabled: form.survey_enabled,
            survey_q1: form.survey_q1,
            survey_q2: form.survey_q2,
            survey_q3: form.survey_q3,
          });
          setSaving(false);
          toast.success('הגדרות סקר נשמרו ✓');
        }}
      />
      <SettingsLocations businessProfile={businessProfile} />
      <SettingsLearnBusiness businessProfile={businessProfile} />

      {/* API Credentials — WhatsApp Business + Google */}
      <ApiCredentialsCard form={form} setForm={setForm} onSave={saveField} />

      {/* Autonomy Level */}
      <AutonomySelector businessProfile={businessProfile} onSave={saveField} />

      {/* Notification Settings (ITEM 4) */}
      <div className="card-base p-5">
        <h2 className="text-[14px] font-semibold text-foreground mb-1">🔔 התראות WhatsApp ומייל</h2>
        <p className="text-[11px] text-foreground-muted mb-4">הגדר לאיפה לשלוח התראות על אירועים חשובים</p>
        <NotificationSettings businessId={businessProfile?.id} />
      </div>
      <SettingsAlerts form={form} onToggle={(key, val) => saveField({ [key]: val })} />

      <AiInsightBox
        title="בדיקת הגדרות חכמה — המלצות AI"
        prompt={`אתה יועץ הגדרות מערכת OTX. בדוק את הגדרות העסק "${form.name}" (${form.category}, ${form.city}):
- טון: ${form.tone_preference}, שוק יעד: ${form.target_market || 'לא הוגדר'}
- תקציב מינימום: ${form.min_budget || 'לא הוגדר'}, שירותים: ${form.relevant_services || 'לא הוגדר'}
- ערוצים מופעלים: ${[form.channels_whatsapp_enabled && 'WhatsApp', form.channels_instagram_enabled && 'Instagram', form.channels_facebook_enabled && 'Facebook', form.channels_tiktok_enabled && 'TikTok', form.channels_website_enabled && 'אתר'].filter(Boolean).join(', ') || 'אין'}
- בוט: ${form.bot_enabled ? 'פעיל' : 'לא פעיל'}, התראות push: ${form.push_email_alerts ? 'מייל' : ''} ${form.push_whatsapp_alerts ? 'WhatsApp' : ''}
זהה הגדרות חסרות או לא אופטימליות, והצע 3-5 שיפורים ספציפיים. בעברית, Markdown.`}
      />
    </div>
  );
}