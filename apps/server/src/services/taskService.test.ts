import { describe, it, expect } from "vitest";
import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  createProject,
  renameProject,
  archiveProject,
  unarchiveProject,
  listProjects,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  moveTask,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
  createSubtasks,
  getBoard,
} from "./taskService.js";
import { createAttachment } from "./attachmentService.js";

async function setupProject(name = "Progetto Test") {
  return createProject(name);
}

describe("taskService — progetti", () => {
  it("crea, rinomina, archivia e disarchivia un progetto", async () => {
    const project = await createProject("Il mio progetto");
    expect(project.name).toBe("Il mio progetto");
    expect(project.archived).toBe(false);

    const renamed = await renameProject(project.id, "Nuovo nome");
    expect(renamed.name).toBe("Nuovo nome");

    const archived = await archiveProject(project.id);
    expect(archived.archived).toBe(true);

    const unarchived = await unarchiveProject(project.id);
    expect(unarchived.archived).toBe(false);
  });

  it("rifiuta nome progetto vuoto con VALIDATION_ERROR", async () => {
    await expect(createProject("")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createProject("   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("listProjects filtra gli archiviati per default", async () => {
    const p1 = await createProject("Attivo");
    const p2 = await createProject("Archiviato");
    await archiveProject(p2.id);

    const onlyActive = await listProjects();
    expect(onlyActive.map((p) => p.id)).toContain(p1.id);
    expect(onlyActive.map((p) => p.id)).not.toContain(p2.id);

    const all = await listProjects(true);
    expect(all.map((p) => p.id)).toContain(p2.id);
  });

  it("renameProject/archiveProject lanciano NOT_FOUND su progetto inesistente", async () => {
    await expect(renameProject("inesistente", "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(archiveProject("inesistente")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("taskService — task CRUD", () => {
  it("crea un task con default corretti", async () => {
    const project = await setupProject();
    const task = await createTask(project.id, { title: "Fare qualcosa" });
    expect(task.title).toBe("Fare qualcosa");
    expect(task.priority).toBe("medium");
    expect(task.status).toBe("draft");
    expect(task.tags).toEqual([]);
    expect(task.description).toBe("");
  });

  it("rifiuta title vuoto o troppo lungo", async () => {
    const project = await setupProject();
    await expect(createTask(project.id, { title: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createTask(project.id, { title: "a".repeat(301) })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rifiuta complexity non-Fibonacci", async () => {
    const project = await setupProject();
    await expect(
      createTask(project.id, { title: "Task", complexity: 4 as any })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("aggiorna un task esistente e NOT_FOUND su inesistente", async () => {
    const project = await setupProject();
    const task = await createTask(project.id, { title: "Originale" });
    const updated = await updateTask(task.id, { title: "Modificato", tags: ["a", "b"] });
    expect(updated.title).toBe("Modificato");
    expect(updated.tags).toEqual(["a", "b"]);

    await expect(updateTask("inesistente", { title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getTask include blockedBy/blocking, conteggi", async () => {
    const project = await setupProject();
    const task = await createTask(project.id, { title: "Task" });
    await addComment(task.id, "Un commento");

    const detail = await getTask(task.id);
    expect(detail.commentsCount).toBe(1);
    expect(detail.attachmentsCount).toBe(0);
    expect(detail.blockedBy).toEqual([]);
    expect(detail.blocking).toEqual([]);
  });
});

describe("taskService — sotto-task", () => {
  it("crea un task con parentId e getTask espone subtasks/subtaskCount sul parent", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Epic grande" });
    const child = await createTask(project.id, { title: "Sotto-task 1", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);

    const detail = await getTask(parent.id);
    expect(detail.subtaskCount).toBe(1);
    expect(detail.openSubtaskCount).toBe(1);
    expect(detail.subtasks).toEqual([{ id: child.id, title: "Sotto-task 1", status: "draft" }]);

    const childDetail = await getTask(child.id);
    expect(childDetail.subtaskCount).toBe(0);
  });

  it("openSubtaskCount si aggiorna quando una sotto-task va done", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Parent" });
    const child = await createTask(project.id, { title: "Child", parentId: parent.id });
    await moveTask(child.id, "done");

    const detail = await getTask(parent.id);
    expect(detail.subtaskCount).toBe(1);
    expect(detail.openSubtaskCount).toBe(0);
  });

  it("rifiuta parentId inesistente o di un altro progetto con NOT_FOUND", async () => {
    const project = await setupProject();
    const other = await setupProject("Altro progetto");
    const foreignParent = await createTask(other.id, { title: "Foreign" });

    await expect(
      createTask(project.id, { title: "X", parentId: "inesistente" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createTask(project.id, { title: "X", parentId: foreignParent.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rifiuta un solo livello di annidamento: una sotto-task non può avere sotto-task", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Parent" });
    const child = await createTask(project.id, { title: "Child", parentId: parent.id });

    await expect(
      createTask(project.id, { title: "Grandchild", parentId: child.id })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rifiuta un task con sotto-task proprie che diventa a sua volta sotto-task", async () => {
    const project = await setupProject();
    const parentA = await createTask(project.id, { title: "A" });
    await createTask(project.id, { title: "A.1", parentId: parentA.id });
    const parentB = await createTask(project.id, { title: "B" });

    await expect(updateTask(parentA.id, { parentId: parentB.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rifiuta self-parenting", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    await expect(updateTask(a.id, { parentId: a.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("updateTask con parentId: null stacca la sotto-task e la rende di primo livello", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Parent" });
    const child = await createTask(project.id, { title: "Child", parentId: parent.id });

    const detached = await updateTask(child.id, { parentId: null });
    expect(detached.parentId).toBeNull();
  });

  it("deleteTask rifiuta un parent con sotto-task ancora presenti", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Parent" });
    await createTask(project.id, { title: "Child", parentId: parent.id });

    await expect(deleteTask(parent.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("createSubtasks crea piu' sotto-task in blocco sotto lo stesso parent", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Epic" });

    const created = await createSubtasks(project.id, parent.id, [
      { title: "Sub 1" },
      { title: "Sub 2", priority: "high" },
    ]);
    expect(created).toHaveLength(2);
    expect(created.every((t) => t.parentId === parent.id)).toBe(true);

    const detail = await getTask(parent.id);
    expect(detail.subtaskCount).toBe(2);
  });

  it("createSubtasks non crea nulla se una riga è invalida (tutto o niente)", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Epic" });

    await expect(
      createSubtasks(project.id, parent.id, [{ title: "Ok" }, { title: "" }])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const detail = await getTask(parent.id);
    expect(detail.subtaskCount).toBe(0);
  });

  it("getBoard espone subtaskCount/openSubtaskCount per ogni task", async () => {
    const project = await setupProject();
    const parent = await createTask(project.id, { title: "Parent" });
    await createTask(project.id, { title: "Child", parentId: parent.id });

    const board = await getBoard(project.id, {});
    const parentOnBoard = board.draft.find((t: any) => t.id === parent.id);
    expect(parentOnBoard.subtaskCount).toBe(1);
    expect(parentOnBoard.openSubtaskCount).toBe(1);
  });
});

describe("taskService — cascade delete", () => {
  it("cancella task, commenti, allegati e dipendenze", async () => {
    const project = await setupProject();
    const root = await createTask(project.id, { title: "Root" });

    await addComment(root.id, "commento root");
    await createAttachment(root.id, {
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("contenuto"),
    });

    const other = await createTask(project.id, { title: "Altro task" });
    await addDependency(other.id, root.id); // other bloccato da root

    const result = await deleteTask(root.id);
    expect(result).toEqual({ id: root.id, deleted: true });

    await expect(getTask(root.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const remainingComments = await prisma.comment.findMany({ where: { taskId: root.id } });
    expect(remainingComments).toHaveLength(0);

    const remainingAttachments = await prisma.attachment.findMany({ where: { taskId: root.id } });
    expect(remainingAttachments).toHaveLength(0);

    const remainingDeps = await prisma.taskDependency.findMany({
      where: { OR: [{ taskId: other.id }, { blockedByTaskId: root.id }] },
    });
    expect(remainingDeps).toHaveLength(0);

    // Il task "other" (fuori dal task cancellato) deve sopravvivere.
    const survivingOther = await getTask(other.id);
    expect(survivingOther).toBeDefined();
  });
});

describe("taskService — dipendenze", () => {
  it("aggiunge e rimuove una dipendenza", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });

    const dep = await addDependency(a.id, b.id);
    expect(dep.taskId).toBe(a.id);
    expect(dep.blockedByTaskId).toBe(b.id);

    const blockers = await listBlockers(a.id);
    expect(blockers.blockers).toHaveLength(1);
    expect(blockers.allResolved).toBe(false);

    const removed = await removeDependency(a.id, b.id);
    expect(removed).toEqual({ deleted: true });

    const blockersAfter = await listBlockers(a.id);
    expect(blockersAfter.blockers).toHaveLength(0);
    expect(blockersAfter.allResolved).toBe(true);
  });

  it("rifiuta self-dependency con VALIDATION_ERROR", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    await expect(addDependency(a.id, a.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rileva ciclo diretto (A<-B, B<-A)", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    await addDependency(a.id, b.id); // A bloccato da B
    await expect(addDependency(b.id, a.id)).rejects.toMatchObject({ code: "CIRCULAR_DEPENDENCY" });
  });

  it("rileva ciclo indiretto (A<-B<-C, poi C<-A)", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    const c = await createTask(project.id, { title: "C" });
    await addDependency(a.id, b.id); // A bloccato da B
    await addDependency(b.id, c.id); // B bloccato da C
    await expect(addDependency(c.id, a.id)).rejects.toMatchObject({ code: "CIRCULAR_DEPENDENCY" });
  });

  it("removeDependency lancia NOT_FOUND se la dipendenza non esiste", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    await expect(removeDependency(a.id, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("taskService — move/transizioni di stato", () => {
  it("blocca move a in_progress se ci sono dipendenze non done", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    await addDependency(a.id, b.id);

    await expect(moveTask(a.id, "in_progress")).rejects.toMatchObject({ code: "DEPENDENCY_BLOCKED" });
  });

  it("sblocca move a in_progress quando le dipendenze sono risolte", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    await addDependency(a.id, b.id);
    await moveTask(b.id, "done");

    const moved = await moveTask(a.id, "in_progress");
    expect(moved.status).toBe("in_progress");
  });

  it("permette di tornare indietro da done a in_progress liberamente", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    await moveTask(a.id, "done");
    const reopened = await moveTask(a.id, "in_progress");
    expect(reopened.status).toBe("in_progress");
  });

  it("moveTask lancia NOT_FOUND su task inesistente", async () => {
    await expect(moveTask("inesistente", "draft")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("taskService — commenti", () => {
  it("aggiunge e lista commenti in ordine cronologico", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    await addComment(a.id, "primo");
    await addComment(a.id, "secondo");

    const comments = await listComments(a.id);
    expect(comments.map((c) => c.body)).toEqual(["primo", "secondo"]);
  });

  it("rifiuta commento vuoto con VALIDATION_ERROR", async () => {
    const project = await setupProject();
    const a = await createTask(project.id, { title: "A" });
    await expect(addComment(a.id, "   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("addComment lancia NOT_FOUND su task inesistente", async () => {
    await expect(addComment("inesistente", "ciao")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("taskService — errori sono ApiErrorException", () => {
  it("propaga ApiErrorException con code corretto", async () => {
    try {
      await createProject("");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiErrorException);
      expect((err as ApiErrorException).code).toBe("VALIDATION_ERROR");
    }
  });
});
