import { matchPath } from "react-router-dom";

export type AppView = "board" | "stats" | "profile" | "activity";

export interface ParsedRoute {
  view: AppView;
  /** Id progetto (o "all") dal path; null per profilo/attivita'/path sconosciuti. */
  projectId: string | "all" | null;
  /** false per path sconosciuti o combinazioni inesistenti (es. statistiche di "all"). */
  valid: boolean;
}

/**
 * Schema URL dell'app (vedi API_CONTRACT.md):
 *   /projects/all | /projects/:projectId | /projects/:projectId/stats
 *   /activity | /profile
 * Il task aperto nel drawer e' nel query param `?task=:taskId`.
 */
export function parseRoute(pathname: string): ParsedRoute {
  if (matchPath("/activity", pathname)) return { view: "activity", projectId: null, valid: true };
  if (matchPath("/profile", pathname)) return { view: "profile", projectId: null, valid: true };
  const stats = matchPath("/projects/:projectId/stats", pathname);
  if (stats) {
    const id = stats.params.projectId as string;
    return { view: "stats", projectId: id, valid: id !== "all" };
  }
  const board = matchPath("/projects/:projectId", pathname);
  if (board) return { view: "board", projectId: board.params.projectId as string, valid: true };
  return { view: "board", projectId: null, valid: false };
}

export function projectPath(projectId: string | "all", view: "board" | "stats" = "board"): string {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return view === "stats" && projectId !== "all" ? `${base}/stats` : base;
}

export function taskPath(projectId: string, taskId: string): string {
  return `${projectPath(projectId)}?task=${encodeURIComponent(taskId)}`;
}

/** URL assoluto condivisibile. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
