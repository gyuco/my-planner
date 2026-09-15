import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, Project } from "@my-planner/core";
import { KanbanBoard } from "./components/KanbanBoard";
import { Sidebar } from "./components/Sidebar";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { ProjectSettingsModal } from "./components/ProjectSettingsModal";
import { ArchivedProjectsModal } from "./components/ArchivedProjectsModal";
import { TaskDrawer } from "./components/TaskDrawer";
import { FilterBar, type BoardFiltersState } from "./components/FilterBar";
import type { BoardTask } from "./components/TaskCard";
import { LoginPage } from "./pages/LoginPage";
import { clearToken, hasValidToken } from "./auth";
import { getAggregatedBoard, getProjectBoard, listProjects, setUnauthorizedHandler } from "./api";

const EMPTY_BOARD: Board = { draft: [], in_progress: [], done: [] };
const EMPTY_FILTERS: BoardFiltersState = { priorities: [], blockedOnly: false, search: "", tag: null };

function filterBoard(board: Board, filters: BoardFiltersState): Board {
  function applyFilters(tasks: BoardTask[]): BoardTask[] {
    return tasks.filter((t) => {
      if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
      if (filters.blockedOnly && !((t.blockedByOpenCount ?? 0) > 0)) return false;
      if (filters.tag && !t.tags.includes(filters.tag)) return false;
      return true;
    });
  }
  return {
    draft: applyFilters(board.draft as BoardTask[]),
    in_progress: applyFilters(board.in_progress as BoardTask[]),
    done: applyFilters(board.done as BoardTask[]),
  };
}

function collectTags(board: Board): string[] {
  const set = new Set<string>();
  for (const status of ["draft", "in_progress", "done"] as const) {
    for (const t of board[status] as BoardTask[]) {
      for (const tag of t.tags) set.add(tag);
    }
  }
  return Array.from(set).sort();
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(hasValidToken());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all" | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filters, setFilters] = useState<BoardFiltersState>(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskProjectId, setOpenTaskProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // null = tutti i progetti inclusi nella vista aggregata (comportamento di default).
  const [aggregatedProjectIds, setAggregatedProjectIds] = useState<string[] | null>(null);

  const handleLogout = useCallback(() => {
    clearToken();
    setLoggedIn(false);
    setProjects([]);
    setSelectedProjectId(null);
    setBoard(EMPTY_BOARD);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
    return () => setUnauthorizedHandler(null);
  }, [handleLogout]);

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
      setLoadError("Impossibile caricare i progetti");
    }
  }, []);

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
      setLoadError("Impossibile caricare la board");
    }
  }, [selectedProjectId, filters.search, filters.tag, aggregatedProjectIds]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

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

  const settingsProject = projects.find((p) => p.id === settingsProjectId) ?? null;

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelect={(id) => {
          setSelectedProjectId(id);
          setSidebarOpen(false);
        }}
        onCreateProject={() => setShowCreateProject(true)}
        onOpenSettings={(projectId) => setSettingsProjectId(projectId)}
        onOpenArchived={() => setShowArchived(true)}
      />
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Menu progetti"
            title="Menu progetti"
          >
            ☰
          </button>
          <h1>{selectedProjectId === "all" ? "Tutti i progetti" : currentProject?.name ?? "my-planner"}</h1>
          <div className="topbar-actions">
            {currentProject && (
              <button onClick={() => setShowCreateTask(true)}>+ Nuovo task</button>
            )}
            <button onClick={handleLogout}>Logout</button>
          </div>
        </header>

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
      </div>

      {showCreateTask && currentProject && (
        <CreateTaskModal
          projectId={currentProject.id}
          onClose={() => setShowCreateTask(false)}
          onCreated={loadBoard}
        />
      )}

      {showCreateProject && (
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
    </div>
  );
}
