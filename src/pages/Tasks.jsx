import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Plus, ClipboardList, CalendarDays, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import TaskCard from '@/components/tasks/TaskCard';
import TaskStatsBar from '@/components/tasks/TaskStatsBar';
import AddTaskModal from '@/components/tasks/AddTaskModal';
import AiInsightBox from '@/components/ai/AiInsightBox';

const filterTabs = [
  { key: 'all', label: 'הכל' },
  { key: 'pending', label: 'ממתינות' },
  { key: 'in_progress', label: 'בביצוע' },
  { key: 'done', label: 'הושלמו' },
  { key: 'overdue', label: 'באיחור' },
];

export default function Tasks() {
  const { businessProfile } = useOutletContext();
  const bpId = businessProfile?.id;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [planningContent, setPlanningContent] = useState(false);

  // Check for prefill from alert redirect
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromAlert = params.get('from_alert');
    if (fromAlert) {
      setPrefill({
        title: params.get('title') || '',
        description: params.get('desc') || '',
        priority: params.get('priority') || 'medium',
        source_alert_id: fromAlert,
      });
      setShowAddModal(true);
      window.history.replaceState({}, '', '/tasks');
    }
  }, []);

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', bpId],
    queryFn: () => base44.entities.Task.filter({ linked_business: bpId }, '-created_date', 200),
    enabled: !!bpId,
  });

  const now = new Date();
  const filtered = tasks.filter(t => {
    if (activeTab === 'overdue') return t.due_date && new Date(t.due_date) < now && t.status !== 'done' && t.status !== 'cancelled';
    if (activeTab === 'all') return t.status !== 'cancelled';
    return t.status === activeTab;
  });

  const sorted = [...filtered].sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    if (a.status !== b.status) {
      const statusOrder = { in_progress: 0, pending: 1, done: 2, cancelled: 3 };
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    }
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-foreground tracking-tight">משימות</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!bpId) return;
              setPlanningContent(true);
              toast.info('מתכנן יומן תוכן שבועי...');
              try {
                const res = await base44.functions.invoke('contentCalendarAgent', { businessProfileId: bpId });
                const { tasks_created = 0 } = res?.data || {};
                queryClient.invalidateQueries({ queryKey: ['tasks', bpId] });
                toast.success(tasks_created > 0 ? `נוצרו ${tasks_created} פוסטים ליומן השבועי ✓` : 'יומן תוכן עודכן');
              } catch { toast.error('שגיאה בתכנון תוכן'); }
              setPlanningContent(false);
            }}
            disabled={planningContent}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all disabled:opacity-50">
            {planningContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}
            {planningContent ? 'מתכנן...' : 'תכנן תוכן שבועי'}
          </button>
          <button onClick={() => setShowAddModal(true)}
            className="btn-subtle flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
            <Plus className="w-4 h-4" /> משימה חדשה
          </button>
        </div>
      </div>

      <TaskStatsBar tasks={tasks} />

      <AiInsightBox
        title="ניתוח משימות וסדר עדיפויות — AI"
        prompt={`אתה מנהל משימות מומחה. העסק "${businessProfile?.name}" (${businessProfile?.category}).
משימות פתוחות: ${tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length}, באיחור: ${tasks.filter(t => t.due_date && new Date(t.due_date) < now && t.status !== 'done' && t.status !== 'cancelled').length}.
משימות אחרונות: ${tasks.slice(0, 8).map(t => `"${t.title}" (${t.status}, ${t.priority}, ${t.assignee || 'לא מוקצה'}, יעד: ${t.due_date || '?'})`).join('; ')}.
הצע: 1) סדר עדיפויות מומלץ 2) משימות שדורשות תשומת לב מיידית 3) שיפורים לתהליך העבודה. בעברית, Markdown.`}
      />

      <div className="flex gap-0.5 border-b border-border">
        {filterTabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-all duration-150 relative ${
              activeTab === tab.key ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}>
            {tab.label}
            {activeTab === tab.key && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground rounded-t" />}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="card-base py-20 text-center">
          <ClipboardList className="w-12 h-12 text-foreground-muted opacity-20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground-muted mb-4">
            {activeTab === 'all' ? 'עוד אין משימות — צור משימה חדשה או הפוך התראת AI למשימה' : 'אין משימות בפילטר הנוכחי'}
          </p>
          {activeTab === 'all' && (
            <button onClick={() => setShowAddModal(true)}
              className="btn-subtle px-5 py-2.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:opacity-90 transition-all">
              + משימה ראשונה
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(task => <TaskCard key={task.id} task={task} />)}
        </div>
      )}

      {showAddModal && (
        <AddTaskModal
          bpId={bpId}
          onClose={() => { setShowAddModal(false); setPrefill(null); }}
          onAdded={() => { setShowAddModal(false); setPrefill(null); }}
          prefill={prefill}
        />
      )}
    </div>
  );
}