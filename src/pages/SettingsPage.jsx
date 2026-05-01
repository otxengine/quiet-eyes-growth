import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Save, Loader2, Zap, MapPin, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

const RADIUS_OPTIONS = [5, 10, 15, 20, 30, 50];

function SettingsSearchRadius({ businessProfile, onSave }) {
  const [radius, setRadius] = useState(businessProfile?.search_radius_km || 15);
  const [cities, setCities] = useState(businessProfile?.additional_cities || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRadius(businessProfile?.search_radius_km || 15);
    setCities(businessProfile?.additional_cities || '');
  }, [businessProfile?.search_radius_km, businessProfile?.additional_cities]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ search_radius_km: radius, additional_cities: cities });
      toast.success('טווח חיפוש עודכן ✓');
    } catch { toast.error('שגיאה בשמירה'); }
    setSaving(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-1">
        <MapPin className="w-4 h-4 text-primary" />
        <h2 className="text-[14px] font-semibold text-foreground">טווח חיפוש</h2>
      </div>
      <p className="text-[11px] text-foreground-muted mb-4">קבע עד כמה רחוק הסוכנים יחפשו לידים, מתחרים וסיגנלים</p>

      {/* Radius pills */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-foreground mb-2">רדיוס חיפוש: <span className="text-primary font-bold">{radius} ק"מ</span></p>
        <div className="flex gap-2 flex-wrap">
          {RADIUS_OPTIONS.map(r => (
            <button key={r} onClick={() => setRadius(r)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium border transition-all ${radius === r ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary text-foreground-muted border-border hover:border-foreground-muted'}`}>
              {r} ק"מ
            </button>
          ))}
        </div>
      </div>

      {/* Additional city */}
      <div className="mb-4">
        <label className="text-[11px] font-medium text-foreground block mb-1">עיר נוספת לסריקה (אופציונלי)</label>
        <input value={cities} onChange={e => setCities(e.target.value)}
          placeholder="לדוגמה: תל אביב, רמת גן"
          className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-secondary focus:outline-none focus:ring-1 focus:ring-primary" />
        <p className="text-[10px] text-foreground-muted mt-1">הפרד ערים בפסיק</p>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-medium hover:opacity-90 transition-all disabled:opacity-60">
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
        {saving ? 'שומר...' : 'שמור הגדרות טווח'}
      </button>
    </div>
  );
}

function SettingsBranches({ businessProfile, onSave }) {
  const parseBranches = () => {
    try { return JSON.parse(businessProfile?.branches || '[]'); } catch { return []; }
  };
  const [branches, setBranches] = useState(parseBranches);
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ name: '', address: '', city: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { setBranches(parseBranches()); }, [businessProfile?.branches]);

  const handleAdd = () => {
    if (!newBranch.name.trim()) return;
    const updated = [...branches, { ...newBranch, id: Date.now() }];
    setBranches(updated);
    setNewBranch({ name: '', address: '', city: '' });
    setAdding(false);
  };

  const handleRemove = (id) => setBranches(branches.filter(b => b.id !== id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ branches: JSON.stringify(branches) });
      toast.success('סניפים עודכנו ✓');
    } catch { toast.error('שגיאה בשמירה'); }
    setSaving(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          <h2 className="text-[14px] font-semibold text-foreground">סניפים</h2>
        </div>
        <button onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground transition-colors">
          <Plus className="w-3.5 h-3.5" /> הוסף סניף
        </button>
      </div>
      <p className="text-[11px] text-foreground-muted mb-4">הגדר סניפים נוספים — הסוכנים יסרקו גם עבורם</p>

      {branches.length > 0 && (
        <div className="space-y-2 mb-3">
          {branches.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-secondary border border-border">
              <div>
                <p className="text-[12px] font-medium text-foreground">{b.name}</p>
                {(b.address || b.city) && <p className="text-[10px] text-foreground-muted">{[b.address, b.city].filter(Boolean).join(', ')}</p>}
              </div>
              <button onClick={() => handleRemove(b.id)} className="text-foreground-muted hover:text-danger transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="bg-secondary/50 border border-border rounded-lg p-3 mb-3 space-y-2">
          <input value={newBranch.name} onChange={e => setNewBranch(b => ({ ...b, name: e.target.value }))}
            placeholder="שם הסניף"
            className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-white focus:outline-none focus:ring-1 focus:ring-primary" />
          <input value={newBranch.address} onChange={e => setNewBranch(b => ({ ...b, address: e.target.value }))}
            placeholder="כתובת"
            className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-white focus:outline-none focus:ring-1 focus:ring-primary" />
          <input value={newBranch.city} onChange={e => setNewBranch(b => ({ ...b, city: e.target.value }))}
            placeholder="עיר"
            className="w-full border border-border rounded-lg px-3 py-2 text-[12px] bg-white focus:outline-none focus:ring-1 focus:ring-primary" />
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1.5 bg-primary text-white rounded-lg text-[11px] font-medium hover:opacity-90 transition-all">הוסף</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-[11px] font-medium text-foreground-muted hover:text-foreground transition-colors">בטל</button>
          </div>
        </div>
      )}

      {branches.length > 0 && (
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-medium hover:opacity-90 transition-all disabled:opacity-60">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saving ? 'שומר...' : 'שמור סניפים'}
        </button>
      )}
    </div>
  );
}

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
import SettingsChannels from '@/components/settings/SettingsChannels';
import SettingsDataSources from '@/components/settings/SettingsDataSources.jsx';
import SettingsAutoRespond from '@/components/settings/SettingsAutoRespond.jsx';

export default function SettingsPage() {
  const { businessProfile } = useOutletContext();
  const [form, setForm] = useState({
    name: '', category: '', city: '', full_address: '', description: '', target_market: '',
    tone_preference: 'friendly', min_budget: '', relevant_services: '', preferred_area: '',
    lead_intent_signals: '', lead_quality_notes: '',
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
        lead_intent_signals: businessProfile.lead_intent_signals || '', lead_quality_notes: businessProfile.lead_quality_notes || '',
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
      <SettingsLeadCriteria form={form} setForm={setForm} onSave={() => saveField({ min_budget: form.min_budget, relevant_services: form.relevant_services, preferred_area: form.preferred_area, lead_intent_signals: form.lead_intent_signals, lead_quality_notes: form.lead_quality_notes })} />
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

      {/* Autonomy Level */}
      <AutonomySelector businessProfile={businessProfile} onSave={saveField} />

      {/* Search Radius */}
      <SettingsSearchRadius businessProfile={businessProfile} onSave={saveField} />

      {/* Branches */}
      <SettingsBranches businessProfile={businessProfile} onSave={saveField} />

      <SettingsAlerts form={form} onToggle={(key, val) => saveField({ [key]: val })} />
    </div>
  );
}