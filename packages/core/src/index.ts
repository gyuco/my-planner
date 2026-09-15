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
  createdAt: string;
  revokedAt: string | null;
}
