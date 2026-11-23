import { describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { createProject, createTask, updateProject } from "./taskService.js";
import { createUser, getAuthUser } from "./userService.js";
import {
  STALE_AFTER_MS,
  VISIBLE_WINDOW_MS,
  createSessionHookToken,
  dismissClaudeSession,
  listClaudeSessions,
  listSessionHookTokens,
  normalizeRepo,
  recordHookEvent,
  resolveUserFromHookToken,
  revokeSessionHookToken,
  taskIdFromBranch,
} from "./claudeSessionService.js";
import { resolveUserFromMcpToken } from "../mcp/auth.js";

/** Vista "In corso": sessioni di Claude Code segnalate dagli hook. */

async function setup() {
  const clinica = await createProject("Clinica");
  await updateProject(clinica.id, { repoUrl: "https://github.com/gyuco/clinica" });
  const altro = await createProject("Altro");
  const admin = await createUser({ email: "admin@test.it", password: "password123", role: "admin" });
  const manager = await createUser({
    email: "manager@test.it",
    password: "password123",
    role: "manager",
    projectIds: [altro.id],
  });
  return {
    clinica,
    altro,
    admin: (await getAuthUser(admin.id))!,
    manager: (await getAuthUser(manager.id))!,
  };
}

describe("riconoscimento di repository e task", () => {
  it("normalizza i remote git in owner/name", () => {
    expect(normalizeRepo("https://github.com/Gyuco/Clinica.git")).toBe("gyuco/clinica");
    expect(normalizeRepo("git@github.com:gyuco/clinica.git")).toBe("gyuco/clinica");
    expect(normalizeRepo("http://local_proxy@127.0.0.1:41721/git/gyuco/clinica")).toBe("gyuco/clinica");
    expect(normalizeRepo("gyuco/clinica")).toBe("gyuco/clinica");
    expect(normalizeRepo("clinica")).toBeNull();
    expect(normalizeRepo(null)).toBeNull();
  });

  it("ricava l'id del task dai branch feat/{taskId}-slug", () => {
    expect(taskIdFromBranch("feat/cmwtn87u90001h49y2os0crq6-project-settings")).toBe("cmwtn87u90001h49y2os0crq6");
    expect(taskIdFromBranch("fix/cmwtn87u90001h49y2os0crq6")).toBe("cmwtn87u90001h49y2os0crq6");
    expect(taskIdFromBranch("develop")).toBeNull();
    expect(taskIdFromBranch("feat/nuova-ui")).toBeNull();
  });
});

describe("token degli hook", () => {
  it("si crea, autentica solo gli hook e si revoca", async () => {
    const { admin } = await setup();
    const created = await createSessionHookToken(admin.id, "portatile");
    expect(created.token).toMatch(/^mph_[0-9a-f]{64}$/);
    expect(await resolveUserFromHookToken(created.token)).toBe(admin.id);
    expect(await resolveUserFromHookToken("mph_sbagliato")).toBeNull();
    expect(await resolveUserFromHookToken(null)).toBeNull();
    // Non apre l'MCP globale.
    await expect(resolveUserFromMcpToken(created.token)).rejects.toThrow();

    const listed = await listSessionHookTokens(admin.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("token");

    await revokeSessionHookToken(admin.id, created.id);
    expect(await resolveUserFromHookToken(created.token)).toBeNull();
  });

  it("un utente non puo' revocare il token di un altro", async () => {
    const { admin, manager } = await setup();
    const created = await createSessionHookToken(admin.id, null);
    await expect(revokeSessionHookToken(manager.id, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("eventi delle sessioni", () => {
  it("segue il ciclo di vita e lega progetto e task da repository e branch", async () => {
    const { clinica, admin } = await setup();
    const task = await createTask(clinica.id, { title: "Login" });
    const base = { sessionId: "s1", repo: "git@github.com:gyuco/clinica.git", branch: `feat/${task.id}-login`, workdir: "clinica" };

    await recordHookEvent(admin.id, { ...base, event: "SessionStart" });
    let [s] = await listClaudeSessions(admin);
    expect(s).toMatchObject({ status: "idle", projectId: clinica.id, projectName: "Clinica", taskId: task.id, taskTitle: "Login", repo: "gyuco/clinica", origin: "cli" });

    await recordHookEvent(admin.id, { ...base, event: "UserPromptSubmit" });
    expect((await listClaudeSessions(admin))[0].status).toBe("working");

    await recordHookEvent(admin.id, { ...base, event: "Notification", message: "Claude needs your permission to use Bash" });
    [s] = await listClaudeSessions(admin);
    expect(s).toMatchObject({ status: "waiting_input", lastMessage: "Claude needs your permission to use Bash" });

    await recordHookEvent(admin.id, { ...base, event: "PostToolUse" });
    [s] = await listClaudeSessions(admin);
    expect(s).toMatchObject({ status: "working", lastMessage: null });

    await recordHookEvent(admin.id, { ...base, event: "Stop" });
    expect((await listClaudeSessions(admin))[0].status).toBe("idle");

    await recordHookEvent(admin.id, { ...base, event: "SessionEnd" });
    expect(await listClaudeSessions(admin)).toHaveLength(0);

    // Ripresa della stessa sessione.
    await recordHookEvent(admin.id, { ...base, event: "SessionStart" });
    expect(await listClaudeSessions(admin)).toHaveLength(1);
  });

  it("salva origine e link delle sessioni cloud", async () => {
    const { admin } = await setup();
    await recordHookEvent(admin.id, {
      event: "SessionStart",
      sessionId: "s-cloud",
      origin: "cloud",
      url: "https://claude.ai/code/session_01ABC",
    });
    expect((await listClaudeSessions(admin))[0]).toMatchObject({ origin: "cloud", url: "https://claude.ai/code/session_01ABC" });
  });

  it("ignora la chiusura di una sessione mai vista", async () => {
    const { admin } = await setup();
    expect(await recordHookEvent(admin.id, { event: "SessionEnd", sessionId: "mai-vista" })).toBeNull();
    expect(await prisma.claudeSession.count()).toBe(0);
  });

  it("non lega progetti o task che l'utente non vede", async () => {
    const { clinica, manager } = await setup();
    const task = await createTask(clinica.id, { title: "Segreto" });
    await recordHookEvent(manager.id, {
      event: "SessionStart",
      sessionId: "s-manager",
      repo: "gyuco/clinica",
      branch: `feat/${task.id}-segreto`,
    });
    const [s] = await listClaudeSessions(manager);
    expect(s).toMatchObject({ projectId: null, taskId: null, repo: "gyuco/clinica" });
  });

  it("un repository condiviso da piu' progetti non lega nessun progetto", async () => {
    const { clinica, altro, admin } = await setup();
    await updateProject(altro.id, { repoUrl: "gyuco/clinica" });
    await recordHookEvent(admin.id, { event: "SessionStart", sessionId: "s", repo: "gyuco/clinica", branch: "develop" });
    expect((await listClaudeSessions(admin))[0].projectId).toBeNull();

    // Il task del branch decide il progetto.
    const task = await createTask(clinica.id, { title: "T" });
    await recordHookEvent(admin.id, { event: "UserPromptSubmit", sessionId: "s", repo: "gyuco/clinica", branch: `feat/${task.id}-t` });
    expect((await listClaudeSessions(admin))[0]).toMatchObject({ projectId: clinica.id, taskId: task.id });
  });
});

describe("elenco delle sessioni", () => {
  it("il manager vede le sue sessioni e quelle dei suoi progetti, l'admin tutte", async () => {
    const { clinica, altro, admin, manager } = await setup();
    await updateProject(altro.id, { repoUrl: "gyuco/altro" });
    await recordHookEvent(admin.id, { event: "SessionStart", sessionId: "a-clinica", repo: "gyuco/clinica" });
    await recordHookEvent(admin.id, { event: "SessionStart", sessionId: "a-altro", repo: "gyuco/altro" });
    await recordHookEvent(manager.id, { event: "SessionStart", sessionId: "m-libera" });

    const forManager = (await listClaudeSessions(manager)).map((s) => s.sessionId).sort();
    expect(forManager).toEqual(["a-altro", "m-libera"]);
    expect(await listClaudeSessions(admin)).toHaveLength(3);
    expect(clinica.id).toBeTruthy();
  });

  it("mette prima chi aspetta l'utente, segna le sessioni cadute e nasconde quelle vecchie", async () => {
    const { admin } = await setup();
    const now = new Date();
    await recordHookEvent(admin.id, { event: "Stop", sessionId: "idle" }, now);
    await recordHookEvent(admin.id, { event: "Notification", sessionId: "attesa" }, now);
    await recordHookEvent(admin.id, { event: "UserPromptSubmit", sessionId: "lavora" }, now);
    await recordHookEvent(admin.id, { event: "UserPromptSubmit", sessionId: "caduta" }, new Date(now.getTime() - STALE_AFTER_MS - 1000));
    await recordHookEvent(admin.id, { event: "Stop", sessionId: "vecchia" }, new Date(now.getTime() - VISIBLE_WINDOW_MS - 1000));

    const list = await listClaudeSessions(admin, now);
    expect(list.map((s) => s.sessionId)).toEqual(["attesa", "lavora", "idle", "caduta"]);
    expect(list.find((s) => s.sessionId === "caduta")!.stale).toBe(true);
    expect(list.find((s) => s.sessionId === "lavora")!.stale).toBe(false);
  });

  it("si puo' togliere una sessione caduta: solo chi l'ha avviata o un admin", async () => {
    const { altro, admin, manager } = await setup();
    await updateProject(altro.id, { repoUrl: "gyuco/altro" });
    await recordHookEvent(admin.id, { event: "UserPromptSubmit", sessionId: "a", repo: "gyuco/altro" });
    const [visible] = await listClaudeSessions(manager);
    await expect(dismissClaudeSession(manager, visible.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await recordHookEvent(admin.id, { event: "UserPromptSubmit", sessionId: "privata" });
    const hidden = (await listClaudeSessions(admin)).find((s) => s.sessionId === "privata")!;
    await expect(dismissClaudeSession(manager, hidden.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await dismissClaudeSession(admin, visible.id);
    expect((await listClaudeSessions(admin)).map((s) => s.sessionId)).toEqual(["privata"]);
  });
});
