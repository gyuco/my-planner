import type { Task, TaskPriority } from "@my-planner/core";
import { useI18n } from "../i18n";

/** Task come restituito dalla board: include i campi calcolati dal service layer. */
export interface BoardTask extends Task {
  blockedByOpenCount?: number;
  projectId: string;
  projectName?: string;
}

const PROJECT_COLOR_PALETTE = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

/** Colore stabile per progetto, derivato da un hash del suo id (F8). */
function colorForProject(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return PROJECT_COLOR_PALETTE[hash % PROJECT_COLOR_PALETTE.length];
}

interface TaskCardProps {
  task: BoardTask;
  showProject?: boolean;
  onClick?: () => void;
  /** Ref/attributi/listener dnd-kit, iniettati dal wrapper sortable in KanbanBoard. */
  dragRef?: (element: HTMLElement | null) => void;
  dragAttributes?: React.HTMLAttributes<HTMLDivElement>;
  dragListeners?: Record<string, unknown>;
  style?: React.CSSProperties;
  isDragging?: boolean;
}

export function TaskCard({
  task,
  showProject,
  onClick,
  dragRef,
  dragAttributes,
  dragListeners,
  style,
  isDragging,
}: TaskCardProps) {
  const { t, dateLocale } = useI18n();
  const PRIORITY_LABEL: Record<TaskPriority, string> = {
    low: t.taskCard.priorityLow,
    medium: t.taskCard.priorityMedium,
    high: t.taskCard.priorityHigh,
    urgent: t.taskCard.priorityUrgent,
  };
  const blocked = (task.blockedByOpenCount ?? 0) > 0;
  const subtaskCount = task.subtaskCount ?? 0;
  const doneSubtasks = subtaskCount - (task.openSubtaskCount ?? 0);

  return (
    <div
      className={`task-card${isDragging ? " task-card-dragging" : ""}`}
      ref={dragRef}
      style={style}
      onClick={onClick}
      role="button"
      tabIndex={0}
      {...dragAttributes}
      {...dragListeners}
    >
      <div className="task-card-badges">
        <span className={`badge badge-priority badge-priority-${task.priority}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.complexity != null && <span className="badge badge-complexity">{task.complexity}</span>}
        {showProject && task.projectName && (
          <span
            className="badge badge-project"
            style={{ background: colorForProject(task.projectId), color: "#fff" }}
          >
            {task.projectName}
          </span>
        )}
      </div>

      <div className="task-card-title">{task.title}</div>

      {task.tags.length > 0 && (
        <div className="task-card-tags">
          {task.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="task-card-footer">
        {blocked && (
          <span className="task-card-blocked" title={t.taskCard.blockedTitle}>
            🔒 {task.blockedByOpenCount}
          </span>
        )}
        {subtaskCount > 0 && (
          <span className="task-card-subtasks" title={t.taskCard.subtasksTitle}>
            ☑ {doneSubtasks}/{subtaskCount}
          </span>
        )}
        {task.dueDate && (
          <span className="task-card-due">{new Date(task.dueDate).toLocaleDateString(dateLocale)}</span>
        )}
      </div>
    </div>
  );
}
