import {
  TASK_STATUSES,
  TASK_TYPES,
  type ProjectStats,
  type ProjectStatsAssignee,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  computeBlockedByOpenCount,
  getProjectOrThrow,
  tagsToArray,
  userDisplayName,
} from "./taskService.js";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

/** Valore di `assigneeId` per filtrare i task senza assegnatario. */
export const UNASSIGNED_ASSIGNEE = "none";

/** Periodo di default per `closedInPeriod` se `from` non e' indicato. */
const DEFAULT_PERIOD_DAYS = 30;

export interface ProjectStatsFilters {
  type?: TaskType;
  priority?: TaskPriority;
  /** Id utente, oppure `UNASSIGNED_ASSIGNEE` per i task senza assegnatario. */
  assigneeId?: string;
  tag?: string;
  /** Di default le sotto-task sono escluse, come sulla board. */
  includeSubtasks?: boolean;
  /** Inizio del periodo per `closedInPeriod`. */
  from?: Date;
}

function countByStatus(): Record<TaskStatus, number> {
  return Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
}

function countByStatusAnd<K extends string>(keys: readonly K[]): Record<TaskStatus, Record<K, number>> {
  return Object.fromEntries(
    TASK_STATUSES.map((s) => [s, Object.fromEntries(keys.map((k) => [k, 0]))]),
  ) as Record<TaskStatus, Record<K, number>>;
}

/**
 * Statistiche sullo stato dei task di un progetto. Carica tutti i task del
 * progetto una volta sola: i valori disponibili per i filtri (tag,
 * assegnatari) sono calcolati sull'insieme completo, le statistiche solo sui
 * task che passano i filtri.
 */
export async function getProjectStats(projectId: string, filters: ProjectStatsFilters = {}): Promise<ProjectStats> {
  await getProjectOrThrow(projectId);
  const now = new Date();
  const from = filters.from ?? new Date(now.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const all = await prisma.task.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      type: true,
      priority: true,
      complexity: true,
      tags: true,
      dueDate: true,
      parentId: true,
      assigneeId: true,
      assignee: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  const availableTags = new Set<string>();
  const assigneeNames = new Map<string, string>();
  for (const t of all) {
    for (const tag of tagsToArray(t.tags)) availableTags.add(tag);
    if (t.assigneeId) assigneeNames.set(t.assigneeId, userDisplayName(t.assignee) ?? t.assigneeId);
  }

  const tasks = all.filter((t) => {
    if (!filters.includeSubtasks && t.parentId) return false;
    if (filters.type && t.type !== filters.type) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.assigneeId === UNASSIGNED_ASSIGNEE ? t.assigneeId !== null : filters.assigneeId && t.assigneeId !== filters.assigneeId) {
      return false;
    }
    if (filters.tag && !tagsToArray(t.tags).includes(filters.tag)) return false;
    return true;
  });

  const openIds = tasks.filter((t) => t.status !== "done").map((t) => t.id);
  const doneIds = tasks.filter((t) => t.status === "done").map((t) => t.id);
  const [blockedMap, closedEvents] = await Promise.all([
    computeBlockedByOpenCount(openIds),
    doneIds.length === 0
      ? Promise.resolve([])
      : prisma.taskEvent.findMany({
          where: { projectId, taskId: { in: doneIds }, type: "task.status_changed", createdAt: { gte: from } },
          select: { taskId: true, data: true },
        }),
  ]);

  const closedInPeriod = new Set<string>();
  for (const e of closedEvents) {
    try {
      if (e.taskId && JSON.parse(e.data).to === "done") closedInPeriod.add(e.taskId);
    } catch {
      // evento con data non valido: ignorato
    }
  }

  const byStatus = countByStatus();
  const byStatusPriority = countByStatusAnd(PRIORITIES);
  const byStatusType = countByStatusAnd(TASK_TYPES);
  const byAssigneeMap = new Map<string | null, ProjectStatsAssignee>();
  let overdue = 0;
  let complexityTotal = 0;
  let complexityDone = 0;

  for (const t of tasks) {
    const status = t.status as TaskStatus;
    const isDone = status === "done";
    byStatus[status]++;
    byStatusPriority[status][t.priority as TaskPriority]++;
    byStatusType[status][t.type as TaskType]++;
    if (!isDone && t.dueDate && t.dueDate < now) overdue++;
    if (t.complexity) {
      complexityTotal += t.complexity;
      if (isDone) complexityDone += t.complexity;
    }

    let row = byAssigneeMap.get(t.assigneeId);
    if (!row) {
      row = {
        assigneeId: t.assigneeId,
        name: t.assigneeId ? assigneeNames.get(t.assigneeId) ?? null : null,
        byStatus: countByStatus(),
        open: 0,
      };
      byAssigneeMap.set(t.assigneeId, row);
    }
    row.byStatus[status]++;
    if (!isDone) row.open++;
  }

  // Piu' carico aperto prima; "non assegnati" sempre in fondo.
  const byAssignee = Array.from(byAssigneeMap.values()).sort((a, b) => {
    if (a.assigneeId === null) return 1;
    if (b.assigneeId === null) return -1;
    return b.open - a.open || (a.name ?? "").localeCompare(b.name ?? "");
  });

  return {
    total: tasks.length,
    open: openIds.length,
    done: doneIds.length,
    blocked: blockedMap.size,
    overdue,
    complexityTotal,
    complexityDone,
    closedInPeriod: closedInPeriod.size,
    periodFrom: from.toISOString(),
    byStatus,
    byStatusPriority,
    byStatusType,
    byAssignee,
    availableTags: Array.from(availableTags).sort(),
    availableAssignees: Array.from(assigneeNames, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  };
}
