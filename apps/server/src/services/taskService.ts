import { ApiErrorException, FIBONACCI_COMPLEXITY, type TaskComplexity } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

/**
 * Service layer condiviso tra route REST e tool MCP.
 * Nessuna business logic va duplicata: REST e MCP chiamano queste funzioni.
 * Tutti gli errori sono lanciati come ApiErrorException con un ErrorCode
 * coerente con API_CONTRACT.md §1, cosi' REST e MCP possono mappare lo
 * stesso envelope.
 */

type TaskStatus = "draft" | "in_progress" | "done";
type TaskPriority = "low" | "medium" | "high" | "urgent";

function tagsToArray(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToCsv(tags: string[] | undefined): string | undefined {
  if (tags === undefined) return undefined;
  return tags.filter(Boolean).join(",");
}

function serializeTask(task: any): any {
  const { tags, ...rest } = task;
  const out: any = { ...rest, tags: tagsToArray(tags ?? "") };
  if (task.dueDate) out.dueDate = new Date(task.dueDate).toISOString();
  if (task.createdAt) out.createdAt = new Date(task.createdAt).toISOString();
  if (task.updatedAt) out.updatedAt = new Date(task.updatedAt).toISOString();
  if (task.subtasks) {
    out.subtasks = task.subtasks.map(serializeTask);
    const total = task.subtasks.length;
    if (total > 0) {
      const done = task.subtasks.filter((s: any) => s.status === "done").length;
      out.subtaskProgress = { done, total };
    }
  }
  if (task.project) {
    out.projectId = task.project.id;
    out.projectName = task.project.name;
    delete out.project;
  }
  return out;
}

async function computeSubtaskProgress(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, { done: number; total: number }>();
  const subtasks = await prisma.task.findMany({
    where: { parentTaskId: { in: taskIds } },
    select: { parentTaskId: true, status: true },
  });
  const map = new Map<string, { done: number; total: number }>();
  for (const s of subtasks) {
    const key = s.parentTaskId as string;
    const entry = map.get(key) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (s.status === "done") entry.done += 1;
    map.set(key, entry);
  }
  return map;
}

async function computeBlockedByOpenCount(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, number>();
  const deps = await prisma.taskDependency.findMany({
    where: { taskId: { in: taskIds } },
    include: { blockedByTask: { select: { status: true } } },
  });
  const map = new Map<string, number>();
  for (const d of deps) {
    if (d.blockedByTask.status !== "done") {
      map.set(d.taskId, (map.get(d.taskId) ?? 0) + 1);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Progetti
// ---------------------------------------------------------------------------

export async function listProjects(includeArchived = false) {
  return prisma.project.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { createdAt: "asc" },
  });
}

export async function createProject(name: string) {
  if (!name || name.trim().length === 0 || name.length > 200) {
    throw new ApiErrorException("VALIDATION_ERROR", "Il nome del progetto deve avere tra 1 e 200 caratteri");
  }
  return prisma.project.create({ data: { name } });
}

async function getProjectOrThrow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");
  return project;
}

export async function renameProject(projectId: string, name: string) {
  await getProjectOrThrow(projectId);
  if (!name || name.trim().length === 0 || name.length > 200) {
    throw new ApiErrorException("VALIDATION_ERROR", "Il nome del progetto deve avere tra 1 e 200 caratteri");
  }
  return prisma.project.update({ where: { id: projectId }, data: { name } });
}

export async function archiveProject(projectId: string) {
  await getProjectOrThrow(projectId);
  return prisma.project.update({ where: { id: projectId }, data: { archived: true } });
}

export async function unarchiveProject(projectId: string) {
  await getProjectOrThrow(projectId);
  return prisma.project.update({ where: { id: projectId }, data: { archived: false } });
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface TaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentTaskId?: string | null;
}

function validateComplexity(complexity: unknown) {
  if (complexity === null || complexity === undefined) return;
  if (!(FIBONACCI_COMPLEXITY as readonly number[]).includes(complexity as number)) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `complexity deve essere uno dei valori Fibonacci ammessi: ${FIBONACCI_COMPLEXITY.join(", ")}`
    );
  }
}

async function getTaskOrThrow(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
  return task;
}

export async function createTask(projectId: string, input: TaskInput) {
  await getProjectOrThrow(projectId);

  if (!input.title || input.title.trim().length === 0 || input.title.length > 300) {
    throw new ApiErrorException("VALIDATION_ERROR", "title deve avere tra 1 e 300 caratteri");
  }
  validateComplexity(input.complexity);

  if (input.parentTaskId) {
    const parent = await prisma.task.findUnique({ where: { id: input.parentTaskId } });
    if (!parent || parent.projectId !== projectId) {
      throw new ApiErrorException(
        "VALIDATION_ERROR",
        "parentTaskId riferisce un task inesistente o di un altro progetto"
      );
    }
  }

  const maxPosition = await prisma.task.aggregate({
    where: { projectId, status: "draft" },
    _max: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      projectId,
      title: input.title,
      description: input.description ?? "",
      priority: input.priority ?? "medium",
      complexity: input.complexity ?? null,
      tags: tagsToCsv(input.tags) ?? "",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      parentTaskId: input.parentTaskId ?? null,
      position: (maxPosition._max.position ?? -1) + 1,
    },
  });
  return serializeTask(task);
}

export async function listTasks(
  projectId: string,
  filters: { status?: TaskStatus; priority?: TaskPriority; tag?: string; search?: string; includeSubtasks?: boolean }
) {
  await getProjectOrThrow(projectId);
  const where: any = { projectId };
  if (!filters.includeSubtasks) where.parentTaskId = null;
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { description: { contains: filters.search } },
    ];
  }

  let tasks = await prisma.task.findMany({ where, orderBy: [{ status: "asc" }, { position: "asc" }] });

  if (filters.tag) {
    tasks = tasks.filter((t) => tagsToArray(t.tags).includes(filters.tag as string));
  }

  const progressMap = await computeSubtaskProgress(tasks.map((t) => t.id));
  return tasks.map((t) => {
    const serialized = serializeTask(t);
    const progress = progressMap.get(t.id);
    if (progress) serialized.subtaskProgress = progress;
    return serialized;
  });
}

export async function getTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { subtasks: true },
  });
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");

  const [blockedBy, blocking, commentsCount, attachmentsCount] = await Promise.all([
    prisma.taskDependency.findMany({ where: { taskId } }),
    prisma.taskDependency.findMany({ where: { blockedByTaskId: taskId } }),
    prisma.comment.count({ where: { taskId } }),
    prisma.attachment.count({ where: { taskId } }),
  ]);

  const serialized = serializeTask(task);
  serialized.blockedBy = blockedBy;
  serialized.blocking = blocking;
  serialized.commentsCount = commentsCount;
  serialized.attachmentsCount = attachmentsCount;
  return serialized;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
}

export async function updateTask(taskId: string, input: TaskUpdateInput) {
  await getTaskOrThrow(taskId);

  if (input.title !== undefined && (input.title.trim().length === 0 || input.title.length > 300)) {
    throw new ApiErrorException("VALIDATION_ERROR", "title deve avere tra 1 e 300 caratteri");
  }
  if (input.complexity !== undefined) validateComplexity(input.complexity);

  const data: any = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.complexity !== undefined) data.complexity = input.complexity;
  if (input.tags !== undefined) data.tags = tagsToCsv(input.tags);
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const task = await prisma.task.update({ where: { id: taskId }, data });
  return serializeTask(task);
}

export async function deleteTask(taskId: string) {
  await getTaskOrThrow(taskId);

  // Raccoglie il task e tutti i discendenti (subtask) per il cascade.
  const toDelete = new Set<string>([taskId]);
  let frontier = [taskId];
  while (frontier.length > 0) {
    const children = await prisma.task.findMany({
      where: { parentTaskId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !toDelete.has(id));
    frontier.forEach((id) => toDelete.add(id));
  }
  const ids = Array.from(toDelete);

  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.attachment.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: { in: ids } }, { blockedByTaskId: { in: ids } }] } }),
    prisma.task.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return { id: taskId, deleted: true as const };
}

// ---------------------------------------------------------------------------
// Subtask (Task con parentTaskId valorizzato)
// ---------------------------------------------------------------------------

export async function createSubtask(parentTaskId: string, input: TaskInput) {
  const parent = await getTaskOrThrow(parentTaskId);
  return createTask(parent.projectId, { ...input, parentTaskId });
}

export async function listSubtasks(parentTaskId: string) {
  await getTaskOrThrow(parentTaskId);
  const subtasks = await prisma.task.findMany({
    where: { parentTaskId },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });
  return subtasks.map(serializeTask);
}

// ---------------------------------------------------------------------------
// Move / Board
// ---------------------------------------------------------------------------

export async function moveTask(taskId: string, status: TaskStatus, position?: number) {
  await getTaskOrThrow(taskId);

  if (status === "in_progress") {
    const blockers = await prisma.taskDependency.findMany({
      where: { taskId },
      include: { blockedByTask: true },
    });
    const unresolved = blockers.filter((b) => b.blockedByTask.status !== "done");
    if (unresolved.length > 0) {
      throw new ApiErrorException(
        "DEPENDENCY_BLOCKED",
        `Task bloccato da ${unresolved.length} task non completati: ${unresolved
          .map((b) => b.blockedByTask.title)
          .join(", ")}`
      );
    }
  }

  let targetPosition = position;
  if (targetPosition === undefined) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    const maxPosition = await prisma.task.aggregate({
      where: { projectId: task!.projectId, status },
      _max: { position: true },
    });
    targetPosition = (maxPosition._max.position ?? -1) + 1;
  }

  const updated = await prisma.task.update({ where: { id: taskId }, data: { status, position: targetPosition } });
  return serializeTask(updated);
}

export async function getBoard(
  projectId: string,
  filters: { priority?: TaskPriority; tag?: string; search?: string } = {}
) {
  await getProjectOrThrow(projectId);
  const where: any = { projectId, parentTaskId: null };
  if (filters.priority) where.priority = filters.priority;
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { description: { contains: filters.search } },
    ];
  }

  let tasks = await prisma.task.findMany({ where, orderBy: [{ status: "asc" }, { position: "asc" }] });
  if (filters.tag) tasks = tasks.filter((t) => tagsToArray(t.tags).includes(filters.tag as string));

  const [progressMap, blockedMap] = await Promise.all([
    computeSubtaskProgress(tasks.map((t) => t.id)),
    computeBlockedByOpenCount(tasks.map((t) => t.id)),
  ]);

  const board: Record<TaskStatus, any[]> = { draft: [], in_progress: [], done: [] };
  for (const t of tasks) {
    const serialized = serializeTask(t);
    const progress = progressMap.get(t.id);
    if (progress) serialized.subtaskProgress = progress;
    serialized.blockedByOpenCount = blockedMap.get(t.id) ?? 0;
    board[t.status as TaskStatus].push(serialized);
  }
  return board;
}

export async function getAggregatedBoard(
  projectIds: string[] | undefined,
  filters: { priority?: TaskPriority; tag?: string; search?: string } = {}
) {
  const where: any = {
    parentTaskId: null,
    project: projectIds ? { id: { in: projectIds } } : { archived: false },
  };
  if (filters.priority) where.priority = filters.priority;
  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search } },
      { description: { contains: filters.search } },
    ];
  }

  let tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { position: "asc" }],
    include: { project: true },
  });
  if (filters.tag) tasks = tasks.filter((t) => tagsToArray(t.tags).includes(filters.tag as string));

  const [progressMap, blockedMap] = await Promise.all([
    computeSubtaskProgress(tasks.map((t) => t.id)),
    computeBlockedByOpenCount(tasks.map((t) => t.id)),
  ]);

  const board: Record<TaskStatus, any[]> = { draft: [], in_progress: [], done: [] };
  for (const t of tasks) {
    const serialized = serializeTask(t);
    const progress = progressMap.get(t.id);
    if (progress) serialized.subtaskProgress = progress;
    serialized.blockedByOpenCount = blockedMap.get(t.id) ?? 0;
    board[t.status as TaskStatus].push(serialized);
  }
  return board;
}

// ---------------------------------------------------------------------------
// Dipendenze
// ---------------------------------------------------------------------------

export async function addDependency(taskId: string, blockedByTaskId: string) {
  if (taskId === blockedByTaskId) {
    throw new ApiErrorException("VALIDATION_ERROR", "Un task non può bloccare se stesso");
  }
  const [task, blockedByTask] = await Promise.all([getTaskOrThrow(taskId), getTaskOrThrow(blockedByTaskId)]);

  // Rileva cicli diretti E indiretti: se da blockedByTaskId, seguendo la
  // catena "e' bloccato da", si puo' raggiungere taskId, allora aggiungere
  // taskId -> blockedByTaskId creerebbe un ciclo.
  const wouldCreateCycle = await canReach(blockedByTaskId, taskId);
  if (wouldCreateCycle) {
    throw new ApiErrorException("CIRCULAR_DEPENDENCY", "Questa dipendenza creerebbe un ciclo tra i task");
  }

  void task;
  void blockedByTask;

  const existing = await prisma.taskDependency.findUnique({
    where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } },
  });
  if (existing) return existing;

  return prisma.taskDependency.create({ data: { taskId, blockedByTaskId } });
}

/**
 * Verifica se, partendo da `fromTaskId` e seguendo le dipendenze
 * "e' bloccato da" (taskId -> blockedByTaskId), si puo' raggiungere `targetTaskId`.
 * Usata per rilevare cicli indiretti prima di inserire una nuova dipendenza.
 */
async function canReach(fromTaskId: string, targetTaskId: string): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [fromTaskId];
  while (frontier.length > 0) {
    if (frontier.includes(targetTaskId)) return true;
    frontier.forEach((id) => visited.add(id));
    const deps = await prisma.taskDependency.findMany({
      where: { taskId: { in: frontier } },
      select: { blockedByTaskId: true },
    });
    frontier = deps.map((d) => d.blockedByTaskId).filter((id) => !visited.has(id));
  }
  return false;
}

export async function removeDependency(taskId: string, blockedByTaskId: string) {
  const existing = await prisma.taskDependency.findUnique({
    where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } },
  });
  if (!existing) throw new ApiErrorException("NOT_FOUND", "Dipendenza non trovata");
  await prisma.taskDependency.delete({ where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } } });
  return { deleted: true as const };
}

export async function listBlockers(taskId: string) {
  await getTaskOrThrow(taskId);
  const deps = await prisma.taskDependency.findMany({
    where: { taskId },
    include: { blockedByTask: true },
  });
  const blockers = deps.map((d) => serializeTask(d.blockedByTask));
  const allResolved = blockers.every((b) => b.status === "done");
  return { blockers, allResolved };
}

// ---------------------------------------------------------------------------
// Commenti
// ---------------------------------------------------------------------------

export async function addComment(taskId: string, body: string) {
  await getTaskOrThrow(taskId);
  if (!body || body.trim().length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "body del commento non può essere vuoto");
  }
  return prisma.comment.create({ data: { taskId, body } });
}

export async function listComments(taskId: string) {
  await getTaskOrThrow(taskId);
  return prisma.comment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
}
