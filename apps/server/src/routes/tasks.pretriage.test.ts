import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { taskRoutes } from "./tasks.js";
import { settingsRoutes } from "./settings.js";
import { createUser, getAuthUser } from "../services/userService.js";
import { createProject, createTask } from "../services/taskService.js";
import { updateVoiceSettings } from "../services/voiceService.js";

/**
 * Route REST Node del pre-triage: per tutti gli utenti con accesso al task
 * (non solo admin); la verifica del modello resta admin-only. L'app replica
 * autenticazione ed error handler di src/index.ts.
 */

const API_KEY = "AIzaSyTEST-0123456789abcdefghijkl";
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
  instance.decorate("requireAdmin", async function (req: any, reply: any) {
    if (req.authUser?.role !== "admin") {
      return reply.code(403).send(apiError("FORBIDDEN", "Operazione riservata agli amministratori"));
    }
  });
  instance.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiErrorException) return reply.code(HTTP_STATUS_BY_ERROR_CODE[err.code]).send(err.toApiError());
    if (err instanceof ZodError) return reply.code(400).send(apiError("VALIDATION_ERROR", "Input non valido"));
    return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
  });
  instance.register(taskRoutes);
  instance.register(settingsRoutes);
  await instance.ready();
  return instance;
}

let geminiStatus = 200;

beforeEach(async () => {
  app = await buildApp();
  geminiStatus = 200;
  vi.stubGlobal("fetch", async () =>
    geminiStatus === 200
      ? Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      ready: true,
                      missing: [],
                      ambiguities: [],
                      suggestedPriority: "medium",
                      suggestedComplexity: 3,
                      possibleDuplicates: [],
                      summary: "Ok",
                    }),
                  },
                ],
              },
            },
          ],
        })
      : Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }, { status: geminiStatus }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

async function setup() {
  const project = await createProject("Clinica");
  const otherProject = await createProject("Altro");
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  const task = await createTask(project.id, { title: "Login lento" });
  const foreignTask = await createTask(otherProject.id, { title: "Non mio" });
  const managerToken = app.jwt.sign({ sub: manager.id, email: manager.email });
  return { task, foreignTask, managerToken };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("REST Node pre-triage", () => {
  it("un manager con accesso lo lancia; senza accesso 403, task inesistente 404", async () => {
    const { task, foreignTask, managerToken } = await setup();

    const off = await app.inject({ method: "GET", url: "/pretriage/status", headers: auth(managerToken) });
    expect(off.json()).toEqual({ available: false });
    const unavailable = await app.inject({
      method: "POST",
      url: `/tasks/${task.id}/pretriage`,
      headers: auth(managerToken),
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("PRETRIAGE_UNAVAILABLE");

    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    const on = await app.inject({ method: "GET", url: "/pretriage/status", headers: auth(managerToken) });
    expect(on.json()).toEqual({ available: true });

    const ok = await app.inject({ method: "POST", url: `/tasks/${task.id}/pretriage`, headers: auth(managerToken) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ result: { ready: true }, comment: { taskId: task.id } });

    const forbidden = await app.inject({
      method: "POST",
      url: `/tasks/${foreignTask.id}/pretriage`,
      headers: auth(managerToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const missing = await app.inject({ method: "POST", url: "/tasks/inesistente/pretriage", headers: auth(managerToken) });
    expect(missing.statusCode).toBe(404);
  });

  it("quota esaurita: 429 PRETRIAGE_QUOTA", async () => {
    const { task, managerToken } = await setup();
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true });
    geminiStatus = 429;
    const res = await app.inject({ method: "POST", url: `/tasks/${task.id}/pretriage`, headers: auth(managerToken) });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toEqual({
      code: "PRETRIAGE_QUOTA",
      message: "Quota gratuita di Gemini esaurita per oggi, riprova piu' tardi",
    });
  });

  it("verifica del modello solo admin; senza autenticazione 401", async () => {
    const { task, managerToken } = await setup();
    const test = await app.inject({
      method: "POST",
      url: "/settings/voice/pretriage-test",
      headers: auth(managerToken),
    });
    expect(test.statusCode).toBe(403);
    const anon = await app.inject({ method: "POST", url: `/tasks/${task.id}/pretriage` });
    expect(anon.statusCode).toBe(401);
  });
});
