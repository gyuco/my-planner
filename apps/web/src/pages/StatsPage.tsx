import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TASK_STATUSES, TASK_TYPES } from "@my-planner/core";
import type { ProjectStats, TaskPriority, TaskStatus, TaskType } from "@my-planner/core";
import { getProjectStats } from "../api";
import { useI18n } from "../i18n";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const PERIODS = [7, 30, 90] as const;
const UNASSIGNED = "none";

/**
 * Colori per stato: palette categorica validata (CVD/contrasto, vedi skill
 * dataviz) assegnata in ordine fisso draft -> done. Non sono i colori dei
 * pallini delle colonne della board: indigo e violet non sono distinguibili
 * in un grafico impilato.
 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  draft: "#2a78d6",
  todo: "#eb6834",
  in_progress: "#1baf7a",
  testing: "#eda100",
  done: "#e87ba4",
};
/** Serie singola (task per stato) e scala sequenziale della matrice. */
const SINGLE_SERIES = "#2a78d6";
const SEQ_RGB = "42, 120, 214";
const AXIS_COLOR = "#9a95ad";
const GRID_COLOR = "#f0eef7";
const TEXT_COLOR = "#55516b";

interface StatsFilters {
  type: TaskType | "";
  priority: TaskPriority | "";
  assigneeId: string;
  tag: string;
  includeSubtasks: boolean;
  periodDays: (typeof PERIODS)[number];
}

const EMPTY_FILTERS: StatsFilters = {
  type: "",
  priority: "",
  assigneeId: "",
  tag: "",
  includeSubtasks: false,
  periodDays: 30,
};

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

interface StatsPageProps {
  projectId: string;
}

export default function StatsPage({ projectId }: StatsPageProps) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<StatsFilters>(EMPTY_FILTERS);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matrixBy, setMatrixBy] = useState<"priority" | "type">("priority");
  const [assigneeTable, setAssigneeTable] = useState(false);

  const STATUS_LABEL: Record<TaskStatus, string> = {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };
  const PRIORITY_LABEL: Record<TaskPriority, string> = {
    low: t.filters.priorityLow,
    medium: t.filters.priorityMedium,
    high: t.filters.priorityHigh,
    urgent: t.filters.priorityUrgent,
  };
  const TYPE_LABEL: Record<TaskType, string> = {
    bug: t.taskType.bug,
    feature: t.taskType.feature,
    analysis: t.taskType.analysis,
  };
  const PERIOD_LABEL: Record<(typeof PERIODS)[number], string> = {
    7: t.stats.last7,
    30: t.stats.last30,
    90: t.stats.last90,
  };

  // Cambio progetto: i filtri (tag, assegnatari) non hanno senso sul nuovo.
  useEffect(() => {
    setFilters(EMPTY_FILTERS);
    setStats(null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    // Inizio periodo arrotondato a mezzanotte: stesso valore per tutto il giorno.
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - filters.periodDays);
    getProjectStats(projectId, {
      type: filters.type || undefined,
      priority: filters.priority || undefined,
      assigneeId: filters.assigneeId || undefined,
      tag: filters.tag || undefined,
      includeSubtasks: filters.includeSubtasks,
      from: from.toISOString(),
    })
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError(t.stats.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, filters, t]);

  const statusData = useMemo(
    () =>
      stats ? TASK_STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s], count: stats.byStatus[s] })) : [],
    // STATUS_LABEL dipende solo dalla lingua (t).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, t],
  );

  const assigneeData = useMemo(
    () =>
      stats
        ? stats.byAssignee.map((row) => ({
            name: row.name ?? t.assignee.unassigned,
            open: row.open,
            ...row.byStatus,
          }))
        : [],
    [stats, t],
  );

  const filtersActive =
    filters.type !== "" ||
    filters.priority !== "" ||
    filters.assigneeId !== "" ||
    filters.tag !== "" ||
    filters.includeSubtasks ||
    filters.periodDays !== EMPTY_FILTERS.periodDays;

  const matrixKeys: readonly string[] = matrixBy === "priority" ? PRIORITIES : TASK_TYPES;
  const matrixLabel = (k: string) =>
    matrixBy === "priority" ? PRIORITY_LABEL[k as TaskPriority] : TYPE_LABEL[k as TaskType];
  const matrixRow = (s: TaskStatus): Record<string, number> =>
    stats ? (matrixBy === "priority" ? stats.byStatusPriority[s] : stats.byStatusType[s]) : {};
  const matrixMax = stats ? Math.max(1, ...TASK_STATUSES.flatMap((s) => Object.values(matrixRow(s)))) : 1;

  return (
    <div className="stats-page">
      <div className="activity-filters stats-filters">
        <label>
          {t.stats.type}
          <select
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value as StatsFilters["type"] })}
          >
            <option value="">{t.stats.allTypes}</option>
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.stats.priority}
          <select
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value as StatsFilters["priority"] })}
          >
            <option value="">{t.stats.allPriorities}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.stats.assignee}
          <select value={filters.assigneeId} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })}>
            <option value="">{t.stats.allAssignees}</option>
            <option value={UNASSIGNED}>{t.assignee.unassigned}</option>
            {stats?.availableAssignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.stats.tag}
          <select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
            <option value="">{t.stats.allTags}</option>
            {stats?.availableTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.stats.period}
          <select
            value={filters.periodDays}
            onChange={(e) =>
              setFilters({ ...filters, periodDays: Number(e.target.value) as StatsFilters["periodDays"] })
            }
          >
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {PERIOD_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <div className="activity-filter-actions">
          <button
            type="button"
            className={`filter-chip${filters.includeSubtasks ? " active" : ""}`}
            aria-pressed={filters.includeSubtasks}
            onClick={() => setFilters({ ...filters, includeSubtasks: !filters.includeSubtasks })}
          >
            ↳ {t.stats.includeSubtasks}
          </button>
          {filtersActive && (
            <button type="button" className="link-button" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t.stats.reset}
            </button>
          )}
        </div>
      </div>

      {error && <div className="board-error stats-error">{error}</div>}
      {!stats && !error && <p className="stats-muted">{t.stats.loading}</p>}

      {stats && (
        <>
          <div className="stats-kpis">
            <div className="stats-kpi">
              <span className="stats-kpi-label">{t.stats.total}</span>
              <span className="stats-kpi-value">{stats.total}</span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-label">{t.stats.open}</span>
              <span className="stats-kpi-value">{stats.open}</span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-label">
                {t.stats.closedInPeriod.replace("{days}", String(filters.periodDays))}
              </span>
              <span className="stats-kpi-value">{stats.closedInPeriod}</span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-label">{t.stats.blocked}</span>
              <span className={`stats-kpi-value${stats.blocked > 0 ? " stats-kpi-danger" : ""}`}>
                {stats.blocked}
              </span>
            </div>
            <div className="stats-kpi">
              <span className="stats-kpi-label">{t.stats.overdue}</span>
              <span className={`stats-kpi-value${stats.overdue > 0 ? " stats-kpi-danger" : ""}`}>
                {stats.overdue}
              </span>
            </div>
            <div className="stats-kpi stats-kpi-wide">
              <span className="stats-kpi-label">{t.stats.completion}</span>
              <span className="stats-kpi-value">{pct(stats.done, stats.total)}%</span>
              <div
                className="stats-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct(stats.done, stats.total)}
              >
                <div style={{ width: `${pct(stats.done, stats.total)}%` }} />
              </div>
              <span className="stats-kpi-hint">
                {t.stats.completionHint
                  .replace("{done}", String(stats.done))
                  .replace("{total}", String(stats.total))}
              </span>
              <span className="stats-kpi-hint">
                {stats.complexityTotal > 0
                  ? t.stats.complexityHint
                      .replace("{pct}", String(pct(stats.complexityDone, stats.complexityTotal)))
                      .replace("{done}", String(stats.complexityDone))
                      .replace("{total}", String(stats.complexityTotal))
                  : t.stats.noComplexity}
              </span>
            </div>
          </div>

          {stats.total === 0 ? (
            <p className="stats-muted">{t.stats.empty}</p>
          ) : (
            <div className="stats-grid">
              <section className="stats-card">
                <header className="stats-card-header">
                  <div>
                    <h2>{t.stats.byStatusTitle}</h2>
                    <p>{t.stats.byStatusSubtitle}</p>
                  </div>
                </header>
                <ResponsiveContainer width="100%" height={TASK_STATUSES.length * 40 + 30}>
                  <BarChart data={statusData} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }}>
                    <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      stroke={AXIS_COLOR}
                      tick={{ fill: TEXT_COLOR, fontSize: 12 }}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={96}
                      stroke={AXIS_COLOR}
                      tick={{ fill: TEXT_COLOR, fontSize: 12 }}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(42, 120, 214, 0.06)" }}
                      formatter={(value) => [`${value} ${t.stats.tasks}`, ""]}
                      separator=""
                    />
                    <Bar dataKey="count" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={24}>
                      <LabelList dataKey="count" position="right" fill={TEXT_COLOR} fontSize={12} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="stats-card">
                <header className="stats-card-header">
                  <div>
                    <h2>{t.stats.matrixTitle}</h2>
                  </div>
                  <div className="stats-toggle" role="group">
                    <button
                      type="button"
                      className={`filter-chip${matrixBy === "priority" ? " active" : ""}`}
                      aria-pressed={matrixBy === "priority"}
                      onClick={() => setMatrixBy("priority")}
                    >
                      {t.stats.matrixByPriority}
                    </button>
                    <button
                      type="button"
                      className={`filter-chip${matrixBy === "type" ? " active" : ""}`}
                      aria-pressed={matrixBy === "type"}
                      onClick={() => setMatrixBy("type")}
                    >
                      {t.stats.matrixByType}
                    </button>
                  </div>
                </header>
                <div className="stats-table-wrap">
                  <table className="stats-table stats-matrix">
                    <thead>
                      <tr>
                        <th />
                        {matrixKeys.map((k) => (
                          <th key={k}>{matrixLabel(k)}</th>
                        ))}
                        <th>{t.stats.matrixTotal}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TASK_STATUSES.map((s) => {
                        const row = matrixRow(s);
                        return (
                          <tr key={s}>
                            <th scope="row">{STATUS_LABEL[s]}</th>
                            {matrixKeys.map((k) => {
                              const v = row[k] ?? 0;
                              const alpha = v === 0 ? 0 : 0.12 + 0.78 * (v / matrixMax);
                              return (
                                <td
                                  key={k}
                                  style={{
                                    background: v === 0 ? undefined : `rgba(${SEQ_RGB}, ${alpha})`,
                                    color: alpha > 0.55 ? "#fff" : undefined,
                                  }}
                                  title={`${STATUS_LABEL[s]} · ${matrixLabel(k)}: ${v}`}
                                >
                                  {v}
                                </td>
                              );
                            })}
                            <td className="stats-table-total">{stats.byStatus[s]}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="stats-card stats-card-full">
                <header className="stats-card-header">
                  <div>
                    <h2>{t.stats.byAssigneeTitle}</h2>
                    <p>{t.stats.byAssigneeSubtitle}</p>
                  </div>
                  <button type="button" className="link-button" onClick={() => setAssigneeTable((v) => !v)}>
                    {assigneeTable ? t.stats.showChart : t.stats.showTable}
                  </button>
                </header>
                {assigneeTable ? (
                  <div className="stats-table-wrap">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          <th>{t.stats.assignee}</th>
                          {TASK_STATUSES.map((s) => (
                            <th key={s}>{STATUS_LABEL[s]}</th>
                          ))}
                          <th>{t.stats.openTasks}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assigneeData.map((row) => (
                          <tr key={row.name}>
                            <th scope="row">{row.name}</th>
                            {TASK_STATUSES.map((s) => (
                              <td key={s}>{row[s]}</td>
                            ))}
                            <td className="stats-table-total">{row.open}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={assigneeData.length * 40 + 70}>
                    <BarChart
                      data={assigneeData}
                      layout="vertical"
                      margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        stroke={AXIS_COLOR}
                        tick={{ fill: TEXT_COLOR, fontSize: 12 }}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        stroke={AXIS_COLOR}
                        tick={{ fill: TEXT_COLOR, fontSize: 12 }}
                        tickLine={false}
                      />
                      <Tooltip cursor={{ fill: "rgba(42, 120, 214, 0.06)" }} />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        // Ordine degli stati (draft -> done), non alfabetico.
                        itemSorter={(item) => TASK_STATUSES.indexOf(item.dataKey as TaskStatus)}
                        formatter={(value) => <span style={{ color: TEXT_COLOR, fontSize: 12 }}>{value}</span>}
                      />
                      {TASK_STATUSES.map((s) => (
                        <Bar
                          key={s}
                          dataKey={s}
                          name={STATUS_LABEL[s]}
                          stackId="status"
                          fill={STATUS_COLORS[s]}
                          stroke="#ffffff"
                          strokeWidth={2}
                          maxBarSize={24}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
