import { suggestParentStatus, type Task, type TaskPriority, type TaskStatus } from "@my-planner/core";
import { useI18n } from "../i18n";

/** Task come restituito dalla board: include i campi calcolati dal service layer. */
export interface BoardTask extends Task {
  blockedByOpenCount?: number;
  projectId: string;
  projectName?: string;
  /** Titolo del parent, valorizzato lato client quando il task e' una sotto-task. */
  parentTitle?: string;
}

/** Ordine dei segmenti nella barra delle sotto-task: dal piu' avanzato al meno. */
const SUBTASK_SEGMENT_ORDER: TaskStatus[] = ["done", "testing", "in_progress", "todo", "draft"];

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
  /** Se presente, mostra l'azione per allineare lo stato del parent a quello suggerito dalle sotto-task. */
  onAlignStatus?: (status: TaskStatus) => void;
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
  onAlignStatus,
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
  const subtaskProgress = subtaskCount > 0 ? Math.round((doneSubtasks / subtaskCount) * 100) : 0;
  const statusCounts = task.subtaskStatusCounts;
  const STATUS_LABEL: Record<TaskStatus, string> = {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };
  const subtaskSummary = statusCounts
    ? SUBTASK_SEGMENT_ORDER.filter((s) => statusCounts[s] > 0)
        .map((s) => `${statusCounts[s]} ${STATUS_LABEL[s]}`)
        .join(" · ")
    : t.taskCard.subtasksTitle;
  const suggestedStatus = statusCounts ? suggestParentStatus(statusCounts) : null;
  const statusMismatch = suggestedStatus !== null && suggestedStatus !== task.status;

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
        {task.parentId && (
          <span
            className="badge badge-parent"
            title={task.parentTitle ? t.taskCard.subtaskOf.replace("{title}", task.parentTitle) : t.taskCard.subtask}
          >
            ↳ {task.parentTitle ?? t.taskCard.subtask}
          </span>
        )}
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

      {subtaskCount > 0 && (
        <div className="task-card-progress" title={subtaskSummary}>
          <div className="task-card-progress-head">
            <span className="task-card-progress-count">
              ☑ {doneSubtasks}/{subtaskCount}
            </span>
            <span className="task-card-progress-pct">{subtaskProgress}%</span>
          </div>
          <div
            className="task-card-progress-track"
            role="progressbar"
            aria-valuenow={subtaskProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.taskCard.subtasksTitle}
            aria-valuetext={subtaskSummary}
          >
            {statusCounts ? (
              SUBTASK_SEGMENT_ORDER.filter((s) => statusCounts[s] > 0).map((s) => (
                <div
                  key={s}
                  className={`task-card-progress-seg task-card-progress-seg-${s}`}
                  style={{ width: `${(statusCounts[s] / subtaskCount) * 100}%` }}
                />
              ))
            ) : (
              <div
                className={`task-card-progress-fill${subtaskProgress === 100 ? " task-card-progress-fill-done" : ""}`}
                style={{ width: `${subtaskProgress}%` }}
              />
            )}
          </div>
          {statusCounts && (
            <div className="task-card-progress-legend">
              {SUBTASK_SEGMENT_ORDER.filter((s) => s !== "done" && statusCounts[s] > 0).map((s) => (
                <span key={s} className="task-card-progress-legend-item" title={STATUS_LABEL[s]}>
                  <span className={`task-card-progress-dot task-card-progress-seg-${s}`} />
                  {statusCounts[s]} {STATUS_LABEL[s]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {statusMismatch && suggestedStatus && onAlignStatus && (
        <button
          type="button"
          className="task-card-status-mismatch"
          title={t.taskCard.statusMismatch.replace("{status}", STATUS_LABEL[suggestedStatus])}
          // Evita che click/tastiera sul bottone avviino il drag o aprano il drawer.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAlignStatus(suggestedStatus);
          }}
        >
          ⚠ → {STATUS_LABEL[suggestedStatus]}
        </button>
      )}

      <div className="task-card-footer">
        {blocked && (
          <span className="task-card-blocked" title={t.taskCard.blockedTitle}>
            🔒 {task.blockedByOpenCount}
          </span>
        )}
        {task.dueDate && (
          <span className="task-card-due">{new Date(task.dueDate).toLocaleDateString(dateLocale)}</span>
        )}
      </div>
    </div>
  );
}
