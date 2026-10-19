import { describe, it, expect } from "vitest";
import type { AuthUser, UserAccount } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { createProject, createTask, moveTask, addComment } from "./taskService.js";
import { createUser as createUserService } from "./userService.js";
import {
  listNotifications,
  markNotificationsRead,
  type Actor,
} from "./notificationService.js";

/**
 * Notifiche: l'event log e' la fonte di verita', mentre il filtro "non le mie
 * azioni" e i permessi di progetto sono applicati in lettura.
 */

/**
 * Crea l'utente passando dal service (non da prisma diretto): cosi' viene
 * anche ancorato il cursore notifiche alla creazione dell'account, come in
 * produzione.
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

describe("notificationService — visibilita'", () => {
  it("non notifica all'autore le proprie azioni", async () => {
    const author = await createTestUser("author@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Fatto da me" }, userActor(author.id));

    const list = await listNotifications(authUserOf(author), 30);
    expect(list.items).toHaveLength(0);
    expect(list.unreadCount).toBe(0);
  });

  it("notifica gli altri utenti con autore e titolo del task", async () => {
    const author = await createTestUser("author@test.it");
    const other = await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Nuovo task" }, userActor(author.id));

    const list = await listNotifications(authUserOf(other), 30);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      type: "task.created",
      taskTitle: "Nuovo task",
      actorType: "user",
      actorName: "Test User",
      projectName: "Progetto",
    });
    expect(list.unreadCount).toBe(1);
    expect(list.serverCursor).toBeGreaterThan(0);
  });

  it("non mostra lo storico a chi inizia a leggere dopo gli eventi", async () => {
    const author = await createTestUser("author@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Pre-esistente" }, userActor(author.id));

    const late = await createTestUser("late@test.it");
    const list = await listNotifications(authUserOf(late), 30);
    expect(list.items).toHaveLength(0);
    expect(list.unreadCount).toBe(0);
  });

  it("un manager vede solo gli eventi dei progetti assegnati", async () => {
    const author = await createTestUser("author@test.it");
    const projectA = await createProject("Progetto A");
    const projectB = await createProject("Progetto B");
    const manager = await createTestUser("manager@test.it", "manager", [projectB.id]);

    await createTask(projectA.id, { title: "Nel progetto A" }, userActor(author.id));
    await createTask(projectB.id, { title: "Nel progetto B" }, userActor(author.id));

    const list = await listNotifications(authUserOf(manager), 30);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].taskTitle).toBe("Nel progetto B");
  });

  it("gli eventi via MCP non sono attribuibili a un utente e restano visibili", async () => {
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Via MCP" }, { type: "mcp" });

    const list = await listNotifications(authUserOf(observer), 30);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ actorType: "mcp", actorId: null, actorName: null });
  });
});

describe("notificationService — eventi", () => {
  it("emette un evento sul cambio di stato, non sul semplice riordino", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Task" }, userActor(author.id));

    await moveTask(task.id, "todo", undefined, userActor(author.id));
    let list = await listNotifications(authUserOf(observer), 30);
    // L'observer vede sia la creazione sia il cambio di stato, il piu' recente per primo.
    expect(list.items.map((i) => i.type)).toEqual(["task.status_changed", "task.created"]);
    expect(list.items[0]).toMatchObject({ from: "draft", to: "todo", taskTitle: "Task" });

    // Riordino nella stessa colonna: nessun nuovo evento.
    await moveTask(task.id, "todo", 7, userActor(author.id));
    list = await listNotifications(authUserOf(observer), 30);
    expect(list.items).toHaveLength(2);
  });

  it("emette un evento sul commento con l'estratto del testo", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Task" }, userActor(author.id));

    await addComment(task.id, "Ho finito la prima parte", userActor(author.id));
    const list = await listNotifications(authUserOf(observer), 30);
    expect(list.items[0]).toMatchObject({
      type: "comment.created",
      taskTitle: "Task",
      excerpt: "Ho finito la prima parte",
    });
  });
});

describe("notificationService — cursore di lettura", () => {
  it("markNotificationsRead azzera il conteggio e non tocca eventi futuri", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Primo" }, userActor(author.id));

    const first = await listNotifications(authUserOf(observer), 30);
    expect(first.unreadCount).toBe(1);

    await markNotificationsRead(authUserOf(observer), first.serverCursor);
    const afterRead = await listNotifications(authUserOf(observer), 30);
    expect(afterRead.unreadCount).toBe(0);
    expect(afterRead.items).toHaveLength(0);

    await createTask(project.id, { title: "Secondo" }, userActor(author.id));
    const afterNew = await listNotifications(authUserOf(observer), 30);
    expect(afterNew.unreadCount).toBe(1);
    expect(afterNew.items[0].taskTitle).toBe("Secondo");
  });

  it("non sposta il cursore oltre l'ultimo evento visibile", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Primo" }, userActor(author.id));

    const result = await markNotificationsRead(authUserOf(observer), 999_999);
    const state = await prisma.notificationState.findUnique({ where: { userId: observer.id } });
    expect(state?.lastSeenEventId).toBe(result.lastSeenEventId);
    expect(result.lastSeenEventId).toBeLessThan(999_999);
  });
});
