import type {
  Board,
  Project,
  Task,
  TaskPriority,
  TaskComplexity,
  TaskDependency,
  Comment,
  Attachment,
} from "@my-planner/core";
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

export function listTasks(
  projectId: string,
  filters?: { includeSubtasks?: boolean },
): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters?.includeSubtasks) params.set("includeSubtasks", "true");
  const qs = params.toString();
  return apiFetch(`/projects/${projectId}/tasks${qs ? `?${qs}` : ""}`);
}

export function getTask(taskId: string): Promise<Task> {
  return apiFetch(`/tasks/${taskId}`);
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
}

export function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  return apiFetch(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTask(taskId: string): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
}

// --- Subtask ---------------------------------------------------------------

export function createSubtask(parentTaskId: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch(`/tasks/${parentTaskId}/subtasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listSubtasks(parentTaskId: string): Promise<Task[]> {
  return apiFetch(`/tasks/${parentTaskId}/subtasks`);
}

export function updateSubtask(subtaskId: string, input: UpdateTaskInput): Promise<Task> {
  return apiFetch(`/subtasks/${subtaskId}`, { method: "PATCH", body: JSON.stringify(input) });
}

// --- Dipendenze --------------------------------------------------------------

export function addDependency(taskId: string, blockedByTaskId: string): Promise<TaskDependency> {
  return apiFetch(`/tasks/${taskId}/dependencies`, {
    method: "POST",
    body: JSON.stringify({ blockedByTaskId }),
  });
}

export function removeDependency(taskId: string, blockedByTaskId: string): Promise<{ deleted: true }> {
  return apiFetch(`/tasks/${taskId}/dependencies/${blockedByTaskId}`, { method: "DELETE" });
}

export function listBlockers(taskId: string): Promise<{ blockers: Task[]; allResolved: boolean }> {
  return apiFetch(`/tasks/${taskId}/blockers`);
}

// --- Commenti ----------------------------------------------------------------

export function addComment(taskId: string, body: string): Promise<Comment> {
  return apiFetch(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
}

export function listComments(taskId: string): Promise<Comment[]> {
  return apiFetch(`/tasks/${taskId}/comments`);
}

// --- Allegati ------------------------------------------------------------------

export function listAttachments(taskId: string): Promise<Attachment[]> {
  return apiFetch(`/tasks/${taskId}/attachments`);
}

export async function uploadAttachment(taskId: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch(`/tasks/${taskId}/attachments`, { method: "POST", body: formData });
}

export function deleteAttachment(attachmentId: string): Promise<{ deleted: true }> {
  return apiFetch(`/attachments/${attachmentId}`, { method: "DELETE" });
}

/**
 * Il download richiede l'header Authorization JWT, quindi non si può usare
 * un semplice link <a href>: si scarica come blob autenticato e si innesca
 * il salvataggio via un link temporaneo.
 */
export async function downloadAttachment(attachmentId: string, fileName: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/attachments/${attachmentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiRequestError(`Errore ${res.status} durante il download`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
