/**
 * OrganizationSettings — manage members + branches for the current org.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { orgApi } from '@/api/orgApi';
import { toast } from 'sonner';
import {
  Users, GitBranch, Plus, Trash2, Crown, Shield, User, MapPin,
  Loader2, Copy, Check, Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_OPTIONS = [
  { value: 'admin',          label: 'מנהל',       desc: 'גישה מלאה לכל הסניפים והגדרות' },
  { value: 'content_editor', label: 'עורך תוכן',  desc: 'יוצר פוסטים, קמפיינים ומשימות' },
  { value: 'viewer',         label: 'צופה',        desc: 'קריאה בלבד — ללא עריכה' },
];

const ROLE_LABELS = {
  owner:          'בעלים',
  admin:          'מנהל',
  content_editor: 'עורך תוכן',
  manager:        'מנהל סניף',  // legacy
  viewer:         'צופה',
};

const ROLE_ICONS  = { owner: Crown, admin: Shield, content_editor: User, manager: User, viewer: User };

const ROLE_COLORS = {
  owner:          'bg-amber-50 text-amber-700 border-amber-200',
  admin:          'bg-blue-50 text-blue-700 border-blue-200',
  content_editor: 'bg-purple-50 text-purple-700 border-purple-200',
  manager:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  viewer:         'bg-secondary/50 text-foreground-secondary border-border',
};

function RoleBadge({ role }) {
  const Icon = ROLE_ICONS[role] || User;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border',
      ROLE_COLORS[role] || ROLE_COLORS.viewer,
    )}>
      <Icon className="w-3 h-3" />
      {ROLE_LABELS[role] || role}
    </span>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="flex items-center gap-1 text-[11px] text-primary hover:opacity-70 transition-all"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'הועתק' : 'העתק'}
    </button>
  );
}

export default function OrganizationSettings() {
  const qc = useQueryClient();
  const { currentOrg, refetch: refetchOrgs } = useOrganization();
  const [tab, setTab] = useState('members');

  // ── Members state ──
  const [inviteEmail,   setInviteEmail]   = useState('');
  const [inviteRole,    setInviteRole]    = useState('content_editor');
  const [inviteLink,    setInviteLink]    = useState(null);

  // ── Branch state ──
  const [branchName,    setBranchName]    = useState('');
  const [branchDisplay, setBranchDisplay] = useState('');
  const [branchCity,    setBranchCity]    = useState('');
  const [branchCat,     setBranchCat]     = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone,   setBranchPhone]   = useState('');
  const [branchWebsite, setBranchWebsite] = useState('');
  const [branchDesc,    setBranchDesc]    = useState('');
  const [branchPlaceId, setBranchPlaceId] = useState('');

  const orgId = currentOrg?.id;

  const { data: orgData, isLoading } = useQuery({
    queryKey: ['org', orgId],
    queryFn: () => orgApi.getOrg(orgId),
    enabled: !!orgId,
  });

  const members  = orgData?.members  || [];
  const branches = currentOrg?.branches || [];

  const inviteMut = useMutation({
    mutationFn: () => orgApi.addMember(orgId, {
      email:        inviteEmail,
      role:         inviteRole,
      inviter_name: currentOrg?.name || 'מנהל הארגון',
    }),
    onSuccess: (data) => {
      if (data?.emailSent) {
        toast.success(`מייל הזמנה נשלח ל-${inviteEmail}`);
      } else {
        toast.success('הוזמן בהצלחה — שתף את הקישור ידנית');
      }
      if (data?.inviteLink) setInviteLink(data.inviteLink);
      setInviteEmail('');
      qc.invalidateQueries({ queryKey: ['org', orgId] });
      refetchOrgs();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMemberMut = useMutation({
    mutationFn: (userId) => orgApi.removeMember(orgId, userId),
    onSuccess: () => { toast.success('הוסר'); qc.invalidateQueries({ queryKey: ['org', orgId] }); },
    onError: (e) => toast.error(e.message),
  });

  const createBranchMut = useMutation({
    mutationFn: () => orgApi.createBranch(orgId, {
      name:                branchName,
      city:                branchCity,
      category:            branchCat,
      branch_display_name: branchDisplay || branchName,
      full_address:        branchAddress || undefined,
      phone:               branchPhone   || undefined,
      website_url:         branchWebsite || undefined,
      description:         branchDesc    || undefined,
      google_place_id:     branchPlaceId || undefined,
    }),
    onSuccess: () => {
      toast.success('סניף נוצר');
      setBranchName(''); setBranchDisplay(''); setBranchCity(''); setBranchCat('');
      setBranchAddress(''); setBranchPhone(''); setBranchWebsite('');
      setBranchDesc(''); setBranchPlaceId('');
      refetchOrgs();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteBranchMut = useMutation({
    mutationFn: (branchId) => orgApi.deleteBranch(orgId, branchId),
    onSuccess: () => { toast.success('סניף הושבת'); refetchOrgs(); },
    onError: (e) => toast.error(e.message),
  });

  if (!currentOrg) return (
    <div className="p-8 text-center text-foreground-muted text-[13px]">אין ארגון פעיל</div>
  );

  const inputCls = 'w-full px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right';

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h2 className="text-[20px] font-bold text-foreground">{currentOrg.name}</h2>
        <p className="text-[13px] text-foreground-muted mt-0.5">ניהול חברים וסניפים</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
        {[
          { id: 'members',  label: 'חברים',  icon: Users },
          { id: 'branches', label: 'סניפים', icon: GitBranch },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-all',
              tab === id ? 'bg-card text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Members Tab ── */}
      {tab === 'members' && (
        <div className="space-y-4">
          {/* Invite form */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-semibold text-foreground">הזמן חבר חדש</h3>

            {/* Role picker */}
            <div className="grid grid-cols-3 gap-2">
              {ROLE_OPTIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setInviteRole(r.value)}
                  className={cn(
                    'px-3 py-2.5 rounded-xl border text-right transition-all',
                    inviteRole === r.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-border-hover',
                  )}
                >
                  <p className={cn('text-[12px] font-semibold', inviteRole === r.value ? 'text-primary' : 'text-foreground')}>
                    {r.label}
                  </p>
                  <p className="text-[10px] text-foreground-muted mt-0.5 leading-snug">{r.desc}</p>
                </button>
              ))}
            </div>

            {/* Email + send */}
            <div className="flex gap-2">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && inviteEmail && inviteMut.mutate()}
                placeholder="כתובת אימייל של המוזמן"
                className="flex-1 px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
                dir="ltr"
                type="email"
              />
              <button
                onClick={() => inviteMut.mutate()}
                disabled={!inviteEmail || inviteMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {inviteMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Mail className="w-3.5 h-3.5" />}
                שלח הזמנה
              </button>
            </div>

            {/* Invite link (shown after invite if email wasn't sent) */}
            {inviteLink && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-semibold text-green-700 mb-0.5">קישור הזמנה — שתף ידנית אם המייל לא הגיע</p>
                  <p className="text-[11px] text-green-600 truncate">{inviteLink}</p>
                </div>
                <CopyButton text={inviteLink} />
              </div>
            )}
          </div>

          {/* Member list */}
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {isLoading ? (
              <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-foreground-muted" /></div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-foreground-muted">אין חברים</div>
            ) : members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-[12px]">
                    {(m.email || m.user_id || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">{m.email || m.user_id}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <RoleBadge role={m.role} />
                      {m.status === 'pending' && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          ממתין
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {m.role !== 'owner' && (
                  <button
                    onClick={() => removeMemberMut.mutate(m.user_id)}
                    className="p-1.5 rounded-md hover:bg-red-50 text-foreground-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Branches Tab ── */}
      {tab === 'branches' && (
        <div className="space-y-4">
          {/* Create branch form */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-semibold text-foreground">צור סניף חדש</h3>
            <p className="text-[12px] text-foreground-muted">
              מלא כמה שיותר פרטים — הסוכנים משתמשים בהם לסריקת ביקורות, תחרות ולידים.
            </p>

            {/* Required */}
            <div className="grid grid-cols-2 gap-2">
              <input value={branchName}    onChange={e => setBranchName(e.target.value)}
                placeholder="שם העסק / סניף *" className={inputCls} />
              <input value={branchDisplay} onChange={e => setBranchDisplay(e.target.value)}
                placeholder="שם תצוגה (אופציונלי)" className={inputCls} />
              <input value={branchCity}    onChange={e => setBranchCity(e.target.value)}
                placeholder="עיר *" className={inputCls} />
              <input value={branchCat}     onChange={e => setBranchCat(e.target.value)}
                placeholder="קטגוריה (מסעדה, חדר כושר, ...) *" className={inputCls} />
            </div>

            {/* Contact + location */}
            <div className="grid grid-cols-2 gap-2">
              <input value={branchAddress} onChange={e => setBranchAddress(e.target.value)}
                placeholder="כתובת מדויקת (רחוב + מספר)" className={inputCls} />
              <input value={branchPhone}   onChange={e => setBranchPhone(e.target.value)}
                placeholder="טלפון" className={inputCls} dir="ltr" />
              <input value={branchWebsite} onChange={e => setBranchWebsite(e.target.value)}
                placeholder="אתר (https://...)" className={inputCls} dir="ltr" />
              <input value={branchPlaceId} onChange={e => setBranchPlaceId(e.target.value)}
                placeholder="Google Place ID (אופציונלי)" className={inputCls} dir="ltr" />
            </div>

            {/* Description */}
            <textarea
              value={branchDesc}
              onChange={e => setBranchDesc(e.target.value)}
              placeholder="תיאור קצר לסוכנים — מה מייחד את הסניף הזה? (מנה מיוחדת, קהל יעד, כשרות, ...)"
              rows={2}
              className={cn(inputCls, 'resize-none')}
            />

            <button
              onClick={() => createBranchMut.mutate()}
              disabled={!branchName || !branchCity || !branchCat || createBranchMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createBranchMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              + צור סניף
            </button>
          </div>

          {/* Branch list */}
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {branches.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-foreground-muted">אין סניפים</div>
            ) : branches.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">
                      {b.branch_display_name || b.name}
                    </p>
                    <p className="text-[11px] text-foreground-muted">
                      {[b.city, b.category].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`להשבית את הסניף "${b.branch_display_name || b.name}"?`)) {
                      deleteBranchMut.mutate(b.id);
                    }
                  }}
                  className="p-1.5 rounded-md hover:bg-red-50 text-foreground-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
