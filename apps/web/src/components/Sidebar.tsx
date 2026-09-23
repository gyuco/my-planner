import type { Project } from "@my-planner/core";
import { useI18n } from "../i18n";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | "all" | null;
  onSelect: (projectId: string | "all") => void;
  onCreateProject: () => void;
  onOpenSettings: (projectId: string) => void;
  onRefreshProject: (projectId: string) => void;
  onOpenArchived: () => void;
  onOpenStorageSettings: () => void;
}

export function Sidebar({
  projects,
  selectedProjectId,
  onSelect,
  onCreateProject,
  onOpenSettings,
  onRefreshProject,
  onOpenArchived,
  onOpenStorageSettings,
}: SidebarProps) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>{t.sidebar.projects}</span>
        <button className="icon-button" onClick={onCreateProject} title={t.sidebar.newProjectTitle}>
          +
        </button>
      </div>
      <nav className="sidebar-nav">
        <button
          className={`sidebar-item${selectedProjectId === "all" ? " active" : ""}`}
          onClick={() => onSelect("all")}
        >
          {t.sidebar.allProjects}
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
              className="icon-button sidebar-project-refresh"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshProject(p.id);
              }}
              title={t.sidebar.refreshProjectTitle}
              aria-label={`${t.sidebar.refreshProjectTitle} ${p.name}`}
            >
              ↻
            </button>
            <button
              className="icon-button sidebar-project-settings"
              onClick={() => onOpenSettings(p.id)}
              title={t.sidebar.projectSettingsTitle}
              aria-label={`${t.sidebar.projectSettingsTitle} ${p.name}`}
            >
              ⚙
            </button>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={onOpenArchived}>
          {t.sidebar.archivedProjects}
        </button>
        <button className="sidebar-item" onClick={onOpenStorageSettings}>
          {t.sidebar.storageSettings}
        </button>
      </div>
    </aside>
  );
}
