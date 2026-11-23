import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { projectRoutes } from "./projects.js";
import { createUser, getAuthUser } from "../services/userService.js";
import { createProject, updateProject } from "../services/taskService.js";
import { setRoutineConfig } from "../services/aiRoutineService.js";

/**
 * Route REST Node POST /projects/:projectId/ai-routine/session: solo admin.
 * L'app replica l'autenticazione e l'error handler di src/index.ts (che avvia
 * il server e non e' importabile nei test). La routine e' simulata con fetch.
 */

let app: FastifyInstance;
let fires: { url: string; body: any }[] = [];

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
  instance.register(projectRoutes);
  await instance.ready();
  return instance;
}

beforeEach(async () => {
  fires = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fires.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_1" });
  });
  app = await buildApp();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

async function setup() {
  const project = await createProject("Clinica");
  await updateProject(project.id, { repoUrl: "gyuco/clinica" });
  await setRoutineConfig(project.id, { routineId: "trig_01ABCDEFGHJK", token: "sk-ant-oat01-test-token-0123456789" });
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  const admin = await createUser({ email: "admin@example.com", password: "password-123", role: "admin" });
  const tokenFor = (u: { id: string; email: string }) => app.jwt.sign({ sub: u.id, email: u.email });
  return { project, managerToken: tokenFor(manager), adminToken: tokenFor(admin) };
}

describe("REST Node POST /projects/:projectId/ai-routine/session", () => {
  it("un manager assegnato al progetto riceve 403 e la routine non parte", async () => {
    const { project, managerToken } = await setup();
    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/ai-routine/session`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload: { message: "Ciao" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(fires).toHaveLength(0);
  });

  it("l'admin avvia la sessione (200) e riceve il link", async () => {
    const { project, adminToken } = await setup();
    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/ai-routine/session`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: "  Aggiorna il README  " },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionUrl: "https://claude.ai/code/session_1" });
    expect(fires).toHaveLength(1);
    expect(fires[0].body.text.endsWith("Richiesta:\nAggiorna il README")).toBe(true);
  });

  it("messaggio vuoto: 400 senza avvio", async () => {
    const { project, adminToken } = await setup();
    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/ai-routine/session`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { message: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(fires).toHaveLength(0);
  });
});
