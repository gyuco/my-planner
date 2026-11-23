import { useMemo, useState } from "react";
import type { Project } from "@my-planner/core";
import { useI18n } from "../i18n";
import { LinkIcon, PlusIcon, SettingsIcon } from "./Icons";
import { copyText } from "../lib/clipboard";
import { absoluteUrl, projectPath } from "../lib/routes";

// Gruppi chiusi nella sidebar: preferenza del singolo browser.
const COLLAPSED_GROUPS_KEY = "my-planner:sidebar-collapsed-groups";

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    /* solo comodita' */
  }
}

type SidebarEntry =
  | { kind: "project"; project: Project }
  | { kind: "group"; name: string; projects: Project[] };

/**
 * Progetti nell'ordine originale; quelli con lo stesso gruppo (groupName)
 * diventano un contenitore nella posizione del primo progetto del gruppo.
 */
function groupProjects(projects: Project[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  const groups = new Map<string, Extract<SidebarEntry, { kind: "group" }>>();
  for (const project of projects) {
    const name = project.groupName?.trim();
    if (!name) {
      entries.push({ kind: "project", project });
      continue;
    }
    let group = groups.get(name);
    if (!group) {
      group = { kind: "group", name, projects: [] };
      groups.set(name, group);
      entries.push(group);
    }
    group.projects.push(project);
  }
  return entries;
}

interface SidebarProps {
  projects: Project[];
  selectedProjectId: string | "all" | null;
  /** Evidenzia la voce "Log attivita'" quando la pagina e' aperta. */
  activityActive: boolean;
  guideActive?: boolean;
  onOpenGuide?: () => void;
  isAdmin: boolean;
  onSelect: (projectId: string | "all") => void;
  onCreateProject: () => void;
  onOpenSettings: (projectId: string) => void;
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
  guideActive = false,
  onOpenGuide,
  isAdmin,
  onSelect,
  onCreateProject,
  onOpenSettings,
  onOpenArchived,
  onOpenStorageSettings,
  onOpenEmailSettings,
  onOpenUsers,
  onOpenActivity,
}: SidebarProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);
  const entries = useMemo(() => groupProjects(projects), [projects]);

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      writeCollapsedGroups(next);
      return next;
    });
  }

  function renderProject(p: Project, nested: boolean) {
    return (
      <div key={p.id} className={`sidebar-project-row${nested ? " sidebar-project-nested" : ""}`}>
        <button
          className={`sidebar-item${selectedProjectId === p.id ? " active" : ""}`}
          onClick={() => onSelect(p.id)}
        >
          {p.name}
        </button>
        <button
          className="icon-button sidebar-project-link"
          onClick={() => copyText(absoluteUrl(projectPath(p.id)))}
          title={t.sidebar.copyProjectLinkTitle}
          aria-label={`${t.sidebar.copyProjectLinkTitle} ${p.name}`}
        >
          <LinkIcon />
        </button>
        {isAdmin && (
          <button
            className="icon-button sidebar-project-settings"
            onClick={() => onOpenSettings(p.id)}
            title={t.sidebar.projectSettingsTitle}
            aria-label={`${t.sidebar.projectSettingsTitle} ${p.name}`}
          >
            <SettingsIcon />
          </button>
        )}
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>{t.sidebar.projects}</span>
        {isAdmin && (
          <button className="icon-button" onClick={onCreateProject} title={t.sidebar.newProjectTitle} aria-label={t.sidebar.newProjectTitle}>
            <PlusIcon />
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
        {entries.map((entry) =>
          entry.kind === "project" ? (
            renderProject(entry.project, false)
          ) : (
            <div key={`group-${entry.name}`} className="sidebar-group">
              <button
                type="button"
                className={`sidebar-group-header${entry.projects.some((p) => p.id === selectedProjectId) ? " has-active" : ""}`}
                aria-expanded={!collapsed.has(entry.name)}
                aria-label={t.sidebar.groupToggle.replace("{name}", entry.name)}
                onClick={() => toggleGroup(entry.name)}
              >
                <svg className="sidebar-group-chevron" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="sidebar-group-name">{entry.name}</span>
                <span className="sidebar-group-count">{entry.projects.length}</span>
              </button>
              {!collapsed.has(entry.name) && (
                <div className="sidebar-group-items">{entry.projects.map((p) => renderProject(p, true))}</div>
              )}
            </div>
          ),
        )}
      </nav>
      <div className="sidebar-footer">
        <button className={`sidebar-item${activityActive ? " active" : ""}`} onClick={onOpenActivity}>
          {t.sidebar.activityLog}
        </button>
        {onOpenGuide && (
          <button className={`sidebar-item${guideActive ? " active" : ""}`} onClick={onOpenGuide}>
            {t.guide.sidebar}
          </button>
        )}
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
