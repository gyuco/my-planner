import { useCallback, useEffect, useMemo, useState } from "react";
import type { Board, Project } from "@my-planner/core";
import { KanbanBoard } from "./components/KanbanBoard";
import { Sidebar } from "./components/Sidebar";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { TaskDrawer } from "./components/TaskDrawer";
import { FilterBar, type BoardFiltersState } from "./components/FilterBar";
import type { BoardTask } from "./components/TaskCard";
import { LoginPage } from "./pages/LoginPage";
import { clearToken, hasValidToken } from "./auth";
import { getAggregatedBoard, getProjectBoard, listProjects, setUnauthorizedHandler } from "./api";

const EMPTY_BOARD: Board = { draft: [], in_progress: [], done: [] };
const EMPTY_FILTERS: BoardFiltersState = { priorities: [], blockedOnly: false, search: "" };

function filterBoard(board: Board, filters: BoardFiltersState): Board {
  function applyFilters(tasks: BoardTask[]): BoardTask[] {
    return tasks.filter((t) => {
      if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
      if (filters.blockedOnly && !((t.blockedByOpenCount ?? 0) > 0)) return false;
      return true;
    });
  }
  return {
    draft: applyFilters(board.draft as BoardTask[]),
    in_progress: applyFilters(board.in_progress as BoardTask[]),
    done: applyFilters(board.done as BoardTask[]),
  };
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(hasValidToken());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all" | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [filters, setFilters] = useState<BoardFiltersState>(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskProjectId, setOpenTaskProjectId] = useState<string | null>(null);

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
      const data =
        selectedProjectId === "all"
          ? await getAggregatedBoard(undefined, { search: filters.search || undefined })
          : await getProjectBoard(selectedProjectId, { search: filters.search || undefined });
      setBoard(data);
      setLoadError(null);
    } catch {
      setLoadError("Impossibile caricare la board");
    }
  }, [selectedProjectId, filters.search]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const filteredBoard = useMemo(() => filterBoard(board, filters), [board, filters]);

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

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onCreateProject={() => setShowCreateProject(true)}
      />
      <div className="app-main">
        <header className="topbar">
          <h1>{selectedProjectId === "all" ? "Tutti i progetti" : currentProject?.name ?? "my-planner"}</h1>
          <div className="topbar-actions">
            {currentProject && (
              <button onClick={() => setShowCreateTask(true)}>+ Nuovo task</button>
            )}
            <button onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <FilterBar filters={filters} onChange={setFilters} />

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
    </div>
  );
}
