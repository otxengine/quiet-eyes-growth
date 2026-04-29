import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { parseLLMJson } from '@/lib/utils';

export default function AiInsightsBar({ prompt, title = 'תובנות AI' }) {
  const [open, setOpen] = useState(false);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (insights) return;
    setLoading(true);
    setError('');
    try {
      const fullPrompt = `${prompt}

ענה בעברית עם בדיוק 3 נקודות תובנה קצרות (משפט אחד כל אחת).
JSON בלבד: {"insights": ["תובנה1", "תובנה2", "תובנה3"]}`;
      const result = await base44.integrations.Core.InvokeLLM({ prompt: fullPrompt });
      const parsed = parseLLMJson(result);
      setInsights(parsed?.insights || [result]);
    } catch {
      setError('לא הצלחנו לייצר תובנות. נסה שוב.');
    }
    setLoading(false);
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !insights) generate();
  };

  return (
    <div className="rounded-[10px] border border-[#e8e0ff] bg-[#faf8ff] overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#f5f0ff] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-purple-500" />
          <span className="text-[12px] font-semibold text-purple-700">{title}</span>
          {!open && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 border border-purple-200">
              ✦ לחץ להצגה
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-purple-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-purple-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-[#e8e0ff]">
          {loading ? (
            <div className="flex items-center gap-2 py-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
              <span className="text-[11px] text-purple-500">מנתח נתונים...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-between py-2">
              <span className="text-[11px] text-red-500">{error}</span>
              <button onClick={generate} className="text-[10px] text-purple-600 underline">נסה שוב</button>
            </div>
          ) : (
            <ul className="pt-2 space-y-1.5">
              {(insights || []).map((insight, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-purple-800 leading-relaxed">
                  <span className="text-purple-400 mt-0.5 flex-shrink-0">•</span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
