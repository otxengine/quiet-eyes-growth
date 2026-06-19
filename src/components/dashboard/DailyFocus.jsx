import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, CheckCheck, ChevronLeft, ThumbsUp, ThumbsDown } from 'lucide-react';

// ─── Priority levels ──────────────────────────────────────────────────────────
// P0 = red (act now), P1 = orange (today), P2 = purple (monitor)
const P = {
  0: { dot: 'bg-red-500',    border: 'border-r-red-400',    label: 'דחוף' },
  1: { dot: 'bg-orange-400', border: 'border-r-orange-300', label: 'היום' },
  2: { dot: 'bg-primary/50', border: 'border-r-primary/30', label: 'מעקב' },
};

function timeAgo(d) {
  if (!d) return '';
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (h < 1) return 'עכשיו';
  if (h < 24) return `לפני ${h}ש`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

// ─── Single action row ────────────────────────────────────────────────────────
function ActionRow({ item, onDone, bpId }) {
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [replyText, setReply] = useState(null);
  const [edited, setEdited]   = useState('');
  const [feedback, setFeedback] = useState(null); // 'positive' | 'negative'

  const handleFeedback = async (isPositive) => {
    if (feedback) return;
    setFeedback(isPositive ? 'positive' : 'negative');
    try {
      await base44.functions.invoke('submitFeedback', {
        businessProfileId: bpId || item.meta?.linked_business || item.meta?.bpId,
        entity_type: item.type === 'signal' ? 'MarketSignal' : 'ProactiveAlert',
        entity_id: item.id,
        rating: isPositive ? 5 : 1,
        tags: [isPositive ? 'relevant' : 'irrelevant'],
        agent_name: item.type,
      });
    } catch { /* non-fatal */ }
  };

  if (done) return null;

  const p = P[item.priority] || P[1];

  // ── Reply to review ─────────────────────────────────────────────────────────
  const handleReply = async () => {
    setBusy(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        model: 'sonnet',
        maxTokens: 300,
        prompt: `כתוב תגובת מנהל מקצועית ומשפיעה לביקורת. התגובה חייבת להיות ספציפית לביקורת — לא גנרית.

ביקורת מאת ${item.meta?.reviewer || 'לקוח'}: "${(item.meta?.text || '').slice(0, 400)}"

הנחיות: 2-3 שורות, פנה בשם, הכר את הנקודה הספציפית, הצע פתרון/הזמנה ישירה. ללא תירוצים.
כתוב רק את התגובה.`,
      });
      const text = typeof res === 'string' ? res : '';
      setReply(text);
      setEdited(text);
    } catch { toast.error('שגיאה ביצירת תגובה'); }
    setBusy(false);
  };

  const handleApproveReply = async () => {
    setBusy(true);
    try {
      await base44.entities.Review.update(item.id, { suggested_response: edited, response_status: 'responded' });
      qc.invalidateQueries({ queryKey: ['allReviews'] });
      qc.invalidateQueries({ queryKey: ['pendingReviews'] });
      toast.success('תגובה נשמרה ✓');
      setDone(true);
      onDone?.();
    } catch { toast.error('שגיאה בשמירה'); }
    setBusy(false);
  };

  // ── WhatsApp lead ────────────────────────────────────────────────────────────
  const handleWhatsApp = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('generateLeadFirstContact', {
        leadId: item.id,
        businessProfileId: item.meta?.linked_business,
      });
      const msg = res?.data?.message || res?.message || `שלום ${item.meta?.name}, ראיתי שאתה מחפש ${item.meta?.service || 'שירות'}. אשמח לעזור!`;
      const raw   = (item.meta?.phone || '').replace(/[^0-9+]/g, '');
      const phone = raw.startsWith('0') ? '972' + raw.slice(1) : raw;
      const url   = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
        : `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      await base44.entities.Lead.update(item.id, { status: 'contacted', lifecycle_stage: 'contacted' });
      qc.invalidateQueries({ queryKey: ['allLeads'] });
      qc.invalidateQueries({ queryKey: ['hotLeads'] });
      toast.success('WhatsApp נפתח ✓');
      setDone(true);
      onDone?.();
    } catch { toast.error('שגיאה'); }
    setBusy(false);
  };

  // ── Approve auto-action ──────────────────────────────────────────────────────
  const handleApproveAction = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke('approveAction', { actionId: item.id, businessProfileId: item.meta?.bpId });
      qc.invalidateQueries({ queryKey: ['eventBusStats'] });
      toast.success('פעולה בוצעה ✓');
      setDone(true);
      onDone?.();
    } catch (e) { toast.error(e.message || 'שגיאה בביצוע הפעולה'); }
    setBusy(false);
  };

  const handleRejectAction = async () => {
    try {
      await base44.functions.invoke('rejectAction', { actionId: item.id, businessProfileId: item.meta?.bpId });
      qc.invalidateQueries({ queryKey: ['eventBusStats'] });
      setDone(true);
    } catch {}
  };

  return (
    <div className={`group flex items-start gap-3 px-4 py-3.5 border-r-[3px] ${p.border} hover:bg-secondary/30 transition-colors`}>
      {/* Priority dot */}
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${p.dot}`} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[13px] flex-shrink-0">{item.emoji}</span>
            <p className="text-[12px] font-semibold text-foreground leading-snug">{item.title}</p>
          </div>
          <span className="text-[9px] text-foreground-muted opacity-50 flex-shrink-0 mt-0.5">{timeAgo(item.date)}</span>
        </div>

        {/* Sub-text */}
        {item.sub && (
          <p className="text-[11px] text-foreground-muted mt-0.5 line-clamp-1 pr-4">{item.sub}</p>
        )}

        {/* Inline reply textarea */}
        {replyText !== null && (
          <div className="mt-2 space-y-1.5">
            <textarea
              className="w-full text-[11px] border border-border rounded-lg px-3 py-2 resize-none bg-white focus:outline-none focus:border-primary"
              rows={3}
              value={edited}
              onChange={e => setEdited(e.target.value)}
            />
            <div className="flex gap-1.5">
              <button onClick={handleApproveReply} disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-primary text-background rounded-lg hover:opacity-90 disabled:opacity-60">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                אשר ופרסם
              </button>
              <button onClick={() => setReply(null)} className="px-2.5 py-1 text-[10px] text-foreground-muted border border-border rounded-lg hover:bg-secondary">ביטול</button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {replyText === null && (
          <div className="flex items-center gap-2 mt-2">
            {item.type === 'review' && (
              <button onClick={handleReply} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold bg-foreground text-background hover:opacity-80 transition-all disabled:opacity-60">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {busy ? 'מייצר...' : 'הגב עכשיו'}
              </button>
            )}
            {item.type === 'lead' && (
              <button onClick={handleWhatsApp} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold bg-[#25D366] text-white hover:opacity-90 transition-all disabled:opacity-60">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {busy ? 'מכין...' : 'שלח WhatsApp'}
              </button>
            )}
            {item.type === 'auto_action' && (
              <>
                <button onClick={handleApproveAction} disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-primary text-background hover:opacity-90 disabled:opacity-60">
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  אשר ובצע
                </button>
                <button onClick={handleRejectAction} className="px-2.5 py-1 text-[10px] text-foreground-muted border border-border rounded-lg hover:bg-secondary">דחה</button>
              </>
            )}
            {(item.type === 'signal' || item.type === 'competitor' || item.type === 'alert') && (
              <>
                {item.link && (
                  <button onClick={() => navigate(item.link)}
                    className="flex items-center gap-1 text-[10px] font-medium text-foreground-muted hover:text-foreground transition-all">
                    צפה <ChevronLeft className="w-3 h-3" />
                  </button>
                )}
                {feedback ? (
                  <span className="text-[9px] text-foreground-muted">✓</span>
                ) : (
                  <div className="flex items-center gap-0.5 mr-1">
                    <button onClick={() => handleFeedback(true)} title="רלוונטי"
                      className="p-0.5 rounded hover:bg-emerald-100 text-foreground-muted hover:text-emerald-600 transition-all">
                      <ThumbsUp className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleFeedback(false)} title="לא רלוונטי"
                      className="p-0.5 rounded hover:bg-red-100 text-foreground-muted hover:text-red-500 transition-all">
                      <ThumbsDown className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function DailyFocus({ reviews, leads, signals, competitors, pendingActions, bpId }) {
  const [showAll, setShowAll] = useState(false);
  const [doneIds, setDoneIds] = useState(new Set());

  const oneDayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
  const weekAgo   = new Date(Date.now() - 7 * 24 * 3600000).toISOString();

  // Build unified items list
  const rawItems = [];

  // P0 — Negative reviews pending response
  (reviews || [])
    .filter(r => r.response_status === 'pending' && (r.sentiment === 'negative' || (r.rating && r.rating <= 2)))
    .slice(0, 3)
    .forEach(r => rawItems.push({
      id:    r.id,
      type:  'review',
      priority: 0,
      emoji: '⭐',
      title: `ביקורת שלילית — ${r.reviewer_name || 'לקוח'} ב-${r.platform || 'פלטפורמה'}`,
      sub:   (r.content || r.text || '').slice(0, 90),
      date:  r.created_at || r.created_date,
      link:  '/reviews',
      meta:  { reviewer: r.reviewer_name, text: r.content || r.text, platform: r.platform },
    }));

  // P0 — Hot leads (< 24h) → urgent
  // P1 — Hot leads (older)
  (leads || [])
    .filter(l => l.status === 'hot' && l.lifecycle_stage === 'new')
    .slice(0, 3)
    .forEach(l => {
      const isNew = (l.created_at || l.created_date || '') >= oneDayAgo;
      const phone = l.contact_phone || (l.contact_info?.match(/[\d\-+()]{7,}/)?.[0] ?? '');
      rawItems.push({
        id:    l.id,
        type:  'lead',
        priority: isNew ? 0 : 1,
        emoji: '🔥',
        title: `ליד חם — ${l.name || l.contact_name} (ציון ${l.score || '?'})`,
        sub:   [l.service_needed, l.budget_range ? `תקציב ${l.budget_range}` : null, l.source ? `מ-${l.source}` : null].filter(Boolean).join(' · '),
        date:  l.created_at || l.created_date,
        link:  '/leads',
        meta:  { name: l.name, phone, service: l.service_needed, linked_business: l.linked_business },
      });
    });

  // P0 — Auto-actions pending approval
  (Array.isArray(pendingActions) ? pendingActions : []).slice(0, 2).forEach(a => rawItems.push({
    id:    a.id,
    type:  'auto_action',
    priority: 0,
    emoji: '⚡',
    title: a.description || 'פעולה אוטומטית ממתינה',
    sub:   a.action_type ? `סוג: ${a.action_type}` : null,
    date:  a.created_date,
    link:  null,
    meta:  { bpId },
  }));

  // P1 — Competitor price changes this week
  (competitors || [])
    .filter(c => c.price_changed_at && c.price_changed_at >= weekAgo)
    .slice(0, 2)
    .forEach(c => rawItems.push({
      id:    c.id,
      type:  'competitor',
      priority: c.price_changed_at >= oneDayAgo ? 1 : 2,
      emoji: '⚠️',
      title: `שינוי אצל ${c.name}${c.current_promotions ? ' — מבצע חדש' : ''}`,
      sub:   c.current_promotions || c.price_points || `דירוג ${c.rating || '?'}⭐`,
      date:  c.price_changed_at || c.last_scanned,
      link:  '/competitors',
      meta:  {},
    }));

  // P1 — High-impact signals (unread, today)
  (signals || [])
    .filter(s => !s.is_read && s.impact_level === 'high')
    .slice(0, 2)
    .forEach(s => rawItems.push({
      id:    s.id,
      type:  'signal',
      priority: (s.detected_at || s.created_date || '') >= oneDayAgo ? 1 : 2,
      emoji: '📊',
      title: s.summary,
      sub:   s.recommended_action,
      date:  s.detected_at || s.created_date,
      link:  `/insights/signal-${s.id}`,
      meta:  {},
    }));

  // Sort by priority then date (newest first)
  rawItems.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
  });

  const items = rawItems.filter(i => !doneIds.has(i.id));
  const MAX_DEFAULT = 4;
  const display = showAll ? items : items.slice(0, MAX_DEFAULT);
  const hiddenCount = items.length - MAX_DEFAULT;

  if (items.length === 0) {
    return (
      <div className="card-base px-5 py-6 mb-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
          <CheckCheck className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-foreground">הכל טופל — אין פעולות ממתינות</p>
          <p className="text-[11px] text-foreground-muted mt-0.5">המערכת ממשיכה לנטר בשבילך 24/7</p>
        </div>
      </div>
    );
  }

  const p0Count = items.filter(i => i.priority === 0).length;

  return (
    <div className="card-base overflow-hidden mb-4">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
        <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
          <span className="text-[11px]">🎯</span>
        </div>
        <h2 className="text-[13px] font-bold text-foreground">הדברים החשובים לעשות</h2>
        {p0Count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[9px] font-bold">
            {p0Count}
          </span>
        )}
        <div className="flex items-center gap-2 mr-auto">
          {[0,1,2].map(lvl => {
            const cnt = items.filter(i => i.priority === lvl).length;
            if (!cnt) return null;
            return (
              <span key={lvl} className={`text-[9px] font-medium flex items-center gap-1 ${lvl === 0 ? 'text-red-500' : lvl === 1 ? 'text-orange-500' : 'text-primary/70'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${P[lvl].dot}`} />
                {cnt} {P[lvl].label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-border/60">
        {display.map(item => (
          <ActionRow
            key={item.id}
            item={item}
            bpId={bpId}
            onDone={() => setDoneIds(prev => new Set([...prev, item.id]))}
          />
        ))}
      </div>

      {/* Show more / less */}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2.5 text-[11px] text-foreground-muted hover:text-foreground hover:bg-secondary/30 transition-all text-center border-t border-border/60"
        >
          ועוד {hiddenCount} פריטים →
        </button>
      )}
      {showAll && items.length > MAX_DEFAULT && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full py-2.5 text-[11px] text-foreground-muted hover:text-foreground hover:bg-secondary/30 transition-all text-center border-t border-border/60"
        >
          הצג פחות ↑
        </button>
      )}
    </div>
  );
}
