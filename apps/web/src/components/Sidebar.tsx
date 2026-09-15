import type { Project } from "@my-planner/core";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | "all" | null;
  onSelect: (projectId: string | "all") => void;
  onCreateProject: () => void;
}

export function Sidebar({ projects, selectedProjectId, onSelect, onCreateProject }: SidebarProps) {
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
          <button
            key={p.id}
            className={`sidebar-item${selectedProjectId === p.id ? " active" : ""}`}
            onClick={() => onSelect(p.id)}
          >
            {p.name}
          </button>
        ))}
      </nav>
    </aside>
  );
}
