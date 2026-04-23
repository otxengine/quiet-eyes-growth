import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function WeeklyReportsTab({ bpId }) {
  const [expandedId, setExpandedId] = useState(null);

  const { data: reports = [] } = useQuery({
    queryKey: ['weeklyReports', bpId],
    queryFn: () => base44.entities.WeeklyReport.filter({ linked_business: bpId }, '-created_date', 20),
    enabled: !!bpId,
  });

  if (reports.length === 0) {
    return (
      <div className="card-base py-20 text-center">
        <FileText className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
        <p className="text-[13px] text-foreground-muted">עוד אין דוחות שבועיים</p>
        <p className="text-[11px] text-foreground-muted opacity-50">הדוח הראשון ייווצר ביום ראשון הקרוב</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => {
        const isExpanded = expandedId === report.id;
        const weekLabel = report.week_start ? new Date(report.week_start).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
        return (
          <div key={report.id} className="card-base overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-secondary/30 transition-colors" onClick={() => setExpandedId(isExpanded ? null : report.id)}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                  <span className="text-[14px] font-bold text-foreground">{report.weekly_score || '—'}</span>
                </div>
                <div>
                  <span className="text-[12px] font-semibold text-foreground block">{report.headline || 'דוח שבועי'}</span>
                  <span className="text-[10px] text-foreground-muted">{weekLabel} · {report.insights_count || 0} תובנות · {report.leads_count || 0} לידים</span>
                </div>
              </div>
              {isExpanded ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
            </div>
            {isExpanded && (
              <div className="px-5 pb-5 border-t border-border pt-4">
                <div className="prose prose-sm max-w-none text-[12px] text-foreground-secondary leading-relaxed [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_strong]:text-foreground [&_ol]:mr-4 [&_ul]:mr-4 [&_li]:my-0.5 [&_p]:my-1">
                  <ReactMarkdown>{report.report_text || ''}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}