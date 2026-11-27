import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { AI_NOTE_MAX_LENGTH, ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { taskRoutes } from "./tasks.js";
import { createUser, getAuthUser } from "../services/userService.js";
import { createProject, createTask } from "../services/taskService.js";

/**
 * Nota dell'admin per l'agente (`ai.note`) via PUT /tasks/:taskId/ai sulla
 * route Node (Fastify; il Worker e' in cf/rest.aiNote.test.ts): solo admin, vuota = null,
 * oltre AI_NOTE_MAX_LENGTH errore di validazione, omessa = invariata.
 * L'app Fastify replica autenticazione ed error handler di src/index.ts.
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
  instance.register(taskRoutes);
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

async function setup() {
  const project = await createProject("Clinica");
  const task = await createTask(project.id, { title: "Login rotto" });
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  const admin = await createUser({ email: "admin@example.com", password: "password-123", role: "admin" });
  return { project, task, manager, admin };
}

describe("REST Node PUT /tasks/:taskId/ai — nota per l'agente", () => {
  async function put(token: string, taskId: string, body: unknown) {
    return app.inject({ method: "PUT", url: `/tasks/${taskId}/ai`, headers: { authorization: `Bearer ${token}` }, payload: body as any });
  }

  it("l'admin salva la nota (anche a gestione spenta), la rilegge, vuota = null, omessa = invariata", async () => {
    const { task, admin } = await setup();
    const token = app.jwt.sign({ sub: admin.id, email: admin.email });

    const saved = await put(token, task.id, { enabled: false, note: "  Non toccare il modulo pagamenti  " });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().ai).toMatchObject({ enabled: false, note: "Non toccare il modulo pagamenti" });

    const read = await app.inject({ method: "GET", url: `/tasks/${task.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(read.json().ai.note).toBe("Non toccare il modulo pagamenti");

    const untouched = await put(token, task.id, { enabled: true, steps: ["coder"] });
    expect(untouched.json().ai).toMatchObject({ enabled: true, note: "Non toccare il modulo pagamenti" });

    const cleared = await put(token, task.id, { enabled: true, steps: ["coder"], note: "   " });
    expect(cleared.json().ai.note).toBeNull();
  });

  it(`nota oltre ${AI_NOTE_MAX_LENGTH} caratteri: 400 VALIDATION_ERROR`, async () => {
    const { task, admin } = await setup();
    const token = app.jwt.sign({ sub: admin.id, email: admin.email });
    const ok = await put(token, task.id, { enabled: false, note: "x".repeat(AI_NOTE_MAX_LENGTH) });
    expect(ok.statusCode).toBe(200);
    const res = await put(token, task.id, { enabled: false, note: "x".repeat(AI_NOTE_MAX_LENGTH + 1) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("un manager del progetto riceve 403 e la nota non cambia", async () => {
    const { task, manager } = await setup();
    const token = app.jwt.sign({ sub: manager.id, email: manager.email });
    const res = await put(token, task.id, { enabled: false, note: "Vincolo" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    const read = await app.inject({ method: "GET", url: `/tasks/${task.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(read.json().ai.note).toBeNull();
  });
});
