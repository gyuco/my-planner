import type { FastifyInstance } from "fastify";
import {
  AGENT_CHAT_SSE_HEADERS,
  agentChatSseBody,
  confirmAgentChatTool,
  createAgentChat,
  getAgentChat,
  interruptAgentChat,
  listAgentChatEvents,
  listAgentChats,
  openAgentChatStream,
  sendAgentChatMessage,
} from "../services/agentChatService.js";
import { assertAdmin } from "../services/userService.js";
import {
  agentChatCreateInputSchema,
  agentChatListQuerySchema,
  agentChatMessageInputSchema,
  agentChatToolConfirmationInputSchema,
} from "../lib/validation.js";

/** Chat con l'agente Claude Managed Agents (solo admin, anche per i progetti di un manager). */
export async function agentChatRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/agent-chats", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    assertAdmin((req as any).authUser);
    return listAgentChats(projectId, agentChatListQuerySchema.parse(req.query ?? {}));
  });

  app.post("/projects/:projectId/agent-chats", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const user = (req as any).authUser;
    assertAdmin(user);
    const body = agentChatCreateInputSchema.parse(req.body ?? {});
    return reply.code(201).send(await createAgentChat(projectId, body, user.id));
  });

  app.get("/agent-chats/:chatId", { onRequest: [app.authenticate] }, async (req) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    return getAgentChat(chatId);
  });

  app.get("/agent-chats/:chatId/events", { onRequest: [app.authenticate] }, async (req) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    return listAgentChatEvents(chatId);
  });

  app.post("/agent-chats/:chatId/messages", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    const { text } = agentChatMessageInputSchema.parse(req.body ?? {});
    await sendAgentChatMessage(chatId, text);
    return reply.code(202).send({ ok: true });
  });

  app.post("/agent-chats/:chatId/interrupt", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    await interruptAgentChat(chatId);
    return reply.code(202).send({ ok: true });
  });

  app.post("/agent-chats/:chatId/tool-confirmation", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    const { toolUseId, result } = agentChatToolConfirmationInputSchema.parse(req.body ?? {});
    await confirmAgentChatTool(chatId, toolUseId, result);
    return reply.code(202).send({ ok: true });
  });

  // SSE letto dalla web app con fetch (header Authorization normale).
  app.get("/agent-chats/:chatId/stream", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    assertAdmin((req as any).authUser);
    // Errori di apertura (404, AGENT_API_ERROR) escono come JSON dall'error handler.
    const stream = await openAgentChatStream(chatId);
    const reader = agentChatSseBody(stream).getReader();

    reply.hijack();
    reply.raw.writeHead(200, AGENT_CHAT_SSE_HEADERS);
    reply.raw.flushHeaders?.();
    const stop = () => {
      void reader.cancel().catch(() => undefined);
    };
    // "close" della risposta (non della richiesta: per una GET quella arriva
    // appena letto il corpo) = client disconnesso.
    reply.raw.on("close", stop);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
    } catch {
      // client disconnesso
    } finally {
      stop();
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
}
