import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { setBackgroundRunner } from "../lib/email/provider.js";
import { createProject, createTask, getTask, listProjects, moveTask, setTaskAi, updateProject } from "./taskService.js";
import { createUser, listProjectsForUser, getAuthUser } from "./userService.js";
import { completeAiStep } from "./aiService.js";
import { clearRoutineConfig, dispatchProject, getRoutineConfig, setRoutineConfig } from "./aiRoutineService.js";

/** Avvio automatico dei passi AI con la routine Claude Code (fetch simulato). */

const TOKEN = "sk-ant-oat01-test-token-0123456789";
const ROUTINE = "trig_01ABCDEFGHJK";
let fires: { url: string; headers: Record<string, string>; body: any }[] = [];
let nextStatus = 200;
let pending: Promise<unknown>[] = [];

async function flush() {
  while (pending.length) {
    const batch = pending;
    pending = [];
    await Promise.all(batch);
  }
}

beforeEach(() => {
  fires = [];
  nextStatus = 200;
  pending = [];
  setBackgroundRunner((task) => {
    pending.push(task);
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fires.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    if (nextStatus !== 200) {
      return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), {
        status: nextStatus,
        headers: { "retry-after": "120" },
      });
    }
    return Response.json({
      type: "routine_fire",
      claude_code_session_id: `session_${fires.length}`,
      claude_code_session_url: `https://claude.ai/code/session_${fires.length}`,
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const project = await createProject("Clinica");
  await updateProject(project.id, { repoUrl: "gyuco/clinica" });
  const admin = await createUser({ email: "admin@test.it", password: "password123", role: "admin" });
  return { project, admin };
}

describe("configurazione della routine", () => {
  it("salva id e token cifrato; il token non esce mai; prompt con progetto e repository", async () => {
    const { project, admin } = await setup();
    expect((await getRoutineConfig(project.id)).configured).toBe(false);

    await expect(setRoutineConfig(project.id, { routineId: "abc", token: TOKEN })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(setRoutineConfig(project.id, { routineId: ROUTINE })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const cfg = await setRoutineConfig(project.id, { routineId: ROUTINE, token: TOKEN });
    expect(cfg).toMatchObject({ configured: true, routineId: ROUTINE, lastError: null });
    expect(cfg.prompt).toContain(`projectId ${project.id}`);
    expect(cfg.prompt).toContain("https://github.com/gyuco/clinica");
    expect(JSON.stringify(cfg)).not.toContain(TOKEN);

    const row = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.aiRoutineTokenEncrypted?.startsWith("v1:")).toBe(true);
    expect(row.aiRoutineTokenEncrypted).not.toContain(TOKEN);

    // Le API dei progetti non espongono il token (nemmeno cifrato).
    const listed = await listProjectsForUser((await getAuthUser(admin.id))!);
    expect(listed[0]).toMatchObject({ id: project.id, aiRoutineConfigured: true });
    expect(JSON.stringify(listed)).not.toContain("aiRoutineTokenEncrypted");
    expect(JSON.stringify(await listProjects())).not.toContain("v1:");

    // Cambio solo dell'id: il token resta.
    expect((await setRoutineConfig(project.id, { routineId: "trig_02ZZZZZZZZZZ" })).configured).toBe(true);
    expect((await clearRoutineConfig(project.id)).configured).toBe(false);
  });
});

describe("avvio della routine", () => {
  it("una sola chiamata con tutti i task in attesa; header corretti; niente riavvii a breve; force riavvia", async () => {
    const { project, admin } = await setup();
    const a = await createTask(project.id, { title: "A" });
    const b = await createTask(project.id, { title: "B" });
    await setTaskAi(a.id, { enabled: true, steps: ["triage"] }, admin.id);
    await setTaskAi(b.id, { enabled: true, steps: ["triage"] }, admin.id);
    await flush();
    // Routine configurata dopo: nessun avvio automatico finora.
    await setRoutineConfig(project.id, { routineId: ROUTINE, token: TOKEN });
    expect(fires).toHaveLength(0);

    const res = await dispatchProject(project.id);
    expect(res).toMatchObject({ fired: true, sessionUrl: "https://claude.ai/code/session_1" });
    expect(res.taskIds.sort()).toEqual([a.id, b.id].sort());
    expect(fires).toHaveLength(1);
    expect(fires[0].url).toBe(`https://api.anthropic.com/v1/claude_code/routines/${ROUTINE}/fire`);
    expect(fires[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(fires[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(fires[0].body.text).toContain(`projectId: ${project.id}`);
    expect(fires[0].body.text).toContain(`- ${a.id} (triage)`);
    // Solo id: niente titoli o descrizioni nel testo dell'avvio.
    expect(fires[0].body.text).not.toContain("\\nA\\n");

    const task = await getTask(a.id);
    expect(task.ai.dispatch).toMatchObject({ step: "triage", sessionUrl: "https://claude.ai/code/session_1" });

    expect(await dispatchProject(project.id)).toMatchObject({ fired: false, reason: "Task gia' avviati di recente" });
    expect((await dispatchProject(project.id, { force: true })).fired).toBe(true);
    expect((await getRoutineConfig(project.id)).lastSessionUrl).toBe("https://claude.ai/code/session_2");
  });

  it("errori della routine (429) salvati come ultimo errore; senza configurazione o coda non parte nulla", async () => {
    const { project, admin } = await setup();
    expect(await dispatchProject(project.id)).toMatchObject({ fired: false, reason: "Routine non configurata" });
    await setRoutineConfig(project.id, { routineId: ROUTINE, token: TOKEN });
    expect(await dispatchProject(project.id)).toMatchObject({ fired: false, reason: "Nessun task AI in attesa" });

    const t = await createTask(project.id, { title: "A" });
    await setTaskAi(t.id, { enabled: true, steps: ["triage"] }, admin.id);
    await flush();
    nextStatus = 429;
    const res = await dispatchProject(project.id, { force: true });
    expect(res.fired).toBe(false);
    expect(res.reason).toBe("Limite di avvii raggiunto, riprova tra 120s");
    expect((await getRoutineConfig(project.id)).lastError).toBe(res.reason);
  });
});

describe("avvio automatico sugli eventi", () => {
  it("parte quando un admin attiva l'AI o un utente sposta il task; non sugli spostamenti degli agenti", async () => {
    const { project, admin } = await setup();
    await setRoutineConfig(project.id, { routineId: ROUTINE, token: TOKEN });
    const t = await createTask(project.id, { title: "A" });

    await setTaskAi(t.id, { enabled: true, steps: ["triage", "coder"] }, admin.id, { type: "user", id: admin.id });
    await flush();
    expect(fires).toHaveLength(1);
    expect(fires[0].body.text).toContain(`${t.id} (triage)`);

    // L'agente completa il triage: il task passa in TODO (coder in attesa) ma non si riavvia nulla,
    // la sessione in corso continua la coda da sola.
    await completeAiStep(t.id, "fatto", { type: "mcp" });
    await flush();
    expect(fires).toHaveLength(1);

    // Un utente riporta il task in Draft e poi in TODO: nuovo passo in attesa -> avvio.
    await moveTask(t.id, "draft", undefined, { type: "user", id: admin.id });
    await flush();
    expect(fires).toHaveLength(1); // triage gia' avviato da meno di 30 minuti
    await moveTask(t.id, "todo", undefined, { type: "user", id: admin.id });
    await flush();
    expect(fires).toHaveLength(2);
    expect(fires[1].body.text).toContain(`${t.id} (coder)`);
  });

  it("progetti senza routine: nessuna chiamata", async () => {
    const { project, admin } = await setup();
    const t = await createTask(project.id, { title: "A" });
    await setTaskAi(t.id, { enabled: true, steps: ["triage"] }, admin.id, { type: "user", id: admin.id });
    await flush();
    expect(fires).toHaveLength(0);
  });
});
