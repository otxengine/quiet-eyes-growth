import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function WeeklyReportCard({ bpId }) {
  const [expanded, setExpanded] = useState(false);

  const { data: reports = [] } = useQuery({
    queryKey: ['weeklyReport', bpId],
    queryFn: () => base44.entities.WeeklyReport.filter({ linked_business: bpId }, '-created_date', 1),
    enabled: !!bpId,
  });

  const report = reports[0];
  if (!report) return null;

  return (
    <div className="card-base mb-4 overflow-hidden">
      <div className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-secondary/30 transition-colors" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-primary" />
          <span className="text-[12px] font-semibold text-foreground">דוח שבועי</span>
          <span className="text-[11px] text-foreground-muted">השבוע: {report.headline || '—'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-foreground">ציון: {report.weekly_score}/10</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-foreground-muted" /> : <ChevronDown className="w-4 h-4 text-foreground-muted" />}
        </div>
      </div>
      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4">
          <div className="prose prose-sm max-w-none text-[12px] text-foreground-secondary leading-relaxed [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 [&_strong]:text-foreground [&_ol]:mr-4 [&_ul]:mr-4 [&_li]:my-0.5 [&_p]:my-1">
            <ReactMarkdown>{report.report_text || ''}</ReactMarkdown>
          </div>
          <div className="flex gap-4 mt-3 pt-3 border-t border-border">
            <span className="text-[10px] text-foreground-muted">{report.insights_count || 0} תובנות</span>
            <span className="text-[10px] text-foreground-muted">{report.reviews_count || 0} ביקורות</span>
            <span className="text-[10px] text-foreground-muted">{report.leads_count || 0} לידים</span>
          </div>
        </div>
      )}
    </div>
  );
}