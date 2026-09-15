export type TaskStatus = "draft" | "in_progress" | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const FIBONACCI_COMPLEXITY = [1, 2, 3, 5, 8, 13, 21] as const;
export type TaskComplexity = (typeof FIBONACCI_COMPLEXITY)[number];

export interface Project {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  complexity: TaskComplexity | null;
  tags: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
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
  storageBackend: "local" | "s3";
  storageRef: string;
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

export interface Board {
  draft: Task[];
  in_progress: Task[];
  done: Task[];
}
