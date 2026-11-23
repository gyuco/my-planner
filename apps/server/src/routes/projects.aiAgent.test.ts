import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { projectRoutes } from "./projects.js";
import { createUser, getAuthUser } from "../services/userService.js";
import { createProject, updateProject } from "../services/taskService.js";
import { setAgentClientFactory } from "../services/agentConfigService.js";

/**
 * Route REST Node /projects/:projectId/ai-agent: solo admin. L'app replica
 * l'autenticazione e l'error handler di src/index.ts (che avvia il server e
 * non e' importabile nei test).
 */

let app: FastifyInstance;
let anthropicCalls = 0;

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
  anthropicCalls = 0;
  setAgentClientFactory(() => {
    anthropicCalls++;
    throw new Error("il client Anthropic non deve essere usato");
  });
  app = await buildApp();
});

afterEach(async () => {
  setAgentClientFactory(null);
  await app.close();
});

async function setup() {
  const project = await createProject("Clinica");
  await updateProject(project.id, { repoUrl: "gyuco/clinica" });
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

describe("REST Node /projects/:projectId/ai-agent", () => {
  it("un manager assegnato al progetto riceve 403 su GET, PUT e DELETE", async () => {
    const { project, managerToken } = await setup();
    const url = `/projects/${project.id}/ai-agent`;
    const headers = { authorization: `Bearer ${managerToken}` };

    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url,
        headers,
        ...(method === "PUT"
          ? { payload: { apiKey: "sk-ant-api03-x", githubToken: "ghp_x", mcpUrl: "https://planner.example.com/mcp" } }
          : {}),
      });
      expect(res.statusCode, method).toBe(403);
      expect(res.json().error.code, method).toBe("FORBIDDEN");
    }
    expect(anthropicCalls).toBe(0);
  });

  it("l'admin legge la configurazione (200)", async () => {
    const { project, adminToken } = await setup();
    const res = await app.inject({
      method: "GET",
      url: `/projects/${project.id}/ai-agent`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false });
  });

  it("senza token risponde 401", async () => {
    const { project } = await setup();
    const res = await app.inject({ method: "GET", url: `/projects/${project.id}/ai-agent` });
    expect(res.statusCode).toBe(401);
  });
});
