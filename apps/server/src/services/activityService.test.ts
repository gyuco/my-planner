import { describe, it, expect } from "vitest";
import type { AuthUser, UserAccount } from "@my-planner/core";
import {
  addDependency,
  createProject,
  createTask,
  deleteTask,
  moveTask,
  removeDependency,
  updateTask,
} from "./taskService.js";
import { createUser as createUserService } from "./userService.js";
import { listNotifications, type Actor } from "./notificationService.js";
import { activityFiltersFromQuery, listActivity, listActivityActors } from "./activityService.js";

/**
 * Log attivita': tutte le mutazioni dei task finiscono in TaskEvent, il log
 * le espone con filtri; le notifiche restano limitate ai tipi notificabili.
 */

async function createTestUser(
  email: string,
  role: "admin" | "manager" = "admin",
  projectIds: string[] = [],
): Promise<UserAccount> {
  return createUserService({
    email,
    password: "password123",
    role,
    firstName: "Test",
    lastName: "User",
    projectIds: role === "manager" ? projectIds : undefined,
  });
}

function authUserOf(account: UserAccount): AuthUser {
  return {
    id: account.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    role: account.role,
    projectIds: account.projectIds,
  };
}

function userActor(id: string): Actor {
  return { type: "user", id };
}

describe("activityService — eventi registrati", () => {
  it("registra update con diff dei soli campi cambiati, incluse le azioni dell'utente corrente", async () => {
    const admin = await createTestUser("admin@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Prima", priority: "low" }, userActor(admin.id));

    await updateTask(task.id, { title: "Dopo", priority: "low", description: "nuova" }, userActor(admin.id));
    // Nessun cambiamento reale: nessun evento (il drawer salva su ogni blur).
    await updateTask(task.id, { title: "Dopo" }, userActor(admin.id));

    const log = await listActivity(authUserOf(admin), { taskId: task.id });
    expect(log.items.map((i) => i.type)).toEqual(["task.updated", "task.created"]);
    expect(log.items[0].changes).toEqual([
      { field: "title", from: "Prima", to: "Dopo" },
      { field: "description", from: null, to: null },
    ]);
    expect(log.items[0].actorId).toBe(admin.id);
  });

  it("registra dipendenze e delete, che sopravvive alla cancellazione del task", async () => {
    const admin = await createTestUser("admin@test.it");
    const project = await createProject("Progetto");
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });

    await addDependency(a.id, b.id, userActor(admin.id));
    await removeDependency(a.id, b.id, userActor(admin.id));
    await deleteTask(a.id, userActor(admin.id));

    const log = await listActivity(authUserOf(admin), { taskId: a.id });
    expect(log.items.map((i) => i.type)).toEqual([
      "task.deleted",
      "dependency.removed",
      "dependency.added",
      "task.created",
    ]);
    expect(log.items[1]).toMatchObject({ relatedTaskId: b.id, relatedTaskTitle: "B", taskTitle: "A" });
  });

  it("non trasforma gli eventi di solo log in notifiche", async () => {
    const author = await createTestUser("author@test.it");
    const other = await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "T", assigneeId: other.id }, userActor(author.id));
    await updateTask(task.id, { title: "T2" }, userActor(author.id));

    const notifications = await listNotifications(authUserOf(other), 30);
    expect(notifications.items.map((i) => i.type)).toEqual(["task.created"]);
  });
});

describe("activityService — filtri e visibilita'", () => {
  it("filtra per tipo, autore e testo, e pagina con beforeId/afterId", async () => {
    const admin = await createTestUser("admin@test.it");
    const project = await createProject("Progetto");
    const t1 = await createTask(project.id, { title: "Alpha" }, userActor(admin.id));
    await createTask(project.id, { title: "Beta" }, { type: "mcp" });
    await moveTask(t1.id, "todo", undefined, userActor(admin.id));
    const user = authUserOf(admin);

    const byType = await listActivity(user, { types: ["task.status_changed"] });
    expect(byType.items).toHaveLength(1);

    const byMcp = await listActivity(user, activityFiltersFromQuery({ actor: "mcp" }));
    expect(byMcp.items.map((i) => i.taskTitle)).toEqual(["Beta"]);

    const byUser = await listActivity(user, activityFiltersFromQuery({ actor: admin.id }));
    expect(byUser.items).toHaveLength(2);

    const bySearch = await listActivity(user, { search: "Alpha" });
    expect(bySearch.items).toHaveLength(2);

    const page1 = await listActivity(user, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await listActivity(user, { limit: 2, beforeId: page1.items[1].id });
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const newer = await listActivity(user, { afterId: page1.items[1].id });
    expect(newer.items.map((i) => i.id)).toEqual([page1.items[0].id]);
  });

  it("un manager vede solo i progetti assegnati, anche filtrando un progetto altrui", async () => {
    const mine = await createProject("Mio");
    const other = await createProject("Altro");
    const manager = await createTestUser("manager@test.it", "manager", [mine.id]);
    await createTask(mine.id, { title: "Visibile" });
    await createTask(other.id, { title: "Nascosto" });
    const user = authUserOf(manager);

    const all = await listActivity(user);
    expect(all.items.map((i) => i.taskTitle)).toEqual(["Visibile"]);

    const forbidden = await listActivity(user, { projectId: other.id });
    expect(forbidden.items).toHaveLength(0);
  });

  it("gli autori proposti a un manager sono admin e colleghi dei suoi progetti", async () => {
    const mine = await createProject("Mio");
    const other = await createProject("Altro");
    const admin = await createTestUser("admin@test.it");
    const manager = await createTestUser("manager@test.it", "manager", [mine.id]);
    const colleague = await createTestUser("colleague@test.it", "manager", [mine.id]);
    const stranger = await createTestUser("stranger@test.it", "manager", [other.id]);

    const ids = (await listActivityActors(authUserOf(manager))).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([admin.id, manager.id, colleague.id]));
    expect(ids).not.toContain(stranger.id);
  });
});
