import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Calendar, User, MapPin, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';

const statusConfig = {
  pending: { label: 'ממתין', icon: Clock, color: 'text-foreground-muted', bg: 'bg-secondary' },
  in_progress: { label: 'בביצוע', icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10' },
  done: { label: 'הושלם', icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
  cancelled: { label: 'בוטל', icon: XCircle, color: 'text-danger', bg: 'bg-danger/10' },
};

const priorityConfig = {
  critical: { label: 'קריטי', dot: 'bg-danger' },
  high: { label: 'גבוה', dot: 'bg-warning' },
  medium: { label: 'בינוני', dot: 'bg-primary' },
  low: { label: 'נמוך', dot: 'bg-foreground-muted' },
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (diff < 0) return `באיחור של ${Math.abs(diff)} ימים`;
  if (diff === 0) return 'היום';
  if (diff === 1) return 'מחר';
  return `בעוד ${diff} ימים`;
}

export default function TaskCard({ task, onStatusChange }) {
  const [expanded, setExpanded] = React.useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const status = statusConfig[task.status] || statusConfig.pending;
  const priority = priorityConfig[task.priority] || priorityConfig.medium;
  const StatusIcon = status.icon;
  const dueLabel = daysUntil(task.due_date);
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' && task.status !== 'cancelled';

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const nextStatuses = {
    pending: 'in_progress',
    in_progress: 'done',
  };

  return (
    <div className={`card-base ${isOverdue ? 'border-danger/30' : ''}`}>
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-2 ${priority.dot}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[13px] font-semibold cursor-pointer hover:underline ${task.status === 'done' ? 'text-foreground-muted line-through' : 'text-foreground'}`}
                onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${task.id}`); }}
              >
                {task.title}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${status.bg} ${status.color}`}>
                <StatusIcon className="w-3 h-3" /> {status.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-foreground-muted">
              {task.assignee && (
                <span className="flex items-center gap-1"><User className="w-3 h-3" />{task.assignee}</span>
              )}
              {task.branch && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{task.branch}</span>
              )}
              {task.due_date && (
                <span className={`flex items-center gap-1 ${isOverdue ? 'text-danger font-medium' : ''}`}>
                  <Calendar className="w-3 h-3" />{dueLabel}
                </span>
              )}
              {task.source_type === 'alert' && (
                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-medium">מהתראת AI</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {nextStatuses[task.status] && (
              <button
                onClick={(e) => { e.stopPropagation(); updateMutation.mutate({ id: task.id, data: { status: nextStatuses[task.status], ...(nextStatuses[task.status] === 'done' ? { completed_at: new Date().toISOString() } : {}) } }); }}
                className="btn-subtle px-3 py-1.5 rounded-lg text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-all"
              >
                {task.status === 'pending' ? 'התחל' : 'סיים'}
              </button>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-foreground-muted/30" /> : <ChevronDown className="w-4 h-4 text-foreground-muted/30" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3 fade-in-up">
          {task.description && <p className="text-[12px] text-foreground-secondary leading-relaxed">{task.description}</p>}
          {task.notes && (
            <div>
              <span className="text-[10px] font-medium text-foreground-muted block mb-1">הערות</span>
              <p className="text-[11px] text-foreground-secondary">{task.notes}</p>
            </div>
          )}
          <div className="flex gap-2">
            {['pending', 'in_progress', 'done', 'cancelled'].map(s => {
              const cfg = statusConfig[s];
              const Icon = cfg.icon;
              return (
                <button key={s} onClick={() => updateMutation.mutate({ id: task.id, data: { status: s, ...(s === 'done' ? { completed_at: new Date().toISOString() } : {}) } })}
                  className={`btn-subtle flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all ${
                    task.status === s ? `${cfg.bg} ${cfg.color} border-current` : 'bg-secondary border-border text-foreground-muted hover:border-border-hover'
                  }`}>
                  <Icon className="w-3 h-3" /> {cfg.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}