import type {
  AuthUser,
  Board,
  Project,
  ProjectToken,
  AiRoutineConfig,
  AiDispatchResult,
  AiRoutineSessionResult,
  PushDevice,
  TaskAiInput,
  UserMcpToken,
  Task,
  TaskPriority,
  TaskStatusKey,
  ProjectStatus,
  TaskComplexity,
  TaskType,
  TaskDependency,
  Comment,
  Attachment,
  StorageSettings,
  EmailSettings,
  EmailSecurity,
  UserAccount,
  UserRole,
  NotificationsResponse,
  MarkNotificationsReadResponse,
  ActivityActor,
  ActivityLogResponse,
  TaskEventType,
  TaskAssignee,
  ProjectStats,
} from "@my-planner/core";
import { clearToken, getToken } from "./auth";
import { apiDownloadErrorMessage, apiErrorMessage, apiSessionExpiredMessage } from "./i18n";

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
    let message = apiSessionExpiredMessage();
    try {
      const data = await res.json();
      message = data?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, 401, "UNAUTHORIZED");
  }

  if (!res.ok) {
    let message = apiErrorMessage(res.status);
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

// --- Autenticazione / utente corrente ---------------------------------------

export function getMe(): Promise<AuthUser> {
  return apiFetch("/auth/me");
}

export interface UpdateProfileInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

/** Modifica self-service dell'email (identificativo di login) del profilo. */
export function updateMyProfile(input: UpdateProfileInput): Promise<AuthUser> {
  return apiFetch("/auth/me", { method: "PATCH", body: JSON.stringify(input) });
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Cambio password self-service: richiede la password attuale come conferma. */
export async function changeMyPassword(input: ChangePasswordInput): Promise<void> {
  await apiFetch("/auth/me/password", { method: "PATCH", body: JSON.stringify(input) });
}

/** Avatar dell'utente corrente come data URL (null se non caricato). */
export function getMyAvatar(): Promise<{ dataUrl: string | null }> {
  return apiFetch("/auth/me/avatar");
}

/** Avatar di un utente visibile (es. assegnatario sulle card). */
export function getUserAvatar(userId: string): Promise<{ dataUrl: string | null }> {
  return apiFetch(`/avatars/${encodeURIComponent(userId)}`);
}

/** Carica un avatar gia' ridimensionato (data URL PNG/JPEG/WebP). */
export function uploadMyAvatar(dataUrl: string): Promise<AuthUser> {
  return apiFetch("/auth/me/avatar", { method: "PUT", body: JSON.stringify({ dataUrl }) });
}

/** Rimuove l'avatar: il profilo torna alle iniziali. */
export function deleteMyAvatar(): Promise<AuthUser> {
  return apiFetch("/auth/me/avatar", { method: "DELETE" });
}

// --- Gestione utenti (solo admin) -------------------------------------------

export interface CreateUserInput {
  email: string;
  password: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
  projectIds?: string[];
}

export interface UpdateUserInput {
  role?: UserRole;
  password?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  projectIds?: string[];
}

export function listUsers(): Promise<UserAccount[]> {
  return apiFetch("/users");
}

export function createUser(input: CreateUserInput): Promise<UserAccount> {
  return apiFetch("/users", { method: "POST", body: JSON.stringify(input) });
}

export function updateUser(userId: string, input: UpdateUserInput): Promise<UserAccount> {
  return apiFetch(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteUser(userId: string): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/users/${userId}`, { method: "DELETE" });
}

// --- Progetti --------------------------------------------------------------

export function listProjects(includeArchived = false): Promise<Project[]> {
  return apiFetch(`/projects?includeArchived=${includeArchived}`);
}

export function createProject(name: string): Promise<Project> {
  return apiFetch(`/projects`, { method: "POST", body: JSON.stringify({ name }) });
}

export function renameProject(projectId: string, name: string): Promise<Project> {
  return apiFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

/** Routine Claude Code del progetto per l'avvio automatico dei passi AI (solo admin). */
export function getAiRoutine(projectId: string): Promise<AiRoutineConfig> {
  return apiFetch(`/projects/${projectId}/ai-routine`);
}

export function saveAiRoutine(projectId: string, input: { routineId: string; token?: string | null }): Promise<AiRoutineConfig> {
  return apiFetch(`/projects/${projectId}/ai-routine`, { method: "PUT", body: JSON.stringify(input) });
}

export function removeAiRoutine(projectId: string): Promise<AiRoutineConfig> {
  return apiFetch(`/projects/${projectId}/ai-routine`, { method: "DELETE" });
}

export function runAiRoutine(projectId: string): Promise<AiDispatchResult> {
  return apiFetch(`/projects/${projectId}/ai-routine/run`, { method: "POST" });
}

/** Avvia una sessione interattiva di Claude Code con la routine del progetto (solo admin). */
export function startClaudeSession(
  projectId: string,
  input: { message: string; taskId?: string },
): Promise<AiRoutineSessionResult> {
  return apiFetch(`/projects/${projectId}/ai-routine/session`, { method: "POST", body: JSON.stringify(input) });
}

/** Gruppo del progetto nella sidebar (null o "" per toglierlo). */
export function setProjectGroup(projectId: string, groupName: string | null): Promise<Project> {
  return apiFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ groupName }) });
}

/** Repository GitHub del progetto (null o "" per toglierlo). */
export function setProjectRepo(projectId: string, repoUrl: string | null): Promise<Project> {
  return apiFetch(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ repoUrl }) });
}

export function archiveProject(projectId: string): Promise<Project> {
  return apiFetch(`/projects/${projectId}/archive`, { method: "POST" });
}

export function unarchiveProject(projectId: string): Promise<Project> {
  return apiFetch(`/projects/${projectId}/unarchive`, { method: "POST" });
}

// --- Notifiche push ----------------------------------------------------------

export function getPushPublicKey(): Promise<{ publicKey: string }> {
  return apiFetch(`/push/public-key`);
}

export function listPushDevices(): Promise<PushDevice[]> {
  return apiFetch(`/auth/me/push-subscriptions`);
}

export function registerPushDevice(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: string;
  label: string;
}): Promise<PushDevice> {
  return apiFetch(`/auth/me/push-subscriptions`, { method: "POST", body: JSON.stringify(input) });
}

export function removePushDevice(deviceId: string): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/auth/me/push-subscriptions/${deviceId}`, { method: "DELETE" });
}

export function sendTestPush(): Promise<{ sent: number; failed: number }> {
  return apiFetch(`/auth/me/push-subscriptions/test`, { method: "POST" });
}

// --- Token MCP -------------------------------------------------------------

/** Connector MCP globali dell'utente (creati solo dal login web OAuth). */
export function listMyMcpTokens(): Promise<UserMcpToken[]> {
  return apiFetch(`/auth/me/mcp-tokens`);
}

export function revokeMyMcpToken(tokenId: string): Promise<UserMcpToken> {
  return apiFetch(`/auth/me/mcp-tokens/${tokenId}`, { method: "DELETE" });
}

export interface ProjectTokenWithSecret extends ProjectToken {
  token: string;
}

// --- Stati personalizzati -------------------------------------------------

/** Stati del progetto (base + personalizzati) nell'ordine delle colonne. */
export function listProjectStatuses(projectId: string): Promise<ProjectStatus[]> {
  return apiFetch(`/projects/${projectId}/statuses`);
}

export function createProjectStatus(projectId: string, label: string): Promise<ProjectStatus> {
  return apiFetch(`/projects/${projectId}/statuses`, { method: "POST", body: JSON.stringify({ label }) });
}

export function renameProjectStatus(projectId: string, key: string, label: string): Promise<ProjectStatus> {
  return apiFetch(`/projects/${projectId}/statuses/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({ label }),
  });
}

export function deleteProjectStatus(projectId: string, key: string): Promise<{ key: string; deleted: true }> {
  return apiFetch(`/projects/${projectId}/statuses/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export function listProjectTokens(projectId: string): Promise<ProjectToken[]> {
  return apiFetch(`/projects/${projectId}/tokens`);
}

export function createProjectToken(
  projectId: string,
  label?: string,
): Promise<ProjectTokenWithSecret> {
  return apiFetch(`/projects/${projectId}/tokens`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function revokeProjectToken(
  projectId: string,
  tokenId: string,
): Promise<{ id: string; revokedAt: string }> {
  return apiFetch(`/projects/${projectId}/tokens/${tokenId}`, { method: "DELETE" });
}

// --- Board -------------------------------------------------------------

export interface BoardFilters {
  priority?: TaskPriority;
  tag?: string;
  search?: string;
}

/** Utenti a cui si puo' assegnare un task del progetto (admin + membri). */
export function listProjectAssignees(projectId: string): Promise<TaskAssignee[]> {
  return apiFetch(`/projects/${projectId}/assignees`);
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

/**
 * Board del progetto senza i task completati (crescono senza limite): il
 * conteggio e l'archivio arrivano da listDoneTasks.
 */
export function getProjectBoard(projectId: string, filters?: BoardFilters): Promise<Board> {
  const qs = buildQuery(filters);
  return apiFetch(`/projects/${projectId}/board${qs ? `${qs}&` : "?"}includeDone=false`);
}

/** Filtri dell'archivio dei completati (GET /tasks/done). `assigneeId: "none"` = non assegnati. */
export interface DoneTasksQuery {
  projectIds?: string[];
  /** Ricerca della board (titolo o descrizione). */
  search?: string;
  /** Ricerca dell'archivio (titolo o progetto). */
  q?: string;
  tag?: string;
  assigneeId?: string;
  priorities?: TaskPriority[];
  includeSubtasks?: boolean;
  limit?: number;
  offset?: number;
}

export interface DoneTasksPage {
  total: number;
  tasks: Task[];
}

export function listDoneTasks(query: DoneTasksQuery): Promise<DoneTasksPage> {
  const params = new URLSearchParams();
  if (query.projectIds && query.projectIds.length > 0) params.set("projectIds", query.projectIds.join(","));
  if (query.search) params.set("search", query.search);
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.assigneeId) params.set("assigneeId", query.assigneeId);
  if (query.priorities && query.priorities.length > 0) params.set("priorities", query.priorities.join(","));
  if (query.includeSubtasks) params.set("includeSubtasks", "true");
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();
  return apiFetch(`/tasks/done${qs ? `?${qs}` : ""}`);
}

/** Filtri di GET /projects/:projectId/stats. `assigneeId: "none"` = non assegnati. */
export interface ProjectStatsFilters {
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  tag?: string;
  includeSubtasks?: boolean;
  /** Inizio del periodo per i task chiusi (ISO). */
  from?: string;
}

export function getProjectStats(projectId: string, filters: ProjectStatsFilters = {}): Promise<ProjectStats> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.includeSubtasks) params.set("includeSubtasks", "true");
  if (filters.from) params.set("from", filters.from);
  const qs = params.toString();
  return apiFetch(`/projects/${projectId}/stats${qs ? `?${qs}` : ""}`);
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
  params.set("includeDone", "false");
  return apiFetch(`/board?${params.toString()}`);
}

// --- Task ----------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentId?: string | null;
  /** Omesso: il server assegna il task a chi lo crea se e' un manager. */
  assigneeId?: string | null;
}

export function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  return apiFetch(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CreateSubtaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
}

/** Crea in blocco un gruppo di sotto-task di parentId (vedi API_CONTRACT.md §4). */
export function createSubtasks(parentId: string, subtasks: CreateSubtaskInput[]): Promise<Task[]> {
  return apiFetch(`/tasks/${parentId}/subtasks`, {
    method: "POST",
    body: JSON.stringify({ subtasks }),
  });
}

export function moveTask(
  taskId: string,
  status: TaskStatusKey,
  position?: number,
): Promise<Task> {
  return apiFetch(`/tasks/${taskId}/move`, {
    method: "POST",
    body: JSON.stringify({ status, position }),
  });
}

export function listTasks(projectId: string): Promise<Task[]> {
  return apiFetch(`/projects/${projectId}/tasks`);
}

export function getTask(taskId: string): Promise<Task> {
  return apiFetch(`/tasks/${taskId}`);
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
}

export function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  return apiFetch(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(input) });
}

/** Gestione AI del task (solo admin): passi, modalita' di avviso, attiva/spenta. */
export function setTaskAi(taskId: string, input: TaskAiInput): Promise<Task> {
  return apiFetch(`/tasks/${taskId}/ai`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteTask(taskId: string): Promise<{ id: string; deleted: true }> {
  return apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
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

/**
 * "Devolver a En curso": sposta in in_progress, riassegna a chi lo aveva
 * messo in Testing e salva `message` come commento, in una sola chiamata.
 */
export function sendBackTask(taskId: string, message: string): Promise<Task> {
  return apiFetch(`/tasks/${taskId}/send-back`, { method: "POST", body: JSON.stringify({ message }) });
}

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

// --- Notifiche ---------------------------------------------------------------

/**
 * GET /notifications: oltre agli eventi non letti restituisce `unreadCount`
 * (per il badge) e `serverCursor` (da passare a markNotificationsRead).
 */
export function getNotifications(limit = 30): Promise<NotificationsResponse> {
  return apiFetch(`/notifications?limit=${limit}`);
}

/** Cursore unico: segna come lette tutte le notifiche fino a `upTo`. */
export function markNotificationsRead(upTo: number): Promise<MarkNotificationsReadResponse> {
  return apiFetch(`/notifications/read`, { method: "POST", body: JSON.stringify({ upTo }) });
}

// --- Log attivita' -----------------------------------------------------------

export interface ActivityQuery {
  projectId?: string;
  taskId?: string;
  types?: TaskEventType[];
  /** Id utente, oppure "mcp" / "system". */
  actor?: string;
  /** ISO datetime, estremi inclusivi. */
  from?: string;
  to?: string;
  search?: string;
  afterId?: number;
  beforeId?: number;
  limit?: number;
}

/** GET /activity: eventi dal piu' recente; `afterId` per il polling, `beforeId` per paginare. */
export function getActivity(query: ActivityQuery = {}): Promise<ActivityLogResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return apiFetch(`/activity${qs ? `?${qs}` : ""}`);
}

export function getActivityActors(): Promise<ActivityActor[]> {
  return apiFetch(`/activity/actors`);
}

// --- Impostazioni storage ----------------------------------------------------

export interface StorageSettingsInput {
  backend: "local" | "s3";
  localDir?: string;
  s3Endpoint?: string | null;
  s3Bucket?: string | null;
  s3Region?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
}

export function getStorageSettings(): Promise<StorageSettings> {
  return apiFetch(`/settings/storage`);
}

export function updateStorageSettings(input: StorageSettingsInput): Promise<StorageSettings> {
  return apiFetch(`/settings/storage`, { method: "PUT", body: JSON.stringify(input) });
}

// --- Impostazioni email (SMTP notifiche) ------------------------------------

export interface EmailSettingsInput {
  enabled: boolean;
  host?: string | null;
  port: number;
  security: EmailSecurity;
  username?: string | null;
  /** Vuota/omessa = mantiene la password salvata. */
  password?: string;
  fromAddress?: string | null;
  fromName?: string;
  appUrl?: string | null;
}

export function getEmailSettings(): Promise<EmailSettings> {
  return apiFetch(`/settings/email`);
}

export function updateEmailSettings(input: EmailSettingsInput): Promise<EmailSettings> {
  return apiFetch(`/settings/email`, { method: "PUT", body: JSON.stringify(input) });
}

export function sendTestEmail(to?: string): Promise<{ ok: true; to: string }> {
  return apiFetch(`/settings/email/test`, { method: "POST", body: JSON.stringify(to ? { to } : {}) });
}

/**
 * Il download richiede l'header Authorization JWT, quindi non si può usare
 * un semplice link <a href>: si scarica come blob autenticato e si innesca
 * il salvataggio via un link temporaneo.
 */
/**
 * Scarica il contenuto di un allegato come Blob (con header JWT). Usato sia
 * per il download sia per le anteprime immagine/video (object URL).
 * `type` forza il MIME del Blob quando il server non ne ha uno affidabile.
 */
export async function fetchAttachmentBlob(attachmentId: string, type?: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api/attachments/${attachmentId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiRequestError(apiDownloadErrorMessage(res.status), res.status);
  }
  const blob = await res.blob();
  return type && blob.type !== type ? new Blob([blob], { type }) : blob;
}

export async function downloadAttachment(attachmentId: string, fileName: string): Promise<void> {
  const blob = await fetchAttachmentBlob(attachmentId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
