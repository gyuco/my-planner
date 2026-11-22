import { describe, it, expect } from "vitest";
import { aiPendingStep, normalizeAiSteps } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { createProject, createTask, getBoard, getTask, moveTask, setTaskAi } from "./taskService.js";
import { createUser, deleteUser } from "./userService.js";
import { taskAiInputSchema } from "../lib/validation.js";

/** Gestione AI del task: configurazione (passi, avvisi, destinatario) e passo in attesa. */

async function setup() {
  const project = await createProject("AI");
  const admin = await createUser({ email: "ai-admin@test.it", password: "password123", role: "admin" });
  const task = await createTask(project.id, { title: "Ticket" });
  return { project, admin, task };
}

describe("gestione AI del task", () => {
  it("di default un task non e' AI", async () => {
    const { task } = await setup();
    expect(task.ai).toEqual({
      enabled: false,
      steps: [],
      notify: "end",
      watcherId: null,
      watcherName: null,
      running: null,
      rejectCount: 0,
      failure: null,
      dispatch: null,
    });
  });

  it("attiva con passi normalizzati, avvisi e destinatario; il log registra il cambio", async () => {
    const { admin, task } = await setup();
    const updated = await setTaskAi(task.id, { enabled: true, steps: ["reviewer", "triage", "triage"], notify: "each" }, admin.id, {
      type: "user",
      id: admin.id,
    });
    expect(updated.ai).toMatchObject({ enabled: true, steps: ["triage", "reviewer"], notify: "each", watcherId: admin.id });
    expect(updated.ai.watcherName).toBe("ai-admin@test.it");

    const detail = await getTask(task.id);
    expect(detail.ai.steps).toEqual(["triage", "reviewer"]);

    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id, type: "task.updated" } });
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].data).changes).toEqual([{ field: "ai", from: null, to: "triage,reviewer|each" }]);
  });

  it("senza passi non si puo' attivare", async () => {
    const { admin, task } = await setup();
    await expect(setTaskAi(task.id, { enabled: true, steps: [] }, admin.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(taskAiInputSchema.safeParse({ enabled: true, steps: [] }).success).toBe(false);
    expect(taskAiInputSchema.safeParse({ enabled: true, steps: ["deploy"] }).success).toBe(false);
    expect(taskAiInputSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("spegnere conserva passi e modalita'; nessun evento se non cambia nulla", async () => {
    const { admin, task } = await setup();
    await setTaskAi(task.id, { enabled: true, steps: ["coder"], notify: "end" }, admin.id);
    const off = await setTaskAi(task.id, { enabled: false }, admin.id);
    expect(off.ai).toMatchObject({ enabled: false, steps: ["coder"], notify: "end" });
    await setTaskAi(task.id, { enabled: false }, admin.id);
    const events = await prisma.taskEvent.count({ where: { taskId: task.id, type: "task.updated" } });
    expect(events).toBe(2);
  });

  it("il passo in attesa dipende dalla colonna; la board espone la configurazione", async () => {
    const { project, admin, task } = await setup();
    await setTaskAi(task.id, { enabled: true, steps: ["triage", "coder", "reviewer"] }, admin.id);

    expect(aiPendingStep(await getTask(task.id))).toBe("triage");
    await moveTask(task.id, "todo");
    expect(aiPendingStep(await getTask(task.id))).toBe("coder");
    await moveTask(task.id, "in_progress");
    expect(aiPendingStep(await getTask(task.id))).toBeNull();
    await moveTask(task.id, "testing");
    expect(aiPendingStep(await getTask(task.id))).toBe("reviewer");

    const board = await getBoard(project.id);
    expect(board.testing[0].ai.enabled).toBe(true);
  });

  it("solo i passi scelti: un passo non scelto non e' in attesa", async () => {
    const { admin, task } = await setup();
    const t = await setTaskAi(task.id, { enabled: true, steps: ["coder"] }, admin.id);
    expect(aiPendingStep(t)).toBeNull(); // draft, ma il triage non e' tra i passi
    expect(normalizeAiSteps(["x", "reviewer", "coder"])).toEqual(["coder", "reviewer"]);
  });

  it("eliminare l'admin destinatario lascia il task AI senza destinatario", async () => {
    const { admin, task } = await setup();
    const other = await createUser({ email: "ai-admin2@test.it", password: "password123", role: "admin" });
    await setTaskAi(task.id, { enabled: true, steps: ["triage"] }, admin.id);
    await deleteUser(admin.id, other.id);
    const t = await getTask(task.id);
    expect(t.ai).toMatchObject({ enabled: true, watcherId: null, watcherName: null });
  });
});
