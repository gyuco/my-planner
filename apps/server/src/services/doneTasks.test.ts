import { describe, it, expect } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  archiveProject,
  createProject,
  createSubtasks,
  createTask,
  getAggregatedBoard,
  getBoard,
  listDoneTasks,
  moveTask,
} from "./taskService.js";
import { createUser, doneProjectScope, getAuthUser } from "./userService.js";

/**
 * La board non carica i completati con includeDone=false: crescono senza
 * limite. L'archivio (pulsante Done) li legge a pagine con listDoneTasks.
 */

async function done(projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const task = await createTask(projectId, { title, ...extra });
  await moveTask(task.id, "done");
  return task;
}

describe("board senza completati e archivio a pagine", () => {
  it("includeDone=false esclude i done; il default resta invariato (MCP)", async () => {
    const project = await createProject("Clinica");
    const open = await createTask(project.id, { title: "Aperto" });
    await done(project.id, "Chiuso");

    const light = await getBoard(project.id, { includeDone: false });
    expect(light.draft.map((t: any) => t.id)).toEqual([open.id]);
    expect(light.done).toEqual([]);

    const full = await getBoard(project.id);
    expect(full.done.map((t: any) => t.title)).toEqual(["Chiuso"]);

    const aggregated = await getAggregatedBoard([project.id], { includeDone: false });
    expect(aggregated.done).toEqual([]);
    expect(aggregated.draft).toHaveLength(1);
  });

  it("dal piu' recente, a pagine, con totale; sotto-task escluse se non richieste", async () => {
    const project = await createProject("Clinica");
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t = await done(project.id, `Task ${i}`);
      ids.push(t.id);
      await prisma.task.update({ where: { id: t.id }, data: { updatedAt: new Date(2026, 0, i + 1) } });
    }
    const [sub] = await createSubtasks(project.id, ids[0], [{ title: "Sotto" }]);
    await moveTask(sub.id, "done");

    const page1 = await listDoneTasks({ projectIds: [project.id], limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.tasks.map((t) => t.title)).toEqual(["Task 4", "Task 3"]);
    expect(page1.tasks[0].projectName).toBe("Clinica");
    const page3 = await listDoneTasks({ projectIds: [project.id], limit: 2, offset: 4 });
    expect(page3.tasks.map((t) => t.title)).toEqual(["Task 0"]);

    expect((await listDoneTasks({ projectIds: [project.id], includeSubtasks: true })).total).toBe(6);
    expect((await listDoneTasks({ projectIds: [project.id], limit: 0 })).tasks).toEqual([]);
  });

  it("filtri: ricerca, tag esatto, priorita', assegnatario, progetto", async () => {
    const project = await createProject("Clinica");
    const other = await createProject("Magazzino");
    const admin = await createUser({ email: "admin@test.it", password: "password123", role: "admin" });
    await done(project.id, "Login rotto", { tags: ["auth", "ui"], priority: "high", assigneeId: admin.id });
    await done(project.id, "Export CSV", { tags: ["authz"], priority: "low", description: "report login" });
    await done(other.id, "Inventario", { tags: ["auth"] });

    const titles = async (q: Parameters<typeof listDoneTasks>[0]) =>
      (await listDoneTasks(q)).tasks.map((t) => t.title).sort();

    expect(await titles({ projectIds: [project.id], tag: "auth" })).toEqual(["Login rotto"]);
    expect(await titles({ projectIds: [project.id], search: "login" })).toEqual(["Export CSV", "Login rotto"]);
    expect(await titles({ projectIds: [project.id], q: "login" })).toEqual(["Login rotto"]);
    expect(await titles({ q: "magazz" })).toEqual(["Inventario"]);
    expect(await titles({ projectIds: [project.id], priorities: ["high", "urgent"] })).toEqual(["Login rotto"]);
    expect(await titles({ projectIds: [project.id], assigneeId: admin.id })).toEqual(["Login rotto"]);
    expect(await titles({ projectIds: [project.id], assigneeId: "none" })).toEqual(["Export CSV"]);
    expect(await titles({ tag: "auth" })).toEqual(["Inventario", "Login rotto"]);
  });

  it("ambito: il manager vede solo i suoi progetti; senza elenco solo quelli attivi", async () => {
    const mine = await createProject("Mio");
    const archived = await createProject("Archiviato");
    const foreign = await createProject("Altrui");
    const manager = await createUser({
      email: "m@test.it",
      password: "password123",
      role: "manager",
      projectIds: [mine.id, archived.id],
    });
    await archiveProject(archived.id);
    const user = (await getAuthUser(manager.id))!;

    expect(await doneProjectScope(user, `${mine.id},${foreign.id}`)).toEqual([mine.id]);
    expect(await doneProjectScope(user, archived.id)).toEqual([archived.id]);
    expect(await doneProjectScope(user, undefined)).toEqual([mine.id]);
  });
});
