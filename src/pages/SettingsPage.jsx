import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Save, Loader2, Zap, MapPin, Plus, X, ShieldAlert, RefreshCw } from 'lucide-react';
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
      <p className="text-[11px] text-foreground-muted mb-4">קבע באיזה טווח מהעסק הסוכנים יחפשו מתחרים</p>

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
        <label className="text-[11px] font-medium text-foreground block mb-1">ערים נוספות לחיפוש מתחרים (אופציונלי)</label>
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
    desc: 'הסוכנים מציעים פעולות — ואם לא דחית, מבצעים אותן אוטומטית אחרי 2–24 שעות, לפי סוג הפעולה.',
    color: '#d97706',
  },
  {
    value: 'full_auto',
    label: 'מלא אוטומטי',
    desc: 'הסוכנים פועלים מיד — שליחת WhatsApp ופרסום תוכן, בלי לחכות לאישורך.',
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
        קבע אילו פעולות הסוכנים מבצעים בלי לחכות לאישורך. תגובות לביקורות ופניות ללידים תמיד ממתינות לאישורך, בכל רמה.
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
import SettingsDataSources from '@/components/settings/SettingsDataSources.jsx';
import SettingsAutoRespond from '@/components/settings/SettingsAutoRespond.jsx';
import SettingsWhatsAppBot from '@/components/settings/SettingsWhatsAppBot';
import SettingsLearnBusiness from '@/components/settings/SettingsLearnBusiness';

function ConstraintsSection({ businessProfileId }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [newKw, setNewKw] = useState('');

  const { data: res } = useQuery({
    queryKey: ['businessConstraints', businessProfileId],
    queryFn: () => base44.functions.invoke('getBusinessConstraints', { businessProfileId }),
    enabled: !!businessProfileId,
  });

  const constraints = res?.constraints || {};

  const [form, setForm] = useState({
    prohibited_keywords:    [],
    max_discount_pct:       50,
    allow_competitor_mention: false,
    posting_hours_start:    8,
    posting_hours_end:      22,
    budget_cap_daily_ils:   500,
    min_confidence_auto:    85,
    min_confidence_suggest: 60,
  });

  useEffect(() => {
    if (constraints?.id) {
      setForm({
        prohibited_keywords:    JSON.parse(constraints.prohibited_keywords || '[]'),
        max_discount_pct:       constraints.max_discount_pct ?? 50,
        allow_competitor_mention: constraints.allow_competitor_mention ?? false,
        posting_hours_start:    constraints.posting_hours_start ?? 8,
        posting_hours_end:      constraints.posting_hours_end ?? 22,
        budget_cap_daily_ils:   constraints.budget_cap_daily_ils ?? 500,
        min_confidence_auto:    constraints.min_confidence_auto ?? 85,
        min_confidence_suggest: constraints.min_confidence_suggest ?? 60,
      });
    }
  }, [constraints?.id]);

  const addKeyword = () => {
    const kw = newKw.trim();
    if (!kw || form.prohibited_keywords.includes(kw)) return;
    setForm(f => ({ ...f, prohibited_keywords: [...f.prohibited_keywords, kw] }));
    setNewKw('');
  };

  const removeKeyword = (kw) => {
    setForm(f => ({ ...f, prohibited_keywords: f.prohibited_keywords.filter(k => k !== kw) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.functions.invoke('updateBusinessConstraints', { businessProfileId, ...form });
      queryClient.invalidateQueries({ queryKey: ['businessConstraints'] });
      toast.success('הגבלות עודכנו ✓');
    } catch { toast.error('שגיאה בשמירה'); }
    setSaving(false);
  };

  return (
    <div className="card-base p-5 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-orange-500" />
        <h2 className="text-[14px] font-semibold text-foreground">מילים אסורות בתוכן</h2>
      </div>
      <p className="text-[11px] text-foreground-muted -mt-3">
        מילים אלה יוסרו אוטומטית מטיוטות תגובה לביקורות ומהודעות WhatsApp שהסוכנים כותבים
      </p>

      {/* Prohibited keywords */}
      <div>
        <label className="text-[11px] font-medium text-foreground block mb-2">מילות מפתח אסורות בתוכן</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {form.prohibited_keywords.map(kw => (
            <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[11px] text-red-700">
              {kw}
              <button onClick={() => removeKeyword(kw)} className="hover:text-red-900 transition-colors">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKw}
            onChange={e => setNewKw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addKeyword()}
            placeholder="הוסף מילה..."
            className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-[12px] bg-secondary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button onClick={addKeyword}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-foreground text-background text-[11px] font-medium">
            <Plus className="w-3 h-3" /> הוסף
          </button>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-[11px] font-medium hover:opacity-90 disabled:opacity-60 transition-all">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        שמור מילים אסורות
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { businessProfile } = useOutletContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    bot_working_hours_start: '09:00', bot_working_hours_end: '20:00', bot_off_hours_message: '',
    channels_whatsapp: '', channels_whatsapp_enabled: false,
    channels_instagram: '', channels_instagram_enabled: false,
    channels_facebook: '', channels_facebook_enabled: false,
    channels_website: '', channels_website_enabled: false,
    channels_webhook_secret: '',
    custom_keywords: '', custom_urls: '',
    facebook_url: '', instagram_url: '', website_url: '',
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
        channels_website: businessProfile.channels_website || '',
        channels_website_enabled: businessProfile.channels_website_enabled === true,
        channels_webhook_secret: businessProfile.channels_webhook_secret || '',
        custom_keywords: businessProfile.custom_keywords || '',
        custom_urls: businessProfile.custom_urls || '',
        facebook_url: businessProfile.facebook_url || '',
        instagram_url: businessProfile.instagram_url || '',
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
        // Same defaults the time inputs display, so what's shown is what gets saved
        bot_working_hours_start: businessProfile.bot_working_hours_start || '09:00',
        bot_working_hours_end: businessProfile.bot_working_hours_end || '20:00',
        bot_off_hours_message: businessProfile.bot_off_hours_message || '',
      });
    }
  }, [businessProfile]);

  const saveField = async (partial) => {
    if (!businessProfile?.id) return;
    setForm(f => ({ ...f, ...partial }));
    try {
      await base44.entities.BusinessProfile.update(businessProfile.id, partial);
      queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
    } catch (err) {
      toast.error('שגיאה בשמירה: ' + (err.message || 'נסה שוב'));
    }
  };

  const handleSaveAll = async () => {
    if (!businessProfile?.id) return;
    setSaving(true);
    try {
      await base44.entities.BusinessProfile.update(businessProfile.id, form);
      queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
      toast.success('ההגדרות נשמרו בהצלחה');
    } catch (err) {
      toast.error('שגיאה בשמירה: ' + (err.message || 'נסה שוב'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-[16px] font-bold text-foreground tracking-tight">הגדרות</h1>

      <div className="card-base p-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">תהליך קליטה (Onboarding)</h2>
          <p className="text-[11px] text-foreground-muted mt-0.5">בצע מחדש את תהליך הקליטה כדי ליצור פרופיל עסקי חדש</p>
        </div>
        <button
          onClick={() => navigate('/onboarding')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-border text-[11px] font-medium text-foreground-muted hover:text-foreground transition-colors flex-shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> בצע קליטה מחדש
        </button>
      </div>

      <SettingsBusinessDetails form={form} setForm={setForm} onSave={handleSaveAll} saving={saving} />
      {businessProfile?.id && (
        <SettingsLearnBusiness businessProfile={businessProfile} onApproved={() => queryClient.invalidateQueries({ queryKey: ['businessProfiles'] })} />
      )}
      <SettingsTone form={form} onToneChange={(tone) => { setForm({ ...form, tone_preference: tone }); saveField({ tone_preference: tone }); toast.success('הטון עודכן ✓'); }} />
      <SettingsLeadCriteria form={form} setForm={setForm} onSave={() => saveField({ min_budget: form.min_budget, relevant_services: form.relevant_services, preferred_area: form.preferred_area, lead_intent_signals: form.lead_intent_signals, lead_quality_notes: form.lead_quality_notes })} />
      <SettingsWhatsAppBot
        form={form}
        setForm={setForm}
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
            bot_working_hours_start: form.bot_working_hours_start,
            bot_working_hours_end: form.bot_working_hours_end,
            bot_off_hours_message: form.bot_off_hours_message,
          });
          setSaving(false);
          toast.success('הגדרות בוט נשמרו ✓');
        }}
        businessProfile={businessProfile}
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
      />

      {/* Autonomy Level */}
      <AutonomySelector businessProfile={businessProfile} onSave={saveField} />

      {/* Search Radius */}
      <SettingsSearchRadius businessProfile={businessProfile} onSave={saveField} />

      {/* OTX-004: Constraint-based validation settings */}
      <ConstraintsSection businessProfileId={businessProfile?.id} />
    </div>
  );
}