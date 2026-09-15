import type { Board, Project, Task, TaskPriority, TaskComplexity } from "@my-planner/core";
import { clearToken, getToken } from "./auth";

/**
 * Errore thrown da apiFetch quando la risposta non è ok. Contiene il code
 * dell'envelope errore condiviso REST/MCP (vedi API_CONTRACT.md §1) quando
 * disponibile.
 */
export class ApiRequestError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Callback invocata quando una richiesta autenticata riceve 401: il token
 * non è più valido, occorre tornare al login. Impostata da App al mount.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    let message = "Sessione scaduta, effettua di nuovo il login";
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, 401, "UNAUTHORIZED");
  }

  if (!res.ok) {
    let message = `Errore ${res.status}`;
    let code: string | undefined;
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
      code = data?.error?.code;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Progetti --------------------------------------------------------------

export function listProjects(includeArchived = false): Promise<Project[]> {
  return apiFetch(`/projects?includeArchived=${includeArchived}`);
}

export function createProject(name: string): Promise<Project> {
  return apiFetch(`/projects`, { method: "POST", body: JSON.stringify({ name }) });
}

// --- Board -------------------------------------------------------------

export interface BoardFilters {
  priority?: TaskPriority;
  tag?: string;
  search?: string;
}

function buildQuery(filters?: BoardFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function getProjectBoard(projectId: string, filters?: BoardFilters): Promise<Board> {
  return apiFetch(`/projects/${projectId}/board${buildQuery(filters)}`);
}

export function getAggregatedBoard(
  projectIds?: string[],
  filters?: BoardFilters,
): Promise<Board> {
  const params = new URLSearchParams();
  if (projectIds && projectIds.length > 0) params.set("projectIds", projectIds.join(","));
  if (filters?.priority) params.set("priority", filters.priority);
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.search) params.set("search", filters.search);
  const qs = params.toString();
  return apiFetch(`/board${qs ? `?${qs}` : ""}`);
}

// --- Task ----------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentTaskId?: string | null;
}

export function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function moveTask(
  taskId: string,
  status: "draft" | "in_progress" | "done",
  position?: number,
): Promise<Task> {
  return apiFetch(`/tasks/${taskId}/move`, {
    method: "POST",
    body: JSON.stringify({ status, position }),
  });
}
