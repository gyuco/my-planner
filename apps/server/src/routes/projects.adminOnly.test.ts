import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { projectRoutes } from "./projects.js";
import { createUser, getAuthUser } from "../services/userService.js";
import { createProject } from "../services/taskService.js";

/**
 * Route REST Node delle impostazioni di progetto: solo admin.
 * Un manager assegnato al progetto riceve 403; GET /statuses resta aperta
 * (la board ne ha bisogno). L'app replica autenticazione ed error handler di src/index.ts.
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
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

async function setup() {
  const project = await createProject("Clinica");
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

type Method = "GET" | "POST" | "PATCH" | "DELETE";

function adminOnlyRoutes(projectId: string): { method: Method; url: string; payload?: Record<string, unknown> }[] {
  return [
    { method: "PATCH", url: `/projects/${projectId}`, payload: { name: "Rinominato" } },
    { method: "POST", url: `/projects/${projectId}/archive` },
    { method: "POST", url: `/projects/${projectId}/unarchive` },
    { method: "POST", url: `/projects/${projectId}/statuses`, payload: { label: "In attesa" } },
    { method: "PATCH", url: `/projects/${projectId}/statuses/todo`, payload: { label: "Da fare ora" } },
    { method: "DELETE", url: `/projects/${projectId}/statuses/todo` },
    { method: "POST", url: `/projects/${projectId}/tokens`, payload: { label: "ci" } },
    { method: "GET", url: `/projects/${projectId}/tokens` },
    { method: "DELETE", url: `/projects/${projectId}/tokens/token-inesistente` },
  ];
}

describe("REST Node impostazioni di progetto solo admin", () => {
  it("un manager assegnato al progetto riceve 403 su ogni route delle impostazioni", async () => {
    const { project, managerToken } = await setup();
    for (const route of adminOnlyRoutes(project.id)) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: `Bearer ${managerToken}` },
        ...(route.payload !== undefined ? { payload: route.payload } : {}),
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("il manager continua a leggere gli stati del progetto (200)", async () => {
    const { project, managerToken } = await setup();
    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/statuses`,
      headers: { authorization: `Bearer ${managerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("l'admin rinomina il progetto e aggiunge uno stato (2xx)", async () => {
    const { project, adminToken } = await setup();
    const patch = await app.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Rinominato" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe("Rinominato");

    const status = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/statuses`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { label: "In attesa" },
    });
    expect(status.statusCode).toBe(201);
  });
});
