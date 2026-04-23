import React from 'react';
import { CheckCircle } from 'lucide-react';

function scoreStyle(score) {
  if (score >= 80) return 'bg-success/15 text-success';
  if (score >= 40) return 'bg-warning/15 text-warning';
  return 'bg-secondary text-foreground-muted';
}

function statusLabel(status) {
  if (status === 'hot') return { text: 'חם', cls: 'bg-success/15 text-success' };
  if (status === 'warm') return { text: 'פושר', cls: 'bg-warning/15 text-warning' };
  return { text: 'קר', cls: 'bg-secondary text-foreground-muted' };
}

export default function RecentLeads({ leads = [] }) {
  const hotCount = leads.filter(l => l.status === 'hot').length;

  return (
    <div className="bg-background-card rounded-lg border border-border">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-success" />
        <h3 className="font-semibold text-foreground">לידים אחרונים</h3>
        {hotCount > 0 && (
          <span className="px-2 py-0.5 text-xs font-medium bg-success/15 text-success rounded-full mr-auto">
            {hotCount} חמים
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {leads.slice(0, 5).map((lead) => {
          const st = statusLabel(lead.status);
          return (
            <div key={lead.id} className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${scoreStyle(lead.score)}`}>
                {lead.score}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground block truncate">{lead.name}</span>
                <span className="text-xs text-foreground-muted truncate block">
                  {[lead.service_needed, lead.budget_range, lead.city].filter(Boolean).join(' · ')}
                </span>
              </div>
              <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${st.cls}`}>
                {st.text}
              </span>
            </div>
          );
        })}
        {leads.length === 0 && (
          <div className="p-6 text-center text-sm text-foreground-muted">
            אין לידים עדיין
          </div>
        )}
      </div>
    </div>
  );
}