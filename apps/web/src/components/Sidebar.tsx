import type { Project } from "@my-planner/core";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | "all" | null;
  onSelect: (projectId: string | "all") => void;
  onCreateProject: () => void;
  onOpenSettings: (projectId: string) => void;
  onOpenArchived: () => void;
}

export function Sidebar({
  projects,
  selectedProjectId,
  onSelect,
  onCreateProject,
  onOpenSettings,
  onOpenArchived,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Progetti</span>
        <button className="icon-button" onClick={onCreateProject} title="Nuovo progetto">
          +
        </button>
      </div>
      <nav className="sidebar-nav">
        <button
          className={`sidebar-item${selectedProjectId === "all" ? " active" : ""}`}
          onClick={() => onSelect("all")}
        >
          Tutti i progetti
        </button>
        {projects.map((p) => (
          <div key={p.id} className="sidebar-project-row">
            <button
              className={`sidebar-item${selectedProjectId === p.id ? " active" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              {p.name}
            </button>
            <button
              className="icon-button sidebar-project-settings"
              onClick={() => onOpenSettings(p.id)}
              title="Impostazioni progetto"
              aria-label={`Impostazioni ${p.name}`}
            >
              ⚙
            </button>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={onOpenArchived}>
          Progetti archiviati
        </button>
      </div>
    </aside>
  );
}
