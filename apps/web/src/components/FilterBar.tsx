import type { TaskPriority } from "@my-planner/core";

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
}

interface FilterBarProps {
  filters: BoardFiltersState;
  onChange: (filters: BoardFiltersState) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  function togglePriority(p: TaskPriority) {
    const has = filters.priorities.includes(p);
    onChange({
      ...filters,
      priorities: has ? filters.priorities.filter((x) => x !== p) : [...filters.priorities, p],
    });
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
      <input
        type="search"
        className="filter-search"
        placeholder="Cerca per titolo o descrizione..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />
    </div>
  );
}
