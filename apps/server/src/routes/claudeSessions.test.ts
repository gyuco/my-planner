import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { claudeSessionRoutes } from "./claudeSessions.js";
import { createUser, getAuthUser } from "../services/userService.js";

/**
 * Route REST Node della vista "In corso": l'hook si autentica col token hook
 * (non col JWT), le altre route col JWT. L'app replica auth ed error handler di src/index.ts.
 */

let app: FastifyInstance;

async function buildApp() {
  const instance = Fastify();
  instance.register(jwt, { secret: process.env.JWT_SECRET! });
  instance.decorate("authenticate", async function (req: any, reply: any) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Token non valido o mancante"));
    }
    const authUser = await getAuthUser(req.user.sub);
    if (!authUser) return reply.code(401).send(apiError("UNAUTHORIZED", "Utente non piu' valido"));
    req.authUser = authUser;
  });
  instance.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiErrorException) return reply.code(HTTP_STATUS_BY_ERROR_CODE[err.code]).send(err.toApiError());
    if (err instanceof ZodError) return reply.code(400).send(apiError("VALIDATION_ERROR", "Input non valido"));
    return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
  });
  instance.register(claudeSessionRoutes);
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

async function login() {
  const user = await createUser({ email: "admin@test.it", password: "password123", role: "admin" });
  return { user, jwt: app.jwt.sign({ sub: user.id }) };
}

describe("hook e vista In corso", () => {
  it("token creato dal profilo -> l'hook registra la sessione -> compare nell'elenco", async () => {
    const { jwt: token } = await login();
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({ method: "POST", url: "/auth/me/hook-tokens", headers: auth, payload: { label: "pc" } });
    expect(created.statusCode).toBe(201);
    const hookToken = created.json().token as string;

    const hook = await app.inject({
      method: "POST",
      url: "/hooks/claude-session",
      headers: { authorization: `Bearer ${hookToken}` },
      payload: { event: "UserPromptSubmit", sessionId: "abc", workdir: "clinica" },
    });
    expect(hook.statusCode).toBe(200);
    expect(hook.json()).toEqual({ ok: true, status: "working" });

    const list = await app.inject({ method: "GET", url: "/claude-sessions", headers: auth });
    expect(list.json()).toMatchObject([{ sessionId: "abc", status: "working", workdir: "clinica" }]);

    const listed = await app.inject({ method: "GET", url: "/auth/me/hook-tokens", headers: auth });
    expect(listed.json()[0]).not.toHaveProperty("token");
  });

  it("l'hook rifiuta JWT, token mancanti e input non validi", async () => {
    const { jwt: token } = await login();
    const payload = { event: "Stop", sessionId: "abc" };

    const noToken = await app.inject({ method: "POST", url: "/hooks/claude-session", payload });
    expect(noToken.statusCode).toBe(401);
    const withJwt = await app.inject({ method: "POST", url: "/hooks/claude-session", headers: { authorization: `Bearer ${token}` }, payload });
    expect(withJwt.statusCode).toBe(401);

    const created = await app.inject({ method: "POST", url: "/auth/me/hook-tokens", headers: { authorization: `Bearer ${token}` }, payload: {} });
    const headers = { authorization: `Bearer ${created.json().token}` };
    const badEvent = await app.inject({ method: "POST", url: "/hooks/claude-session", headers, payload: { event: "PreCompact", sessionId: "abc" } });
    expect(badEvent.statusCode).toBe(400);
    const badUrl = await app.inject({
      method: "POST",
      url: "/hooks/claude-session",
      headers,
      payload: { event: "Stop", sessionId: "abc", url: "https://evil.example/code/x" },
    });
    expect(badUrl.statusCode).toBe(400);
  });

  it("il token hook non apre le route protette da JWT", async () => {
    const { jwt: token } = await login();
    const created = await app.inject({ method: "POST", url: "/auth/me/hook-tokens", headers: { authorization: `Bearer ${token}` }, payload: {} });
    const res = await app.inject({ method: "GET", url: "/claude-sessions", headers: { authorization: `Bearer ${created.json().token}` } });
    expect(res.statusCode).toBe(401);
  });
});
