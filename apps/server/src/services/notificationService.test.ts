import { describe, it, expect } from "vitest";
import type { AuthUser, UserAccount } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { createProject, createTask, moveTask, addComment, updateTask } from "./taskService.js";
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

describe("notificationService — destinatario = assegnatario", () => {
  it("alla creazione notifica solo l'assegnatario, con autore e titolo", async () => {
    const author = await createTestUser("author@test.it");
    const assignee = await createTestUser("assignee@test.it");
    const other = await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Nuovo task", assigneeId: assignee.id }, userActor(author.id));

    const list = await listNotifications(authUserOf(assignee), 30);
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

    expect((await listNotifications(authUserOf(other), 30)).items).toHaveLength(0);
    expect((await listNotifications(authUserOf(author), 30)).items).toHaveLength(0);
  });

  it("un task senza assegnatario non notifica nessuno", async () => {
    const author = await createTestUser("author@test.it");
    const other = await createTestUser("other@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Libero" }, userActor(author.id));
    await moveTask(task.id, "todo", undefined, userActor(author.id));
    await addComment(task.id, "commento", userActor(author.id));

    expect((await listNotifications(authUserOf(other), 30)).items).toHaveLength(0);
  });

  it("chi si assegna un task da solo non riceve notifiche delle proprie azioni", async () => {
    const author = await createTestUser("author@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Mio", assigneeId: author.id }, userActor(author.id));
    await moveTask(task.id, "todo", undefined, userActor(author.id));

    expect((await listNotifications(authUserOf(author), 30)).items).toHaveLength(0);
  });

  it("non mostra lo storico a chi inizia a leggere dopo gli eventi", async () => {
    const author = await createTestUser("author@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Pre-esistente" }, userActor(author.id));

    const late = await createTestUser("late@test.it");
    await prisma.taskEvent.updateMany({ where: { taskId: task.id }, data: { recipientId: late.id } });
    const list = await listNotifications(authUserOf(late), 30);
    expect(list.items).toHaveLength(0);
    expect(list.unreadCount).toBe(0);
  });

  it("un manager non riceve notifiche di progetti non suoi", async () => {
    const author = await createTestUser("author@test.it");
    const projectA = await createProject("Progetto A");
    const projectB = await createProject("Progetto B");
    const manager = await createTestUser("manager@test.it", "manager", [projectA.id, projectB.id]);
    await createTask(projectA.id, { title: "In A", assigneeId: manager.id }, userActor(author.id));
    await createTask(projectB.id, { title: "In B", assigneeId: manager.id }, userActor(author.id));

    // Il manager viene tolto dal progetto A dopo l'assegnazione.
    await prisma.userProject.delete({ where: { userId_projectId: { userId: manager.id, projectId: projectA.id } } });
    const user = { ...authUserOf(manager), projectIds: [projectB.id] };
    const list = await listNotifications(user, 30);
    expect(list.items.map((i) => i.taskTitle)).toEqual(["In B"]);
  });

  it("le azioni via MCP notificano l'assegnatario", async () => {
    const assignee = await createTestUser("assignee@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Via MCP", assigneeId: assignee.id }, { type: "mcp" });

    const list = await listNotifications(authUserOf(assignee), 30);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ actorType: "mcp", actorId: null, actorName: null });
  });
});

describe("notificationService — eventi", () => {
  it("notifica il cambio di stato fatto da altri, non il riordino ne' quello dell'assegnatario", async () => {
    const author = await createTestUser("author@test.it");
    const assignee = await createTestUser("assignee@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Task", assigneeId: assignee.id }, userActor(author.id));

    await moveTask(task.id, "todo", undefined, userActor(author.id));
    let list = await listNotifications(authUserOf(assignee), 30);
    expect(list.items.map((i) => i.type)).toEqual(["task.status_changed", "task.created"]);
    expect(list.items[0]).toMatchObject({ from: "draft", to: "todo", taskTitle: "Task" });

    // Riordino nella stessa colonna: nessun nuovo evento.
    await moveTask(task.id, "todo", 7, userActor(author.id));
    // L'assegnatario sposta il proprio task: nessuna notifica a se stesso.
    await moveTask(task.id, "in_progress", undefined, userActor(assignee.id));
    list = await listNotifications(authUserOf(assignee), 30);
    expect(list.items).toHaveLength(2);
  });

  it("notifica il commento all'assegnatario con l'estratto del testo", async () => {
    const author = await createTestUser("author@test.it");
    const assignee = await createTestUser("assignee@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Task", assigneeId: assignee.id }, userActor(author.id));

    await addComment(task.id, "Ho finito la prima parte", userActor(author.id));
    const list = await listNotifications(authUserOf(assignee), 30);
    expect(list.items[0]).toMatchObject({
      type: "comment.created",
      taskTitle: "Task",
      excerpt: "Ho finito la prima parte",
    });
  });

  it("notifica il nuovo assegnatario quando un task viene (ri)assegnato", async () => {
    const author = await createTestUser("author@test.it");
    const first = await createTestUser("first@test.it");
    const second = await createTestUser("second@test.it");
    const project = await createProject("Progetto");
    const task = await createTask(project.id, { title: "Passa di mano" }, userActor(author.id));

    await updateTask(task.id, { assigneeId: first.id }, userActor(author.id));
    await updateTask(task.id, { assigneeId: second.id }, userActor(author.id));

    const firstList = await listNotifications(authUserOf(first), 30);
    expect(firstList.items.map((i) => i.type)).toEqual(["task.assigned"]);
    const secondList = await listNotifications(authUserOf(second), 30);
    expect(secondList.items.map((i) => i.type)).toEqual(["task.assigned"]);

    // Togliere l'assegnatario o assegnarsi il task da soli non notifica nessuno.
    await updateTask(task.id, { assigneeId: null }, userActor(author.id));
    await updateTask(task.id, { assigneeId: author.id }, userActor(author.id));
    expect((await listNotifications(authUserOf(author), 30)).items).toHaveLength(0);
  });
});

describe("notificationService — cursore di lettura", () => {
  it("markNotificationsRead azzera il conteggio e non tocca eventi futuri", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Primo", assigneeId: observer.id }, userActor(author.id));

    const first = await listNotifications(authUserOf(observer), 30);
    expect(first.unreadCount).toBe(1);

    await markNotificationsRead(authUserOf(observer), first.serverCursor);
    const afterRead = await listNotifications(authUserOf(observer), 30);
    expect(afterRead.unreadCount).toBe(0);
    expect(afterRead.items).toHaveLength(0);

    await createTask(project.id, { title: "Secondo", assigneeId: observer.id }, userActor(author.id));
    const afterNew = await listNotifications(authUserOf(observer), 30);
    expect(afterNew.unreadCount).toBe(1);
    expect(afterNew.items[0].taskTitle).toBe("Secondo");
  });

  it("non sposta il cursore oltre l'ultimo evento visibile", async () => {
    const author = await createTestUser("author@test.it");
    const observer = await createTestUser("observer@test.it");
    const project = await createProject("Progetto");
    await createTask(project.id, { title: "Primo", assigneeId: observer.id }, userActor(author.id));

    const result = await markNotificationsRead(authUserOf(observer), 999_999);
    const state = await prisma.notificationState.findUnique({ where: { userId: observer.id } });
    expect(state?.lastSeenEventId).toBe(result.lastSeenEventId);
    expect(result.lastSeenEventId).toBeLessThan(999_999);
  });
});
