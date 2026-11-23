import type { FastifyInstance } from "fastify";
import { apiError } from "@my-planner/core";
import {
  bearerToken,
  createSessionHookToken,
  dismissClaudeSession,
  listClaudeSessions,
  listSessionHookTokens,
  recordHookEvent,
  resolveUserFromHookToken,
  revokeSessionHookToken,
} from "../services/claudeSessionService.js";
import { claudeHookInputSchema, sessionHookTokenInputSchema } from "../lib/validation.js";

/**
 * Vista "In corso" (sessioni di Claude Code) e token degli hook.
 * POST /hooks/claude-session NON usa il JWT: si autentica col token hook
 * (mph_...), che vale solo per questa route.
 */
export async function claudeSessionRoutes(app: FastifyInstance) {
  app.post("/hooks/claude-session", async (req, reply) => {
    const userId = await resolveUserFromHookToken(bearerToken(req.headers.authorization));
    if (!userId) return reply.code(401).send(apiError("UNAUTHORIZED", "Token hook non valido o revocato"));
    const input = claudeHookInputSchema.parse(req.body ?? {});
    const result = await recordHookEvent(userId, input);
    return { ok: true, status: result?.status ?? null };
  });

  app.get("/claude-sessions", { onRequest: [app.authenticate] }, async (req) => {
    return listClaudeSessions((req as any).authUser);
  });

  app.delete("/claude-sessions/:sessionId", { onRequest: [app.authenticate] }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    return dismissClaudeSession((req as any).authUser, sessionId);
  });

  app.get("/auth/me/hook-tokens", { onRequest: [app.authenticate] }, async (req) => {
    return listSessionHookTokens((req as any).authUser.id);
  });

  app.post("/auth/me/hook-tokens", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { label } = sessionHookTokenInputSchema.parse(req.body ?? {});
    return reply.code(201).send(await createSessionHookToken((req as any).authUser.id, label));
  });

  app.delete("/auth/me/hook-tokens/:tokenId", { onRequest: [app.authenticate] }, async (req) => {
    const { tokenId } = req.params as { tokenId: string };
    return revokeSessionHookToken((req as any).authUser.id, tokenId);
  });
}
