import type { Task, TaskPriority } from "@my-planner/core";

/** Task come restituito dalla board: include i campi calcolati dal service layer. */
export interface BoardTask extends Task {
  subtaskProgress?: { done: number; total: number };
  blockedByOpenCount?: number;
  projectId: string;
  projectName?: string;
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

interface TaskCardProps {
  task: BoardTask;
  showProject?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}

export function TaskCard({ task, showProject, onDragStart, onClick }: TaskCardProps) {
  const blocked = (task.blockedByOpenCount ?? 0) > 0;

  return (
    <div
      className="task-card"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="task-card-badges">
        <span className={`badge badge-priority badge-priority-${task.priority}`}>
          {PRIORITY_LABEL[task.priority]}
        </span>
        {task.complexity != null && <span className="badge badge-complexity">{task.complexity}</span>}
        {showProject && task.projectName && (
          <span className="badge badge-project">{task.projectName}</span>
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
        {task.subtaskProgress && task.subtaskProgress.total > 0 && (
          <span className="task-card-subtasks">
            {task.subtaskProgress.done}/{task.subtaskProgress.total}
          </span>
        )}
        {blocked && (
          <span className="task-card-blocked" title="Task bloccato da dipendenze non risolte">
            🔒 {task.blockedByOpenCount}
          </span>
        )}
        {task.dueDate && (
          <span className="task-card-due">{new Date(task.dueDate).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
