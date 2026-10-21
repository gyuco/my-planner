import type { Project } from "@my-planner/core";
import { useI18n } from "../i18n";
import { copyText } from "../lib/clipboard";
import { absoluteUrl, projectPath } from "../lib/routes";

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | "all" | null;
  /** Evidenzia la voce "Log attivita'" quando la pagina e' aperta. */
  activityActive: boolean;
  isAdmin: boolean;
  onSelect: (projectId: string | "all") => void;
  onCreateProject: () => void;
  onOpenSettings: (projectId: string) => void;
  onRefreshProject: (projectId: string) => void;
  onOpenArchived: () => void;
  onOpenStorageSettings: () => void;
  onOpenEmailSettings: () => void;
  onOpenUsers: () => void;
  onOpenActivity: () => void;
}

export function Sidebar({
  projects,
  selectedProjectId,
  activityActive,
  isAdmin,
  onSelect,
  onCreateProject,
  onOpenSettings,
  onRefreshProject,
  onOpenArchived,
  onOpenStorageSettings,
  onOpenEmailSettings,
  onOpenUsers,
  onOpenActivity,
}: SidebarProps) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>{t.sidebar.projects}</span>
        {isAdmin && (
          <button className="icon-button" onClick={onCreateProject} title={t.sidebar.newProjectTitle}>
            +
          </button>
        )}
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
              className="icon-button sidebar-project-link"
              onClick={() => copyText(absoluteUrl(projectPath(p.id)))}
              title={t.sidebar.copyProjectLinkTitle}
              aria-label={`${t.sidebar.copyProjectLinkTitle} ${p.name}`}
            >
              🔗
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
        <button className={`sidebar-item${activityActive ? " active" : ""}`} onClick={onOpenActivity}>
          {t.sidebar.activityLog}
        </button>
        {isAdmin && (
          <button className="sidebar-item" onClick={onOpenUsers}>
            {t.sidebar.users}
          </button>
        )}
        <button className="sidebar-item" onClick={onOpenArchived}>
          {t.sidebar.archivedProjects}
        </button>
        {isAdmin && (
          <button className="sidebar-item" onClick={onOpenStorageSettings}>
            {t.sidebar.storageSettings}
          </button>
        )}
        {isAdmin && (
          <button className="sidebar-item" onClick={onOpenEmailSettings}>
            {t.sidebar.emailSettings}
          </button>
        )}
      </div>
    </aside>
  );
}
