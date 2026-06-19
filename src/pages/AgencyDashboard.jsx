/**
 * AgencyDashboard — view for agency accounts.
 * Shows all client organizations with their branches and live health metrics.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agencyApi, orgApi } from '@/api/orgApi';
import { toast } from 'sonner';
import { Building2, Plus, Eye, Star, Zap, AlertTriangle, Loader2, X, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '@/contexts/OrganizationContext';
import { cn } from '@/lib/utils';

function StatChip({ icon: Icon, value, label, color = 'text-foreground-muted' }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1">
      <Icon className={cn('w-3.5 h-3.5', color)} />
      <span className="text-[12px] font-semibold">{value}</span>
      <span className="text-[11px] text-foreground-muted">{label}</span>
    </div>
  );
}

function ClientCard({ client, onView }) {
  const totalSignals = client.branches?.reduce((s, _b) => s, 0) || 0;
  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-4.5 h-4.5 text-primary" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">{client.org_name}</h3>
            <p className="text-[11px] text-foreground-muted">
              {client.branches?.length || 0} {client.branches?.length === 1 ? 'סניף' : 'סניפים'}
            </p>
          </div>
        </div>
        <button
          onClick={onView}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-foreground-muted border border-border rounded-lg hover:bg-secondary transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          כנס
        </button>
      </div>

      {/* Branches */}
      {(client.branches || []).length > 0 && (
        <div className="space-y-1.5 mb-3">
          {client.branches.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary rounded-lg">
              <div className={cn('w-1.5 h-1.5 rounded-full', b.onboarding_completed ? 'bg-emerald-500' : 'bg-amber-400')} />
              <span className="text-[12px] text-foreground">{b.branch_display_name || b.name}</span>
              {b.city && <span className="text-[11px] text-foreground-muted">{b.city}</span>}
              {!b.onboarding_completed && (
                <span className="mr-auto text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                  בהגדרה
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddClientModal({ onClose, onAdded }) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => agencyApi.addClient({ client_name: name }),
    onSuccess: () => { toast.success('לקוח נוסף'); qc.invalidateQueries({ queryKey: ['agencyClients'] }); onAdded(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold">הוסף לקוח חדש</h3>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary"><X className="w-4 h-4" /></button>
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="שם הלקוח / ארגון"
          className="w-full px-3 py-2.5 text-[13px] bg-secondary border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-right mb-4"
          onKeyDown={e => e.key === 'Enter' && mut.mutate()}
          autoFocus
        />
        <button
          onClick={() => mut.mutate()}
          disabled={!name || mut.isPending}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          צור ארגון לקוח
        </button>
      </div>
    </div>
  );
}

export default function AgencyDashboard() {
  const [showAddModal, setShowAddModal] = useState(false);
  const { refetch: refetchOrgs } = useOrganization();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agencyClients'],
    queryFn: () => agencyApi.getClients(),
    staleTime: 30_000,
  });

  const { data: aggregate } = useQuery({
    queryKey: ['agencyAggregate'],
    queryFn: () => agencyApi.getAggregate(),
    staleTime: 60_000,
  });

  const clients = data?.clients || [];
  const totals  = aggregate?.totals || {};

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-foreground">לוח בקרה סוכנות</h1>
          <p className="text-[13px] text-foreground-muted mt-0.5">
            {clients.length} לקוחות פעילים
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          לקוח חדש
        </button>
      </div>

      {/* Aggregate totals */}
      {aggregate && totals.profile_count > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'סניפים', value: totals.profile_count, icon: Building2, color: 'text-primary' },
            { label: 'סיגנלים לא נקראו', value: totals.unread_signals, icon: Eye, color: 'text-blue-600' },
            { label: 'התראות פעילות', value: totals.active_alerts, icon: AlertTriangle, color: 'text-amber-600' },
            { label: 'לידים חמים', value: totals.hot_leads, icon: Zap, color: 'text-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 text-center">
              <Icon className={cn('w-5 h-5 mx-auto mb-1.5', color)} />
              <p className="text-[22px] font-bold text-foreground">{value || 0}</p>
              <p className="text-[11px] text-foreground-muted">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Client list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <Building2 className="w-10 h-10 text-foreground-muted mx-auto mb-3" />
          <p className="text-[15px] font-semibold text-foreground mb-1">אין לקוחות עדיין</p>
          <p className="text-[13px] text-foreground-muted mb-4">הוסף את הלקוח הראשון שלך כדי להתחיל</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            הוסף לקוח
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((client) => (
            <ClientCard
              key={client.org_id}
              client={client}
              onView={() => {
                // Navigate to settings for this client org
                navigate('/org/settings');
              }}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => { refetch(); refetchOrgs(); }}
        />
      )}
    </div>
  );
}
