import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import { Calendar, User, Bot } from 'lucide-react';

const COLUMNS = [
  { key: 'pending', label: 'ממתינות' },
  { key: 'in_progress', label: 'בביצוע' },
  { key: 'done', label: 'הושלמו' },
];

const PRIORITY_DOT = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-blue-500',
  low: 'bg-gray-400',
};

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (diff < 0) return { text: `באיחור ${Math.abs(diff)} ימים`, overdue: true };
  if (diff === 0) return { text: 'היום', overdue: false };
  if (diff === 1) return { text: 'מחר', overdue: false };
  return { text: `בעוד ${diff} ימים`, overdue: false };
}

function sortColumn(tasks) {
  return [...tasks].sort((a, b) => {
    const posA = a.position ?? 0, posB = b.position ?? 0;
    if (posA !== posB) return posA - posB;
    return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  });
}

function KanbanCard({ task, index, onSelect }) {
  const due = daysUntil(task.due_date);
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onSelect(task.id)}
          className={`card-base p-3 mb-2 cursor-pointer hover:shadow-md transition-shadow ${snapshot.isDragging ? 'shadow-lg' : ''}`}
        >
          <div className="flex items-start gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium}`} />
            <p className={`text-[12px] font-semibold leading-snug ${task.status === 'done' ? 'text-foreground-muted line-through' : 'text-foreground'}`}>
              {task.title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[10px] text-foreground-muted">
            {task.assignee && (
              <span className="flex items-center gap-1"><User className="w-3 h-3" />{task.assignee}</span>
            )}
            {due && (
              <span className={`flex items-center gap-1 ${due.overdue ? 'text-danger font-medium' : ''}`}>
                <Calendar className="w-3 h-3" />{due.text}
              </span>
            )}
            {task.source_type === 'alert' && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                <Bot className="w-3 h-3" />
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

/**
 * KanbanBoard — 3 status columns (pending/in_progress/done; cancelled tasks
 * stay invisible, matching the old list's "all" tab which already excluded
 * them). Cards ordered by `position` (a Task field added for this) within
 * each column, falling back to priority for any pre-migration rows still
 * at the default 0. Dragging updates status/position via the same
 * base44.entities.Task.update(id, {status}) call TaskCard/TaskDetail
 * already used for status changes.
 */
export default function KanbanBoard({ tasks, bpId, onSelectTask }) {
  const queryClient = useQueryClient();

  const grouped = useMemo(() => {
    const byStatus = { pending: [], in_progress: [], done: [] };
    for (const t of tasks) {
      if (byStatus[t.status]) byStatus[t.status].push(t);
    }
    for (const key of Object.keys(byStatus)) byStatus[key] = sortColumn(byStatus[key]);
    return byStatus;
  }, [tasks]);

  const reorderMutation = useMutation({
    mutationFn: (updates) => Promise.all(updates.map(u => base44.entities.Task.update(u.id, u.data))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', bpId] }),
  });

  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const sourceCol = source.droppableId;
    const destCol = destination.droppableId;
    const sameColumn = sourceCol === destCol;

    const sourceList = Array.from(grouped[sourceCol]);
    const [moved] = sourceList.splice(source.index, 1);
    const destList = sameColumn ? sourceList : Array.from(grouped[destCol]);
    destList.splice(destination.index, 0, { ...moved, status: destCol });

    const updates = destList.map((t, i) => ({
      id: t.id,
      data: { position: i, ...(t.id === draggableId ? { status: destCol } : {}) },
    }));
    if (!sameColumn) {
      sourceList.forEach((t, i) => updates.push({ id: t.id, data: { position: i } }));
    }

    queryClient.setQueryData(['tasks', bpId], (old = []) => {
      const others = old.filter(t => t.status !== sourceCol && t.status !== destCol);
      const changedCols = sameColumn ? destList : [...sourceList, ...destList];
      return [...others, ...changedCols];
    });

    reorderMutation.mutate(updates);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map(col => (
          <div key={col.key} className="bg-secondary/40 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-[12px] font-bold text-foreground">{col.label}</h3>
              <span className="text-[11px] text-foreground-muted">{grouped[col.key].length}</span>
            </div>
            <Droppable droppableId={col.key}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-[80px] rounded-xl transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5' : ''}`}
                >
                  {grouped[col.key].map((task, i) => (
                    <KanbanCard key={task.id} task={task} index={i} onSelect={onSelectTask} />
                  ))}
                  {provided.placeholder}
                  {grouped[col.key].length === 0 && (
                    <p className="text-[11px] text-foreground-muted text-center py-6">אין משימות</p>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}
