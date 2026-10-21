import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import {
  FilterBar,
  UNASSIGNED_FILTER,
  type AssigneeOption,
  type BoardFiltersState,
} from "./components/FilterBar";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { NotificationsBell } from "./components/NotificationsBell";
import type { BoardTask } from "./components/TaskCard";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ActivityPage } from "./pages/ActivityPage";

// Recharts pesa: caricato solo quando si apre la tab Statistiche.
const StatsPage = lazy(() => import("./pages/StatsPage"));
import { displayName, userInitials } from "./lib/user";
import { LogOutIcon, MenuIcon, PlusIcon, ShieldIcon } from "./components/Icons";
import { clearToken, getStoredUser, hasValidToken, saveUser } from "./auth";
import {
  getAggregatedBoard,
  getMe,
  getProjectBoard,
  getTask,
  listProjects,
  setUnauthorizedHandler,
} from "./api";
import { useI18n } from "./i18n";
import { parseRoute, projectPath } from "./lib/routes";
import {
  filtersSearch,
  parseFilters,
  parseProjectIds,
  writeFilters,
  writeProjectIds,
} from "./lib/filters";

function emptyBoard(): Board {
  return Object.fromEntries(TASK_STATUSES.map((status) => [status, []])) as unknown as Board;
}

const EMPTY_BOARD: Board = emptyBoard();

/** Preferenza locale di visibilità della sidebar (desktop). */
const SIDEBAR_COLLAPSED_STORAGE_KEY = "my-planner-sidebar-collapsed";

function getStoredSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function filterBoard(board: Board, filters: BoardFiltersState, currentUserId: string | null): Board {
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
    // Con "Assegnati a me" le sotto-task assegnate all'utente compaiono come
    // card anche se il parent non e' suo, altrimenti resterebbero invisibili.
    const byPerson = filters.assignedToMe || filters.assignee !== null;
    if (t.parentId && !filters.showSubtasks && !byPerson) return false;
    if (filters.assignedToMe && (!currentUserId || t.assigneeId !== currentUserId)) return false;
    if (filters.assignee === UNASSIGNED_FILTER ? t.assigneeId !== null : filters.assignee && t.assigneeId !== filters.assignee) {
      return false;
    }
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

/** Assegnatari presenti nei task caricati, per il filtro della FilterBar. */
function collectAssignees(board: Board): AssigneeOption[] {
  const map = new Map<string, string>();
  for (const status of TASK_STATUSES) {
    for (const t of board[status] as BoardTask[]) {
      if (t.assigneeId) map.set(t.assigneeId, t.assigneeName ?? t.assigneeId);
    }
  }
  return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
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
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showStorageSettings, setShowStorageSettings] = useState(false);
  const [showEmailSettings, setShowEmailSettings] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  // Task aperto nel drawer: l'id sta nell'URL (?task=), il progetto viene
  // risolto da noi (click) o da GET /tasks/:id (deep link).
  const [resolvedTask, setResolvedTask] = useState<{ taskId: string; projectId: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);

  const isAdmin = currentUser?.role === "admin";

  const navigate = useNavigate();
  const location = useLocation();
  const route = useMemo(() => parseRoute(location.pathname), [location.pathname]);
  const view = route.view;
  const taskParam = useMemo(() => new URLSearchParams(location.search).get("task"), [location.search]);
  // Il progetto selezionato e' valido solo se presente tra quelli accessibili
  // (o "all"): altrimenti l'effetto di redirect sotto riporta al default.
  const routeProjectId = route.valid ? route.projectId : null;
  const selectedProjectId =
    routeProjectId === "all" || (routeProjectId !== null && projects.some((p) => p.id === routeProjectId))
      ? routeProjectId
      : null;
  // Ultimo progetto visitato: serve per tornare alla board da profilo/attivita'.
  const lastProjectRef = useRef<string | "all" | null>(null);
  useEffect(() => {
    if (selectedProjectId) lastProjectRef.current = selectedProjectId;
  }, [selectedProjectId]);

  // Filtri e sottoinsieme progetti vivono nel query string (link condivisibili).
  // Si memoizza sulla parte "filtri" (senza ?task=) cosi' aprire il drawer non
  // ricarica la board.
  const filterSearch = useMemo(() => {
    const p = new URLSearchParams(location.search);
    p.delete("task");
    return p.toString();
  }, [location.search]);
  const filters = useMemo(() => parseFilters(filterSearch), [filterSearch]);
  const aggregatedProjectIds = useMemo(() => parseProjectIds(filterSearch), [filterSearch]);
  // Ultimi filtri usati su board/statistiche: si ripristinano tornando da profilo/attivita'.
  const lastBoardSearchRef = useRef("");
  useEffect(() => {
    if (view === "board" || view === "stats") lastBoardSearchRef.current = filtersSearch(`?${filterSearch}`, true);
  }, [view, filterSearch]);

  const updateQuery = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(location.search);
      mutate(p);
      const search = p.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    },
    [navigate, location.pathname, location.search],
  );
  const setFilters = useCallback(
    (next: BoardFiltersState) => updateQuery((p) => writeFilters(p, next)),
    [updateQuery],
  );
  const setAggregatedProjectIds = useCallback(
    (ids: string[] | null) => updateQuery((p) => writeProjectIds(p, ids)),
    [updateQuery],
  );

  const setTaskParam = useCallback(
    (taskId: string | null, replace: boolean) => {
      const params = new URLSearchParams(location.search);
      if (taskId) params.set("task", taskId);
      else params.delete("task");
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace });
    },
    [navigate, location.pathname, location.search],
  );

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
    if (view === "stats" && currentProject) {
      document.title = `${t.stats.title} · ${currentProject.name} · My Planner`;
    } else if (selectedProjectId === "all") {
      document.title = `${t.app.allProjects} · My Planner`;
    } else if (currentProject) {
      document.title = `${currentProject.name} · My Planner`;
    } else {
      document.title = "My Planner";
    }
  }, [loggedIn, projects, selectedProjectId, view, t]);

  // Azzera la sessione senza toccare l'URL: dopo una scadenza del token il
  // re-login riporta sulla pagina (o sul task) che si stava aprendo.
  const resetSession = useCallback(() => {
    clearToken();
    setLoggedIn(false);
    setCurrentUser(null);
    setProjects([]);
    setProjectsLoaded(false);
    setBoard(EMPTY_BOARD);
    setShowUsers(false);
    setResolvedTask(null);
    setRouteNotice(null);
  }, []);

  const handleLogout = useCallback(() => {
    resetSession();
    lastProjectRef.current = null;
    navigate("/", { replace: true });
  }, [resetSession, navigate]);

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
    setUnauthorizedHandler(resetSession);
    return () => setUnauthorizedHandler(null);
  }, [resetSession]);

  useEffect(() => {
    if (loggedIn) refreshSession();
  }, [loggedIn, refreshSession]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects(false);
      setProjects(list);
      setProjectsLoaded(true);
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
      if (projectId !== selectedProjectId) {
        navigate({
          pathname: projectPath(projectId, view === "stats" ? "stats" : "board"),
          search: filtersSearch(location.search, false),
        });
      }
      try {
        const boardFilters = { search: filters.search || undefined, tag: filters.tag ?? undefined };
        const data = await getProjectBoard(projectId, boardFilters);
        setBoard(data);
        setLoadError(null);
      } catch {
        setLoadError(t.app.loadBoardError);
      }
    },
    [filters.search, filters.tag, t, navigate, selectedProjectId, view],
  );

  const currentUserId = currentUser?.id ?? null;
  const filteredBoard = useMemo(
    () => filterBoard(board, filters, currentUserId),
    [board, filters, currentUserId],
  );
  const availableTags = useMemo(() => collectTags(board), [board]);
  const availableAssignees = useMemo(() => collectAssignees(board), [board]);

  // Path sconosciuto o progetto non accessibile/archiviato: redirect al default
  // (primo progetto, altrimenti vista aggregata) mantenendo l'eventuale ?task=.
  useEffect(() => {
    if (!loggedIn || !projectsLoaded) return;
    if (view === "profile" || view === "activity") return;
    if (selectedProjectId) return;
    const target = projects[0]?.id ?? "all";
    const unknownProject = route.projectId !== null && route.projectId !== "all";
    if (unknownProject && lastProjectRef.current !== route.projectId) {
      setRouteNotice(t.app.projectNotFound);
    }
    navigate({ pathname: projectPath(target), search: location.search }, { replace: true });
  }, [loggedIn, projectsLoaded, view, selectedProjectId, projects, route.projectId, location.search, navigate, t]);

  // Deep link ?task=: risolve il progetto del task (e verifica l'accesso).
  useEffect(() => {
    if (!loggedIn || !taskParam || resolvedTask?.taskId === taskParam) return;
    let cancelled = false;
    getTask(taskParam)
      .then((task) => {
        if (!cancelled) setResolvedTask({ taskId: task.id, projectId: task.projectId });
      })
      .catch(() => {
        if (cancelled) return;
        setRouteNotice(t.app.taskNotFound);
        setTaskParam(null, true);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn, taskParam, resolvedTask, setTaskParam, t]);

  const openTaskId = taskParam && resolvedTask?.taskId === taskParam ? taskParam : null;
  const openTaskProjectId = openTaskId ? resolvedTask?.projectId ?? null : null;

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

  // Torna alla board dell'ultimo progetto con gli ultimi filtri usati.
  function backToBoard() {
    return {
      pathname: projectPath(lastProjectRef.current ?? projects[0]?.id ?? "all"),
      search: lastBoardSearchRef.current,
    };
  }

  // Apre il drawer scrivendo ?task= nell'URL (push: "indietro" lo chiude).
  // `toBoard`: da profilo/attivita'/statistiche torna prima alla board.
  function openTask(taskId: string, projectId: string, toBoard = false) {
    setResolvedTask({ taskId, projectId });
    setRouteNotice(null);
    const pathname =
      toBoard && view !== "board"
        ? projectPath(selectedProjectId ?? lastProjectRef.current ?? projectId)
        : location.pathname;
    const params = new URLSearchParams(location.search);
    params.set("task", taskId);
    navigate({ pathname, search: `?${params.toString()}` });
  }

  function handleTaskClick(task: BoardTask) {
    openTask(task.id, task.projectId);
  }

  // Navigazione dentro il drawer: aprire una sotto-task o risalire al parent
  // sostituisce semplicemente il task mostrato, stesso progetto.
  function handleOpenTask(taskId: string) {
    if (resolvedTask) setResolvedTask({ taskId, projectId: resolvedTask.projectId });
    setTaskParam(taskId, true);
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
          // Cambiando progetto si resta sulle statistiche (non esistono per la vista aggregata).
          setRouteNotice(null);
          navigate({
            pathname: projectPath(id, view === "stats" ? "stats" : "board"),
            search: filtersSearch(location.search, id === "all"),
          });
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
          setRouteNotice(null);
          navigate("/activity");
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
                  openTask(taskId, projectId, true);
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
                    navigate(view === "profile" ? backToBoard() : "/profile");
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
              openTask(taskId, projectId);
            }}
          />
        ) : view === "profile" && currentUser ? (
          <ProfilePage
            user={currentUser}
            projects={projects}
            onBack={() => navigate(backToBoard())}
            onUserUpdated={(user) => {
              setCurrentUser(user);
              saveUser(user);
            }}
          />
        ) : (
          <>
            {currentProject && (
              <div className="view-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "board"}
                  className={`view-tab${view === "board" ? " active" : ""}`}
                  onClick={() => currentProject && navigate({ pathname: projectPath(currentProject.id), search: filtersSearch(location.search, false) })}
                >
                  {t.app.tabBoard}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "stats"}
                  className={`view-tab${view === "stats" ? " active" : ""}`}
                  onClick={() => currentProject && navigate({ pathname: projectPath(currentProject.id, "stats"), search: filtersSearch(location.search, false) })}
                >
                  {t.app.tabStats}
                </button>
              </div>
            )}
            {view === "stats" && currentProject ? (
              <Suspense fallback={<p className="stats-muted stats-page">{t.stats.loading}</p>}>
                <StatsPage projectId={currentProject.id} />
              </Suspense>
            ) : (
              <>
                <FilterBar
                  filters={filters}
                  onChange={setFilters}
                  availableTags={availableTags}
                  availableAssignees={availableAssignees}
                  projects={selectedProjectId === "all" ? projects : undefined}
                  selectedProjectIds={selectedProjectId === "all" ? aggregatedProjectIds : undefined}
                  onSelectedProjectIdsChange={
                    selectedProjectId === "all" ? setAggregatedProjectIds : undefined
                  }
                />

                {routeNotice && (
                  <div className="board-error" role="alert">
                    {routeNotice}
                    <button onClick={() => setRouteNotice(null)}>&times;</button>
                  </div>
                )}
                {loadError && <div className="board-error">{loadError}</div>}

                <KanbanBoard
                  board={filteredBoard}
                  showProject={selectedProjectId === "all"}
                  onBoardChange={loadBoard}
                  onTaskClick={handleTaskClick}
                />
              </>
            )}
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
          onClose={() => setTaskParam(null, true)}
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
