import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'לפני פחות משעה';
  if (hours < 24) return `לפני ${hours} שעות`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

const TABS = [
  { key: 'urgent',     label: 'דחוף',   color: '#dc2626' },
  { key: 'today',      label: 'היום',   color: '#d97706' },
  { key: 'monitoring', label: 'מעקב',   color: '#6366f1' },
];

export default function UrgentActions({ reviews, leads, signals, competitors }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionState, setActionState] = useState({});
  const [activeTab, setActiveTab] = useState('urgent');

  const todayStr = new Date().toISOString().split('T')[0];
  const weekAgo  = new Date(Date.now() - 7 * 24 * 3600000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 3600000).toISOString();

  // Build all items with category tag
  const items = [];

  // Negative reviews — always URGENT
  const negReviews = (reviews || []).filter(r => r.response_status === 'pending' && (r.sentiment === 'negative' || (r.rating && r.rating <= 2)));
  negReviews.slice(0, 2).forEach(r => {
    items.push({
      type: 'review', category: 'urgent',
      id: r.id, reviewerName: r.reviewer_name, reviewText: r.text, platform: r.platform,
      icon: '⭐',
      title: `ביקורת שלילית — ${r.reviewer_name || 'אנונימי'} ב${r.platform || 'לא ידוע'}`,
      desc: (r.text || '').slice(0, 70) + ((r.text || '').length > 70 ? '...' : ''),
      source: r.source_url ? { label: `${r.platform || 'מקור'} ←`, url: r.source_url } : null,
      time: timeAgo(r.created_at || r.created_date),
      urgency: 1, borderColor: '#dc2626',
    });
  });

  // Hot leads: new today → urgent; older → today
  const hotLeads = (leads || []).filter(l => l.status === 'hot' && l.lifecycle_stage === 'new');
  hotLeads.slice(0, 3).forEach(l => {
    const createdAt = l.created_at || l.created_date || '';
    const isNew = createdAt >= oneDayAgo;
    items.push({
      type: 'lead', category: isNew ? 'urgent' : 'today',
      id: l.id, leadName: l.name, phone: l.contact_phone || (l.contact_info?.match(/[\d\-+()]{7,}/)?.[0] ?? ''),
      serviceNeeded: l.service_needed, linked_business: l.linked_business,
      icon: '🔥',
      title: `ליד חם — ${l.name} (ציון ${l.score})`,
      desc: [l.service_needed, l.budget_range ? `תקציב ${l.budget_range}` : null].filter(Boolean).join(', '),
      source: l.source_url ? { label: `${l.source || 'מקור'} ←`, url: l.source_url } : l.source ? { label: `זוהה ב: ${l.source}`, url: null } : null,
      time: timeAgo(createdAt),
      urgency: 2, borderColor: '#10b981',
    });
  });

  // Competitor changes: price drops this week → today; others → monitoring
  const compChanges = (competitors || []).filter(c => c.price_changed_at && c.price_changed_at >= weekAgo);
  compChanges.slice(0, 2).forEach(c => {
    const isPriceAlert = c.price_changed_at >= oneDayAgo;
    items.push({
      type: 'competitor', category: isPriceAlert ? 'today' : 'monitoring',
      id: c.id, icon: '⚠️',
      title: `שינוי אצל ${c.name}${c.current_promotions ? ' — מבצע חדש!' : ''}`,
      desc: c.current_promotions || c.price_points || `דירוג: ${c.rating || '?'}`,
      source: null,
      action: { label: 'צפה ←', onClick: () => navigate('/competitors') },
      time: timeAgo(c.price_changed_at || c.last_scanned),
      urgency: 3, borderColor: '#d97706',
    });
  });

  // High-impact signals → today; others → monitoring
  const urgentSignals = (signals || []).filter(s => !s.is_read && s.impact_level === 'high');
  urgentSignals.slice(0, 2).forEach(s => {
    const sourceUrl = s.source_urls ? s.source_urls.split('|')[0].trim() : null;
    const isToday = (s.detected_at || s.created_date || '') >= oneDayAgo;
    items.push({
      type: 'signal', category: isToday ? 'today' : 'monitoring',
      id: s.id, icon: '📊',
      title: s.summary,
      desc: s.recommended_action || '',
      source: sourceUrl ? { label: 'צפה במקור ←', url: sourceUrl } : s.source_description ? { label: s.source_description, url: null } : null,
      action: { label: 'צפה ←', onClick: () => navigate('/signals') },
      time: timeAgo(s.detected_at || s.created_date),
      urgency: 4, borderColor: '#6366f1',
    });
  });

  // Medium/low signals → monitoring
  const lowSignals = (signals || []).filter(s => !s.is_read && s.impact_level !== 'high');
  lowSignals.slice(0, 2).forEach(s => {
    const sourceUrl = s.source_urls ? s.source_urls.split('|')[0].trim() : null;
    items.push({
      type: 'signal', category: 'monitoring',
      id: s.id, icon: '📈',
      title: s.summary,
      desc: s.recommended_action || '',
      source: sourceUrl ? { label: 'צפה במקור ←', url: sourceUrl } : null,
      action: { label: 'צפה ←', onClick: () => navigate('/signals') },
      time: timeAgo(s.detected_at || s.created_date),
      urgency: 5, borderColor: '#94a3b8',
    });
  });

  items.sort((a, b) => a.urgency - b.urgency);

  // Tab counts
  const urgentItems    = items.filter(i => i.category === 'urgent').slice(0, 3); // max 3 urgent
  const todayItems     = items.filter(i => i.category === 'today');
  const monitorItems   = items.filter(i => i.category === 'monitoring');

  const tabItems = { urgent: urgentItems, today: todayItems, monitoring: monitorItems };
  const display = tabItems[activeTab] || [];

  const handleQuickReply = async (item) => {
    setActionState(prev => ({ ...prev, [item.id]: { loading: true } }));
    try {
      const reply = await base44.integrations.Core.InvokeLLM({
        prompt: `כתוב תגובת מנהל מקצועית ומכבדת בעברית לביקורת זו. 2-3 שורות מקסימום. טון אדיב, ללא הגנתיות.

ביקורת מאת ${item.reviewerName || 'לקוח'} ב${item.platform || 'פלטפורמה'}:
"${(item.reviewText || '').substring(0, 300)}"

כתוב רק את תגובת המנהל, ללא הסברים נוספים.`
      });
      setActionState(prev => ({ ...prev, [item.id]: { text: typeof reply === 'string' ? reply : '', loading: false } }));
    } catch (_) {
      toast.error('שגיאה ביצירת תגובה');
      setActionState(prev => ({ ...prev, [item.id]: { loading: false } }));
    }
  };

  const handleApproveReply = async (itemId, text) => {
    try {
      await base44.entities.Review.update(itemId, { suggested_response: text, response_status: 'responded' });
      queryClient.invalidateQueries({ queryKey: ['allReviews'] });
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] });
      setActionState(prev => ({ ...prev, [itemId]: { ...prev[itemId], approved: true } }));
      toast.success('תגובה נשמרה ✓');
    } catch (_) {
      toast.error('שגיאה בשמירה');
    }
  };

  const handleWhatsAppLead = async (item) => {
    setActionState(prev => ({ ...prev, [item.id]: { loading: true } }));
    try {
      const res = await base44.functions.invoke('generateLeadFirstContact', {
        leadId: item.id,
        businessProfileId: item.linked_business,
      });
      const message = res?.data?.message || res?.message || `שלום ${item.leadName}, ראיתי שאתה מחפש ${item.serviceNeeded || 'שירות'}. אשמח לעזור!`;
      const phone = (item.phone || '').replace(/[^0-9+]/g, '');
      const encodedMsg = encodeURIComponent(message);
      const waUrl = phone
        ? `https://wa.me/${phone.startsWith('0') ? '972' + phone.slice(1) : phone}?text=${encodedMsg}`
        : `https://wa.me/?text=${encodedMsg}`;
      window.open(waUrl, '_blank');
      await base44.entities.Lead.update(item.id, {
        status: 'contacted',
        lifecycle_stage: 'contacted',
        lifecycle_updated_at: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['allLeads'] });
      queryClient.invalidateQueries({ queryKey: ['hotLeads'] });
      setActionState(prev => ({ ...prev, [item.id]: { sent: true, loading: false } }));
    } catch (_) {
      toast.error('שגיאה בשליחה');
      setActionState(prev => ({ ...prev, [item.id]: { loading: false } }));
    }
  };

  return (
    <div className="card-base overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        {urgentItems.length > 0 && <span className="w-2 h-2 rounded-full bg-[#dc2626] animate-pulse" />}
        <h3 className="text-[12px] font-semibold text-foreground">דורש טיפול עכשיו</h3>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map(tab => {
          const count = tabItems[tab.key]?.length ?? 0;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 text-[11px] font-medium transition-colors relative ${
                isActive ? 'text-foreground' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[9px] font-bold mr-1"
                  style={{ background: tab.color }}
                >
                  {count}
                </span>
              )}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: tab.color }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: '300px' }}>
        {display.length === 0 ? (
          <div className="flex items-center justify-center h-full py-10">
            <p className="text-[12px] text-success">
              {activeTab === 'urgent' ? '🎉 אין פריטים דחופים — הכל תחת שליטה' : 'אין פריטים'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {display.map((item, i) => {
              const state = actionState[item.id] || {};
              return (
                <div key={i} className="px-4 py-3 hover:bg-secondary/30 transition-colors" style={{ borderRight: `2px solid ${item.borderColor}` }}>
                  <div className="flex items-start gap-2">
                    <span className="text-[13px] mt-0.5 flex-shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-foreground leading-snug">{item.title}</p>
                      {item.desc && <p className="text-[10px] text-foreground-muted mt-0.5 line-clamp-1">{item.desc}</p>}
                      <div className="flex items-center gap-2 mt-1.5">
                        {item.source && (
                          item.source.url ? (
                            <a href={item.source.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                              className="flex items-center gap-0.5 text-[9px] text-foreground-muted hover:text-foreground hover:underline transition-colors">
                              <ExternalLink className="w-2.5 h-2.5" />{item.source.label}
                            </a>
                          ) : (
                            <span className="text-[9px] text-foreground-muted">{item.source.label}</span>
                          )
                        )}
                        <span className="text-[9px] text-foreground-muted opacity-50">{item.time}</span>
                      </div>

                      {/* Review inline actions */}
                      {item.type === 'review' && (() => {
                        if (state.approved) return <p className="mt-2 text-[10px] text-success font-medium">נשמר ✓</p>;
                        if (state.text) return (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              className="w-full text-[10px] border border-border rounded px-2 py-1.5 resize-none bg-white focus:outline-none focus:border-primary"
                              rows={3}
                              value={state.editedText ?? state.text}
                              onChange={e => setActionState(prev => ({ ...prev, [item.id]: { ...prev[item.id], editedText: e.target.value } }))}
                            />
                            <div className="flex gap-1.5">
                              <button onClick={() => handleApproveReply(item.id, state.editedText ?? state.text)}
                                className="px-2.5 py-1 text-[10px] font-medium bg-success text-white rounded hover:opacity-90 transition-all">
                                אשר ✓
                              </button>
                              <button onClick={() => setActionState(prev => ({ ...prev, [item.id]: {} }))}
                                className="px-2.5 py-1 text-[10px] text-foreground-muted border border-border rounded hover:bg-secondary transition-all">
                                ביטול
                              </button>
                            </div>
                          </div>
                        );
                        return (
                          <button onClick={() => handleQuickReply(item)} disabled={state.loading}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium bg-foreground text-background hover:opacity-90 transition-all disabled:opacity-60">
                            {state.loading && <Loader2 className="w-3 h-3 animate-spin" />}
                            {state.loading ? 'מייצר תגובה...' : 'הגב עכשיו →'}
                          </button>
                        );
                      })()}

                      {/* Lead inline actions */}
                      {item.type === 'lead' && (() => {
                        if (state.sent) return <p className="mt-2 text-[10px] text-success font-medium">WhatsApp נפתח ✓</p>;
                        return (
                          <button onClick={() => handleWhatsAppLead(item)} disabled={state.loading}
                            className="mt-2 flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-medium bg-[#25D366] text-white hover:opacity-90 transition-all disabled:opacity-60">
                            {state.loading && <Loader2 className="w-3 h-3 animate-spin" />}
                            {state.loading ? 'מכין...' : 'שלח WhatsApp →'}
                          </button>
                        );
                      })()}

                      {/* Default action for competitor / signal */}
                      {item.type !== 'review' && item.type !== 'lead' && item.action && (
                        <button onClick={item.action.onClick}
                          className="mt-2 btn-subtle px-3 py-1 rounded-md text-[10px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
                          {item.action.label}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && (
        <div className="px-4 py-2 border-t border-border">
          <span className="text-[10px] text-foreground-muted">
            {urgentItems.length} דחוף · {todayItems.length} היום · {monitorItems.length} מעקב
          </span>
        </div>
      )}
    </div>
  );
}
