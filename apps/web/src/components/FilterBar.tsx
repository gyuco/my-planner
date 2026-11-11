import type { Project, TaskPriority } from "@my-planner/core";
import { useState } from "react";
import { useI18n } from "../i18n";
import { FilterIcon, SubtaskIcon } from "./Icons";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

/** Valore del filtro assegnatario per i task senza assegnatario. */
export const UNASSIGNED_FILTER = "__unassigned__";

export interface AssigneeOption {
  id: string;
  name: string;
}

export interface BoardFiltersState {
  /** Solo i task assegnati all'utente corrente. */
  assignedToMe: boolean;
  /** Id dell'assegnatario, `UNASSIGNED_FILTER` per i non assegnati, null = tutti. */
  assignee: string | null;
  priorities: TaskPriority[];
  blockedOnly: boolean;
  search: string;
  tag: string | null;
  /** Mostra le sotto-task come card nella loro colonna (default: nascoste, aggregate nel parent). */
  showSubtasks: boolean;
}

interface FilterBarProps {
  filters: BoardFiltersState;
  onChange: (filters: BoardFiltersState) => void;
  /** Tag disponibili, derivati lato client dai task attualmente caricati. */
  availableTags: string[];
  /** Assegnatari presenti nei task caricati. */
  availableAssignees: AssigneeOption[];
  /** Se presente, mostra il selettore di sottoinsieme progetti (solo vista aggregata). */
  projects?: Project[];
  selectedProjectIds?: string[] | null;
  onSelectedProjectIdsChange?: (ids: string[] | null) => void;
}

export function FilterBar({
  filters,
  onChange,
  availableTags,
  availableAssignees,
  projects,
  selectedProjectIds,
  onSelectedProjectIdsChange,
}: FilterBarProps) {
  const { t } = useI18n();
  // Su mobile chip e select stanno in un pannello richiudibile (bottone "Filtri");
  // su desktop il pannello e' `display: contents` e il toggle e' nascosto.
  const [panelOpen, setPanelOpen] = useState(false);
  const activeCount =
    (filters.assignedToMe ? 1 : 0) +
    filters.priorities.length +
    (filters.blockedOnly ? 1 : 0) +
    (filters.showSubtasks ? 1 : 0) +
    (filters.tag !== null ? 1 : 0) +
    (filters.assignee !== null ? 1 : 0);
  const PRIORITY_LABEL: Record<TaskPriority, string> = {
    low: t.filters.priorityLow,
    medium: t.filters.priorityMedium,
    high: t.filters.priorityHigh,
    urgent: t.filters.priorityUrgent,
  };
  function togglePriority(p: TaskPriority) {
    const has = filters.priorities.includes(p);
    onChange({
      ...filters,
      priorities: has ? filters.priorities.filter((x) => x !== p) : [...filters.priorities, p],
    });
  }

  function toggleProject(projectId: string) {
    if (!onSelectedProjectIdsChange) return;
    // null significa "tutti inclusi": lo normalizziamo alla lista completa
    // prima di calcolare la deselezione di un singolo progetto.
    const current = selectedProjectIds ?? (projects ?? []).map((p) => p.id);
    const has = current.includes(projectId);
    const next = has ? current.filter((id) => id !== projectId) : [...current, projectId];
    const allIds = (projects ?? []).map((p) => p.id);
    const isAll = next.length === allIds.length && allIds.every((id) => next.includes(id));
    onSelectedProjectIdsChange(isAll || next.length === 0 ? (next.length === 0 ? [] : null) : next);
  }

  return (
    <div className="filter-bar">
      <button
        type="button"
        className={`filter-toggle${panelOpen ? " is-open" : ""}`}
        aria-expanded={panelOpen}
        aria-controls="filter-panel"
        onClick={() => setPanelOpen((o) => !o)}
      >
        <FilterIcon />
        {t.filters.toggle}
        {activeCount > 0 && <span className="filter-toggle-count">{activeCount}</span>}
      </button>

      <div id="filter-panel" className={`filter-panel${panelOpen ? " is-open" : ""}`}>
        <div className="filter-chips">
          <button
            type="button"
            className={`filter-chip filter-chip-mine${filters.assignedToMe ? " active" : ""}`}
            aria-pressed={filters.assignedToMe}
            onClick={() => onChange({ ...filters, assignedToMe: !filters.assignedToMe })}
          >
            {t.filters.assignedToMe}
          </button>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`filter-chip filter-chip-${p}${filters.priorities.includes(p) ? " active" : ""}`}
              onClick={() => togglePriority(p)}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
          <button
            type="button"
            className={`filter-chip filter-chip-blocked${filters.blockedOnly ? " active" : ""}`}
            onClick={() => onChange({ ...filters, blockedOnly: !filters.blockedOnly })}
          >
            {t.filters.blockedOnly}
          </button>
          <button
            type="button"
            className={`filter-chip${filters.showSubtasks ? " active" : ""}`}
            aria-pressed={filters.showSubtasks}
            onClick={() => onChange({ ...filters, showSubtasks: !filters.showSubtasks })}
          >
            <SubtaskIcon /> {t.filters.showSubtasks}
          </button>
        </div>

        {/* Tag come menu a tendina: con molti tag per progetto una riga di chip
            occupava troppo spazio. */}
        {(availableTags.length > 0 || filters.tag !== null) && (
          <select
            className="filter-select filter-select-tag"
            aria-label={t.filters.allTags}
            value={filters.tag ?? ""}
            onChange={(e) => onChange({ ...filters, tag: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">{t.filters.allTags}</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
            {filters.tag !== null && !availableTags.includes(filters.tag) && (
              <option value={filters.tag}>#{filters.tag}</option>
            )}
          </select>
        )}

        <select
          className="filter-select"
          aria-label={t.filters.assigneeLabel}
          value={filters.assignee ?? ""}
          onChange={(e) => onChange({ ...filters, assignee: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">{t.filters.allAssignees}</option>
          <option value={UNASSIGNED_FILTER}>{t.assignee.unassigned}</option>
          {availableAssignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {/* L'assegnatario scelto resta selezionabile anche se non ha piu' task caricati. */}
          {filters.assignee &&
            filters.assignee !== UNASSIGNED_FILTER &&
            !availableAssignees.some((a) => a.id === filters.assignee) && (
              <option value={filters.assignee}>{t.filters.assigneeLabel}</option>
            )}
        </select>

      </div>

      <input
        type="search"
        className="filter-search"
        placeholder={t.filters.searchPlaceholder}
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />

      {projects && onSelectedProjectIdsChange && (
        <div className="filter-projects">
          <span className="filter-projects-label">{t.filters.includedProjects}</span>
          <div className="filter-chips">
            {projects.map((p) => {
              const active = !selectedProjectIds || selectedProjectIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`filter-chip${active ? " active" : ""}`}
                  onClick={() => toggleProject(p.id)}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
