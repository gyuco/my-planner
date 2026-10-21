import { describe, it, expect } from "vitest";
import { addDependency, createProject, createTask, moveTask } from "./taskService.js";
import { createUser } from "./userService.js";
import { getProjectStats, UNASSIGNED_ASSIGNEE } from "./statsService.js";
import { prisma } from "../lib/prisma.js";

/**
 * Statistiche di progetto: conteggi sullo stato attuale dei task filtrati,
 * piu' `closedInPeriod` ricavato dagli eventi task.status_changed.
 */

describe("statsService.getProjectStats", () => {
  it("conta task per stato, priorita', tipo, bloccati, scaduti e complessita'", async () => {
    const project = await createProject("Stats");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const a = await createTask(project.id, { title: "A", type: "bug", priority: "high", complexity: 3, dueDate: yesterday });
    const b = await createTask(project.id, { title: "B", priority: "low", complexity: 5 });
    await createTask(project.id, { title: "C", type: "analysis" });
    await moveTask(b.id, "done");
    await addDependency(a.id, (await createTask(project.id, { title: "D" })).id);

    const stats = await getProjectStats(project.id);
    expect(stats.total).toBe(4);
    expect(stats.done).toBe(1);
    expect(stats.open).toBe(3);
    expect(stats.blocked).toBe(1);
    expect(stats.overdue).toBe(1);
    expect(stats.complexityTotal).toBe(8);
    expect(stats.complexityDone).toBe(5);
    expect(stats.closedInPeriod).toBe(1);
    expect(stats.byStatus).toEqual({ draft: 3, todo: 0, in_progress: 0, testing: 0, done: 1 });
    expect(stats.byStatusPriority.draft).toEqual({ low: 0, medium: 2, high: 1, urgent: 0 });
    expect(stats.byStatusType.draft).toEqual({ bug: 1, feature: 1, analysis: 1 });
  });

  it("esclude le sotto-task di default e le include su richiesta", async () => {
    const project = await createProject("Stats");
    const parent = await createTask(project.id, { title: "Parent" });
    await createTask(project.id, { title: "Sub", parentId: parent.id });

    expect((await getProjectStats(project.id)).total).toBe(1);
    expect((await getProjectStats(project.id, { includeSubtasks: true })).total).toBe(2);
  });

  it("filtra per tipo, tag e assegnatario e raggruppa il carico per assegnatario", async () => {
    const user = await createUser({ email: "dev@test.it", password: "password123", role: "admin", firstName: "Ada", lastName: "Dev" });
    const project = await createProject("Stats");
    await createTask(project.id, { title: "A", type: "bug", tags: ["api"], assigneeId: user.id });
    await createTask(project.id, { title: "B", tags: ["ui"], assigneeId: user.id });
    await createTask(project.id, { title: "C" });

    const all = await getProjectStats(project.id);
    expect(all.availableTags).toEqual(["api", "ui"]);
    expect(all.availableAssignees).toEqual([{ id: user.id, name: "Ada Dev" }]);
    expect(all.byAssignee.map((r) => [r.assigneeId, r.open])).toEqual([
      [user.id, 2],
      [null, 1],
    ]);

    expect((await getProjectStats(project.id, { type: "bug" })).total).toBe(1);
    expect((await getProjectStats(project.id, { tag: "ui" })).total).toBe(1);
    expect((await getProjectStats(project.id, { assigneeId: user.id })).total).toBe(2);
    expect((await getProjectStats(project.id, { assigneeId: UNASSIGNED_ASSIGNEE })).total).toBe(1);
    // I valori disponibili non dipendono dai filtri.
    expect((await getProjectStats(project.id, { tag: "ui" })).availableTags).toEqual(["api", "ui"]);
  });

  it("conta come chiusi nel periodo solo i task done con passaggio a done dopo `from`", async () => {
    const project = await createProject("Stats");
    const old = await createTask(project.id, { title: "Vecchio" });
    const recent = await createTask(project.id, { title: "Recente" });
    const reopened = await createTask(project.id, { title: "Riaperto" });
    await moveTask(old.id, "done");
    await moveTask(recent.id, "done");
    await moveTask(reopened.id, "done");
    await moveTask(reopened.id, "todo");
    await prisma.taskEvent.updateMany({
      where: { taskId: old.id },
      data: { createdAt: new Date("2020-01-01T00:00:00Z") },
    });

    const stats = await getProjectStats(project.id, { from: new Date("2021-01-01T00:00:00Z") });
    expect(stats.done).toBe(2);
    expect(stats.closedInPeriod).toBe(1);
  });

  it("rifiuta un progetto inesistente", async () => {
    await expect(getProjectStats("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
