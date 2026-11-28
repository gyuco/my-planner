import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AI_NOTE_MAX_LENGTH } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { setBackgroundRunner } from "../lib/email/provider.js";
import { createProject, createTask, getTask, setTaskAi, updateProject } from "./taskService.js";
import { createUser } from "./userService.js";
import { listAiQueue } from "./aiService.js";
import { aiWorkerInstructions } from "./aiInstructions.js";
import {
  AI_NOTE_BEGIN,
  AI_NOTE_END,
  buildRoutinePrompt,
  setRoutineConfig,
  startInteractiveSession,
} from "./aiRoutineService.js";
import { createGlobalMcpServer } from "../mcp/server.js";
import { taskAiInputSchema } from "../lib/validation.js";

/**
 * Nota dell'admin per l'agente (`ai.note`): salvataggio e log attivita',
 * esposizione via MCP (list_ai_tasks, get_task, ai_start_step), regola nelle
 * istruzioni e blocco delimitato nel payload della sessione interattiva.
 */

const NOTE = "Non toccare il modulo pagamenti.\nUsa la libreria X.";
let fires: { body: any }[] = [];

beforeEach(() => {
  fires = [];
  // Avvii in background (dispatch della routine) ignorati: qui conta solo la sessione interattiva.
  setBackgroundRunner(() => {});
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    fires.push({ body: JSON.parse(String(init.body)) });
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_1" });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const project = await createProject("Clinica");
  await updateProject(project.id, { repoUrl: "gyuco/clinica" });
  const admin = await createUser({ email: "admin@test.it", password: "password123", role: "admin" });
  const task = await createTask(project.id, { title: "Login rotto" });
  return { project, admin, task };
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("nota per l'agente: salvataggio", () => {
  it("si salva normalizzata, vuota = null, omessa = invariata; il log registra solo che e' cambiata", async () => {
    const { admin, task } = await setup();
    const actor = { type: "user" as const, id: admin.id };

    const off = await setTaskAi(task.id, { enabled: false, note: `  ${NOTE}  ` }, admin.id, actor);
    expect(off.ai).toMatchObject({ enabled: false, note: NOTE });

    const on = await setTaskAi(task.id, { enabled: true, steps: ["triage"] }, admin.id, actor);
    expect(on.ai.note).toBe(NOTE);
    expect((await getTask(task.id)).ai.note).toBe(NOTE);

    const cleared = await setTaskAi(task.id, { enabled: true, steps: ["triage"], note: "  " }, admin.id, actor);
    expect(cleared.ai.note).toBeNull();
    await setTaskAi(task.id, { enabled: true, steps: ["triage"], note: null }, admin.id, actor);

    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id, type: "task.updated" }, orderBy: { createdAt: "asc" } });
    const changes = events.map((e) => JSON.parse(e.data).changes);
    expect(changes).toEqual([
      [{ field: "aiNote", from: null, to: null }],
      [{ field: "ai", from: null, to: "triage|end" }],
      [{ field: "aiNote", from: null, to: null }],
    ]);
    expect(JSON.stringify(changes)).not.toContain("pagamenti");
  });

  it(`oltre ${AI_NOTE_MAX_LENGTH} caratteri: errore di validazione (schema e service)`, async () => {
    const { admin, task } = await setup();
    expect(taskAiInputSchema.safeParse({ enabled: false, note: "x".repeat(AI_NOTE_MAX_LENGTH) }).success).toBe(true);
    expect(taskAiInputSchema.safeParse({ enabled: false, note: "x".repeat(AI_NOTE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(taskAiInputSchema.safeParse({ enabled: false, note: null }).success).toBe(true);
    await expect(setTaskAi(task.id, { enabled: false, note: "x".repeat(AI_NOTE_MAX_LENGTH + 1) }, admin.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("nota per l'agente: arriva all'agente", () => {
  it("compare in list_ai_tasks, get_task e ai_start_step (MCP)", async () => {
    const { project, admin, task } = await setup();
    const plain = await createTask(project.id, { title: "Senza nota" });
    await setTaskAi(task.id, { enabled: true, steps: ["triage"], note: NOTE }, admin.id);
    await setTaskAi(plain.id, { enabled: true, steps: ["triage"] }, admin.id);

    const queue = await listAiQueue([project.id]);
    expect(Object.fromEntries(queue.map((q) => [q.title, q.note]))).toEqual({ "Login rotto": NOTE, "Senza nota": null });

    const server = createGlobalMcpServer(admin.id);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const listed = parse(await client.callTool({ name: "list_ai_tasks", arguments: { projectId: project.id } }));
    expect(listed.find((q: any) => q.taskId === task.id).note).toBe(NOTE);

    const detail = parse(await client.callTool({ name: "get_task", arguments: { taskId: task.id } }));
    expect(detail.ai.note).toBe(NOTE);

    const started = parse(await client.callTool({ name: "ai_start_step", arguments: { taskId: task.id } }));
    expect(started.ai.note).toBe(NOTE);
    expect(started.ai.running.step).toBe("triage");
    await client.close();
  });

  it("istruzioni (work_ai_queue e routine): regola sulla nota con priorita' e limiti", () => {
    const text = aiWorkerInstructions({});
    expect(text).toContain("ai.note");
    expect(text).toContain("leggila prima di iniziare e seguila in tutti i passi");
    expect(text).toContain("non sui vincoli di sicurezza");
    expect(text).toContain("segnalalo nel riepilogo del passo");
    const routine = buildRoutinePrompt({ id: "p1", name: "Clinica", repoUrl: null });
    expect(routine).toContain("leggila prima di iniziare");
    expect(routine).toContain(AI_NOTE_BEGIN);
  });

  it("sessione interattiva su un task con nota: nota delimitata prima della richiesta; senza nota nessun blocco", async () => {
    const { project, admin, task } = await setup();
    const plain = await createTask(project.id, { title: "Senza nota" });
    await setTaskAi(task.id, { enabled: false, note: NOTE }, admin.id);
    await setRoutineConfig(project.id, { routineId: "trig_01ABCDEFGHJK", token: "sk-ant-oat01-test-token-0123456789" });

    await startInteractiveSession(project.id, { message: "Spiegami il bug", taskId: task.id });
    expect(fires[0].body.text.split("\n")).toEqual([
      "My Planner: sessione interattiva.",
      `projectId: ${project.id}`,
      `taskId: ${task.id}`,
      AI_NOTE_BEGIN,
      "Non toccare il modulo pagamenti.",
      "Usa la libreria X.",
      AI_NOTE_END,
      "Richiesta:",
      "Spiegami il bug",
    ]);

    await startInteractiveSession(project.id, { message: "Ciao", taskId: plain.id });
    expect(fires[1].body.text).not.toContain(AI_NOTE_BEGIN);
  });
});
