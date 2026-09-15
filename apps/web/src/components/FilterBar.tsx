import type { Project, TaskPriority } from "@my-planner/core";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export interface BoardFiltersState {
  priorities: TaskPriority[];
  blockedOnly: boolean;
  search: string;
  tag: string | null;
}

interface FilterBarProps {
  filters: BoardFiltersState;
  onChange: (filters: BoardFiltersState) => void;
  /** Tag disponibili, derivati lato client dai task attualmente caricati. */
  availableTags: string[];
  /** Se presente, mostra il selettore di sottoinsieme progetti (solo vista aggregata). */
  projects?: Project[];
  selectedProjectIds?: string[] | null;
  onSelectedProjectIdsChange?: (ids: string[] | null) => void;
}

export function FilterBar({
  filters,
  onChange,
  availableTags,
  projects,
  selectedProjectIds,
  onSelectedProjectIdsChange,
}: FilterBarProps) {
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
      <div className="filter-chips">
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
          Solo bloccati
        </button>
      </div>

      {availableTags.length > 0 && (
        <div className="filter-chips filter-chips-tags">
          <button
            type="button"
            className={`filter-chip filter-chip-tag${filters.tag === null ? " active" : ""}`}
            onClick={() => onChange({ ...filters, tag: null })}
          >
            Tutti i tag
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`filter-chip filter-chip-tag${filters.tag === tag ? " active" : ""}`}
              onClick={() => onChange({ ...filters, tag: filters.tag === tag ? null : tag })}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <input
        type="search"
        className="filter-search"
        placeholder="Cerca per titolo o descrizione..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />

      {projects && onSelectedProjectIdsChange && (
        <div className="filter-projects">
          <span className="filter-projects-label">Progetti inclusi:</span>
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
