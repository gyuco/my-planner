import { TASK_TYPES } from "@my-planner/core";
import type { ActivityLogItem, TaskEventType, TaskFieldChange, TaskStatus, TaskType } from "@my-planner/core";
import { useI18n } from "../i18n";
import type { Dictionary } from "../i18n/en";

type ActivityKey = keyof Dictionary["activity"]["typeLabels"];

/** Tipo evento -> chiave dei testi i18n (messaggi ed etichette del filtro). */
export const ACTIVITY_KEYS: Record<TaskEventType, ActivityKey> = {
  "task.created": "created",
  "task.updated": "updated",
  "task.status_changed": "statusChanged",
  "task.assigned": "assigned",
  "task.deleted": "deleted",
  "comment.created": "commented",
  "dependency.added": "dependencyAdded",
  "dependency.removed": "dependencyRemoved",
  "attachment.added": "attachmentAdded",
  "attachment.deleted": "attachmentDeleted",
};

/** Sostituisce i segnaposto `{nome}` nei messaggi i18n. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

function toneOf(type: TaskEventType): string {
  if (type === "task.status_changed") return "status";
  if (type === "comment.created") return "comment";
  if (type === "task.deleted" || type.endsWith(".removed") || type.endsWith(".deleted")) return "removed";
  if (type === "task.updated" || type === "task.assigned") return "updated";
  return "created";
}

interface ActivityListProps {
  items: ActivityLogItem[];
  /** Mostra il nome del progetto nei metadati (vista multi-progetto). */
  showProject?: boolean;
  /** Apre il task nel drawer; assente o task eliminato => titolo non cliccabile. */
  onOpenTask?: (taskId: string, projectId: string) => void;
  /** Restringe il log a un task (pagina log). */
  onFilterTask?: (item: ActivityLogItem) => void;
}

export function ActivityList({ items, showProject = false, onOpenTask, onFilterTask }: ActivityListProps) {
  const { t, formatDate, formatDateTime } = useI18n();
  const statusLabel: Record<TaskStatus, string> = {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };

  function actorOf(item: ActivityLogItem): string {
    if (item.actorName) return item.actorName;
    if (item.actorType === "mcp") return t.notifications.viaMcp;
    if (item.actorType === "system") return t.activity.system;
    return t.notifications.someone;
  }

  function messageOf(item: ActivityLogItem): string {
    const template =
      item.type === "task.assigned" && !item.assigneeName
        ? t.activity.messages.unassigned
        : t.activity.messages[ACTIVITY_KEYS[item.type]];
    return fill(template, {
      assignee: item.assigneeName ?? "",
      actor: actorOf(item),
      title: item.taskTitle,
      from: item.from ? statusLabel[item.from] ?? item.from : "?",
      to: item.to ? statusLabel[item.to] ?? item.to : "?",
      related: item.relatedTaskTitle ?? "?",
      file: item.fileName ?? "?",
    });
  }

  function changeValue(change: TaskFieldChange, value: string | null): string {
    if (value === null) return "—";
    if (change.field === "dueDate") return formatDate(value);
    if (change.field === "type" && (TASK_TYPES as readonly string[]).includes(value)) {
      return t.taskType[value as TaskType];
    }
    return value;
  }

  function changeText(change: TaskFieldChange): string {
    const label = t.activity.fields[change.field];
    // Descrizione e parent non hanno valori leggibili (testo lungo / id).
    if (change.field === "description" || change.field === "parentId") return `${label}: ${t.activity.changed}`;
    return `${label}: ${changeValue(change, change.from)} → ${changeValue(change, change.to)}`;
  }

  return (
    <ul className="activity-list">
      {items.map((item) => {
        const canOpen = Boolean(onOpenTask && item.taskId && item.type !== "task.deleted");
        return (
          <li key={item.id} className="activity-item">
            <span className={`activity-dot activity-dot-${toneOf(item.type)}`} aria-hidden="true" />
            <div className="activity-content">
              {canOpen ? (
                <button
                  type="button"
                  className="activity-text activity-text-link"
                  onClick={() => onOpenTask?.(item.taskId as string, item.projectId)}
                >
                  {messageOf(item)}
                </button>
              ) : (
                <span className="activity-text">{messageOf(item)}</span>
              )}
              {item.changes.length > 0 && (
                <ul className="activity-changes">
                  {item.changes.map((change) => (
                    <li key={change.field}>{changeText(change)}</li>
                  ))}
                </ul>
              )}
              {item.excerpt && <span className="activity-excerpt">{item.excerpt}</span>}
              <span className="activity-meta">
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                {showProject && item.projectName && <span>· {item.projectName}</span>}
                {onFilterTask && item.taskId && (
                  <button type="button" className="link-button activity-filter-task" onClick={() => onFilterTask(item)}>
                    {t.activity.filterByTask}
                  </button>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
