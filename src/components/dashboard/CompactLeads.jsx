import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, MessageSquare } from 'lucide-react';
import LeadFirstContactModal from '@/components/leads/LeadFirstContactModal';

function scoreStyle(score) {
  if (score >= 80) return 'bg-[#f0fdf8] text-[#10b981] border border-[#d1fae5]';
  if (score >= 40) return 'bg-[#fffbeb] text-[#d97706] border border-[#fef3c7]';
  return 'bg-[#f9f9f9] text-[#999999] border border-[#f0f0f0]';
}

function statusLabel(status) {
  if (status === 'hot') return { text: 'חם', cls: 'text-[#10b981]' };
  if (status === 'warm') return { text: 'פושר', cls: 'text-[#d97706]' };
  return { text: 'קר', cls: 'text-[#999999]' };
}

export default function CompactLeads({ leads = [], businessProfile }) {
  const navigate = useNavigate();
  const [contactLead, setContactLead] = useState(null);

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] flex flex-col">
      <div className="px-4 py-3 border-b border-[#f5f5f5]">
        <h3 className="text-[13px] font-semibold text-[#222222]">לידים חמים</h3>
      </div>
      <div className="divide-y divide-[#f5f5f5]">
        {leads.slice(0, 3).map((lead) => {
          const st = statusLabel(lead.status);
          const hasPhone = lead.contact_info?.match(/[\d\-+()]{7,}/);
          return (
            <div
              key={lead.id}
              className="px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[#f5f5f5] transition-colors"
              onClick={() => navigate('/leads')}
            >
              <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${scoreStyle(lead.score)}`}>
                {lead.score}
              </div>
              <span className="text-[11px] font-medium text-[#444444] flex-1 truncate">{lead.name}</span>
              {lead.status === 'hot' && hasPhone && (
                <button onClick={(e) => { e.stopPropagation(); setContactLead(lead); }}
                  className="px-2 py-1 rounded text-[9px] font-medium text-primary hover:bg-primary/5 transition-colors flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> שלח הודעה
                </button>
              )}
              <span className={`text-[10px] font-medium ${st.cls}`}>{st.text}</span>
            </div>
          );
        })}
        {leads.length === 0 && (
          <div className="p-6 text-center flex flex-col items-center justify-center">
            <CheckCircle className="w-8 h-8 text-[#cccccc] mb-1.5" />
            <p className="text-[11px] text-[#999999]">עוד אין לידים — המערכת מחפשת בשבילך</p>
          </div>
        )}
      </div>
      {contactLead && (
        <LeadFirstContactModal lead={contactLead} businessProfile={businessProfile}
          onClose={() => setContactLead(null)} onSent={() => setContactLead(null)} />
      )}
    </div>
  );
}