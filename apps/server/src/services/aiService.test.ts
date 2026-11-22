import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AI_RUN_TTL_MS, aiPendingStep, aiRunningStep } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  addDependency,
  archiveProject,
  createProject,
  createTask,
  getTask,
  listComments,
  moveTask,
  normalizeRepoUrl,
  setTaskAi,
  updateProject,
} from "./taskService.js";
import { createUser } from "./userService.js";
import { completeAiStep, failAiStep, listAiQueue, rejectAiStep, startAiStep } from "./aiService.js";
import { createGlobalMcpServer, createProjectMcpServer } from "../mcp/server.js";

/** Esecuzione dei passi AI (tool ai_*): coda, blocco, transizioni, rimandi, fallimenti. */

const MCP = { type: "mcp" } as const;

async function setup(steps: ("triage" | "coder" | "reviewer")[] = ["triage", "coder", "reviewer"], notify: "end" | "each" | "none" = "end") {
  const project = await createProject("Clinica");
  const admin = await createUser({ email: "ai-admin@test.it", password: "password123", role: "admin" });
  const task = await createTask(project.id, { title: "Login rotto" });
  await setTaskAi(task.id, { enabled: true, steps, notify }, admin.id);
  return { project, admin, task };
}

afterEach(() => vi.useRealTimers());

describe("coda AI (list_ai_tasks)", () => {
  it("passo in attesa per colonna, priorita', filtro per passo, repoUrl del progetto", async () => {
    const { project, admin, task } = await setup();
    await updateProject(project.id, { repoUrl: "gyuco/clinica" });
    const urgent = await createTask(project.id, { title: "Urgente", priority: "urgent" });
    await setTaskAi(urgent.id, { enabled: true, steps: ["coder"] }, admin.id);
    await moveTask(urgent.id, "todo");
    const notAi = await createTask(project.id, { title: "Manuale" });
    void notAi;

    const queue = await listAiQueue([project.id]);
    expect(queue.map((q) => [q.title, q.step])).toEqual([
      ["Urgente", "coder"],
      ["Login rotto", "triage"],
    ]);
    expect(queue[0].repoUrl).toBe("https://github.com/gyuco/clinica");
    expect((await listAiQueue([project.id], "triage")).map((q) => q.taskId)).toEqual([task.id]);
  });

  it("esclude task in lavorazione (finche' il blocco non scade), fermati, coder bloccati e progetti archiviati", async () => {
    const { project, admin, task } = await setup();
    await startAiStep(task.id, MCP);
    expect(await listAiQueue([project.id])).toHaveLength(0);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + AI_RUN_TTL_MS + 1000);
    expect(await listAiQueue([project.id])).toHaveLength(1);
    vi.useRealTimers();

    const blocker = await createTask(project.id, { title: "Prima questo" });
    const coderTask = await createTask(project.id, { title: "Dopo" });
    await setTaskAi(coderTask.id, { enabled: true, steps: ["coder"] }, admin.id);
    await moveTask(coderTask.id, "todo");
    await addDependency(coderTask.id, blocker.id);
    expect((await listAiQueue([project.id], "coder")).map((q) => q.taskId)).toEqual([]);
    await expect(startAiStep(coderTask.id, MCP)).rejects.toMatchObject({ code: "DEPENDENCY_BLOCKED" });

    await failAiStep(task.id, "manca la descrizione", MCP);
    expect((await listAiQueue([project.id])).map((q) => q.taskId)).not.toContain(task.id);

    await archiveProject(project.id);
    expect(await listAiQueue(undefined)).toHaveLength(0);
  });
});

describe("passi AI", () => {
  it("percorso completo triage -> coder -> reviewer con commenti e spostamenti decisi dal server", async () => {
    const { task } = await setup();

    const started = await startAiStep(task.id, MCP, "triage");
    expect(aiRunningStep(started)).toBe("triage");
    expect(aiPendingStep(started)).toBeNull();
    await expect(startAiStep(task.id, MCP)).rejects.toMatchObject({ code: "CONFLICT" });

    let t = await completeAiStep(task.id, "Causa: token scaduto. File: auth.ts", MCP);
    expect(t.status).toBe("todo");
    expect(t.ai.running).toBeNull();
    expect(aiPendingStep(t)).toBe("coder");

    // Completare senza ai_start_step usa il passo in attesa.
    t = await completeAiStep(task.id, "PR #12 su branch fix/login", MCP);
    expect(t.status).toBe("testing");

    await expect(startAiStep(task.id, MCP, "coder")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    t = await completeAiStep(task.id, "Approvata", MCP);
    expect(t.status).toBe("done");
    expect(aiPendingStep(t)).toBeNull();

    const comments = await listComments(task.id);
    expect(comments.map((c: any) => c.body.split("\n")[0])).toEqual([
      "**🤖 Triage completato**",
      "**🤖 Coder completato**",
      "**🤖 Reviewer completato**",
    ]);
    const started_ = await prisma.taskEvent.count({ where: { taskId: task.id, type: "ai.step_started" } });
    expect(started_).toBe(1);
  });

  it("se il task e' stato spostato a mano, completare il vecchio passo e' un conflitto", async () => {
    const { admin, task } = await setup();
    await startAiStep(task.id, MCP);
    await moveTask(task.id, "in_progress", undefined, { type: "user", id: admin.id });
    // Lo spostamento di un utente libera il blocco.
    expect((await getTask(task.id)).ai.running).toBeNull();
    await expect(completeAiStep(task.id, "fatto", MCP)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("il reviewer rimanda in TODO; al terzo rimando il percorso si ferma e avvisa l'admin", async () => {
    const { admin, task } = await setup(["coder", "reviewer"], "each");
    await moveTask(task.id, "todo");

    for (let round = 1; round <= 3; round++) {
      await completeAiStep(task.id, `PR v${round}`, MCP);
      await expect(rejectAiStep(task.id, "", MCP)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const t = await rejectAiStep(task.id, `manca il test ${round}`, MCP);
      expect(t.status).toBe("todo");
      expect(t.ai.rejectCount).toBe(round);
      expect(Boolean(t.ai.failure)).toBe(round === 3);
    }
    const failed = await getTask(task.id);
    expect(failed.ai.failure.reason).toContain("Rimandato 3 volte");
    expect(aiPendingStep(failed)).toBeNull();

    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id, type: "ai.failed" } });
    expect(events).toHaveLength(1);
    expect(events[0].recipientId).toBe(admin.id);
    expect(JSON.parse(events[0].data).aiStep).toBe("reviewer");

    // Solo il reviewer puo' rimandare.
    await setTaskAi(task.id, { enabled: true, steps: ["coder", "reviewer"], notify: "each" }, admin.id);
    await expect(rejectAiStep(task.id, "no", MCP)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("ai_fail ferma il percorso; si riprende salvando la gestione AI o spostando il task", async () => {
    const { admin, task } = await setup(["triage"], "none");
    await startAiStep(task.id, MCP);
    const failed = await failAiStep(task.id, "Descrizione insufficiente", MCP);
    expect(failed.status).toBe("draft");
    expect(failed.ai.failure.reason).toBe("Descrizione insufficiente");
    expect(failed.ai.running).toBeNull();
    // notify "none": evento registrato ma senza destinatario.
    const ev = await prisma.taskEvent.findFirstOrThrow({ where: { taskId: task.id, type: "ai.failed" } });
    expect(ev.recipientId).toBeNull();
    await expect(startAiStep(task.id, MCP)).rejects.toMatchObject({ code: "CONFLICT" });

    const resumed = await setTaskAi(task.id, { enabled: true, steps: ["triage"] }, admin.id);
    expect(resumed.ai.failure).toBeNull();
    expect(aiPendingStep(resumed)).toBe("triage");

    await failAiStep(task.id, "ancora", MCP);
    await moveTask(task.id, "todo", undefined, MCP); // un agente non riprende
    expect((await getTask(task.id)).ai.failure).not.toBeNull();
    await moveTask(task.id, "draft", undefined, { type: "user", id: admin.id });
    expect((await getTask(task.id)).ai.failure).toBeNull();
  });

  it("task non AI: i tool rifiutano", async () => {
    const project = await createProject("X");
    const task = await createTask(project.id, { title: "Normale" });
    await expect(startAiStep(task.id, MCP)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(completeAiStep(task.id, "x", MCP)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("gruppo del progetto", () => {
  it("salva, normalizza gli spazi, toglie con stringa vuota; non tocca gli altri campi", async () => {
    const p = await createProject("API");
    expect((await updateProject(p.id, { groupName: "  Prodotto   X " })).groupName).toBe("Prodotto X");
    expect((await updateProject(p.id, { name: "API v2" })).groupName).toBe("Prodotto X");
    expect((await updateProject(p.id, { groupName: "" })).groupName).toBeNull();
    await expect(updateProject(p.id, { groupName: "x".repeat(61) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("repository GitHub del progetto", () => {
  it("normalizza i formati comuni e rifiuta il resto", async () => {
    expect(normalizeRepoUrl("gyuco/my-planner")).toBe("https://github.com/gyuco/my-planner");
    expect(normalizeRepoUrl("https://github.com/gyuco/my-planner.git")).toBe("https://github.com/gyuco/my-planner");
    expect(normalizeRepoUrl(" github.com/gyuco/my-planner/ ")).toBe("https://github.com/gyuco/my-planner");
    expect(normalizeRepoUrl("")).toBeNull();
    expect(normalizeRepoUrl(null)).toBeNull();
    expect(() => normalizeRepoUrl("https://gitlab.com/a/b")).toThrow();
    expect(() => normalizeRepoUrl("a/b/c")).toThrow();
    const p = await createProject("Repo");
    expect((await updateProject(p.id, { repoUrl: "gyuco/x" })).repoUrl).toBe("https://github.com/gyuco/x");
    expect((await updateProject(p.id, { name: "Repo 2" })).repoUrl).toBe("https://github.com/gyuco/x");
    expect((await updateProject(p.id, { repoUrl: null })).repoUrl).toBeNull();
  });
});

describe("tool MCP ai_*", () => {
  function parse(result: any) {
    return JSON.parse(result.content[0].text);
  }

  it("server globale: coda su tutti i progetti, percorso via tool; server di progetto: solo il suo progetto", async () => {
    const { project, admin, task } = await setup(["triage"]);
    const other = await createProject("Altro");
    const otherTask = await createTask(other.id, { title: "Altrove" });
    await setTaskAi(otherTask.id, { enabled: true, steps: ["triage"] }, admin.id);

    const server = createGlobalMcpServer(admin.id);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([client.connect(ct), server.connect(st)]);

    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["list_ai_tasks", "ai_start_step", "ai_complete_step", "ai_reject", "ai_fail"]));

    const all = parse(await client.callTool({ name: "list_ai_tasks", arguments: {} }));
    expect(all.map((q: any) => q.title).sort()).toEqual(["Altrove", "Login rotto"]);
    const one = parse(await client.callTool({ name: "list_ai_tasks", arguments: { projectId: project.id } }));
    expect(one.map((q: any) => q.taskId)).toEqual([task.id]);

    await client.callTool({ name: "ai_start_step", arguments: { taskId: task.id } });
    const done = parse(await client.callTool({ name: "ai_complete_step", arguments: { taskId: task.id, summary: "ok" } }));
    expect(done.status).toBe("todo");

    const projectServer = createProjectMcpServer(other.id);
    const [ct2, st2] = InMemoryTransport.createLinkedPair();
    const pc = new Client({ name: "t", version: "0" });
    await Promise.all([pc.connect(ct2), projectServer.connect(st2)]);
    const queue = parse(await pc.callTool({ name: "list_ai_tasks", arguments: {} }));
    expect(queue.map((q: any) => q.taskId)).toEqual([otherTask.id]);
    const forbidden = await pc.callTool({ name: "ai_start_step", arguments: { taskId: task.id } });
    expect(forbidden.isError).toBe(true);
  });

  it("prompt work_ai_queue: istruzioni con progetto, repository e passo; accesso verificato", async () => {
    const { project, admin } = await setup(["triage"]);
    await updateProject(project.id, { repoUrl: "gyuco/clinica" });
    const other = await createProject("Riservato");
    const manager = await createUser({ email: "mgr@test.it", password: "password123", role: "manager", projectIds: [project.id] });

    const connect = async (server: ReturnType<typeof createGlobalMcpServer>) => {
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "t", version: "0" });
      await Promise.all([client.connect(ct), server.connect(st)]);
      return client;
    };

    const global = await connect(createGlobalMcpServer(admin.id));
    expect((await global.listPrompts()).prompts.map((p) => p.name)).toContain("work_ai_queue");
    const all = await global.getPrompt({ name: "work_ai_queue", arguments: {} });
    const allText = (all.messages[0].content as any).text as string;
    expect(allText).toContain("list_ai_tasks");
    expect(allText).toContain("TRIAGE");
    expect(allText).toContain("REVIEWER");
    expect(allText).toContain("Non usare move_task");

    const one = await global.getPrompt({ name: "work_ai_queue", arguments: { projectId: project.id, step: "reviewer" } });
    const oneText = (one.messages[0].content as any).text as string;
    expect(oneText).toContain(`projectId ${project.id}`);
    expect(oneText).toContain("https://github.com/gyuco/clinica");
    expect(oneText).toContain("REVIEWER");
    expect(oneText).not.toContain("TRIAGE (");

    const mgr = await connect(createGlobalMcpServer(manager.id));
    await expect(mgr.getPrompt({ name: "work_ai_queue", arguments: { projectId: other.id } })).rejects.toThrow();

    const projectClient = await connect(createProjectMcpServer(project.id) as any);
    const scoped = await projectClient.getPrompt({ name: "work_ai_queue", arguments: {} });
    expect((scoped.messages[0].content as any).text).toContain(`Progetto: "Clinica"`);
  });
});
