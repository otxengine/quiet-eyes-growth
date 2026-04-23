import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Loader2 } from 'lucide-react';

const templateFocus = {
  'חסרת לנו!': 'Focus on how much we miss them',
  'הצעה מיוחדת': 'Focus on a special exclusive offer',
  'חדש אצלנו': 'Focus on new services/products',
};

export default function RetentionCustomerRow({ customer, businessProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sent, setSent] = useState(false);

  const alertColor = customer.alertColor === 'danger' ? 'text-[#dc2626] bg-[#fef2f2]' : 'text-[#d97706] bg-[#fffbeb]';

  const generateMessage = async (focus) => {
    setGenerating(true);
    const tone = businessProfile?.tone_preference || 'friendly';
    const bName = businessProfile?.name || '';
    const focusInstruction = focus ? `\nAdditional focus: ${templateFocus[focus]}` : '';
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Write a customer retention WhatsApp message for an Israeli small business.
Business: ${bName}, Tone: ${tone}, Customer: ${customer.name}, Reason: ${customer.detail}${focusInstruction}
Write 2-3 sentences max. Natural conversational Hebrew.`
    });
    setMessageText(result);
    setGenerating(false);
    setExpanded(true);
  };

  const handleSend = () => { setSent(true); setExpanded(false); setTimeout(() => setSent(false), 3000); };

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className={`w-8 h-8 rounded-full ${alertColor} flex items-center justify-center flex-shrink-0`}>
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-[#222222] block">{customer.name}</span>
          <span className="text-[12px] text-[#999999] block truncate">{customer.detail}</span>
        </div>
        {sent ? (
          <span className="text-[11px] font-medium text-[#10b981]">ההודעה נשמרה ✓</span>
        ) : (
          <button onClick={() => generateMessage(null)} disabled={generating}
            className="px-3 py-1.5 text-[12px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors flex items-center gap-1.5 flex-shrink-0">
            {generating && <Loader2 className="w-3 h-3 animate-spin" />} {generating ? 'מכין הודעה...' : 'שלח הודעה'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 mr-11">
          <div className="flex gap-1.5 mb-2">
            {Object.keys(templateFocus).map((label) => (
              <button key={label} onClick={() => generateMessage(label)} disabled={generating}
                className="px-2 py-1 text-[11px] font-medium text-[#aaaaaa] border border-[#eeeeee] rounded-md hover:border-[#cccccc] hover:text-[#666666] transition-colors">{label}</button>
            ))}
          </div>
          <label className="text-[12px] text-[#222222] font-medium mb-1.5 block">הודעת שימור מוצעת:</label>
          <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={4}
            className="w-full bg-[#fafafa] border border-[#eeeeee] rounded-lg p-3 text-[13px] text-[#444444] resize-none focus:outline-none focus:border-[#dddddd]" />
          <div className="flex gap-2 mt-2">
            <button onClick={handleSend} className="px-4 py-2 text-[12px] font-medium bg-[#111111] text-white rounded-md hover:bg-[#333333] transition-colors">שלח ✓</button>
            <button onClick={() => setExpanded(false)} className="px-3 py-1.5 text-[12px] font-medium text-[#aaaaaa] border border-[#eeeeee] rounded-md hover:border-[#cccccc] transition-colors">בטל</button>
          </div>
        </div>
      )}
    </div>
  );
}