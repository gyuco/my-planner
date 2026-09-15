import { prisma } from "../lib/prisma.js";

/**
 * Service layer condiviso tra route REST e tool MCP.
 * Nessuna business logic va duplicata: REST e MCP chiamano queste funzioni.
 */

export async function getBoard(projectId: string) {
  return prisma.task.findMany({
    where: { projectId, parentTaskId: null },
    orderBy: [{ status: "asc" }, { position: "asc" }],
    include: { subtasks: true, blockedBy: true },
  });
}

export async function getAggregatedBoard(projectIds?: string[]) {
  return prisma.task.findMany({
    where: {
      parentTaskId: null,
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
    include: { subtasks: true, blockedBy: true, project: true },
  });
}

export async function moveTask(taskId: string, status: "draft" | "in_progress" | "done") {
  if (status === "in_progress") {
    const blockers = await prisma.taskDependency.findMany({
      where: { taskId },
      include: { blockedByTask: true },
    });
    const unresolved = blockers.filter((b) => b.blockedByTask.status !== "done");
    if (unresolved.length > 0) {
      throw new Error(
        `Task bloccato da ${unresolved.length} task non completati: ${unresolved
          .map((b) => b.blockedByTask.title)
          .join(", ")}`
      );
    }
  }
  return prisma.task.update({ where: { id: taskId }, data: { status } });
}

export async function addDependency(taskId: string, blockedByTaskId: string) {
  if (taskId === blockedByTaskId) {
    throw new Error("Un task non può bloccare se stesso");
  }
  // previene dipendenze circolari dirette (A blocca B e B blocca A)
  const inverse = await prisma.taskDependency.findFirst({
    where: { taskId: blockedByTaskId, blockedByTaskId: taskId },
  });
  if (inverse) {
    throw new Error("Dipendenza circolare non consentita");
  }
  return prisma.taskDependency.create({ data: { taskId, blockedByTaskId } });
}
