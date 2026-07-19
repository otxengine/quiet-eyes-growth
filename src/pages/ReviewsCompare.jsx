import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, Send, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import TopicTimelineWidget from '@/components/competitors/TopicTimelineWidget';
import CompetitorReviewInsightsPanel from '@/components/competitors/CompetitorReviewInsightsPanel';

const ADVISOR_SUGGESTIONS = [
  'איפה אני מפסיד למתחרים בנושא ההמתנה?',
  'מה הנושאים השליליים הנפוצים שלי?',
  'איך הדירוג שלי מושווה לקבוצה?',
];

function ReputationAdvisorChat({ bpId, competitorIds }) {
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]); // [{ role: 'user'|'ai', text }]
  const [loading, setLoading] = useState(false);

  const ask = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', text: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setMsg('');
    setLoading(true);
    try {
      const res = await base44.functions.invoke('reputationAdvisorChat', {
        businessProfileId: bpId,
        competitorIds,
        message: text.trim(),
        history: next.slice(-6),
      });
      const data = res?.data || res;
      setMessages(prev => [...prev, { role: 'ai', text: data?.reply || 'לא התקבלה תשובה' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'שגיאה — נסה שנית' }]);
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-blue-500" />
        <span className="text-[13px] font-semibold text-foreground">יועץ מוניטין AI</span>
        <span className="text-[11px] text-foreground-muted">(מבוסס על נתוני הדף בלבד)</span>
      </div>

      {/* Suggestions — always visible when conversation is empty */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {ADVISOR_SUGGESTIONS.map(s => (
            <button key={s} onClick={() => ask(s)} disabled={loading}
              className="text-[11px] border border-gray-200 rounded-full px-3 py-1 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Message history */}
      {messages.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-blue-50 text-gray-800'
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-end">
              <div className="bg-blue-50 rounded-xl px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={msg}
          onChange={e => setMsg(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && ask(msg)}
          placeholder="שאל שאלה על המוניטין שלך..."
          dir="rtl"
          className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
        <button onClick={() => ask(msg)} disabled={loading || !msg.trim()}
          className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-foreground text-white disabled:opacity-40 hover:opacity-80 transition-opacity">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ReviewsCompare() {
  // @ts-ignore
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const [selectedId, setSelectedId] = useState(null);

  const lsKey = bpId ? `compare-set-${bpId}` : null;
  // ponytail: read comparison set inline — same key as GoogleCompareWidget (R3-3)
  const storedIds = (() => { try { return JSON.parse(localStorage.getItem(lsKey) ?? 'null'); } catch { return null; } })();

  const { data: competitors = [] } = useQuery({
    queryKey: ['competitors', bpId],
    queryFn: () => base44.entities.Competitor.filter({ linked_business: bpId }),
    enabled: !!bpId,
  });

  // null stored → show all; [] → user explicitly cleared set
  const activeIds = storedIds ?? competitors.map(c => c.id);
  const listed = competitors.filter(c => activeIds.includes(c.id));
  const selectedComp = competitors.find(c => c.id === selectedId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3" dir="rtl">
        <Link to="/reviews" className="flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground transition-colors">
          <ArrowRight className="w-4 h-4" />
          חזרה למוניטין
        </Link>
        <span className="text-lg font-semibold text-foreground">השוואת Google</span>
      </div>
      {listed.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide" dir="rtl">
            תובנות ביקורות — מתחרים
          </p>
          <div className="flex flex-wrap gap-2" dir="rtl">
            {listed.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(id => id === c.id ? null : c.id)}
                className={`text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
                  selectedId === c.id
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'border-border text-foreground-secondary hover:border-violet-400 hover:text-foreground'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          {/* AC2: insights panel — read-only, no reply/publish actions (AC3 handled in component) */}
          {selectedComp && (
            <CompetitorReviewInsightsPanel key={selectedId} competitor={selectedComp} businessProfileId={bpId} />
          )}
        </div>
      )}
      <TopicTimelineWidget businessProfileId={bpId} businessName={businessProfile?.name} />
      <ReputationAdvisorChat bpId={bpId} competitorIds={activeIds} />
    </div>
  );
}
