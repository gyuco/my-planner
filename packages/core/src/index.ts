export type TaskStatus = "draft" | "in_progress" | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;
export type TaskComplexity = (typeof FIBONACCI_COMPLEXITY)[number];

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
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
  INTERNAL_ERROR: 500,
};

export interface Board {
  draft: Task[];
  in_progress: Task[];
  done: Task[];
}
