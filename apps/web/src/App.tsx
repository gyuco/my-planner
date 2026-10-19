import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUser, Board, Project } from "@my-planner/core";
import { TASK_STATUSES } from "@my-planner/core";
import { KanbanBoard } from "./components/KanbanBoard";
import { Sidebar } from "./components/Sidebar";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { ProjectSettingsModal } from "./components/ProjectSettingsModal";
import { ArchivedProjectsModal } from "./components/ArchivedProjectsModal";
import { StorageSettingsModal } from "./components/StorageSettingsModal";
import { EmailSettingsModal } from "./components/EmailSettingsModal";
import { UsersModal } from "./components/UsersModal";
import { TaskDrawer } from "./components/TaskDrawer";
import { FilterBar, type BoardFiltersState } from "./components/FilterBar";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { NotificationsBell } from "./components/NotificationsBell";
import type { BoardTask } from "./components/TaskCard";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ActivityPage } from "./pages/ActivityPage";
import { displayName, userInitials } from "./lib/user";
import { LogOutIcon, MenuIcon, PlusIcon, ShieldIcon } from "./components/Icons";
import { clearToken, getStoredUser, hasValidToken, saveUser } from "./auth";
import {
  getAggregatedBoard,
  getMe,
  getProjectBoard,
  listProjects,
  setUnauthorizedHandler,
} from "./api";
import { useI18n } from "./i18n";

function emptyBoard(): Board {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, []])) as unknown as Board;
}

const EMPTY_BOARD: Board = emptyBoard();
const EMPTY_FILTERS: BoardFiltersState = {
  priorities: [],
  blockedOnly: false,
  search: "",
  tag: null,
  showSubtasks: false,
};

/** Preferenza locale di visibilità della sidebar (desktop). */
const SIDEBAR_COLLAPSED_STORAGE_KEY = "my-planner-sidebar-collapsed";

function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function filterBoard(board: Board, filters: BoardFiltersState): Board {
  const titles = new Map<string, string>();
  for (const status of TASK_STATUSES) {
    for (const t of board[status] as BoardTask[]) titles.set(t.id, t.title);
  }
  function applyFilters(tasks: BoardTask[]): BoardTask[] {
    return tasks
      .filter(matches)
      .map((t) => (t.parentId ? { ...t, parentTitle: titles.get(t.parentId) } : t));
  }
  function matches(t: BoardTask): boolean {
    // Di default le sotto-task non compaiono come card indipendenti sulla
    // board: si vedono raggruppate sotto il parent (barra per stato + lista
    // nel drawer), altrimenti un task grande con 13 sotto-task disperderebbe
    // le colonne. Il filtro "Mostra sotto-task" le rende visibili nella loro
    // colonna con il badge del parent. Vedi API_CONTRACT.md §4 e BACKLOG.md
    // (nota 2026-09-23).
    if (t.parentId && !filters.showSubtasks) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
    if (filters.blockedOnly && !((t.blockedByOpenCount ?? 0) > 0)) return false;
    if (filters.tag && !t.tags.includes(filters.tag)) return false;
    return true;
  }
  return {
    draft: applyFilters(board.draft as BoardTask[]),
    todo: applyFilters(board.todo as BoardTask[]),
    in_progress: applyFilters(board.in_progress as BoardTask[]),
    testing: applyFilters(board.testing as BoardTask[]),
    done: applyFilters(board.done as BoardTask[]),
  };
}

function collectTags(board: Board): string[] {
  const set = new Set<string>();
  for (const status of TASK_STATUSES) {
    for (const t of board[status] as BoardTask[]) {
      for (const tag of t.tags) set.add(tag);
    }
  }
  return Array.from(set).sort();
}

export function App() {
  const { t } = useI18n();
  const [loggedIn, setLoggedIn] = useState(hasValidToken());
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(getStoredUser());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all" | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showStorageSettings, setShowStorageSettings] = useState(false);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [filters, setFilters] = useState<BoardFiltersState>(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskProjectId, setOpenTaskProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  // Vista corrente dell'area principale: la board (default), il profilo o il log attivita'.
  const [view, setView] = useState<"board" | "profile" | "activity">("board");
  // null = tutti i progetti inclusi nella vista aggregata (comportamento di default).
  const [aggregatedProjectIds, setAggregatedProjectIds] = useState<string[] | null>(null);

  const isAdmin = currentUser?.role === "admin";

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore (storage non disponibile) */
    }
  }, [sidebarCollapsed]);

  // Titolo della scheda del browser: nome progetto corrente (o "Tutti i
  // progetti") + brand, aggiornato quando si cambia vista o lingua.
  useEffect(() => {
    if (!loggedIn) {
      document.title = "My Planner";
      return;
    }
    if (view === "profile") {
      document.title = `${t.profile.title} · My Planner`;
      return;
    }
    if (view === "activity") {
      document.title = `${t.activity.title} · My Planner`;
      return;
    }
    const currentProject = projects.find((p) => p.id === selectedProjectId);
    if (selectedProjectId === "all") {
      document.title = `${t.app.allProjects} · My Planner`;
    } else if (currentProject) {
      document.title = `${currentProject.name} · My Planner`;
    } else {
      document.title = "My Planner";
    }
  }, [loggedIn, projects, selectedProjectId, view, t]);

  const handleLogout = useCallback(() => {
    clearToken();
    setLoggedIn(false);
    setCurrentUser(null);
    setProjects([]);
    setSelectedProjectId(null);
    setBoard(EMPTY_BOARD);
    setShowUsers(false);
    setView("board");
  }, []);

  // Rilegge ruolo e progetti assegnati dal server: dopo un cambio fatto da un
  // admin (o al reload) la UI riflette subito i permessi correnti.
  const refreshSession = useCallback(async () => {
    try {
      const user = await getMe();
      setCurrentUser(user);
      saveUser(user);
    } catch {
      /* 401 gia' gestito da apiFetch */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
    return () => setUnauthorizedHandler(null);
  }, [handleLogout]);

  useEffect(() => {
    if (loggedIn) refreshSession();
  }, [loggedIn, refreshSession]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects(false);
      setProjects(list);
      setSelectedProjectId((current) => {
        if (current === "all") return current;
        if (current && list.some((p) => p.id === current)) return current;
        return list[0]?.id ?? "all";
      });
    } catch {
      setLoadError(t.app.loadProjectsError);
    }
  }, [t]);

  useEffect(() => {
    if (loggedIn) loadProjects();
  }, [loggedIn, loadProjects]);

  const loadBoard = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      // Priorità multi-chip e "solo bloccati" filtrati lato client (il
      // contratto REST supporta un solo `priority` alla volta); la ricerca
      // testuale invece è delegata al server (`search`, vedi API_CONTRACT.md §5).
      const boardFilters = { search: filters.search || undefined, tag: filters.tag ?? undefined };
      const data =
        selectedProjectId === "all"
          ? await getAggregatedBoard(aggregatedProjectIds ?? undefined, boardFilters)
          : await getProjectBoard(selectedProjectId, boardFilters);
      setBoard(data);
      setLoadError(null);
    } catch {
      setLoadError(t.app.loadBoardError);
    }
  }, [selectedProjectId, filters.search, filters.tag, aggregatedProjectIds, t]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const refreshProject = useCallback(
    async (projectId: string) => {
      setSelectedProjectId(projectId);
      try {
        const boardFilters = { search: filters.search || undefined, tag: filters.tag ?? undefined };
        const data = await getProjectBoard(projectId, boardFilters);
        setBoard(data);
        setLoadError(null);
      } catch {
        setLoadError(t.app.loadBoardError);
      }
    },
    [filters.search, filters.tag, t],
  );

  const filteredBoard = useMemo(() => filterBoard(board, filters), [board, filters]);
  const availableTags = useMemo(() => collectTags(board), [board]);

  if (!loggedIn) {
    return (
      <LoginPage
        onLoggedIn={() => {
          setLoggedIn(true);
        }}
      />
    );
  }

  const currentProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  function handleTaskClick(task: BoardTask) {
    setOpenTaskId(task.id);
    setOpenTaskProjectId(task.projectId);
  }

  // Navigazione dentro il drawer: aprire una sotto-task o risalire al parent
  // sostituisce semplicemente il task mostrato, stesso progetto.
  function handleOpenTask(taskId: string) {
    setOpenTaskId(taskId);
  }

  const settingsProject = projects.find((p) => p.id === settingsProjectId) ?? null;

  function handleToggleSidebar() {
    // Su mobile la sidebar è un overlay (apri/chiudi); su desktop è una
    // colonna fissa che può essere compressa per liberare spazio alla board.
    if (window.matchMedia("(max-width: 700px)").matches) {
      setSidebarOpen((v) => !v);
    } else {
      setSidebarCollapsed((v) => !v);
    }
  }

  return (
    <div
      className={`app-shell${sidebarOpen ? " sidebar-open" : ""}${
        sidebarCollapsed ? " sidebar-collapsed" : ""
      }`}
    >
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        projects={projects}
        selectedProjectId={view === "activity" ? null : selectedProjectId}
        activityActive={view === "activity"}
        isAdmin={isAdmin}
        onSelect={(id) => {
          setSelectedProjectId(id);
          setView("board");
          setSidebarOpen(false);
        }}
        onCreateProject={() => setShowCreateProject(true)}
        onOpenSettings={(projectId) => setSettingsProjectId(projectId)}
        onRefreshProject={refreshProject}
        onOpenArchived={() => setShowArchived(true)}
        onOpenStorageSettings={() => setShowStorageSettings(true)}
        onOpenEmailSettings={() => setShowEmailSettings(true)}
        onOpenUsers={() => setShowUsers(true)}
        onOpenActivity={() => {
          setView("activity");
          setSidebarOpen(false);
        }}
      />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              type="button"
              className="topbar-icon-btn sidebar-toggle"
              onClick={handleToggleSidebar}
              aria-label={t.app.toggleSidebar}
              title={t.app.toggleSidebar}
            >
              <MenuIcon />
            </button>
            <h1>{view === "profile" ? t.profile.title : view === "activity" ? t.activity.title : selectedProjectId === "all" ? t.app.allProjects : currentProject?.name ?? "my-planner"}</h1>
          </div>
          <div className="topbar-actions">
            {view === "board" && currentProject && (
              <button
                type="button"
                className="topbar-cta"
                onClick={() => setShowCreateTask(true)}
                title={t.app.newTask}
              >
                <PlusIcon />
                <span className="topbar-cta-label">{t.app.newTask}</span>
              </button>
            )}
            <div className="topbar-group">
              <NotificationsBell
                onOpenTask={(taskId, projectId) => {
                  setView("board");
                  setOpenTaskId(taskId);
                  setOpenTaskProjectId(projectId);
                  setSidebarOpen(false);
                }}
              />
              <LanguageSwitcher />
            </div>
            {currentUser && (
              <div className="topbar-group">
                <button
                  type="button"
                  className={`topbar-avatar${view === "profile" ? " active" : ""}`}
                  onClick={() => {
                    setView((v) => (v === "profile" ? "board" : "profile"));
                    setSidebarOpen(false);
                  }}
                  aria-label={`${t.profile.open}: ${displayName(currentUser)}`}
                  title={`${displayName(currentUser)} · ${
                    currentUser.role === "admin" ? t.users.roleAdmin : t.users.roleManager
                  }`}
                >
                  {userInitials(currentUser)}
                  {currentUser.role === "admin" && (
                    <span className="topbar-avatar-role">
                      <ShieldIcon />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="topbar-icon-btn"
                  onClick={handleLogout}
                  aria-label={t.app.logout}
                  title={t.app.logout}
                >
                  <LogOutIcon />
                </button>
              </div>
            )}
          </div>
        </header>

        {view === "activity" ? (
          <ActivityPage
            projects={projects}
            onOpenTask={(taskId, projectId) => {
              setOpenTaskId(taskId);
              setOpenTaskProjectId(projectId);
            }}
          />
        ) : view === "profile" && currentUser ? (
          <ProfilePage
            user={currentUser}
            projects={projects}
            onBack={() => setView("board")}
            onUserUpdated={(user) => {
              setCurrentUser(user);
              saveUser(user);
            }}
          />
        ) : (
          <>
            <FilterBar
              filters={filters}
              onChange={setFilters}
              availableTags={availableTags}
              projects={selectedProjectId === "all" ? projects : undefined}
              selectedProjectIds={selectedProjectId === "all" ? aggregatedProjectIds : undefined}
              onSelectedProjectIdsChange={
                selectedProjectId === "all" ? setAggregatedProjectIds : undefined
              }
            />

            {loadError && <div className="board-error">{loadError}</div>}

            <KanbanBoard
              board={filteredBoard}
              showProject={selectedProjectId === "all"}
              onBoardChange={loadBoard}
              onTaskClick={handleTaskClick}
            />
          </>
        )}
      </div>

      {showCreateTask && currentProject && (
        <CreateTaskModal
          projectId={currentProject.id}
          onClose={() => setShowCreateTask(false)}
          onCreated={loadBoard}
        />
      )}

      {showCreateProject && isAdmin && (
        <CreateProjectModal
          onClose={() => setShowCreateProject(false)}
          onCreated={loadProjects}
        />
      )}

      {openTaskId && openTaskProjectId && (
        <TaskDrawer
          taskId={openTaskId}
          projectId={openTaskProjectId}
          onClose={() => {
            setOpenTaskId(null);
            setOpenTaskProjectId(null);
          }}
          onChanged={loadBoard}
          onOpenTask={handleOpenTask}
        />
      )}

      {settingsProject && (
        <ProjectSettingsModal
          project={settingsProject}
          onClose={() => setSettingsProjectId(null)}
          onChanged={loadProjects}
        />
      )}

      {showArchived && (
        <ArchivedProjectsModal onClose={() => setShowArchived(false)} onChanged={loadProjects} />
      )}

      {showStorageSettings && isAdmin && (
        <StorageSettingsModal onClose={() => setShowStorageSettings(false)} />
      )}

      {showEmailSettings && isAdmin && <EmailSettingsModal onClose={() => setShowEmailSettings(false)} />}

      {showUsers && currentUser && isAdmin && (
        <UsersModal
          currentUserId={currentUser.id}
          projects={projects}
          onClose={() => setShowUsers(false)}
          onChanged={() => {
            refreshSession();
            loadProjects();
          }}
        />
      )}
    </div>
  );
}
