import { useCallback, useEffect, useState } from "react";
import type { Board, Project } from "@my-planner/core";
import { KanbanBoard } from "./components/KanbanBoard";
import { Sidebar } from "./components/Sidebar";
import { CreateTaskModal } from "./components/CreateTaskModal";
import { CreateProjectModal } from "./components/CreateProjectModal";
import { LoginPage } from "./pages/LoginPage";
import { clearToken, hasValidToken } from "./auth";
import { getAggregatedBoard, getProjectBoard, listProjects, setUnauthorizedHandler } from "./api";

const EMPTY_BOARD: Board = { draft: [], in_progress: [], done: [] };

export function App() {
  const [loggedIn, setLoggedIn] = useState(hasValidToken());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | "all" | null>(null);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);

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
      const data =
        selectedProjectId === "all"
          ? await getAggregatedBoard()
          : await getProjectBoard(selectedProjectId);
      setBoard(data);
      setLoadError(null);
    } catch {
      setLoadError("Impossibile caricare la board");
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

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

        {loadError && <div className="board-error">{loadError}</div>}

        <KanbanBoard
          board={board}
          showProject={selectedProjectId === "all"}
          onBoardChange={loadBoard}
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
    </div>
  );
}
