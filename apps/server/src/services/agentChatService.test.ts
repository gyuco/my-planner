import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/secretBox.js";
import { createProject, createTask, updateProject } from "./taskService.js";
import { createUser } from "./userService.js";
import {
  createAgentChat,
  getAgentChat,
  interruptAgentChat,
  listAgentChatEvents,
  listAgentChats,
  mapAgentEvent,
  sendAgentChatMessage,
  confirmAgentChatTool,
  setAgentChatClientFactory,
  openAgentChatStream,
  agentChatSseBody,
} from "./agentChatService.js";

/** Chat con l'agente Claude Managed Agents (client Anthropic simulato). */

const API_KEY = "sk-ant-api03-test-key-0123456789abcdef";
const GH_TOKEN = "github_pat_TEST0123456789abcdef";
const REPO = "https://github.com/gyuco/clinica";

interface Call {
  method: string;
  args: any[];
}

let calls: Call[] = [];
let sendError: any = null;
let sessionCounter = 0;
let retrieveStatus = "idle";
let history: any[] = [];

function anthropicError(status: number, message: string) {
  const err: any = new Error(`${status} ${message}`);
  err.status = status;
  err.error = { type: "error", error: { type: "invalid_request_error", message } };
  return err;
}

beforeEach(() => {
  calls = [];
  sendError = null;
  sessionCounter = 0;
  retrieveStatus = "idle";
  history = [];
  setAgentChatClientFactory(() => ({
    beta: {
      sessions: {
        create: async (...args: any[]) => {
          calls.push({ method: "sessions.create", args });
          return { id: `sesn_${++sessionCounter}`, status: "running" };
        },
        retrieve: async (...args: any[]) => {
          calls.push({ method: "sessions.retrieve", args });
          return { id: args[0], status: retrieveStatus };
        },
        events: {
          send: async (...args: any[]) => {
            calls.push({ method: "events.send", args });
            if (sendError) throw sendError;
            return { data: [] };
          },
          list: (...args: any[]) => {
            calls.push({ method: "events.list", args });
            return (async function* () {
              for (const e of history) yield e;
            })();
          },
          stream: async () => {
            throw new Error("non usato");
          },
        },
      },
    },
  }) as any);
});

afterEach(() => setAgentChatClientFactory(null));

async function configuredProject(name = "Clinica") {
  const project = await createProject(name);
  await updateProject(project.id, { repoUrl: REPO });
  await prisma.project.update({
    where: { id: project.id },
    data: {
      agentApiKeyEncrypted: await encryptSecret(API_KEY),
      agentGithubTokenEncrypted: await encryptSecret(GH_TOKEN),
      agentId: "agent_1",
      agentEnvironmentId: "env_1",
      agentVaultId: "vlt_1",
      agentBudgetCents: 750,
    },
  });
  return project;
}

async function admin() {
  return createUser({ email: "admin@example.com", password: "password123", role: "admin", firstName: "Ada", lastName: "Lovelace" });
}

describe("mapAgentEvent", () => {
  const at = "2026-11-23T10:00:00Z";

  it("messaggi utente e agente (blocchi di testo uniti)", () => {
    expect(
      mapAgentEvent({
        type: "user.message",
        id: "sevt_1",
        processed_at: at,
        content: [
          { type: "text", text: "Ciao" },
          { type: "image", source: {} },
          { type: "text", text: "come va?" },
        ],
      }),
    ).toEqual({ id: "sevt_1", type: "user_message", at, text: "Ciao\ncome va?" });
    expect(
      mapAgentEvent({ type: "agent.message", id: "sevt_2", processed_at: at, content: [{ type: "text", text: "Tutto ok" }] }),
    ).toEqual({ id: "sevt_2", type: "agent_message", at, text: "Tutto ok" });
  });

  it("delta: event_start di agent.message e event_delta", () => {
    expect(mapAgentEvent({ type: "event_start", event: { type: "agent.message", id: "sevt_9" } })).toMatchObject({
      type: "agent_delta_start",
      messageId: "sevt_9",
    });
    expect(mapAgentEvent({ type: "event_start", event: { type: "agent.thinking", id: "sevt_8" } })).toBeNull();
    const delta = mapAgentEvent(
      { type: "event_delta", event_id: "sevt_9", delta: { type: "content_delta", content: { type: "text", text: "Ci" } } },
      3,
    );
    expect(delta).toMatchObject({ id: "sevt_9:d3", type: "agent_delta", messageId: "sevt_9", text: "Ci" });
  });

  it("tool_use: nome, server MCP, input troncato, richiesta di approvazione", () => {
    const big = { content: "x".repeat(2000) };
    const tool = mapAgentEvent({
      type: "agent.tool_use",
      id: "sevt_3",
      processed_at: at,
      name: "bash",
      input: big,
      evaluated_permission: "ask",
    });
    expect(tool).toMatchObject({ id: "sevt_3", type: "tool_use", at, toolName: "bash", needsApproval: true });
    expect(tool!.toolInput).toHaveLength(500);
    expect(tool!.toolInput).toBe(JSON.stringify(big).slice(0, 500));

    expect(
      mapAgentEvent({
        type: "agent.mcp_tool_use",
        id: "sevt_4",
        processed_at: at,
        mcp_server_name: "my-planner",
        name: "get_task",
        input: { taskId: "t1" },
        evaluated_permission: "allow",
      }),
    ).toEqual({
      id: "sevt_4",
      type: "tool_use",
      at,
      toolName: "my-planner.get_task",
      toolInput: '{"taskId":"t1"}',
      needsApproval: false,
    });
  });

  it("tool_result con isError", () => {
    expect(
      mapAgentEvent({ type: "agent.tool_result", id: "sevt_5", processed_at: at, tool_use_id: "sevt_3", is_error: true }),
    ).toMatchObject({ id: "sevt_5", type: "tool_result", at, isError: true });
    expect(
      mapAgentEvent({ type: "agent.mcp_tool_result", id: "sevt_6", processed_at: at, mcp_tool_use_id: "sevt_4" }),
    ).toMatchObject({ id: "sevt_6", type: "tool_result", isError: false });
  });

  it("stati, errori, costo", () => {
    expect(mapAgentEvent({ type: "session.status_running", id: "s1", processed_at: at })).toMatchObject({
      type: "status",
      status: "running",
    });
    expect(
      mapAgentEvent({
        type: "session.status_idle",
        id: "s2",
        processed_at: at,
        stop_reason: { type: "requires_action", event_ids: ["sevt_3"] },
      }),
    ).toEqual({ id: "s2", type: "status", at, status: "idle", stopReason: "requires_action" });
    expect(mapAgentEvent({ type: "session.status_rescheduled", id: "s3", processed_at: at })).toMatchObject({
      status: "rescheduling",
    });
    expect(mapAgentEvent({ type: "session.status_terminated", id: "s4", processed_at: at })).toMatchObject({
      status: "terminated",
    });
    expect(
      mapAgentEvent({
        type: "session.error",
        id: "s5",
        processed_at: at,
        error: { type: "unknown_error", message: "Qualcosa e' andato storto", retry_status: { type: "terminal" } },
      }),
    ).toEqual({ id: "s5", type: "error", at, text: "Qualcosa e' andato storto" });
    expect(
      mapAgentEvent({
        type: "session.usage",
        id: "s6",
        processed_at: at,
        usage: { input_tokens: 10, list_cost: { amount: "137", currency: "USD" } },
      }),
    ).toEqual({ id: "s6", type: "usage", at, costCents: 137 });
  });

  it("tutto il resto e' null", () => {
    expect(mapAgentEvent({ type: "agent.thinking", id: "x", processed_at: at })).toBeNull();
    expect(mapAgentEvent({ type: "span.model_request_start", id: "y", processed_at: at })).toBeNull();
    expect(mapAgentEvent({ type: "user.interrupt", id: "z", processed_at: at })).toBeNull();
  });
});

describe("createAgentChat", () => {
  it("crea la sessione con repository, budget, vault e primo messaggio; salva la riga", async () => {
    const project = await configuredProject();
    const user = await admin();
    const task = await createTask(project.id, { title: "Login con Google" });

    const chat = await createAgentChat(project.id, { taskId: task.id, text: "Implementa il login" }, user.id);

    expect(calls).toHaveLength(1);
    const [params] = calls[0].args;
    expect(params).toEqual({
      agent: "agent_1",
      environment_id: "env_1",
      vault_ids: ["vlt_1"],
      title: "Login con Google",
      metadata: { projectId: project.id, taskId: task.id },
      resources: [
        { type: "github_repository", url: REPO, mount_path: "/workspace/repo", authorization_token: GH_TOKEN },
      ],
      budget: { type: "limit", max_list_cost: { amount: "750", currency: "USD" } },
      initial_events: [
        {
          type: "user.message",
          content: [
            {
              type: "text",
              text:
                `Task ${task.id} "Login con Google" del progetto ${project.id}: leggi descrizione e commenti con get_task e list_comments.\n` +
                "Implementa il login",
            },
          ],
        },
      ],
    });

    expect(chat).toMatchObject({
      projectId: project.id,
      taskId: task.id,
      title: "Login con Google",
      status: "running",
      createdByName: "Ada Lovelace",
      consoleUrl: "https://platform.claude.com/workspaces/default/sessions/sesn_1",
    });
    const row = await prisma.agentChat.findUnique({ where: { id: chat.id } });
    expect(row).toMatchObject({ sessionId: "sesn_1", projectId: project.id, taskId: task.id, createdById: user.id });
  });

  it("chat di progetto: titolo dai primi 60 caratteri, nessun prefisso, metadata senza taskId", async () => {
    const project = await configuredProject();
    const user = await admin();
    const text = "Analizza il repository e proponi un piano per migliorare i test end-to-end della board";
    const chat = await createAgentChat(project.id, { text }, user.id);
    const [params] = calls[0].args;
    expect(params.title).toBe(text.slice(0, 60));
    expect(params.metadata).toEqual({ projectId: project.id });
    expect(params.initial_events[0].content[0].text).toBe(text);
    expect(chat.taskId).toBeNull();
  });

  it("409 se il task ha gia' una chat non terminata; ok dopo la terminazione", async () => {
    const project = await configuredProject();
    const user = await admin();
    const task = await createTask(project.id, { title: "Fix" });
    const first = await createAgentChat(project.id, { taskId: task.id, text: "Vai" }, user.id);
    await expect(createAgentChat(project.id, { taskId: task.id, text: "Ancora" }, user.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await prisma.agentChat.update({ where: { id: first.id }, data: { status: "terminated" } });
    await expect(createAgentChat(project.id, { taskId: task.id, text: "Ancora" }, user.id)).resolves.toMatchObject({
      taskId: task.id,
    });
  });

  it("rifiuta un task di un altro progetto e un progetto inesistente", async () => {
    const project = await configuredProject();
    const other = await configuredProject("Altro");
    const user = await admin();
    const foreign = await createTask(other.id, { title: "Estraneo" });
    await expect(createAgentChat(project.id, { taskId: foreign.id, text: "Vai" }, user.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(createAgentChat("nope", { text: "Vai" }, user.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls).toHaveLength(0);
    expect(await prisma.agentChat.count()).toBe(0);
  });

  it("agente non configurato: VALIDATION_ERROR", async () => {
    const project = await createProject("Vuoto");
    const user = await admin();
    await expect(createAgentChat(project.id, { text: "Vai" }, user.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("lettura e invio", () => {
  it("lista per task o progetto (piu' recenti prima), stato aggiornato, eventi senza delta", async () => {
    const project = await configuredProject();
    const user = await admin();
    const task = await createTask(project.id, { title: "Fix" });
    const taskChat = await createAgentChat(project.id, { taskId: task.id, text: "Vai" }, user.id);
    const p1 = await createAgentChat(project.id, { text: "Primo" }, user.id);
    await prisma.agentChat.update({ where: { id: p1.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const p2 = await createAgentChat(project.id, { text: "Secondo" }, user.id);

    expect((await listAgentChats(project.id, { taskId: task.id })).map((c) => c.id)).toEqual([taskChat.id]);
    expect((await listAgentChats(project.id, { scope: "project" })).map((c) => c.id)).toEqual([p2.id, p1.id]);

    retrieveStatus = "terminated";
    expect(await getAgentChat(p2.id)).toMatchObject({ id: p2.id, status: "terminated" });
    expect((await prisma.agentChat.findUnique({ where: { id: p2.id } }))!.status).toBe("terminated");

    history = [
      { type: "user.message", id: "e1", processed_at: "t1", content: [{ type: "text", text: "Ciao" }] },
      { type: "agent.thinking", id: "e2", processed_at: "t2" },
      { type: "agent.message", id: "e3", processed_at: "t3", content: [{ type: "text", text: "Eccomi" }] },
    ];
    expect(await listAgentChatEvents(p2.id)).toEqual([
      { id: "e1", type: "user_message", at: "t1", text: "Ciao" },
      { id: "e3", type: "agent_message", at: "t3", text: "Eccomi" },
    ]);

    await expect(getAgentChat("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("invio di messaggio, interrupt e conferma tool", async () => {
    const project = await configuredProject();
    const user = await admin();
    const chat = await createAgentChat(project.id, { text: "Vai" }, user.id);
    calls = [];
    await sendAgentChatMessage(chat.id, "Continua");
    await interruptAgentChat(chat.id);
    await confirmAgentChatTool(chat.id, "sevt_7", "deny");
    expect(calls.map((c) => c.args)).toEqual([
      ["sesn_1", { events: [{ type: "user.message", content: [{ type: "text", text: "Continua" }] }] }],
      ["sesn_1", { events: [{ type: "user.interrupt" }] }],
      ["sesn_1", { events: [{ type: "user.tool_confirmation", tool_use_id: "sevt_7", result: "deny" }] }],
    ]);
  });

  it("un 400 di Anthropic per approvazione o budget diventa 409; altri errori AGENT_API_ERROR senza chiave", async () => {
    const project = await configuredProject();
    const user = await admin();
    const chat = await createAgentChat(project.id, { text: "Vai" }, user.id);

    sendError = anthropicError(400, "Session is awaiting tool confirmation (requires_action); only user.tool_confirmation or user.interrupt are accepted");
    await expect(sendAgentChatMessage(chat.id, "Ehi")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/approvazione/i),
    });

    sendError = anthropicError(400, "Session budget reached");
    await expect(sendAgentChatMessage(chat.id, "Ehi")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/budget/i),
    });

    sendError = anthropicError(500, `boom ${API_KEY}`);
    const err: any = await sendAgentChatMessage(chat.id, "Ehi").catch((e) => e);
    expect(err.code).toBe("AGENT_API_ERROR");
    expect(err.message).not.toContain(API_KEY);
  });
});

describe("stream SSE", () => {
  it("inoltra gli eventi come data: <json>, numera i delta, aggiorna lo stato e chiude lo stream Anthropic", async () => {
    const project = await configuredProject();
    const user = await admin();
    const chat = await createAgentChat(project.id, { text: "Vai" }, user.id);

    const controller = new AbortController();
    const upstream = [
      { type: "event_start", event: { type: "agent.message", id: "m1" } },
      { type: "event_delta", event_id: "m1", delta: { type: "content_delta", content: { type: "text", text: "Ci" } } },
      { type: "event_delta", event_id: "m1", delta: { type: "content_delta", content: { type: "text", text: "ao" } } },
      { type: "agent.thinking", id: "th", processed_at: "t" },
      { type: "session.status_idle", id: "s1", processed_at: "t", stop_reason: { type: "end_turn" } },
    ];
    setAgentChatClientFactory(() => ({
      beta: {
        sessions: {
          events: {
            stream: async (...args: any[]) => {
              calls.push({ method: "events.stream", args });
              return Object.assign(
                (async function* () {
                  for (const e of upstream) yield e;
                })(),
                { controller },
              );
            },
          },
        },
      },
    }) as any);

    const stream = await openAgentChatStream(chat.id);
    const text = await new Response(agentChatSseBody(stream)).text();
    const data = text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)));

    expect(calls.at(-1)!.args).toEqual(["sesn_1", { event_deltas: ["agent.message"] }]);
    expect(data.map((e) => [e.type, e.id])).toEqual([
      ["agent_delta_start", "m1:start"],
      ["agent_delta", "m1:d1"],
      ["agent_delta", "m1:d2"],
      ["status", "s1"],
    ]);
    expect((await prisma.agentChat.findUnique({ where: { id: chat.id } }))!.status).toBe("idle");
    expect(controller.signal.aborted).toBe(true);
  });
});
