import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminClient } from '@/api/adminClient';
import { Loader2, ShieldAlert } from 'lucide-react';

// Tab components
import OverviewTab           from '@/components/admin/OverviewTab';
import OTXPipelineTab        from '@/components/admin/OTXPipelineTab';
import ROITab                from '@/components/admin/ROITab';
import BusinessHealthTab     from '@/components/admin/BusinessHealthTab';
import ApprovalsTab          from '@/components/admin/ApprovalsTab';
import CustomerManagementTab from '@/components/admin/CustomerManagementTab';
import AgentLogsTab          from '@/components/admin/AgentLogsTab';
import AdminActionsTab       from '@/components/admin/AdminActionsTab';

function useIsAdmin() {
  try {
    const email = window.__clerk?.user?.primaryEmailAddress?.emailAddress || '';
    return email === 'contact@otxengine.io' || email.endsWith('@otx.ai') || email.endsWith('@quieteyes.ai');
  } catch { return false; }
}

const TABS = [
  { key: 'overview',   label: 'Overview' },
  { key: 'pipeline',   label: 'OTX Pipeline' },
  { key: 'roi',        label: 'ROI & רווחיות' },
  { key: 'health',     label: 'בריאות עסקים' },
  { key: 'approvals',  label: 'אישורים' },
  { key: 'customers',  label: 'ניהול לקוחות' },
  { key: 'logs',       label: 'לוגים' },
  { key: 'actions',    label: 'פעולות' },
];

export default function AdminDashboard({ skipAdminCheck = false }) {
  const isAdmin = skipAdminCheck || useIsAdmin();
  if (!isAdmin) return <Navigate to="/" replace />;

  const qc      = useQueryClient();
  const [tab, setTab] = useState('overview');

  // ── Shared data queries ────────────────────────────────────────
  const { data: allBusinesses = [], isLoading: loadingBiz } = useQuery({
    queryKey: ['admin_businesses'],
    queryFn: () => adminClient.entities.BusinessProfile.filter({}, '-created_date', 300),
  });

  const { data: allLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['admin_logs'],
    queryFn: () => adminClient.entities.AutomationLog.filter({}, '-start_time', 500),
    refetchInterval: 30000,
  });

  const { data: allSignals = [] } = useQuery({
    queryKey: ['admin_signals'],
    queryFn: () => adminClient.entities.MarketSignal.filter({}, '-detected_at', 1000),
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['admin_leads'],
    queryFn: () => adminClient.entities.Lead.filter({}, '-created_date', 1000),
  });

  const loading    = loadingBiz || loadingLogs;
  const sharedProps = { allBusinesses, allLogs, allSignals, allLeads };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0d0f14] text-white" dir="rtl">
      {/* Header */}
      <div className="bg-[#0d0f14] border-b border-[#2a3042] px-6 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-indigo-400" />
          <div>
            <h1 className="text-[15px] font-bold text-white tracking-tight">Admin Dashboard</h1>
            <p className="text-[11px] text-slate-500">ניהול פלטפורמה — גישה מוגבלת לבעלים בלבד</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-950 text-red-400 border border-red-800 tracking-wide">
            ADMIN ONLY
          </span>
          <span className="text-[10px] text-slate-600">
            {allBusinesses.length} עסקים · {allLogs.length} לוגים
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#2a3042] bg-[#0d0f14] px-2 overflow-x-auto sticky top-[61px] z-10">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-[12px] font-medium transition-all shrink-0 relative whitespace-nowrap ${
              tab === t.key
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {tab === 'overview'  && <OverviewTab   {...sharedProps} />}
        {tab === 'pipeline'  && <OTXPipelineTab {...sharedProps} />}
        {tab === 'roi'       && <ROITab         {...sharedProps} />}
        {tab === 'health'    && <BusinessHealthTab {...sharedProps} />}
        {tab === 'approvals' && <ApprovalsTab   {...sharedProps} />}
        {tab === 'customers' && <CustomerManagementTab {...sharedProps} />}
        {tab === 'logs'      && <AgentLogsTab   {...sharedProps} />}
        {tab === 'actions'   && (
          <AdminActionsTab
            {...sharedProps}
            onLogsRefresh={() => qc.invalidateQueries({ queryKey: ['admin_logs'] })}
          />
        )}
      </div>
    </div>
  );
}
