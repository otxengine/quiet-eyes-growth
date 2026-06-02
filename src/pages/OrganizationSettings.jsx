/**
 * OrganizationSettings — manage members + branches for the current org.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/contexts/OrganizationContext';
import { orgApi } from '@/api/orgApi';
import { toast } from 'sonner';
import { Users, GitBranch, Plus, Trash2, Crown, Shield, User, MapPin, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ROLE_LABELS = { owner: 'בעלים', admin: 'מנהל', manager: 'סניף', viewer: 'צופה' };
const ROLE_ICONS  = { owner: Crown, admin: Shield, manager: User, viewer: User };

function RoleBadge({ role }) {
  const Icon = ROLE_ICONS[role] || User;
  const colors = {
    owner:   'bg-amber-50 text-amber-700 border-amber-200',
    admin:   'bg-blue-50 text-blue-700 border-blue-200',
    manager: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    viewer:  'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border', colors[role] || colors.viewer)}>
      <Icon className="w-3 h-3" />
      {ROLE_LABELS[role] || role}
    </span>
  );
}

export default function OrganizationSettings() {
  const qc = useQueryClient();
  const { currentOrg, refetch: refetchOrgs } = useOrganization();
  const [tab, setTab] = useState('members');

  // Members
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('manager');

  // Branches
  const [newBranchName,    setNewBranchName]    = useState('');
  const [newBranchCity,    setNewBranchCity]    = useState('');
  const [newBranchCat,     setNewBranchCat]     = useState('');
  const [newBranchDisplay, setNewBranchDisplay] = useState('');

  const orgId = currentOrg?.id;

  const { data: orgData, isLoading } = useQuery({
    queryKey: ['org', orgId],
    queryFn: () => orgApi.getOrg(orgId),
    enabled: !!orgId,
  });

  const members  = orgData?.members  || [];
  const branches = currentOrg?.branches || [];

  const inviteMut = useMutation({
    mutationFn: () => orgApi.addMember(orgId, { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      toast.success('הוזמן בהצלחה');
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
      name: newBranchName, city: newBranchCity,
      category: newBranchCat, branch_display_name: newBranchDisplay || newBranchName,
    }),
    onSuccess: () => {
      toast.success('סניף נוצר');
      setNewBranchName(''); setNewBranchCity(''); setNewBranchCat(''); setNewBranchDisplay('');
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

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-[20px] font-bold text-foreground">{currentOrg.name}</h2>
        <p className="text-[13px] text-foreground-muted mt-0.5">ניהול חברים וסניפים</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl w-fit">
        {[
          { id: 'members', label: 'חברים', icon: Users },
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

      {/* Members Tab */}
      {tab === 'members' && (
        <div className="space-y-4">
          {/* Invite form */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-semibold text-foreground">הזמן חבר חדש</h3>
            <div className="flex gap-2">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="כתובת אימייל"
                className="flex-1 px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
                dir="ltr"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none"
              >
                <option value="admin">מנהל</option>
                <option value="manager">סניף</option>
                <option value="viewer">צופה</option>
              </select>
              <button
                onClick={() => inviteMut.mutate()}
                disabled={!inviteEmail || inviteMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {inviteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                הזמן
              </button>
            </div>
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
                    <RoleBadge role={m.role} />
                  </div>
                </div>
                {m.role !== 'owner' && (
                  <button
                    onClick={() => removeMemberMut.mutate(m.user_id)}
                    className="p-1.5 rounded-md hover:bg-danger/10 text-foreground-muted hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branches Tab */}
      {tab === 'branches' && (
        <div className="space-y-4">
          {/* Create branch form */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-[14px] font-semibold text-foreground">צור סניף חדש</h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                placeholder="שם העסק / סניף"
                className="px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
              />
              <input
                value={newBranchDisplay}
                onChange={e => setNewBranchDisplay(e.target.value)}
                placeholder="שם תצוגה (אופציונלי)"
                className="px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
              />
              <input
                value={newBranchCity}
                onChange={e => setNewBranchCity(e.target.value)}
                placeholder="עיר"
                className="px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
              />
              <input
                value={newBranchCat}
                onChange={e => setNewBranchCat(e.target.value)}
                placeholder="קטגוריה (מסעדה, חדר כושר, ...)"
                className="px-3 py-2 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right"
              />
            </div>
            <button
              onClick={() => createBranchMut.mutate()}
              disabled={!newBranchName || !newBranchCity || !newBranchCat || createBranchMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {createBranchMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              צור סניף
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
                    {b.city && <p className="text-[11px] text-foreground-muted">{b.city}</p>}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`להשבית את הסניף "${b.branch_display_name || b.name}"?`)) {
                      deleteBranchMut.mutate(b.id);
                    }
                  }}
                  className="p-1.5 rounded-md hover:bg-danger/10 text-foreground-muted hover:text-danger transition-colors"
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
