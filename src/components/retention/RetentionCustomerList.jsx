import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Heart } from 'lucide-react';
import RetentionCustomerRow from './RetentionCustomerRow';

function buildAtRiskList(leads, reviews) {
  const atRisk = [];
  
  // Lost leads
  leads.filter(l => l.status === 'lost').forEach(l => {
    atRisk.push({
      id: l.id,
      name: l.name || 'ליד',
      detail: `סטטוס: לא רלוונטי · מקור: ${l.source || '?'} · שירות: ${l.service_needed || '?'}`,
      alertColor: 'danger',
    });
  });

  // Negative reviews
  reviews.filter(r => r.sentiment === 'negative').forEach(r => {
    atRisk.push({
      id: r.id,
      name: r.reviewer_name || 'לקוח',
      detail: `ביקורת שלילית · ${r.rating || '?'}⭐ · ${r.platform || '?'} · "${(r.text || '').slice(0, 50)}..."`,
      alertColor: 'danger',
    });
  });

  // Cold leads that were once warm/hot
  leads.filter(l => l.status === 'cold' && l.score >= 40).forEach(l => {
    atRisk.push({
      id: l.id,
      name: l.name || 'ליד',
      detail: `ליד קר (ציון ${l.score}) · שירות: ${l.service_needed || '?'} · ${l.city || ''}`,
      alertColor: 'warning',
    });
  });

  return atRisk.slice(0, 15);
}

export default function RetentionCustomerList({ businessProfile }) {
  const bpId = businessProfile?.id;

  const { data: leads = [] } = useQuery({
    queryKey: ['retentionListLeads', bpId],
    queryFn: () => base44.entities.Lead.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['retentionListReviews', bpId],
    queryFn: () => base44.entities.Review.filter({ linked_business: bpId, sentiment: 'negative' }, '-created_date', 50),
    enabled: !!bpId,
  });

  const atRisk = buildAtRiskList(leads, reviews);

  if (atRisk.length === 0) {
    return (
      <div className="card-base py-12 text-center">
        <Heart className="w-10 h-10 text-foreground-muted opacity-20 mx-auto mb-2" />
        <p className="text-[12px] text-foreground-muted">אין לקוחות בסיכון נטישה כרגע — מצוין!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0]">
      <div className="px-4 py-3 border-b border-[#f5f5f5] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#d97706]" />
          <h3 className="text-[13px] font-semibold text-[#222222]">לקוחות בסיכון נטישה</h3>
        </div>
        <span className="text-[10px] text-foreground-muted">{atRisk.length} לקוחות</span>
      </div>
      <div className="divide-y divide-[#f5f5f5]">
        {atRisk.map((customer) => (
          <RetentionCustomerRow key={customer.id} customer={customer} businessProfile={businessProfile} />
        ))}
      </div>
    </div>
  );
}