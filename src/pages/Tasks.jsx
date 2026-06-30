import React, { useState, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, Search, ChevronDown, CalendarDays, Loader2, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import AddTaskModal from '@/components/tasks/AddTaskModal';
import { ApprovalsPanel } from './Approvals';
import EmptyState from '@/components/ui/EmptyState';

// ── Config maps ────────────────────────────────────────────────────────────────
const PRIORITY = {
  critical: { label: 'מיידי',  dot: '#ef4444', badge: 'bg-red-50 text-red-600' },
  high:     { label: 'שבועי',  dot: '#f59e0b', badge: 'bg-amber-50 text-amber-600' },
  medium:   { label: 'בינוני', dot: '#9ca3af', badge: 'bg-gray-100 text-gray-500' },
  low:      { label: 'נמוך',   dot: '#10b981', badge: 'bg-emerald-50 text-emerald-600' },
};

const SOURCE_LABEL = {
  monitoring: 'מוניטין', leads: 'לידים', customers: 'לקוחות',
  competitor: 'מתחרים', alert: 'AI', manual: 'ידני',
};

const ACTION_LABEL = {
  monitoring: 'צפה בביקורת',
  leads: 'פתח ליד',
  customers: 'צור קשר',
  competitor: 'צפה בניתוח',
};

function dueLabel(dateStr, isDone) {
  if (!dateStr || isDone) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  const overdue = diff < 0;
  if (diff < 0) return { text: `${Math.abs(diff)}ד' איחור`, overdue: true };
  if (diff === 0) return { text: 'היום', overdue: true };
  if (diff === 1) return { text: 'מחר', overdue: false };
  return { text: `בעוד ${diff} ימים`, overdue: false };
}

// ── Donut chart ────────────────────────────────────────────────────────────────
function DonutChart({ segments, total }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const sum = segments.reduce((s, d) => s + d.value, 0) || 1;
  let cum = 0;

  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="flex-shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="#f0f0f3" strokeWidth="13" />
      {segments.filter(d => d.value > 0).map((d, i) => {
        const pct = d.value / sum;
        const dash = pct * circ;
        const rot = cum * 360 - 90;
        cum += pct;
        return (
          <circle key={i} cx="44" cy="44" r={r}
            fill="none" stroke={d.color} strokeWidth="13"
            strokeDasharray={`${dash} ${circ - dash}`}
            style={{ transform: `rotate(${rot}deg)`, transformOrigin: '44px 44px' }}
          />
        );
      })}
      <text x="44" y="49" textAnchor="middle" fontSize="15" fontWeight="700" fill="#111827">
        {total}
      </text>
    </svg>
  );
}

// ── Filter dropdown ────────────────────────────────────────────────────────────
function FilterDropdown({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="btn-pill-ghost text-[12px]"
      >
        {current?.label || label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[140px] overflow-hidden py-1">
            {options.map(o => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-right px-4 py-2.5 text-[12px] hover:bg-gray-50 transition-colors ${value === o.value ? 'text-[#e8344d] font-semibold' : 'text-gray-700'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Table row ──────────────────────────────────────────────────────────────────
function TaskRow({ task }) {
  const navigate = useNavigate();
  const p = PRIORITY[task.priority] || PRIORITY.medium;
  const due = dueLabel(task.due_date, task.status === 'done');
  const source = SOURCE_LABEL[task.source_type] || SOURCE_LABEL.manual;
  const actionLabel = ACTION_LABEL[task.source_type] || 'צפה בפרטים';

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors">
      {/* Task name */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.dot }} />
          <span
            className={`text-[13px] font-semibold cursor-pointer hover:text-[#e8344d] transition-colors ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}
            onClick={() => navigate(`/tasks/${task.id}`)}
          >
            {task.title}
          </span>
        </div>
      </td>
      {/* Impact */}
      <td className="px-4 py-3.5 max-w-[220px]">
        <span className="text-[12px] text-gray-500 line-clamp-1">
          {task.description ? task.description.slice(0, 55) : '—'}
        </span>
      </td>
      {/* Source */}
      <td className="px-4 py-3.5">
        <span className="text-[12px] text-gray-600">{source}</span>
      </td>
      {/* Priority */}
      <td className="px-4 py-3.5">
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${p.badge}`}>
          {p.label}
        </span>
      </td>
      {/* Due date */}
      <td className="px-4 py-3.5">
        {due
          ? <span className={`text-[12px] ${due.overdue ? 'text-red-500 font-medium' : 'text-gray-500'}`}>{due.text}</span>
          : <span className="text-[12px] text-gray-300">—</span>
        }
      </td>
      {/* Action */}
      <td className="px-4 py-3.5">
        <button
          onClick={() => navigate(`/tasks/${task.id}`)}
          className="px-3.5 py-1.5 rounded-full border border-gray-200 text-[11px] font-medium text-gray-700 hover:border-[#e8344d] hover:text-[#e8344d] transition-all whitespace-nowrap bg-white"
        >
          {actionLabel}
        </button>
      </td>
    </tr>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Tasks() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal]   = useState(false);
  const [showApprovals, setShowApprovals] = useState(false);
  const [prefill, setPrefill]             = useState(null);
  const [planningContent, setPlanningContent] = useState(false);
  const [search, setSearch]               = useState('');
  const [filterStatus, setFilterStatus]   = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterSource, setFilterSource]   = useState('all');

  // Handle deep-link prefill from alerts
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromAlert = params.get('from_alert');
    const fromInsight = params.get('from_insight');
    const sourceId = fromAlert || fromInsight;
    if (sourceId) {
      setPrefill({ title: params.get('title') || '', description: params.get('desc') || '', priority: params.get('priority') || 'medium', source_alert_id: sourceId });
      setShowAddModal(true);
      window.history.replaceState({}, '', '/tasks');
    }
  }, []);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', bpId],
    queryFn: () => base44.entities.Task.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  // Stats
  const now = new Date();
  const activeTasks = tasks.filter(t => t.status !== 'cancelled');
  const urgentTask  = tasks.find(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'cancelled')
                   || tasks.find(t => t.priority === 'high'     && t.status !== 'done' && t.status !== 'cancelled');

  const chartSegments = [
    { label: 'טיפול מיידי',   value: tasks.filter(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'cancelled').length, color: '#ef4444' },
    { label: 'טיפול שבועי',   value: tasks.filter(t => t.priority === 'high'     && t.status !== 'done' && t.status !== 'cancelled').length, color: '#f59e0b' },
    { label: 'בעדיפות גבוהה', value: tasks.filter(t => t.priority === 'medium'   && t.status !== 'done' && t.status !== 'cancelled').length, color: '#d1d5db' },
    { label: 'הושלמו השבוע',  value: tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at) > new Date(Date.now() - 7 * 86400000)).length, color: '#10b981' },
  ];

  // Filters
  const filtered = useMemo(() => activeTasks.filter(t => {
    if (filterStatus !== 'all'   && t.status      !== filterStatus)   return false;
    if (filterPriority !== 'all' && t.priority    !== filterPriority) return false;
    if (filterSource !== 'all'   && (t.source_type || 'manual') !== filterSource) return false;
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [activeTasks, filterStatus, filterPriority, filterSource, search]);

  const sorted = [...filtered].sort((a, b) => {
    const pOrd = { critical: 0, high: 1, medium: 2, low: 3 };
    const sOrd = { in_progress: 0, pending: 1, done: 2 };
    if (a.status !== b.status) return (sOrd[a.status] ?? 9) - (sOrd[b.status] ?? 9);
    return (pOrd[a.priority] ?? 9) - (pOrd[b.priority] ?? 9);
  });

  const hasFilters = filterStatus !== 'all' || filterPriority !== 'all' || filterSource !== 'all' || !!search;

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-pill-dark"
          >
            <Plus className="w-4 h-4" />
            הוספת משימה
          </button>
          <button
            onClick={async () => {
              if (!bpId) return;
              setPlanningContent(true);
              toast.info('מתכנן יומן תוכן שבועי...');
              try {
                const res = await base44.functions.invoke('contentCalendarAgent', { businessProfileId: bpId });
                const { tasks_created = 0 } = res?.data || {};
                queryClient.invalidateQueries({ queryKey: ['tasks', bpId] });
                toast.success(tasks_created > 0 ? `נוצרו ${tasks_created} פוסטים ✓` : 'יומן תוכן עודכן');
              } catch { toast.error('שגיאה בתכנון תוכן'); }
              setPlanningContent(false);
            }}
            disabled={planningContent}
            className="btn-pill-ghost"
          >
            {planningContent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarDays className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">תוכן שבועי</span>
          </button>
        </div>
        <div className="text-right">
          <h1 className="text-[22px] font-bold text-gray-900 leading-tight">ניהול משימות</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">כל המשימות במקום אחד, עם פוקוס על מה שדורש טיפול עכשיו.</p>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Donut chart */}
        <div className="section-card p-5">
          <p className="text-[14px] font-bold text-gray-900 mb-4 text-right">סטטוס משימות</p>
          <div className="flex items-center gap-5">
            <DonutChart segments={chartSegments} total={activeTasks.length} />
            <div className="space-y-2.5 flex-1">
              {chartSegments.map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-gray-700">{s.value}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-500">{s.label}</span>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Urgent task */}
        <div className="section-card p-5">
          {urgentTask ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setFilterStatus('in_progress')}
                  className="text-[11px] text-[#e8344d] border border-[#e8344d]/30 rounded-full px-3 py-1 hover:bg-red-50 transition-colors"
                >
                  לכל המשימות הדחופות
                </button>
                <div className="flex items-center gap-2 text-right">
                  <span className="text-[11px] bg-red-50 text-red-600 px-2.5 py-0.5 rounded-full font-medium">מיידי</span>
                  <span className="text-[12px] text-gray-500">
                    משימה 1 מתוך {tasks.filter(t => t.priority === 'critical' && t.status !== 'done').length || 1}
                  </span>
                </div>
              </div>
              <h3 className="text-[18px] font-bold text-gray-900 mb-3 text-right">{urgentTask.title}</h3>
              {urgentTask.description && (
                <p className="text-[12px] text-gray-500 text-right mb-1 line-clamp-2">{urgentTask.description.slice(0, 80)}</p>
              )}
              <div className="flex items-center gap-1.5 justify-end mb-4">
                <span className="text-[12px] text-gray-400">מקור: {SOURCE_LABEL[urgentTask.source_type] || 'ידני'}</span>
              </div>
              <button
                onClick={() => { /* navigate */ }}
                className="btn-pill"
              >
                {ACTION_LABEL[urgentTask.source_type] || 'צפה בפרטים'}
              </button>
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-[13px] text-gray-400 text-center">🎉 אין משימות דחופות כרגע</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Filters row ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterDropdown
          label="כל המשימות"
          options={[
            { value: 'all',         label: 'כל המשימות' },
            { value: 'pending',     label: 'ממתינות' },
            { value: 'in_progress', label: 'בביצוע' },
            { value: 'done',        label: 'הושלמו' },
          ]}
          value={filterStatus}
          onChange={setFilterStatus}
        />
        <FilterDropdown
          label="כל העדיפויות"
          options={[
            { value: 'all',      label: 'כל העדיפויות' },
            { value: 'critical', label: 'מיידי' },
            { value: 'high',     label: 'שבועי' },
            { value: 'medium',   label: 'בינוני' },
            { value: 'low',      label: 'נמוך' },
          ]}
          value={filterPriority}
          onChange={setFilterPriority}
        />
        <FilterDropdown
          label="כל המקורות"
          options={[
            { value: 'all',        label: 'כל המקורות' },
            { value: 'monitoring', label: 'מוניטין' },
            { value: 'leads',      label: 'לידים' },
            { value: 'customers',  label: 'לקוחות' },
            { value: 'competitor', label: 'מתחרים' },
            { value: 'manual',     label: 'ידני' },
          ]}
          value={filterSource}
          onChange={setFilterSource}
        />
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש"
            className="w-full pr-9 pl-3 py-2 rounded-full bg-white border border-gray-200 text-[12px] text-gray-700 placeholder-gray-400 focus:outline-none focus:border-gray-300 shadow-sm"
          />
        </div>
        {hasFilters && (
          <button
            onClick={() => { setFilterStatus('all'); setFilterPriority('all'); setFilterSource('all'); setSearch(''); }}
            className="text-[12px] text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            נקה פילטרים
          </button>
        )}
        <button
          onClick={() => setShowApprovals(v => !v)}
          className={`mr-auto btn-pill-ghost text-[12px] ${showApprovals ? 'border-[#e8344d] text-[#e8344d]' : ''}`}
        >
          אישורי סוכן
        </button>
      </div>

      {/* Approvals panel */}
      {showApprovals && (
        <div className="section-card p-5">
          <ApprovalsPanel bpId={bpId} />
        </div>
      )}

      {/* ── Tasks count + table ─────────────────────────────────────────────── */}
      <p className="text-[15px] font-bold text-gray-900 text-right">
        {sorted.length} משימות בסה"כ
      </p>

      {sorted.length === 0 ? (
        <div className="section-card p-10">
          <EmptyState
            icon={ClipboardList}
            title={hasFilters ? 'לא נמצאו משימות' : 'אין משימות עדיין'}
            description={hasFilters ? 'נסה לנקות את הפילטרים' : 'צור משימה ראשונה או הפוך התראת AI למשימה'}
            action={!hasFilters ? () => setShowAddModal(true) : undefined}
            actionLabel="+ משימה ראשונה"
          />
        </div>
      ) : (
        <div className="section-card overflow-hidden">
          <table className="w-full" dir="rtl">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[28%]">משימה</th>
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[24%]">השפעה</th>
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[10%]">מקור</th>
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[10%]">עדיפות</th>
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[14%]">תאריך יעד</th>
                <th className="px-4 py-3.5 text-right text-[12px] font-semibold text-gray-500 w-[14%]">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(task => <TaskRow key={task.id} task={task} />)}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddTaskModal
          bpId={bpId}
          onClose={() => { setShowAddModal(false); setPrefill(null); }}
          onAdded={() => { setShowAddModal(false); setPrefill(null); queryClient.invalidateQueries({ queryKey: ['tasks', bpId] }); }}
          prefill={prefill}
        />
      )}
    </div>
  );
}
