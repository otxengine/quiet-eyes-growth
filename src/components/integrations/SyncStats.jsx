import React from 'react';
import { ArrowUpDown, CheckCircle, Clock } from 'lucide-react';

function timeAgo(dateStr) {
  if (!dateStr) return 'טרם בוצע';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function SyncStats({ bp }) {
  const activeCount = [
    bp?.crm_hubspot_enabled, bp?.crm_monday_enabled,
    bp?.crm_webhook_enabled, bp?.crm_zapier_enabled,
  ].filter(Boolean).length;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="card-base p-4 fade-in-up stagger-1">
        <div className="flex items-center gap-1.5 mb-1">
          <ArrowUpDown className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-medium text-foreground-muted">חיבורים פעילים</span>
        </div>
        <span className="text-[24px] font-bold text-foreground leading-none">{activeCount}</span>
      </div>
      <div className="card-base p-4 fade-in-up stagger-2">
        <div className="flex items-center gap-1.5 mb-1">
          <CheckCircle className="w-3.5 h-3.5 text-success" />
          <span className="text-[10px] font-medium text-foreground-muted">סנכרונים</span>
        </div>
        <span className="text-[24px] font-bold text-foreground leading-none">{bp?.crm_sync_count || 0}</span>
      </div>
      <div className="card-base p-4 fade-in-up stagger-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Clock className="w-3.5 h-3.5 text-foreground-muted" />
          <span className="text-[10px] font-medium text-foreground-muted">סנכרון אחרון</span>
        </div>
        <span className="text-[12px] font-medium text-foreground leading-none mt-1 block">{timeAgo(bp?.crm_last_sync)}</span>
      </div>
    </div>
  );
}