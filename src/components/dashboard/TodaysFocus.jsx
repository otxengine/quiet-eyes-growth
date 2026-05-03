import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Zap, Star, Users, Target, ChevronRight, CheckCheck } from 'lucide-react';

function scoreItem(item) {
  let score = 0;
  const priority = item.priority || item.urgency || '';
  if (priority === 'critical') score += 40;
  else if (priority === 'high') score += 30;
  else if (priority === 'medium') score += 20;
  else score += 10;
  const type = item._type || '';
  if (type === 'review' && item.sentiment === 'negative') score += 25;
  if (type === 'lead' && item.status === 'hot') score += 20;
  if (type === 'alert' && item.alert_type === 'action_needed') score += 15;
  if (type === 'alert' && item.alert_type === 'negative_review') score += 15;
  return score;
}

function FocusItem({ item, onDone }) {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  const handleDone = (e) => {
    e.stopPropagation();
    setDone(true);
    onDone?.(item);
  };

  const handleClick = () => {
    if (item._type === 'alert') navigate(`/insights/alert-${item.id}`);
    else if (item._type === 'review') navigate('/reputation');
    else if (item._type === 'lead') navigate('/leads');
    else if (item._type === 'task') navigate(`/tasks/${item.id}`);
  };

  const iconMap = {
    alert: <Zap className="w-3.5 h-3.5" style={{ color: item._color || '#ef4444' }} />,
    review: <Star className="w-3.5 h-3.5 text-amber-500" />,
    lead: <Users className="w-3.5 h-3.5 text-blue-500" />,
    task: <Target className="w-3.5 h-3.5 text-purple-500" />,
  };

  const badgeMap = {
    critical: { cls: 'bg-red-100 text-red-700', label: 'דחוף מאוד' },
    high:     { cls: 'bg-orange-100 text-orange-700', label: 'גבוה' },
    medium:   { cls: 'bg-yellow-100 text-yellow-700', label: 'בינוני' },
    low:      { cls: 'bg-gray-100 text-gray-600', label: 'נמוך' },
    hot:      { cls: 'bg-red-100 text-red-700', label: 'חם' },
    negative: { cls: 'bg-red-100 text-red-700', label: 'שלילי' },
  };

  const urgencyKey = item.priority || item.status || item.sentiment || 'medium';
  const badge = badgeMap[urgencyKey] || badgeMap.medium;

  if (done) return null;

  return (
    <div
      onClick={handleClick}
      className="flex items-center gap-3 p-3 rounded-xl bg-secondary/60 hover:bg-secondary cursor-pointer transition-all group"
    >
      <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
        {iconMap[item._type] || iconMap.alert}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-foreground truncate">{item.title || item.name}</p>
        {item.description && (
          <p className="text-[10px] text-foreground-muted truncate mt-0.5">{item.description}</p>
        )}
      </div>
      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>
        {badge.label}
      </span>
      <button
        onClick={handleDone}
        className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-green-100 text-green-600 transition-all flex-shrink-0"
        title="סמן כבוצע"
      >
        <CheckCheck className="w-3.5 h-3.5" />
      </button>
      <ChevronRight className="w-3 h-3 text-foreground-muted/40 flex-shrink-0" />
    </div>
  );
}

export default function TodaysFocus({ bpId, alerts = [], reviews = [], leads = [], tasks = [] }) {
  const queryClient = useQueryClient();

  const dismissAlert = useMutation({
    mutationFn: (id) => base44.entities.ProactiveAlert.update(id, { is_acted_on: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proactiveAlerts'] }),
  });

  // Build unified item list
  const items = [
    ...alerts
      .filter(a => !a.is_dismissed && !a.is_acted_on)
      .map(a => ({ ...a, _type: 'alert', _color: a.alert_type?.includes('negative') || a.alert_type === 'action_needed' ? '#ef4444' : '#f59e0b' })),
    ...reviews
      .filter(r => r.response_status === 'pending' && (r.sentiment === 'negative' || (r.rating && r.rating <= 2)))
      .map(r => ({ ...r, _type: 'review', title: `ביקורת שלילית: ${r.reviewer_name || 'לקוח'}`, description: r.content?.slice(0, 80), priority: 'high' })),
    ...leads
      .filter(l => l.status === 'hot')
      .map(l => ({ ...l, _type: 'lead', title: `ליד חם: ${l.name || l.contact_name || 'ליד'}`, description: l.source ? `מקור: ${l.source}` : l.notes?.slice(0, 60), priority: 'high' })),
    ...tasks
      .filter(t => t.status !== 'completed' && t.due_date && new Date(t.due_date) < new Date())
      .map(t => ({ ...t, _type: 'task', title: t.title, description: 'עבר המועד הנדרש', priority: 'high' })),
  ].sort((a, b) => scoreItem(b) - scoreItem(a)).slice(0, 3);

  if (items.length === 0) return null;

  const handleDone = (item) => {
    if (item._type === 'alert') dismissAlert.mutate(item.id);
  };

  return (
    <div className="card-base p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-full bg-foreground flex items-center justify-center">
          <Zap className="w-3 h-3 text-background" />
        </div>
        <h3 className="text-[13px] font-bold text-foreground">3 הפעולות של היום</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold mr-auto">
          {items.length} ממתינות
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <FocusItem key={`${item._type}-${item.id}`} item={item} onDone={handleDone} />
        ))}
      </div>
    </div>
  );
}
