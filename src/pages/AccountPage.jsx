/**
 * AccountPage — "החשבון שלי"
 * Three tabs: מידע אישי | פרטי חיוב ותשלומים | אבטחת החשבון
 */

import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { stripeApi } from '@/api/stripeApi';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ChevronDown, Download, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

// ── Shared: section card ──────────────────────────────────────────────────────
function SectionCard({ title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section-card">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        <div className="text-right">
          <h2 className="text-[18px] font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-[13px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Shared: toggle ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors flex-shrink-0 ${checked ? 'bg-emerald-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </div>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'personal', label: 'פרטים אישיים' },
  { key: 'billing',  label: 'חיוב ותשלומים' },
  { key: 'security', label: 'אבטחת חשבון' },
];

// ── Tab 1: מידע אישי ──────────────────────────────────────────────────────────
const NOTIF_ITEMS = [
  { key: 'weekly_report',        label: 'דוח שבועי',          desc: 'קבל סיכום שבועי עם תובנות מרכזיות' },
  { key: 'hot_lead_alerts',      label: 'התראות לידים חמים',  desc: 'קבל התראה מיידית כשמגיע ליד חם' },
  { key: 'monthly_summary',      label: 'סיכום חודשי',        desc: 'קבל סיכום חודשי עם תובנות מרכזיות' },
  { key: 'push_email_alerts',    label: 'התראות במייל',       desc: 'קבל סיכום שבועי עם תובנות מרכזיות' },
  { key: 'push_whatsapp_alerts', label: 'התראות בוואטסאפ',   desc: 'קבל סיכום שבועי עם תובנות מרכזיות' },
];

function PersonalTab({ businessProfile, saveField }) {
  const { user } = useUser();
  const [personalForm, setPersonalForm] = useState({ firstName: '', lastName: '', idNumber: '', birthDate: '' });
  const [contactForm,  setContactForm]  = useState({ email: '', phone: '' });
  const [notifications, setNotifications] = useState({
    weekly_report: true, hot_lead_alerts: true, monthly_summary: false,
    push_email_alerts: false, push_whatsapp_alerts: false,
  });
  const [savingPersonal,  setSavingPersonal]  = useState(false);
  const [savingContact,   setSavingContact]   = useState(false);
  const [savingNotif,     setSavingNotif]     = useState(false);

  useEffect(() => {
    if (user) {
      setPersonalForm(f => ({ ...f, firstName: user.firstName || '', lastName: user.lastName || '' }));
      setContactForm(f => ({ ...f, email: user.primaryEmailAddress?.emailAddress || '' }));
    }
    if (businessProfile) {
      setNotifications({
        weekly_report:        businessProfile.weekly_report !== false,
        hot_lead_alerts:      businessProfile.hot_lead_alerts !== false,
        monthly_summary:      businessProfile.monthly_summary === true,
        push_email_alerts:    businessProfile.push_email_alerts === true,
        push_whatsapp_alerts: businessProfile.push_whatsapp_alerts === true,
      });
      setContactForm(f => ({ ...f, phone: businessProfile.push_whatsapp_number || '' }));
    }
  }, [user, businessProfile]);

  const savePersonal = async () => {
    setSavingPersonal(true);
    try {
      await user.update({ firstName: personalForm.firstName, lastName: personalForm.lastName });
      toast.success('הפרטים האישיים עודכנו ✓');
    } catch { toast.error('שגיאה בעדכון'); }
    setSavingPersonal(false);
  };

  const saveContact = async () => {
    setSavingContact(true);
    try {
      await saveField({ push_whatsapp_number: contactForm.phone });
      toast.success('פרטי התקשרות עודכנו ✓');
    } catch { toast.error('שגיאה בעדכון'); }
    setSavingContact(false);
  };

  const saveNotifications = async () => {
    setSavingNotif(true);
    try {
      await saveField({
        weekly_report: notifications.weekly_report,
        hot_lead_alerts: notifications.hot_lead_alerts,
        monthly_summary: notifications.monthly_summary,
        push_email_alerts: notifications.push_email_alerts,
        push_whatsapp_alerts: notifications.push_whatsapp_alerts,
      });
      toast.success('הגדרות התראות עודכנו ✓');
    } catch { toast.error('שגיאה בעדכון'); }
    setSavingNotif(false);
  };

  return (
    <div className="space-y-4">
      {/* Personal details */}
      <SectionCard title="פרטים אישיים" subtitle="פרטים שישמשו אותנו כדי לפנות אליך">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 mb-5">
          {[
            { key: 'firstName', label: 'שם פרטי *',       placeholder: 'שם פרטי' },
            { key: 'lastName',  label: 'שם משפחה *',       placeholder: 'שם משפחה' },
            { key: 'idNumber',  label: 'ת.ז *',            placeholder: 'מספר ת.ז' },
            { key: 'birthDate', label: 'תאריך לידה *',     placeholder: '', type: 'date' },
          ].map(({ key, label, placeholder, type = 'text' }) => (
            <div key={key}>
              <label className="block text-[12px] text-gray-500 mb-2">{label}</label>
              <input
                type={type}
                value={personalForm[key]}
                onChange={e => setPersonalForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="input-underline"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-start">
          <button onClick={savePersonal} disabled={savingPersonal} className="btn-pill">
            {savingPersonal && <Loader2 className="w-3 h-3 animate-spin" />}
            עדכון
          </button>
        </div>
      </SectionCard>

      {/* Contact details */}
      <SectionCard title="פרטי התקשרות" subtitle="החלפת שם משתמש ניד טלפון נייד דורשת אימות במייל/SMS">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 mb-5">
          <div>
            <label className="block text-[12px] text-gray-500 mb-2">מייל *</label>
            <input value={contactForm.email} readOnly className="input-underline opacity-50 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-[12px] text-gray-500 mb-2">טלפון *</label>
            <input
              value={contactForm.phone}
              onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="050-0000000"
              className="input-underline"
            />
          </div>
        </div>
        <div className="flex justify-start">
          <button onClick={saveContact} disabled={savingContact} className="btn-pill">
            {savingContact && <Loader2 className="w-3 h-3 animate-spin" />}
            עדכון
          </button>
        </div>
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="הגדרת התראות" subtitle="כאן מגדירים אילו התראות יוצאות על ידי המערכת">
        <div className="space-y-0 mb-5">
          {NOTIF_ITEMS.map((item, i) => (
            <div
              key={item.key}
              className={`flex items-center justify-between py-3.5 ${i < NOTIF_ITEMS.length - 1 ? 'border-b border-gray-100' : ''}`}
            >
              <Toggle checked={notifications[item.key]} onChange={v => setNotifications(n => ({ ...n, [item.key]: v }))} />
              <div className="text-right mr-4">
                <p className="text-[14px] font-semibold text-gray-900">{item.label}</p>
                <p className="text-[12px] text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-start">
          <button onClick={saveNotifications} disabled={savingNotif} className="btn-pill">
            {savingNotif && <Loader2 className="w-3 h-3 animate-spin" />}
            עדכון
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Tab 2: פרטי חיוב ─────────────────────────────────────────────────────────
function BillingTab({ businessProfile, saveField }) {
  const { currentOrg, allBranches } = useOrganization();
  const orgId    = currentOrg?.id;
  const branchCount = Math.max(1, allBranches?.length || 1);
  const [billingForm, setBillingForm] = useState({ bizName: '', taxId: '', billingEmail: '' });
  const [savingBilling, setSavingBilling] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: subData } = useQuery({
    queryKey: ['stripeStatus', orgId],
    queryFn: () => stripeApi.getStatus(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (businessProfile) {
      setBillingForm({
        bizName:      businessProfile.name || '',
        taxId:        businessProfile.tax_id || '',
        billingEmail: businessProfile.billing_email || '',
      });
    }
  }, [businessProfile]);

  const handlePortal = async () => {
    if (window.self !== window.top) { alert('ניהול תשלום זמין רק מחלון נפרד'); return; }
    setPortalLoading(true);
    try {
      const result = await stripeApi.portal(orgId, window.location.origin + '/account');
      if (result.url) window.location.href = result.url;
    } catch (e) { toast.error(e.message || 'שגיאה'); }
    setPortalLoading(false);
  };

  const saveBilling = async () => {
    setSavingBilling(true);
    try {
      await saveField({ billing_email: billingForm.billingEmail, tax_id: billingForm.taxId });
      toast.success('פרטי חיוב עודכנו ✓');
    } catch { toast.error('שגיאה'); }
    setSavingBilling(false);
  };

  const currentPlan = subData?.plan || currentOrg?.plan_id || 'free_trial';
  const nextBilling = subData?.currentPeriodEnd
    ? new Date(subData.currentPeriodEnd * 1000).toLocaleDateString('he-IL')
    : '—';
  const invoices = subData?.invoices || [];

  return (
    <div className="space-y-4">
      {/* Current plan */}
      <SectionCard title="המסלול שלי" subtitle={`שם המסלול - ${currentPlan}`}>
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
          <table className="w-full" dir="rtl">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['תאריך', 'מתחדש בתאריך', 'מחזור חיוב', 'עסקים פעילים בחשבון'].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-[12px] font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-3 text-[13px] text-gray-700">{new Date().toLocaleDateString('he-IL')}</td>
                <td className="px-4 py-3 text-[13px] text-gray-700">{nextBilling}</td>
                <td className="px-4 py-3 text-[13px] text-gray-700">חודשי</td>
                <td className="px-4 py-3 text-[13px] text-gray-700">{branchCount}/{branchCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex justify-start">
          <button onClick={handlePortal} disabled={portalLoading} className="btn-pill">
            {portalLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            ניהול המנוי
          </button>
        </div>
      </SectionCard>

      {/* Billing details */}
      <SectionCard title="פרטי חיוב לצורך חשבוניות" subtitle="">
        <div className="grid grid-cols-3 gap-x-8 gap-y-6 mb-5">
          <div>
            <label className="block text-[12px] text-gray-500 mb-2">שם העסק *</label>
            <input
              value={billingForm.bizName}
              onChange={e => setBillingForm(f => ({ ...f, bizName: e.target.value }))}
              placeholder="שם העסק"
              className="input-underline"
            />
          </div>
          <div>
            <label className="block text-[12px] text-gray-500 mb-2">מספר ע.מ / ח.פ *</label>
            <input
              value={billingForm.taxId}
              onChange={e => setBillingForm(f => ({ ...f, taxId: e.target.value }))}
              placeholder="מספר עוסק"
              className="input-underline"
            />
          </div>
          <div>
            <label className="block text-[12px] text-gray-500 mb-2">מייל *</label>
            <input
              value={billingForm.billingEmail}
              onChange={e => setBillingForm(f => ({ ...f, billingEmail: e.target.value }))}
              placeholder="billing@example.com"
              className="input-underline"
            />
          </div>
        </div>
        <div className="flex justify-start">
          <button onClick={saveBilling} disabled={savingBilling} className="btn-pill">
            {savingBilling && <Loader2 className="w-3 h-3 animate-spin" />}
            עדכון
          </button>
        </div>
      </SectionCard>

      {/* Invoices */}
      <SectionCard title="חשבוניות" subtitle="כרטיסי האשראי משמשים עבור חיובים בחשבון">
        {invoices.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-right py-3">אין חשבוניות עדיין</p>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full" dir="rtl">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['מס חשבון', 'תאריך', 'תיאור', 'חשבונית על שם', 'סכום', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-right text-[12px] font-semibold text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-[12px] text-gray-700">{inv.number || String(111111 + i)}</td>
                    <td className="px-4 py-3 text-[12px] text-gray-700">{new Date(inv.date * 1000).toLocaleDateString('he-IL')}</td>
                    <td className="px-4 py-3 text-[12px] text-gray-700">חשבון חודשי</td>
                    <td className="px-4 py-3 text-[12px] text-gray-700">{billingForm.bizName || '—'}</td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-gray-900">₪{(inv.amount / 100).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      {inv.url && (
                        <a href={inv.url} target="_blank" rel="noopener noreferrer"
                          className="text-gray-400 hover:text-[#e8344d] transition-colors">
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Tab 3: אבטחת החשבון ───────────────────────────────────────────────────────
function SecurityTab() {
  const { user } = useUser();
  const [pwForm, setPwForm]   = useState({ current: '', newPw: '', confirm: '' });
  const [showPw, setShowPw]   = useState({ current: false, newPw: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);

  const changePassword = async () => {
    if (pwForm.newPw !== pwForm.confirm) { toast.error('הסיסמאות אינן תואמות'); return; }
    if (pwForm.newPw.length < 8) { toast.error('סיסמה חייבת להכיל לפחות 8 תווים'); return; }
    setSavingPw(true);
    try {
      await user.updatePassword({ currentPassword: pwForm.current, newPassword: pwForm.newPw });
      setPwForm({ current: '', newPw: '', confirm: '' });
      toast.success('הסיסמה עודכנה בהצלחה ✓');
    } catch (e) {
      toast.error(e.errors?.[0]?.message || 'שגיאה בעדכון הסיסמה');
    }
    setSavingPw(false);
  };

  const PW_FIELDS = [
    { key: 'current', label: 'סיסמה נוכחית *' },
    { key: 'newPw',   label: 'סיסמה חדשה *' },
    { key: 'confirm', label: 'אימות סיסמה חדשה *' },
  ];

  const hasPassword = user?.passwordEnabled !== false;

  return (
    <div className="space-y-4">
      {/* Password */}
      <SectionCard title="עדכון סיסמת כניסה" subtitle="">
        {!hasPassword ? (
          <p className="text-[13px] text-gray-500 py-1">
            החשבון שלך מחובר דרך Google / OAuth — אין סיסמת כניסה ישירה.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-x-8 gap-y-6 mb-5">
              {PW_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[12px] text-gray-500 mb-2">{label}</label>
                  <div className="relative">
                    <input
                      type={showPw[key] ? 'text' : 'password'}
                      value={pwForm[key]}
                      onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="••••••••"
                      className="input-underline pl-7"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(s => ({ ...s, [key]: !s[key] }))}
                      className="absolute left-0 bottom-2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPw[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-start">
              <button onClick={changePassword} disabled={savingPw} className="btn-pill">
                {savingPw && <Loader2 className="w-3 h-3 animate-spin" />}
                עדכון
              </button>
            </div>
          </>
        )}
      </SectionCard>

      {/* 2FA */}
      <SectionCard title="אימות דו שלבי" subtitle="">
        <div
          className="rounded-xl p-4 mb-5"
          style={{ background: 'linear-gradient(135deg, rgba(156,39,176,0.07) 0%, rgba(232,52,77,0.04) 100%)' }}
        >
          <p className="text-[15px] font-bold text-gray-900 text-right mb-1.5">
            אימות דו שלבי {user?.twoFactorEnabled ? 'פעיל' : 'לא פעיל'} בכניסה לחשבון
          </p>
          <p className="text-[13px] text-gray-600 text-right leading-relaxed">
            לאחר התחברות עם סיסמה יש להזין את קוד האימות בשיטה שיישלח בה.
            ניתן לשנות את אמצעי האימות בכל עת על ידי לחיצה על הכפתור.
          </p>
        </div>
        <div className="flex justify-start">
          <button className="btn-pill">
            עדכון אמצעי אימות
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    return TABS.some(t => t.key === tab) ? tab : 'personal';
  });

  const saveField = async (partial) => {
    if (!businessProfile?.id) return;
    await base44.entities.BusinessProfile.update(businessProfile.id, partial);
    queryClient.invalidateQueries({ queryKey: ['businessProfiles'] });
  };

  return (
    <div className="max-w-2xl space-y-5" dir="rtl">
      {/* Header */}
      <div className="text-right">
        <h1 className="text-[22px] font-bold text-gray-900">החשבון שלי</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-end gap-0 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-[13px] font-medium transition-all ${
              activeTab === tab.key
                ? 'text-gray-900 border-b-2 border-gray-900 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'personal' && <PersonalTab businessProfile={businessProfile} saveField={saveField} />}
      {activeTab === 'billing'  && <BillingTab  businessProfile={businessProfile} saveField={saveField} />}
      {activeTab === 'security' && <SecurityTab />}
    </div>
  );
}
