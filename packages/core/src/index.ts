/**
 * Stati di un task, nell'ordine in cui compaiono come colonne sulla board:
 * draft -> todo -> in_progress -> testing -> done.
 */
export const TASK_STATUSES = ["draft", "todo", "in_progress", "testing", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;
export type TaskComplexity = (typeof FIBONACCI_COMPLEXITY)[number];

/** Ruolo applicativo: l'admin accede a tutto, il manager solo ai progetti assegnati. */
export type UserRole = "admin" | "manager";

/** Utente di base (senza relazioni). Per la UI di gestione vedi `UserAccount`. */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
}

/**
 * Utente autenticato restituito da login/`GET /auth/me`. `projectIds` e'
 * sempre vuoto per gli admin, che hanno accesso implicito a tutti i progetti.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  projectIds: string[];
}

/** Utente completo per la gestione admin (nessun hash password esposto). */
export interface UserAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: string;
  projectIds: string[];
  projects: Array<{ id: string; name: string }>;
}

export interface Project {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
}

/** Riepilogo di una sotto-task, presente solo nell'array `subtasks` del dettaglio (GET /tasks/:taskId). */
export interface SubtaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  complexity: TaskComplexity | null;
  tags: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  blockedByOpenCount?: number;
  // Sotto-task: un solo livello di annidamento (vedi API_CONTRACT.md §4/§7).
  // parentId presente solo se il task e' esso stesso una sotto-task.
  parentId?: string | null;
  // subtaskCount/openSubtaskCount presenti ovunque venga restituito un Task
  // (list/board/detail), sempre 0 se il task non ha sotto-task.
  subtaskCount?: number;
  openSubtaskCount?: number;
  // Presenti solo su GET /tasks/:taskId (dettaglio esteso, vedi API_CONTRACT.md §4)
  blockedBy?: TaskDependency[];
  blocking?: TaskDependency[];
  commentsCount?: number;
  attachmentsCount?: number;
  subtasks?: SubtaskSummary[];
}

export interface TaskDependency {
  taskId: string;
  blockedByTaskId: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  // "r2" è il backend del porting Cloudflare (CF7); resta compatibile con i
  // record storici "local"/"s3".
  storageBackend: "local" | "s3" | "r2";
  storageRef: string;
  createdAt: string;
}

export type StorageBackendType = "local" | "s3";

/**
 * Config globale del backend di storage allegati (vedi
 * apps/server/src/lib/attachmentStorage). Le credenziali S3 non vengono mai
 * restituite in chiaro dalla GET, solo un flag `s3SecretAccessKeySet`.
 */
export interface StorageSettings {
  backend: StorageBackendType;
  localDir: string;
  s3Endpoint: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKeySet: boolean;
  updatedAt: string;
}

export type EmailSecurity = "tls" | "starttls" | "none";

/**
 * Config SMTP globale per le email di notifica (GET/PUT /settings/email).
 * La password non viene mai restituita, solo il flag `passwordSet`.
 * `configured` = abilitata e completa: solo in quel caso partono email.
 */
export interface EmailSettings {
  enabled: boolean;
  configured: boolean;
  host: string | null;
  port: number;
  security: EmailSecurity;
  username: string | null;
  passwordSet: boolean;
  fromAddress: string | null;
  fromName: string;
  appUrl: string | null;
  updatedAt: string | null;
}

export interface ProjectToken {
  id: string;
  projectId: string;
  tokenHash: string;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
}

/** Eventi che generano una notifica (vedi apps/server/src/services/notificationService.ts). */
export type TaskEventType = "task.created" | "task.status_changed" | "comment.created";

/**
 * Notifica restituita da GET /notifications. `taskTitle` e `excerpt` sono
 * denormalizzati nell'evento, quindi restano leggibili anche dopo che il task
 * (o il commento) non esiste piu'.
 */
export interface NotificationItem {
  id: number;
  type: TaskEventType;
  projectId: string;
  projectName: string;
  taskId: string | null;
  taskTitle: string;
  actorId: string | null;
  actorName: string | null;
  actorType: "user" | "mcp" | "system";
  from: TaskStatus | null;
  to: TaskStatus | null;
  excerpt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
  lastSeenEventId: number;
  /** Max id visibile all'utente: da passare a POST /notifications/read. */
  serverCursor: number;
}

export interface MarkNotificationsReadResponse {
  lastSeenEventId: number;
}

/** Envelope condiviso per tutti gli errori REST e MCP (vedi API_CONTRACT.md §1). */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "MCP_TOKEN_INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "DEPENDENCY_BLOCKED"
  | "CIRCULAR_DEPENDENCY"
  | "INVALID_STATUS_TRANSITION"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "CONFLICT"
  | "EMAIL_SEND_FAILED"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export function apiError(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Eccezione tipizzata usata dal service layer condiviso (apps/server/src/services)
 * cosi' che REST e MCP possano mappare lo stesso envelope errore (vedi API_CONTRACT.md §1).
 */
export class ApiErrorException extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiErrorException";
    this.code = code;
  }

  toApiError(): ApiError {
    return apiError(this.code, this.message);
  }
}

export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  MCP_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  DEPENDENCY_BLOCKED: 409,
  CIRCULAR_DEPENDENCY: 409,
  INVALID_STATUS_TRANSITION: 409,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_TYPE_NOT_ALLOWED: 415,
  CONFLICT: 409,
  EMAIL_SEND_FAILED: 502,
  INTERNAL_ERROR: 500,
};

export interface Board {
  draft: Task[];
  todo: Task[];
  in_progress: Task[];
  testing: Task[];
  done: Task[];
}
