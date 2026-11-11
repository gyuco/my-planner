import { useEffect, useMemo, useState } from "react";
import type { TaskPriority } from "@my-planner/core";
import { useI18n } from "../i18n";
import { XIcon } from "./Icons";
import type { BoardTask } from "./TaskCard";

interface DoneTasksModalProps {
  tasks: BoardTask[];
  showProject?: boolean;
  onClose: () => void;
  onTaskClick?: (task: BoardTask) => void;
}

/**
 * Archivio dei task completati: la colonna Done non e' piu' sulla board,
 * i task chiusi si consultano qui, dal piu' recente.
 */
export function DoneTasksModal({ tasks, showProject, onClose, onTaskClick }: DoneTasksModalProps) {
  const { t, dateLocale } = useI18n();
  const [query, setQuery] = useState("");
  const PRIORITY_LABEL: Record<TaskPriority, string> = {
    low: t.taskCard.priorityLow,
    medium: t.taskCard.priorityMedium,
    high: t.taskCard.priorityHigh,
    urgent: t.taskCard.priorityUrgent,
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...tasks]
      .filter((task) => !q || task.title.toLowerCase().includes(q) || (task.projectName ?? "").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tasks, query]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal done-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="done-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="done-modal-head">
          <h2 id="done-modal-title">
            {t.board.doneTitle} <span className="done-modal-count">{tasks.length}</span>
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t.board.close} title={t.board.close}>
            <XIcon />
          </button>
        </div>
        <input
          type="search"
          className="filter-search done-modal-search"
          placeholder={t.board.doneSearch}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.board.doneSearch}
        />
        {rows.length === 0 ? (
          <p className="done-empty">{t.board.doneEmpty}</p>
        ) : (
          <div className="done-table-wrap">
            <table className="done-table">
              <thead>
                <tr>
                  <th scope="col">{t.board.doneColTitle}</th>
                  {showProject && <th scope="col">{t.board.doneColProject}</th>}
                  <th scope="col">{t.taskType.label}</th>
                  <th scope="col">{t.board.doneColPriority}</th>
                  <th scope="col">{t.assignee.label}</th>
                  <th scope="col">{t.board.doneColCompleted}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <tr
                    key={task.id}
                    tabIndex={0}
                    onClick={() => {
                      onClose();
                      onTaskClick?.(task);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onClose();
                        onTaskClick?.(task);
                      }
                    }}
                  >
                    <td className="done-title">{task.title}</td>
                    {showProject && <td>{task.projectName ?? ""}</td>}
                    <td>
                      <span className={`badge badge-type task-type-${task.type}`}>{t.taskType[task.type]}</span>
                    </td>
                    <td>
                      <span className={`badge badge-priority badge-priority-${task.priority}`}>
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    </td>
                    <td>{task.assigneeName ?? "—"}</td>
                    <td className="done-date">{new Date(task.updatedAt).toLocaleDateString(dateLocale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
