import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowRight, Loader2, Plus, X, Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG = {
  pending:     { label: 'ממתין',   bg: 'bg-secondary',    text: 'text-foreground-muted' },
  in_progress: { label: 'בביצוע',  bg: 'bg-blue-50',      text: 'text-blue-600' },
  done:        { label: 'הושלם',   bg: 'bg-emerald-50',   text: 'text-emerald-700' },
  cancelled:   { label: 'בוטל',    bg: 'bg-red-50',       text: 'text-red-600' },
};

const PRIORITY_CONFIG = {
  critical: { label: 'קריטי', dot: 'bg-red-500',     badge: 'bg-red-50 text-red-600 border-red-200' },
  high:     { label: 'גבוה',  dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  medium:   { label: 'בינוני', dot: 'bg-blue-500',   badge: 'bg-blue-50 text-blue-600 border-blue-200' },
  low:      { label: 'נמוך',  dot: 'bg-gray-400',    badge: 'bg-gray-50 text-gray-600 border-gray-200' },
};

function parseDescription(description = '') {
  let signalId = null;
  let checklist = { items: [] };
  let plainText = description;

  const signalMatch = plainText.match(/^\[signal:([^\]]+)\]\n?/);
  if (signalMatch) {
    signalId = signalMatch[1];
    plainText = plainText.slice(signalMatch[0].length);
  }

  // checklist can appear after signal prefix or at start
  const checklistMatch = plainText.match(/\[checklist:(\{[\s\S]*?\})\]\n?/);
  if (checklistMatch) {
    try { checklist = JSON.parse(checklistMatch[1]); } catch {}
    plainText = plainText.replace(checklistMatch[0], '');
  }

  // strip trailing "מקור: ..." line added by ActionPopup
  plainText = plainText.replace(/\n\nמקור:.*$/s, '').trim();

  return { signalId, checklist, plainText };
}

function buildDescription(signalId, checklist, plainText) {
  let parts = [];
  if (signalId) parts.push(`[signal:${signalId}]`);
  if (checklist.items.length > 0) parts.push(`[checklist:${JSON.stringify(checklist)}]`);
  if (plainText.trim()) parts.push(plainText.trim());
  return parts.join('\n');
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (diff < 0) return { text: `באיחור ${Math.abs(diff)} ימים`, overdue: true };
  if (diff === 0) return { text: 'היום', overdue: false };
  if (diff === 1) return { text: 'מחר', overdue: false };
  return { text: `בעוד ${diff} ימים`, overdue: false };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function TaskDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { businessProfile } = useOutletContext();
  const queryClient = useQueryClient();

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const titleInputRef = useRef(null);
  const descInputRef = useRef(null);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => base44.entities.Task.get(taskId),
    enabled: !!taskId,
  });

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.update(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  useEffect(() => {
    if (task) {
      const { plainText } = parseDescription(task.description);
      setTitleDraft(task.title || '');
      setDescDraft(plainText);
      setNotesDraft(task.notes || '');
    }
  }, [task?.id]); // eslint-disable-line

  useEffect(() => {
    if (editingTitle && titleInputRef.current) titleInputRef.current.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc && descInputRef.current) descInputRef.current.focus();
  }, [editingDesc]);

  const saveTitle = () => {
    if (titleDraft.trim() && titleDraft !== task?.title) {
      updateMutation.mutate({ title: titleDraft.trim() });
      toast.success('הכותרת עודכנה');
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    const { signalId, checklist } = parseDescription(task?.description || '');
    const newFull = buildDescription(signalId, checklist, descDraft);
    updateMutation.mutate({ description: newFull });
    setEditingDesc(false);
    toast.success('התיאור עודכן');
  };

  const saveNotes = () => {
    updateMutation.mutate({ notes: notesDraft });
    setEditingNotes(false);
    toast.success('ההערות נשמרו');
  };

  const toggleSubtask = (index) => {
    const { signalId, checklist, plainText } = parseDescription(task?.description || '');
    const updated = { items: checklist.items.map((item, i) => i === index ? { ...item, done: !item.done } : item) };
    updateMutation.mutate({ description: buildDescription(signalId, updated, plainText) });
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    const { signalId, checklist, plainText } = parseDescription(task?.description || '');
    const updated = { items: [...checklist.items, { text: newSubtask.trim(), done: false }] };
    updateMutation.mutate({ description: buildDescription(signalId, updated, plainText) });
    setNewSubtask('');
  };

  const removeSubtask = (index) => {
    const { signalId, checklist, plainText } = parseDescription(task?.description || '');
    const updated = { items: checklist.items.filter((_, i) => i !== index) };
    updateMutation.mutate({ description: buildDescription(signalId, updated, plainText) });
  };

  const updateStatus = (status) => {
    updateMutation.mutate({
      status,
      ...(status === 'done' ? { completed_at: new Date().toISOString() } : {}),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-foreground-muted" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-center text-foreground-muted" dir="rtl">
        <p className="mb-3">המשימה לא נמצאה</p>
        <button onClick={() => navigate('/tasks')} className="text-primary text-[13px] hover:underline">
          ← חזור למשימות
        </button>
      </div>
    );
  }

  const { signalId, checklist, plainText } = parseDescription(task.description || '');
  const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
  const priorityCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
  const dueInfo = daysUntil(task.due_date);
  const isOverdue = dueInfo?.overdue;
  const doneItems = checklist.items.filter(i => i.done).length;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <button
          onClick={() => navigate('/tasks')}
          className="flex items-center gap-1.5 text-[12px] text-foreground-muted hover:text-foreground transition-colors mt-0.5 flex-shrink-0"
        >
          <ArrowRight className="w-4 h-4" /> משימות
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {task.status === 'pending' && (
            <button onClick={() => updateStatus('in_progress')}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[12px] font-semibold hover:bg-blue-700 transition-all">
              התחל
            </button>
          )}
          {task.status === 'in_progress' && (
            <button onClick={() => updateStatus('done')}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[12px] font-semibold hover:bg-emerald-700 transition-all">
              סיים ✓
            </button>
          )}
          {task.status === 'done' && (
            <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[12px] font-semibold border border-emerald-200">
              ✓ הושלם
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      {editingTitle ? (
        <div className="mb-3">
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
            className="w-full text-[18px] font-bold text-foreground bg-secondary border border-border rounded-xl px-3 py-2 outline-none focus:border-primary"
            dir="rtl"
          />
        </div>
      ) : (
        <h1
          className={`text-[18px] font-bold mb-3 cursor-pointer hover:bg-secondary rounded-lg px-1 -mx-1 py-0.5 transition-colors ${
            task.status === 'done' ? 'text-foreground-muted line-through' : 'text-foreground'
          }`}
          onClick={() => setEditingTitle(true)}
          title="לחץ לעריכה"
        >
          {task.title}
        </h1>
      )}

      {/* Meta badges row */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Status dropdown */}
        <div className="relative group">
          <button className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold rounded-full border ${statusCfg.bg} ${statusCfg.text} border-border`}>
            {statusCfg.label} ▾
          </button>
          <div className="absolute top-full mt-1 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-10 hidden group-hover:block min-w-[110px]">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button key={key} onClick={() => updateStatus(key)}
                className={`w-full text-right px-4 py-2 text-[12px] hover:bg-secondary transition-colors ${task.status === key ? 'font-bold text-foreground' : 'text-foreground-muted'}`}>
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-full border ${priorityCfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityCfg.dot}`} />
          {priorityCfg.label}
        </span>

        {task.due_date && (
          <span className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border ${
            isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-secondary text-foreground-muted border-border'
          }`}>
            📅 {dueInfo.text}
          </span>
        )}

        {task.source_type === 'alert' && (
          <span className="inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border bg-purple-50 text-purple-600 border-purple-200">
            🤖 AI
          </span>
        )}

        <span className="inline-flex items-center gap-1 px-3 py-1 text-[11px] text-foreground-muted rounded-full border border-border bg-secondary">
          {formatDate(task.created_date || task.created_at)}
        </span>
      </div>

      <div className="space-y-4">
        {/* Description */}
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-foreground-muted">תיאור</p>
            {!editingDesc && (
              <button onClick={() => setEditingDesc(true)}
                className="text-[10px] text-foreground-muted hover:text-primary transition-colors">עריכה</button>
            )}
          </div>
          {editingDesc ? (
            <div>
              <textarea
                ref={descInputRef}
                value={descDraft}
                onChange={e => setDescDraft(e.target.value)}
                rows={4}
                className="w-full text-[12px] text-foreground bg-secondary border border-border rounded-lg px-3 py-2 outline-none focus:border-primary resize-none"
                dir="rtl"
                placeholder="תיאור המשימה..."
              />
              <div className="flex gap-2 mt-2">
                <button onClick={saveDesc}
                  className="px-3 py-1.5 bg-primary text-background rounded-lg text-[11px] font-medium hover:opacity-90">
                  שמור
                </button>
                <button onClick={() => { setEditingDesc(false); setDescDraft(plainText); }}
                  className="px-3 py-1.5 border border-border text-foreground-muted rounded-lg text-[11px] hover:bg-secondary">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-foreground-secondary leading-relaxed whitespace-pre-line cursor-pointer hover:bg-secondary rounded px-1 -mx-1 py-0.5 transition-colors min-h-[20px]"
              onClick={() => setEditingDesc(true)}>
              {plainText || <span className="text-foreground-muted italic">אין תיאור — לחץ להוספה</span>}
            </p>
          )}
        </div>

        {/* Source signal */}
        {signalId && (
          <SourceSignalCard signalId={signalId} navigate={navigate} />
        )}

        {/* Sub-tasks checklist */}
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-foreground-muted">
              תת-משימות
              {checklist.items.length > 0 && (
                <span className="mr-1 text-foreground-muted/60">({doneItems}/{checklist.items.length})</span>
              )}
            </p>
            {checklist.items.length > 0 && (
              <div className="h-1.5 w-24 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${checklist.items.length ? (doneItems / checklist.items.length) * 100 : 0}%` }} />
              </div>
            )}
          </div>

          {checklist.items.length > 0 && (
            <div className="space-y-2 mb-3">
              {checklist.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 group">
                  <button onClick={() => toggleSubtask(i)}
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
                      item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border hover:border-primary'
                    }`}>
                    {item.done && <Check className="w-2.5 h-2.5" />}
                  </button>
                  <span className={`flex-1 text-[12px] ${item.done ? 'line-through text-foreground-muted' : 'text-foreground'}`}>
                    {item.text}
                  </span>
                  <button onClick={() => removeSubtask(i)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-foreground-muted hover:text-danger transition-all">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSubtask(); }}
              placeholder="הוסף תת-משימה..."
              className="flex-1 text-[12px] bg-secondary border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
              dir="rtl"
            />
            <button onClick={addSubtask} disabled={!newSubtask.trim()}
              className="p-1.5 bg-primary text-background rounded-lg hover:opacity-90 disabled:opacity-40 transition-all">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-foreground-muted">הערות</p>
            {!editingNotes && (
              <button onClick={() => setEditingNotes(true)}
                className="text-[10px] text-foreground-muted hover:text-primary transition-colors">עריכה</button>
            )}
          </div>
          {editingNotes ? (
            <div>
              <textarea
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                rows={3}
                autoFocus
                className="w-full text-[12px] text-foreground bg-secondary border border-border rounded-lg px-3 py-2 outline-none focus:border-primary resize-none"
                dir="rtl"
                placeholder="הערות חופשיות..."
              />
              <div className="flex gap-2 mt-2">
                <button onClick={saveNotes}
                  className="px-3 py-1.5 bg-primary text-background rounded-lg text-[11px] font-medium hover:opacity-90">
                  שמור
                </button>
                <button onClick={() => { setEditingNotes(false); setNotesDraft(task.notes || ''); }}
                  className="px-3 py-1.5 border border-border text-foreground-muted rounded-lg text-[11px] hover:bg-secondary">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-foreground-secondary leading-relaxed whitespace-pre-line cursor-pointer hover:bg-secondary rounded px-1 -mx-1 py-0.5 transition-colors min-h-[20px]"
              onClick={() => setEditingNotes(true)}>
              {task.notes || <span className="text-foreground-muted italic">אין הערות — לחץ להוספה</span>}
            </p>
          )}
        </div>

        {/* Delete / cancel */}
        {task.status !== 'done' && task.status !== 'cancelled' && (
          <div className="pt-2">
            <button
              onClick={() => { updateMutation.mutate({ status: 'cancelled' }); toast.info('המשימה בוטלה'); }}
              className="text-[11px] text-foreground-muted hover:text-danger transition-colors"
            >
              ביטול משימה
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceSignalCard({ signalId, navigate }) {
  const { data: signal, isLoading } = useQuery({
    queryKey: ['signal', signalId],
    queryFn: () => base44.entities.MarketSignal.get(signalId),
    enabled: !!signalId,
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-3">
        <p className="text-[11px] font-semibold text-foreground-muted mb-2">מקור: תובנה</p>
        <div className="flex items-center gap-2 text-foreground-muted text-[12px]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> טוען...
        </div>
      </div>
    );
  }

  if (!signal) return null;

  const CATEGORY_LABEL = {
    threat: 'איום', opportunity: 'הזדמנות', trend: 'מגמה',
    mention: 'אזכור', competitor_move: 'מתחרים',
  };

  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <p className="text-[11px] font-semibold text-foreground-muted mb-2">מקור: תובנה</p>
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">
          {signal.category === 'threat' ? '⚠️' : signal.category === 'opportunity' ? '💡' : '📊'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-foreground leading-snug mb-1 line-clamp-2">
            {signal.summary}
          </p>
          <div className="flex items-center gap-2">
            {signal.category && (
              <span className="text-[10px] text-foreground-muted bg-secondary px-2 py-0.5 rounded-full">
                {CATEGORY_LABEL[signal.category] || signal.category}
              </span>
            )}
            {signal.impact_level === 'high' && (
              <span className="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                השפעה גבוהה
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate(`/signals/${signalId}`)}
          className="flex-shrink-0 text-[11px] text-primary hover:underline flex items-center gap-1"
        >
          פתח <span className="text-[10px]">←</span>
        </button>
      </div>
    </div>
  );
}
