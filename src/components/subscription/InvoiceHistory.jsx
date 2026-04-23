import React from 'react';
import { FileText, Download } from 'lucide-react';

export default function InvoiceHistory({ invoices = [] }) {
  return (
    <div className="card-base overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
        <FileText className="w-4 h-4 text-foreground-muted" />
        <h3 className="text-[13px] font-semibold text-foreground">היסטוריית חשבוניות</h3>
      </div>
      {invoices.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-[12px] text-foreground-muted">אין חשבוניות עדיין</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {invoices.map(inv => (
            <div key={inv.id} className="flex items-center gap-3 px-5 py-3 hover:bg-secondary/30 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-foreground">{inv.id}</span>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/10 text-success">{inv.status}</span>
                </div>
                <span className="text-[11px] text-foreground-muted">{inv.date}</span>
              </div>
              <span className="text-[13px] font-semibold text-foreground">{inv.amount}</span>
              {inv.pdf && (
                <a href={inv.pdf} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors" title="הורד חשבונית">
                  <Download className="w-3.5 h-3.5 text-foreground-muted" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}