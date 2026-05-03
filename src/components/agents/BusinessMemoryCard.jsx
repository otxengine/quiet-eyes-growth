import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Brain, CheckCircle, XCircle, Megaphone, Clock, BarChart3 } from 'lucide-react';

function MemorySection({ icon: Icon, label, items, color = 'text-foreground-muted' }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3 h-3 ${color}`} />
        <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary border border-border text-foreground-secondary">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BusinessMemoryCard({ bpId }) {
  const { data: memories } = useQuery({
    queryKey: ['businessMemory', bpId],
    queryFn: () => base44.entities.BusinessMemory.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  const memory = memories?.[0];
  if (!memory) return null;

  const parse = (str) => {
    if (!str) return [];
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) return arr.filter(Boolean);
    } catch {}
    return str.split(',').map(s => s.trim()).filter(Boolean);
  };

  const rejected = parse(memory.rejected_patterns);
  const accepted = parse(memory.accepted_patterns);
  const channels = parse(memory.preferred_channels);

  let timing = {};
  try { timing = JSON.parse(memory.timing_preferences || '{}'); } catch {}
  const timingItems = Object.entries(timing).map(([k, v]) => `${k}: ${v}`);

  let agentWeights = {};
  try { agentWeights = JSON.parse(memory.agent_weights || '{}'); } catch {}
  const agentItems = Object.entries(agentWeights)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([k, v]) => `${k} (${Math.round((v as number) * 100)}%)`);

  const hasAnyData = rejected.length > 0 || accepted.length > 0 || channels.length > 0 || timingItems.length > 0 || agentItems.length > 0 || memory.preferred_tone || memory.feedback_summary;

  if (!hasAnyData) return null;

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-primary" />
        <h3 className="text-[13px] font-semibold text-foreground">זיכרון עסקי — מה הסוכנים למדו</h3>
        {memory.learning_version && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold mr-auto">
            v{memory.learning_version}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {memory.preferred_tone && (
          <div>
            <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">טון מועדף</span>
            <p className="text-[12px] text-foreground mt-0.5 font-medium">{memory.preferred_tone}</p>
          </div>
        )}

        <MemorySection icon={CheckCircle} label="תבניות מאושרות" items={accepted} color="text-success" />
        <MemorySection icon={XCircle} label="תבניות שנדחו" items={rejected} color="text-danger" />
        <MemorySection icon={Megaphone} label="ערוצים מועדפים" items={channels} color="text-blue-500" />
        <MemorySection icon={Clock} label="עיתוי מועדף" items={timingItems} color="text-amber-500" />
        <MemorySection icon={BarChart3} label="משקל סוכנים" items={agentItems} color="text-purple-500" />

        {memory.feedback_summary && (
          <div>
            <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">סיכום פידבק</span>
            <p className="text-[11px] text-foreground-secondary mt-1">{memory.feedback_summary}</p>
          </div>
        )}

        {memory.last_updated && (
          <p className="text-[9px] text-foreground-muted pt-1 border-t border-border">
            עדכון אחרון: {new Date(memory.last_updated).toLocaleDateString('he-IL')}
          </p>
        )}
      </div>
    </div>
  );
}
