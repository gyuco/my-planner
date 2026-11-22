import { useEffect, useState } from "react";
import type { TaskPriority } from "@my-planner/core";
import { listDoneTasks, type DoneTasksQuery } from "../api";
import { useI18n } from "../i18n";
import { XIcon } from "./Icons";
import type { BoardTask } from "./TaskCard";

const PAGE_SIZE = 50;

interface DoneTasksModalProps {
  /** Filtri della board da applicare all'archivio (progetti, ricerca, tag, persone, priorita'). */
  query: DoneTasksQuery;
  showProject?: boolean;
  onClose: () => void;
  onTaskClick?: (task: BoardTask) => void;
}

/**
 * Archivio dei task completati: la colonna Done non e' piu' sulla board,
 * i task chiusi si consultano qui, dal piu' recente. Si caricano solo
 * all'apertura, a pagine: la board non li scarica piu'.
 */
export function DoneTasksModal({ query: boardQuery, showProject, onClose, onTaskClick }: DoneTasksModalProps) {
  const { t, dateLocale } = useI18n();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<BoardTask[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const queryKey = JSON.stringify(boardQuery);

  // Prima pagina: all'apertura e a ogni ricerca (con un piccolo debounce).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      listDoneTasks({ ...boardQuery, q: query.trim() || undefined, limit: PAGE_SIZE })
        .then((page) => {
          if (cancelled) return;
          setRows(page.tasks as BoardTask[]);
          setTotal(page.total);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // boardQuery passa per queryKey: un oggetto nuovo a ogni render non ricarica.
  }, [queryKey, query]);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await listDoneTasks({ ...boardQuery, q: query.trim() || undefined, limit: PAGE_SIZE, offset: rows.length });
      setRows((prev) => [...prev, ...(page.tasks as BoardTask[])]);
      setTotal(page.total);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
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
            {t.board.doneTitle} <span className="done-modal-count">{total ?? "–"}</span>
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
        {error && (
          <p className="done-empty" role="alert">
            {t.board.doneLoadError}
          </p>
        )}
        {rows.length === 0 && !error ? (
          <p className="done-empty" role={loading ? "status" : undefined}>
            {loading ? t.board.doneLoading : t.board.doneEmpty}
          </p>
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
            {total !== null && rows.length < total && (
              <button type="button" className="done-load-more" onClick={loadMore} disabled={loading}>
                {loading ? t.board.doneLoading : t.board.doneLoadMore.replace("{count}", String(total - rows.length))}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
