import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Phone, MessageSquare, CheckCircle, ChevronDown, ChevronUp, MapPin, Briefcase, Wallet, Clock, User, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import LeadEnrichmentBadge from '@/components/leads/LeadEnrichmentBadge';
import WhatsAppTemplates from '@/components/leads/WhatsAppTemplates';
import WhatsAppQuickSend from '@/components/leads/WhatsAppQuickSend';
import WhatsAppBotStatus from '@/components/leads/WhatsAppBotStatus';
import LeadConversationHistory from '@/components/leads/LeadConversationHistory';
import LeadStatusActions from '@/components/leads/LeadStatusActions';
import LeadFirstContactModal from '@/components/leads/LeadFirstContactModal';
import AiConfidenceBadge from '@/components/ai/AiConfidenceBadge';
import DataFreshnessBadge from '@/components/ai/DataFreshnessBadge';

function scoreStyle(score) {
  if (score >= 80) return 'bg-[#f0fdf8] text-[#10b981] border border-[#d1fae5]';
  if (score >= 40) return 'bg-[#fffbeb] text-[#d97706] border border-[#fef3c7]';
  return 'bg-[#f9f9f9] text-[#999999] border border-[#f0f0f0]';
}

const statusConfig = {
  hot: { text: 'חם 🔥', cls: 'text-[#10b981]' },
  warm: { text: 'פושר', cls: 'text-[#d97706]' },
  cold: { text: 'קר', cls: 'text-[#999999]' },
  contacted: { text: 'נוצר קשר', cls: 'text-[#6366f1]' },
  completed: { text: 'טופל ✓', cls: 'text-[#10b981]' },
  lost: { text: 'לא רלוונטי', cls: 'text-[#999999]' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export default function LeadCard({ lead, businessProfile, onOpenDetail }) {
  const [expanded, setExpanded] = useState(false);
  const [showFirstContact, setShowFirstContact] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [showCloseDeal, setShowCloseDeal] = useState(false);
  const [dealValue, setDealValue] = useState('');
  const queryClient = useQueryClient();

  const handleWhatsAppFirstContact = async () => {
    setGeneratingMessage(true);
    try {
      const res = await base44.functions.invoke('generateLeadFirstContact', {
        leadId: lead.id,
        businessProfileId: lead.linked_business,
      });
      const message = res?.data?.message || res?.message || '';
      if (!message) {
        toast.error('לא הצלחנו לייצר הודעה');
        return;
      }
      // Prefer contact_phone field, fall back to parsing contact_info
      const phoneRaw = (lead.contact_phone || lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] || '').replace(/[^0-9+]/g, '');
      const encodedMsg = encodeURIComponent(message);
      const waUrl = phoneRaw
        ? `https://wa.me/${phoneRaw.startsWith('0') ? '972' + phoneRaw.slice(1) : phoneRaw}?text=${encodedMsg}`
        : `https://wa.me/?text=${encodedMsg}`;
      window.open(waUrl, '_blank');
      await base44.entities.Lead.update(lead.id, { status: 'contacted', lifecycle_stage: 'contacted', lifecycle_updated_at: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
      toast.success('WhatsApp נפתח עם ההודעה המוכנה ✓');
    } catch (_) {
      toast.error('שגיאה ביצירת ההודעה');
    }
    setGeneratingMessage(false);
  };

  const handleCloseDeal = async () => {
    const val = parseFloat(dealValue) || 0;
    try {
      await base44.entities.Lead.update(lead.id, {
        status: 'completed',
        lifecycle_stage: 'closed_won',
        closed_value: val,
        closed_at: new Date().toISOString(),
        lifecycle_updated_at: new Date().toISOString(),
      });
      await base44.functions.invoke('logOutcome', {
        action_type: 'deal_closed',
        was_accepted: true,
        outcome_description: `עסקה נסגרה: ${lead.name}${val > 0 ? ` — ₪${val.toLocaleString()}` : ''}`,
        impact_score: Math.min(10, Math.floor(val / 1000) || 3),
        linked_business: lead.linked_business,
      });
      queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
      setShowCloseDeal(false);
      toast.success(`עסקה נרשמה בהצלחה${val > 0 ? ` — ₪${val.toLocaleString()}` : ''} ✓`);
    } catch (_) {
      toast.error('שגיאה בשמירת העסקה');
    }
  };
  const st = statusConfig[lead.status] || statusConfig.cold;
  // Prefer contact_phone field; fall back to parsing contact_info
  const phone = lead.contact_phone || (lead.contact_info?.match(/[\d\-+()]{7,}/)?.[0] ?? null);

  const markHandledMutation = useMutation({
    mutationFn: () => base44.entities.Lead.update(lead.id, { status: 'cold' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leadsPage'] }); queryClient.invalidateQueries({ queryKey: ['hotLeads'] }); }
  });

  const logLeadContact = async () => {
    try {
      await base44.functions.invoke('logOutcome', {
        action_type: 'lead_contact', was_accepted: true,
        outcome_description: `יצירת קשר עם ${lead.name}`,
        linked_business: lead.linked_business || '',
      });
    } catch (_) {}
  };

  const urgencyMap = { 'today': 'היום', 'this_week': 'השבוע', 'this_month': 'החודש', 'browsing': 'מתעניין', 'היום': 'היום', 'השבוע': 'השבוע', 'החודש': 'החודש', 'מתעניין': 'מתעניין' };
  const urgency = urgencyMap[lead.urgency] || lead.urgency || '—';

  return (
    <div className="bg-white rounded-[10px] border border-[#f0f0f0] hover:border-[#dddddd] transition-colors">
      <div className="p-3 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${scoreStyle(lead.score)}`}>{lead.score}</div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-[#222222] block truncate">{lead.name}</span>
          <span className="text-[11px] text-[#999999] truncate block">{[lead.service_needed, lead.city].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="flex items-center gap-2">
          {(lead.freshness_score ?? 100) >= 80 && (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-[#fff7ed] text-[#ea580c] border border-[#fed7aa]">חם עכשיו 🔥</span>
          )}
          {lead.intent_strength && lead.intent_strength !== 'none' && (
            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-medium bg-[#f0fdf8] text-[#10b981]">כוונת קנייה</span>
          )}
          <DataFreshnessBadge dateStr={lead.created_at || lead.created_date} maxAgeHours={168} />
          <span className={`text-[10px] font-medium ${st.cls}`}>{st.text}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#cccccc]" /> : <ChevronDown className="w-4 h-4 text-[#cccccc]" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-[#f5f5f5] space-y-3">
          <div>
            <h4 className="text-[11px] font-semibold text-[#222222] mb-1.5">פרטי קשר</h4>
            <div className="space-y-1">
              {phone && <div className="flex items-center gap-2 text-[12px]"><Phone className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">{phone}</span></div>}
              <div className="flex items-center gap-2 text-[12px]"><User className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">{lead.source || '—'}</span></div>
              {lead.city && <div className="flex items-center gap-2 text-[12px]"><MapPin className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">{lead.city}</span></div>}
            </div>
          </div>
          <div>
            <h4 className="text-[11px] font-semibold text-[#222222] mb-1.5">פרטי בקשה</h4>
            <div className="space-y-1">
              {lead.service_needed && <div className="flex items-center gap-2 text-[12px]"><Briefcase className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">{lead.service_needed}</span></div>}
              {lead.budget_range && <div className="flex items-center gap-2 text-[12px]"><Wallet className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">{lead.budget_range}</span></div>}
              <div className="flex items-center gap-2 text-[12px]"><Clock className="w-3.5 h-3.5 text-[#cccccc]" /><span className="text-[#444444]">דחיפות: {urgency}</span></div>
            </div>
          </div>
          {lead.questionnaire_answers && (() => {
            let enrichment = null;
            try { enrichment = JSON.parse(lead.questionnaire_answers); } catch (_) {}
            if (enrichment?.fit_score !== undefined) {
              return <LeadEnrichmentBadge enrichmentData={enrichment} />;
            }
            return (
              <div>
                <h4 className="text-[11px] font-semibold text-[#222222] mb-1.5">תשובות שאלון</h4>
                <p className="text-[12px] text-[#444444] whitespace-pre-wrap bg-[#fafafa] rounded-lg p-2 border border-[#f0f0f0]">{lead.questionnaire_answers}</p>
              </div>
            );
          })()}
          {/* Source URL badge — show real link only for verified-source leads */}
          {lead.source_url && lead.source_url.startsWith('http') && (lead.source_origin === 'tavily' || lead.source_origin === 'google_places' || lead.source_origin === 'apify' || lead.discovery_method === 'tavily_web_search') && (
            <div className="bg-[#f8f9ff] border border-[#e0e4f5] rounded-lg p-2">
              <span className="text-[10px] font-medium text-primary block mb-0.5">מקור הליד</span>
              <a href={lead.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                <ExternalLink className="w-3 h-3" /> צפה במקור ({lead.source || 'אינטרנט'})
              </a>
            </div>
          )}
          {lead.source_url && lead.source_url.startsWith('http') && lead.source_origin === 'llm' && (
            <div className="bg-[#f9f9f9] border border-[#f0f0f0] rounded-lg p-2">
              <span className="text-[10px] text-[#aaaaaa]">מקור: {lead.source || 'לא ידוע'}</span>
            </div>
          )}
          {lead.intent_source && (
            <div className="bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-2">
              <span className="text-[10px] font-medium text-[#10b981] block mb-0.5">כוונת קנייה ({lead.intent_strength})</span>
              <p className="text-[11px] text-[#444444]">{lead.intent_source.split(' | מקור: ')[0]}</p>
              {!lead.source_url && lead.intent_source.includes('http') && (() => {
                const urlMatch = lead.intent_source.match(/(https?:\/\/[^\s|]+)/);
                return urlMatch ? (
                  <a href={urlMatch[1]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 mt-1 text-[10px] text-primary hover:underline">
                    <ExternalLink className="w-3 h-3" /> צפה במקור
                  </a>
                ) : null;
              })()}
            </div>
          )}
          {lead.contact_info && !phone && <p className="text-[12px] text-[#444444]">{lead.contact_info}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {phone && (
              <a href={`tel:${phone}`} onClick={(e) => { e.stopPropagation(); logLeadContact(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[#111111] text-white hover:bg-[#333333] transition-colors">
                <Phone className="w-3.5 h-3.5" /> התקשר ←
              </a>
            )}
            {/* One-click WhatsApp with AI-generated message for hot/warm leads */}
            {(lead.status === 'hot' || lead.status === 'warm') && (
              <button onClick={(e) => { e.stopPropagation(); handleWhatsAppFirstContact(); }} disabled={generatingMessage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[#25D366] text-white hover:opacity-90 transition-colors disabled:opacity-60">
                {generatingMessage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                {generatingMessage ? 'מכין הודעה...' : 'שלח ב-WhatsApp'}
              </button>
            )}
            {phone && lead.status !== 'hot' && lead.status !== 'warm' && (
              <a href={`https://wa.me/${phone.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(`שלום ${lead.name}, פונה אליך בנוגע ל${lead.service_needed || 'שירות שביקשת'}. אשמח לעזור!`)}`}
                target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); logLeadContact(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#aaaaaa] bg-white border border-[#eeeeee] hover:border-[#cccccc] hover:text-[#666666] transition-colors">
                <MessageSquare className="w-3.5 h-3.5" /> WhatsApp ←
              </a>
            )}
            {/* Close deal button for leads in active stages */}
            {(lead.lifecycle_stage === 'negotiation' || lead.lifecycle_stage === 'meeting' || lead.status === 'contacted') && (
              <button onClick={(e) => { e.stopPropagation(); setShowCloseDeal(true); }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[#10b981] bg-white border border-[#d1fae5] hover:bg-[#f0fdf8] transition-colors">
                ✓ סגרתי עסקה
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); markHandledMutation.mutate(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#aaaaaa] bg-white border border-[#eeeeee] hover:border-[#cccccc] hover:text-[#666666] transition-colors">
              <CheckCircle className="w-3.5 h-3.5" /> סמן כטופל
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                base44.entities.Lead.update(lead.id, { status: 'lost' });
                queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
                toast('הליד הוסר');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[#999999] bg-white border border-[#eeeeee] hover:border-red-200 hover:text-red-400 transition-colors"
            >
              ✕ לא רלוונטי
            </button>
            {onOpenDetail && (
              <button onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-primary bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors">
                פתח פרטים מלאים
              </button>
            )}
          </div>

          {/* Suggested first message for social leads */}
          {lead.suggested_first_message && (
            <div className="mt-3 bg-[#f0fdf8] border border-[#d1fae5] rounded-lg p-3">
              <p className="text-[10px] font-semibold text-success mb-1.5 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> תגובה מוכנה (נמצא ב-{lead.source || 'סושיאל'})
              </p>
              <p className="text-[11px] text-foreground-secondary leading-relaxed mb-2">
                {lead.suggested_first_message}
              </p>
              <button
                onClick={() => {
                  const phone = lead.contact_phone || (lead.contact_info || '').replace(/[^0-9+]/g, '');
                  const intl = phone?.startsWith('0') ? '972' + phone.slice(1) : phone;
                  const url = intl
                    ? `https://wa.me/${intl}?text=${encodeURIComponent(lead.suggested_first_message)}`
                    : `https://wa.me/?text=${encodeURIComponent(lead.suggested_first_message)}`;
                  window.open(url, '_blank');
                  base44.entities.Lead.update(lead.id, {
                    status: 'contacted', lifecycle_stage: 'contacted',
                    last_contact_at: new Date().toISOString(),
                  });
                  queryClient.invalidateQueries({ queryKey: ['leadsPage'] });
                  toast.success('WhatsApp נפתח ✓');
                }}
                className="text-[10px] font-medium bg-[#25D366] text-white px-3 py-1.5 rounded-md hover:opacity-90 flex items-center gap-1"
              >
                <MessageSquare className="w-3 h-3" /> שלח דרך WhatsApp
              </button>
            </div>
          )}

          {/* Close Deal modal overlay */}
          {showCloseDeal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCloseDeal(false)}>
              <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-[15px] font-semibold text-[#111111] mb-1">סגירת עסקה</h3>
                <p className="text-[12px] text-[#888888] mb-4">{lead.name} — {lead.service_needed || 'שירות'}</p>
                <label className="text-[11px] font-medium text-[#444444] block mb-1.5">סכום העסקה (₪)</label>
                <input
                  type="number"
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                  placeholder="לדוגמה: 3500"
                  autoFocus
                  className="w-full text-[14px] border border-[#e0e0e0] rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981] mb-4"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCloseDeal(); if (e.key === 'Escape') setShowCloseDeal(false); }}
                />
                <div className="flex gap-2">
                  <button onClick={handleCloseDeal}
                    className="flex-1 py-2.5 text-[13px] font-semibold bg-[#10b981] text-white rounded-lg hover:opacity-90 transition-colors">
                    ✓ שמור עסקה
                  </button>
                  <button onClick={() => setShowCloseDeal(false)}
                    className="px-4 py-2.5 text-[13px] text-[#888888] border border-[#e0e0e0] rounded-lg hover:border-[#cccccc] transition-colors">
                    ביטול
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp Bot Status */}
          {phone && <WhatsAppBotStatus lead={lead} businessProfile={businessProfile} />}

          {/* WhatsApp Section */}
          {phone && (
            <div className="border-t border-[#f0f0f0] pt-3 mt-3 space-y-3">
              <WhatsAppQuickSend lead={lead} onSent={() => logLeadContact()} />
              <WhatsAppTemplates lead={lead} businessProfile={businessProfile} onSend={() => logLeadContact()} />
            </div>
          )}

          {/* Status Actions */}
          <LeadStatusActions lead={lead} />

          {/* Conversation History */}
          <LeadConversationHistory lead={lead} />
        </div>
      )}

      {showFirstContact && (
        <LeadFirstContactModal lead={lead} businessProfile={businessProfile}
          onClose={() => setShowFirstContact(false)}
          onSent={() => { setShowFirstContact(false); queryClient.invalidateQueries({ queryKey: ['leadsPage'] }); queryClient.invalidateQueries({ queryKey: ['allLeads'] }); }} />
      )}
    </div>
  );
}