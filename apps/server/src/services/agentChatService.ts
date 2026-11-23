import Anthropic from "@anthropic-ai/sdk";
import { ApiErrorException, type AgentChat, type AgentChatEvent, type AgentChatStatus } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { getAgentRuntime } from "./agentConfigService.js";

/**
 * Chat con l'agente Claude Managed Agents del progetto (solo admin, il
 * controllo e' nelle route). Ogni chat e' una sessione Anthropic, legata a un
 * task o al progetto; la riga AgentChat tiene solo id sessione, titolo e
 * stato. La cronologia resta su Anthropic. Usato da REST Node e Cloudflare.
 */

export const AGENT_REPO_MOUNT_PATH = "/workspace/repo";
const TOOL_INPUT_MAX = 500;
const SSE_PING_MS = 20_000;

/** Sottoinsieme del client Anthropic usato qui (iniettabile nei test). */
export interface AgentChatClient {
  beta: {
    sessions: Pick<Anthropic["beta"]["sessions"], "create" | "retrieve"> & {
      events: Pick<Anthropic["beta"]["sessions"]["events"], "send" | "list" | "stream">;
    };
  };
}

type ClientFactory = (apiKey: string) => AgentChatClient;

const defaultFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });
let clientFactory: ClientFactory = defaultFactory;

/** Sostituisce il client Anthropic (test). `null` ripristina quello reale. */
export function setAgentChatClientFactory(factory: ClientFactory | null) {
  clientFactory = factory ?? defaultFactory;
}

export function agentConsoleUrl(sessionId: string): string {
  return `https://platform.claude.com/workspaces/default/sessions/${sessionId}`;
}

// --- Mappatura eventi --------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function joinText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b && b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text as string)
    .join("\n");
}

const STATUS_BY_EVENT: Record<string, AgentChatStatus> = {
  "session.status_running": "running",
  "session.status_idle": "idle",
  "session.status_rescheduled": "rescheduling",
  "session.status_terminated": "terminated",
};

/**
 * Normalizza un evento della sessione (storico o stream) per la UI. Restituisce
 * null per gli eventi non mostrati (thinking, span, interrupt, ...). `seq`
 * numera i delta dello stesso messaggio (id `<messageId>:d<seq>`).
 */
export function mapAgentEvent(raw: any, seq = 0): AgentChatEvent | null {
  if (!raw || typeof raw.type !== "string") return null;
  const at: string | null = raw.processed_at ?? null;
  const id: string = raw.id;
  switch (raw.type) {
    case "user.message":
      return { id, type: "user_message", at, text: joinText(raw.content) };
    case "agent.message":
      return { id, type: "agent_message", at, text: joinText(raw.content) };
    case "event_start": {
      if (raw.event?.type !== "agent.message" || typeof raw.event.id !== "string") return null;
      return { id: `${raw.event.id}:start`, type: "agent_delta_start", at: null, messageId: raw.event.id };
    }
    case "event_delta": {
      const text = raw.delta?.content?.text;
      if (typeof raw.event_id !== "string" || typeof text !== "string") return null;
      return { id: `${raw.event_id}:d${seq}`, type: "agent_delta", at: null, messageId: raw.event_id, text };
    }
    case "agent.tool_use":
    case "agent.mcp_tool_use": {
      const toolName = raw.type === "agent.mcp_tool_use" ? `${raw.mcp_server_name}.${raw.name}` : String(raw.name);
      let toolInput: string;
      try {
        toolInput = JSON.stringify(raw.input ?? {}) ?? "";
      } catch {
        toolInput = "";
      }
      return {
        id,
        type: "tool_use",
        at,
        toolName,
        toolInput: toolInput.slice(0, TOOL_INPUT_MAX),
        needsApproval: raw.evaluated_permission === "ask",
      };
    }
    case "agent.tool_result":
    case "agent.mcp_tool_result":
      return { id, type: "tool_result", at, isError: raw.is_error === true };
    case "session.status_running":
    case "session.status_rescheduled":
    case "session.status_terminated":
      return { id, type: "status", at, status: STATUS_BY_EVENT[raw.type] };
    case "session.status_idle": {
      const event: AgentChatEvent = { id, type: "status", at, status: "idle" };
      if (typeof raw.stop_reason?.type === "string") event.stopReason = raw.stop_reason.type;
      return event;
    }
    case "session.error":
      return { id, type: "error", at, text: String(raw.error?.message ?? "Errore della sessione") };
    case "session.usage": {
      const amount = raw.usage?.list_cost?.amount ?? raw.list_cost?.amount;
      const costCents = Number.parseInt(String(amount), 10);
      if (!Number.isFinite(costCents)) return null;
      return { id, type: "usage", at, costCents };
    }
    default:
      return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- Errori Anthropic --------------------------------------------------------

function errorDetail(err: unknown): { status: number | null; message: string } {
  const e = err as { status?: unknown; error?: any; message?: string } | null;
  const status = e && typeof e.status === "number" ? e.status : null;
  const message = String(e?.error?.error?.message ?? e?.error?.message ?? e?.message ?? "errore di rete");
  return { status, message };
}

/** AGENT_API_ERROR con messaggio leggibile, senza segreti. */
function agentApiError(err: unknown, secrets: string[]): ApiErrorException {
  const { status, message } = errorDetail(err);
  let text = status !== null ? `Errore API Anthropic (HTTP ${status}): ${message}` : `Errore API Anthropic: ${message}`;
  for (const s of secrets) if (s) text = text.split(s).join("***");
  return new ApiErrorException("AGENT_API_ERROR", text.slice(0, 500));
}

/**
 * Un 400 su un invio mentre la sessione aspetta un'approvazione o ha esaurito
 * il budget diventa 409 CONFLICT; il resto AGENT_API_ERROR.
 */
function sendError(err: unknown, secrets: string[]): ApiErrorException {
  const { status, message } = errorDetail(err);
  if (status === 400) {
    if (/budget/i.test(message)) {
      return new ApiErrorException(
        "CONFLICT",
        "La sessione ha raggiunto il budget: puoi solo interromperla o rispondere alle richieste di approvazione",
      );
    }
    if (/requires_action|tool_confirmation|confirm|approv|awaiting|pending/i.test(message)) {
      return new ApiErrorException(
        "CONFLICT",
        "La sessione attende l'approvazione di un tool: approva o rifiuta prima di inviare altri messaggi",
      );
    }
  }
  return agentApiError(err, secrets);
}

// --- Serializzazione ---------------------------------------------------------

const chatInclude = { createdBy: { select: { firstName: true, lastName: true, email: true } } } as const;

type ChatRow = NonNullable<Awaited<ReturnType<typeof prisma.agentChat.findUnique>>> & {
  createdBy: { firstName: string; lastName: string; email: string } | null;
};

function toAgentChat(row: ChatRow): AgentChat {
  const name = row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim() || row.createdBy.email : null;
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    title: row.title,
    status: row.status as AgentChatStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: name,
    consoleUrl: agentConsoleUrl(row.sessionId),
  };
}

async function assertProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");
}

async function getChatRow(chatId: string): Promise<ChatRow> {
  const row = await prisma.agentChat.findUnique({ where: { id: chatId }, include: chatInclude });
  if (!row) throw new ApiErrorException("NOT_FOUND", "Chat non trovata");
  return row as ChatRow;
}

/** Chat + client della sessione (segreti solo in memoria). */
async function chatContext(chatId: string) {
  const row = await getChatRow(chatId);
  const runtime = await getAgentRuntime(row.projectId);
  return {
    row,
    client: clientFactory(runtime.apiKey),
    secrets: [runtime.apiKey, runtime.githubToken],
  };
}

// --- API del servizio --------------------------------------------------------

export interface ListAgentChatsQuery {
  taskId?: string;
  scope?: "project";
}

/** Chat di un task (`taskId`), del solo progetto (`scope: "project"`) o tutte; piu' recenti prima. */
export async function listAgentChats(projectId: string, query: ListAgentChatsQuery = {}): Promise<AgentChat[]> {
  await assertProject(projectId);
  const where = query.taskId
    ? { projectId, taskId: query.taskId }
    : query.scope === "project"
      ? { projectId, taskId: null }
      : { projectId };
  const rows = await prisma.agentChat.findMany({ where, include: chatInclude, orderBy: { createdAt: "desc" } });
  return rows.map((r) => toAgentChat(r as ChatRow));
}

export interface CreateAgentChatInput {
  taskId?: string | null;
  text: string;
}

/** Avvia una sessione con il primo messaggio; per un task al massimo una chat non terminata. */
export async function createAgentChat(projectId: string, input: CreateAgentChatInput, userId: string | null): Promise<AgentChat> {
  await assertProject(projectId);
  const text = input.text.trim();
  if (!text) throw new ApiErrorException("VALIDATION_ERROR", "Il messaggio non puo' essere vuoto");

  let task: { id: string; title: string } | null = null;
  if (input.taskId) {
    task = await prisma.task.findFirst({ where: { id: input.taskId, projectId }, select: { id: true, title: true } });
    if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato nel progetto");
    const open = await prisma.agentChat.findFirst({ where: { taskId: task.id, status: { not: "terminated" } } });
    if (open) throw new ApiErrorException("CONFLICT", "Il task ha gia' una chat aperta con l'agente");
  }

  const runtime = await getAgentRuntime(projectId);
  const title = task ? task.title : text.slice(0, 60);
  const firstMessage = task
    ? `Task ${task.id} "${task.title}" del progetto ${projectId}: leggi descrizione e commenti con get_task e list_comments.\n${text}`
    : text;

  let session: { id: string; status: string };
  try {
    session = await clientFactory(runtime.apiKey).beta.sessions.create({
      agent: runtime.agentId,
      environment_id: runtime.environmentId,
      vault_ids: [runtime.vaultId],
      title,
      metadata: task ? { projectId, taskId: task.id } : { projectId },
      resources: [
        {
          type: "github_repository",
          url: runtime.repoUrl,
          mount_path: AGENT_REPO_MOUNT_PATH,
          authorization_token: runtime.githubToken,
        },
      ],
      budget: { type: "limit", max_list_cost: { amount: String(runtime.budgetCents), currency: "USD" } },
      initial_events: [{ type: "user.message", content: [{ type: "text", text: firstMessage }] }],
    });
  } catch (err) {
    throw agentApiError(err, [runtime.apiKey, runtime.githubToken]);
  }

  const row = await prisma.agentChat.create({
    data: {
      projectId,
      taskId: task?.id ?? null,
      sessionId: session.id,
      title,
      status: session.status ?? "running",
      createdById: userId,
    },
    include: chatInclude,
  });
  return toAgentChat(row as ChatRow);
}

async function saveStatus(chatId: string, current: string, status: string) {
  if (current === status) return;
  await prisma.agentChat.update({ where: { id: chatId }, data: { status } });
}

/** Chat con lo stato letto dalla sessione Anthropic. */
export async function getAgentChat(chatId: string): Promise<AgentChat> {
  const { row, client, secrets } = await chatContext(chatId);
  let session: { status: string };
  try {
    session = await client.beta.sessions.retrieve(row.sessionId);
  } catch (err) {
    throw agentApiError(err, secrets);
  }
  if (session.status && session.status !== row.status) {
    await saveStatus(row.id, row.status, session.status);
    return toAgentChat(await getChatRow(chatId));
  }
  return toAgentChat(row);
}

/** Cronologia completa normalizzata (i delta non sono mai nello storico). */
export async function listAgentChatEvents(chatId: string): Promise<AgentChatEvent[]> {
  const { row, client, secrets } = await chatContext(chatId);
  const events: AgentChatEvent[] = [];
  try {
    for await (const raw of client.beta.sessions.events.list(row.sessionId)) {
      const mapped = mapAgentEvent(raw);
      if (mapped && mapped.type !== "agent_delta" && mapped.type !== "agent_delta_start") events.push(mapped);
    }
  } catch (err) {
    throw agentApiError(err, secrets);
  }
  return events;
}

type SendableEvent = Parameters<AgentChatClient["beta"]["sessions"]["events"]["send"]>[1]["events"][number];

async function sendEvent(chatId: string, event: SendableEvent): Promise<void> {
  const { row, client, secrets } = await chatContext(chatId);
  try {
    await client.beta.sessions.events.send(row.sessionId, { events: [event] });
  } catch (err) {
    throw sendError(err, secrets);
  }
}

export function sendAgentChatMessage(chatId: string, text: string): Promise<void> {
  return sendEvent(chatId, { type: "user.message", content: [{ type: "text", text }] });
}

export function interruptAgentChat(chatId: string): Promise<void> {
  return sendEvent(chatId, { type: "user.interrupt" });
}

export function confirmAgentChatTool(chatId: string, toolUseId: string, result: "allow" | "deny"): Promise<void> {
  return sendEvent(chatId, { type: "user.tool_confirmation", tool_use_id: toolUseId, result });
}

// --- Stream live -------------------------------------------------------------

export interface AgentChatStream {
  events: AsyncIterable<AgentChatEvent>;
  close: () => void;
}

/**
 * Apre lo stream live della sessione (solo eventi successivi all'apertura,
 * con i delta dei messaggi). Gli eventi di stato aggiornano AgentChat.status.
 * Gli errori di apertura escono qui, prima di iniziare la risposta SSE.
 */
export async function openAgentChatStream(chatId: string): Promise<AgentChatStream> {
  const { row, client, secrets } = await chatContext(chatId);
  let upstream: Awaited<ReturnType<AgentChatClient["beta"]["sessions"]["events"]["stream"]>>;
  try {
    upstream = await client.beta.sessions.events.stream(row.sessionId, { event_deltas: ["agent.message"] });
  } catch (err) {
    throw agentApiError(err, secrets);
  }
  let closed = false;
  let status = row.status;
  const close = () => {
    if (closed) return;
    closed = true;
    upstream.controller.abort();
  };
  async function* events(): AsyncGenerator<AgentChatEvent> {
    const deltaSeq = new Map<string, number>();
    try {
      for await (const raw of upstream) {
        let seq = 0;
        if (raw.type === "event_delta") {
          seq = (deltaSeq.get(raw.event_id) ?? 0) + 1;
          deltaSeq.set(raw.event_id, seq);
        }
        const mapped = mapAgentEvent(raw, seq);
        if (!mapped) continue;
        if (mapped.type === "status" && mapped.status && mapped.status !== status) {
          await saveStatus(row.id, status, mapped.status);
          status = mapped.status;
        }
        yield mapped;
      }
    } catch (err) {
      if (closed) return;
      yield { id: `stream-error-${Date.now()}`, type: "error", at: new Date().toISOString(), text: agentApiError(err, secrets).message };
    } finally {
      close();
    }
  }
  return { events: events(), close };
}

export const AGENT_CHAT_SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

/**
 * Corpo SSE condiviso da Node e Cloudflare: `data: <json>\n\n` per evento e
 * un commento `: ping` ogni 20 s. Annullare lo stream (client disconnesso)
 * chiude lo stream Anthropic.
 */
export function agentChatSseBody(stream: AgentChatStream, pingMs = SSE_PING_MS): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (ping) clearInterval(ping);
    stream.close();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: string) => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          finish();
        }
      };
      push(": connected\n\n");
      ping = setInterval(() => push(": ping\n\n"), pingMs);
      void (async () => {
        try {
          for await (const event of stream.events) {
            if (done) break;
            push(`data: ${JSON.stringify(event)}\n\n`);
          }
        } finally {
          const wasDone = done;
          finish();
          if (!wasDone) {
            try {
              controller.close();
            } catch {
              // gia' chiuso
            }
          }
        }
      })();
    },
    cancel() {
      finish();
    },
  });
}
