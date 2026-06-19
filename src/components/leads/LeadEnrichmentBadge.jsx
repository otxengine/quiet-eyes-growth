import React from 'react';
import { Sparkles, Phone, MessageSquare, Mail, ArrowLeft } from 'lucide-react';

const channelIcons = {
  'WhatsApp': MessageSquare,
  'טלפון': Phone,
  'מייל': Mail,
};

export default function LeadEnrichmentBadge({ enrichmentData }) {
  if (!enrichmentData) return null;

  const ChannelIcon = channelIcons[enrichmentData.recommended_channel] || Phone;

  return (
    <div className="bg-secondary/50 rounded-lg p-3 border border-border/50 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3 h-3 text-[#6366f1]" />
        <span className="text-[10px] font-semibold text-[#6366f1]">העשרת AI</span>
        {enrichmentData.fit_score && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mr-auto ${
            enrichmentData.fit_score >= 80 ? 'bg-[#dcfce7] text-[#10b981]' :
            enrichmentData.fit_score >= 50 ? 'bg-[#fef3c7] text-[#d97706]' :
            'bg-secondary text-foreground-muted'
          }`}>
            התאמה: {enrichmentData.fit_score}%
          </span>
        )}
      </div>

      {enrichmentData.fit_reasoning && (
        <p className="text-[10px] text-foreground-secondary">{enrichmentData.fit_reasoning}</p>
      )}

      {enrichmentData.recommended_channel && (
        <div className="flex items-center gap-1.5 text-[10px]">
          <ChannelIcon className="w-3 h-3 text-foreground-muted" />
          <span className="text-foreground-secondary">ערוץ מומלץ: <strong>{enrichmentData.recommended_channel}</strong></span>
        </div>
      )}

      {enrichmentData.personalized_message && (
        <div className="bg-white rounded-md p-2 border border-border/50">
          <p className="text-[10px] text-[#222222] font-medium mb-0.5">הודעה מותאמת:</p>
          <p className="text-[10px] text-foreground-secondary leading-relaxed">{enrichmentData.personalized_message}</p>
        </div>
      )}

      {enrichmentData.next_best_action && (
        <div className="flex items-center gap-1 text-[10px] text-[#10b981]">
          <ArrowLeft className="w-3 h-3" />
          <span>{enrichmentData.next_best_action}</span>
        </div>
      )}

      {enrichmentData.urgency_note && (
        <p className="text-[9px] text-[#d97706]">⚡ {enrichmentData.urgency_note}</p>
      )}
    </div>
  );
}