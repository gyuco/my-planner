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
  // Presenti solo su GET /tasks/:taskId (dettaglio esteso, vedi API_CONTRACT.md §4)
  blockedBy?: TaskDependency[];
  blocking?: TaskDependency[];
  commentsCount?: number;
  attachmentsCount?: number;
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
  storageBackend: "local" | "s3";
  storageRef: string;
  createdAt: string;
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
