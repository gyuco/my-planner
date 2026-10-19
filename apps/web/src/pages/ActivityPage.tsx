import { useEffect, useMemo, useState } from "react";
import type { ActivityActor, ActivityLogItem, Project, Task, TaskEventType } from "@my-planner/core";
import { TASK_EVENT_TYPES } from "@my-planner/core";
import { getActivityActors, listTasks, type ActivityQuery } from "../api";
import { ActivityList, ACTIVITY_KEYS } from "../components/ActivityList";
import { useActivityFeed } from "../lib/activity";
import { useI18n } from "../i18n";

const POLL_INTERVAL_MS = 5_000;
const SEARCH_DEBOUNCE_MS = 300;

interface ActivityFilters {
  projectId: string;
  taskId: string;
  /** Titolo del task filtrato, per mostrarlo anche se non e' nella lista (es. eliminato). */
  taskTitle: string;
  type: TaskEventType | "";
  actor: string;
  from: string;
  to: string;
  search: string;
}

const EMPTY_FILTERS: ActivityFilters = {
  projectId: "",
  taskId: "",
  taskTitle: "",
  type: "",
  actor: "",
  from: "",
  to: "",
  search: "",
};

/** Data locale (yyyy-mm-dd) -> ISO all'inizio o alla fine del giorno, nel fuso del browser. */
function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const [y, m, d] = day.split("-").map(Number);
  const date = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  return date.toISOString();
}

interface ActivityPageProps {
  projects: Project[];
  onOpenTask: (taskId: string, projectId: string) => void;
}

/**
 * Log attivita' di tutti i progetti visibili, aggiornato in tempo reale
 * (polling ogni 5s con tab visibile) e filtrabile per progetto, task, tipo di
 * evento, autore, intervallo di date e testo.
 */
export function ActivityPage({ projects, onOpenTask }: ActivityPageProps) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);

  useEffect(() => {
    getActivityActors()
      .then(setActors)
      .catch(() => setActors([]));
  }, []);

  useEffect(() => {
    if (!filters.projectId) {
      setProjectTasks([]);
      return;
    }
    let cancelled = false;
    listTasks(filters.projectId)
      .then((tasks) => {
        if (!cancelled) setProjectTasks(tasks);
      })
      .catch(() => {
        if (!cancelled) setProjectTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.projectId]);

  // Ricerca testuale con debounce: ogni cambio filtri ricarica la lista.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((f) => (f.search === search.trim() ? f : { ...f, search: search.trim() }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo<ActivityQuery>(
    () => ({
      projectId: filters.projectId || undefined,
      taskId: filters.taskId || undefined,
      types: filters.type ? [filters.type] : undefined,
      actor: filters.actor || undefined,
      from: dayBoundary(filters.from, false),
      to: dayBoundary(filters.to, true),
      search: filters.search || undefined,
    }),
    [filters],
  );

  const feed = useActivityFeed(query, {
    live,
    intervalMs: POLL_INTERVAL_MS,
    errorMessage: t.activity.loadError,
  });

  const taskOptions = useMemo(() => {
    const options = projectTasks.map((task) => ({ id: task.id, title: task.title }));
    if (filters.taskId && !options.some((o) => o.id === filters.taskId)) {
      options.unshift({ id: filters.taskId, title: filters.taskTitle || filters.taskId });
    }
    return options;
  }, [projectTasks, filters.taskId, filters.taskTitle]);

  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) || search !== "";

  function update(patch: Partial<ActivityFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
  }

  function handleFilterTask(item: ActivityLogItem) {
    update({ projectId: item.projectId, taskId: item.taskId ?? "", taskTitle: item.taskTitle });
  }

  return (
    <div className="activity-page">
      <div className="activity-filters">
        <label>
          <span>{t.activity.project}</span>
          <select
            value={filters.projectId}
            onChange={(e) => update({ projectId: e.target.value, taskId: "", taskTitle: "" })}
          >
            <option value="">{t.activity.allProjects}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.activity.task}</span>
          <select
            value={filters.taskId}
            disabled={!filters.projectId}
            onChange={(e) => {
              const option = taskOptions.find((o) => o.id === e.target.value);
              update({ taskId: e.target.value, taskTitle: option?.title ?? "" });
            }}
          >
            <option value="">{t.activity.allTasks}</option>
            {taskOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.activity.type}</span>
          <select value={filters.type} onChange={(e) => update({ type: e.target.value as TaskEventType | "" })}>
            <option value="">{t.activity.allTypes}</option>
            {TASK_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.activity.typeLabels[ACTIVITY_KEYS[type]]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.activity.actor}</span>
          <select value={filters.actor} onChange={(e) => update({ actor: e.target.value })}>
            <option value="">{t.activity.allActors}</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="mcp">{t.notifications.viaMcp}</option>
            <option value="system">{t.activity.system}</option>
          </select>
        </label>
        <label>
          <span>{t.activity.from}</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </label>
        <label>
          <span>{t.activity.to}</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
        </label>
        <label className="activity-filter-search">
          <span>{t.activity.search}</span>
          <input
            type="search"
            value={search}
            placeholder={t.activity.searchPlaceholder}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="activity-filter-actions">
          <button
            type="button"
            className={`filter-chip activity-live${live ? " active" : ""}`}
            aria-pressed={live}
            title={t.activity.liveTitle}
            onClick={() => setLive((v) => !v)}
          >
            <span className="activity-live-dot" aria-hidden="true" />
            {live ? t.activity.live : t.activity.paused}
          </button>
          {hasFilters && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearch("");
              }}
            >
              {t.activity.reset}
            </button>
          )}
        </div>
      </div>

      {feed.error && <div className="board-error">{feed.error}</div>}

      <div className="activity-card">
        {feed.loading ? (
          <p className="activity-empty">{t.taskDrawer.loading}</p>
        ) : feed.items.length === 0 ? (
          <p className="activity-empty">{t.activity.empty}</p>
        ) : (
          <ActivityList items={feed.items} showProject onOpenTask={onOpenTask} onFilterTask={handleFilterTask} />
        )}
        {feed.hasMore && (
          <button type="button" className="activity-load-more" onClick={feed.loadMore} disabled={feed.loadingMore}>
            {t.activity.loadMore}
          </button>
        )}
      </div>
    </div>
  );
}
