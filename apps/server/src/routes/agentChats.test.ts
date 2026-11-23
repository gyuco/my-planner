import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { ZodError } from "zod";
import { agentChatRoutes } from "./agentChats.js";
import { createProject } from "../services/taskService.js";
import { createUser, getAuthUser } from "../services/userService.js";

/**
 * Le route della chat agente sono solo per admin: un manager riceve 403 anche
 * sui suoi progetti (variante Cloudflare in src/cf/agentChats.test.ts).
 */

const SECRET = process.env.JWT_SECRET!;

let fastify: FastifyInstance;

beforeAll(async () => {
  fastify = Fastify();
  await fastify.register(jwt, { secret: SECRET });
  fastify.decorate("authenticate", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Token non valido o mancante"));
    }
    const authUser = await getAuthUser(req.user.sub);
    if (!authUser) return reply.code(401).send(apiError("UNAUTHORIZED", "Utente non piu' valido"));
    req.authUser = authUser;
  });
  fastify.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiErrorException) return reply.code(HTTP_STATUS_BY_ERROR_CODE[err.code]).send(err.toApiError());
    if (err instanceof ZodError) return reply.code(400).send(apiError("VALIDATION_ERROR", "Input non valido"));
    return reply.code(500).send(apiError("INTERNAL_ERROR", "Errore interno del server"));
  });
  await fastify.register(agentChatRoutes);
  await fastify.ready();
});

afterAll(async () => {
  await fastify.close();
});

async function managerOnProject() {
  const project = await createProject("Clinica");
  const manager = await createUser({
    email: "manager@example.com",
    password: "password123",
    role: "manager",
    projectIds: [project.id],
  });
  const token = fastify.jwt.sign({ sub: manager.id, email: manager.email });
  return { project, token };
}

describe("chat agente: solo admin", () => {
  it("Node: un manager riceve 403 FORBIDDEN su lista e creazione", async () => {
    const { project, token } = await managerOnProject();
    const headers = { authorization: `Bearer ${token}` };

    const list = await fastify.inject({ method: "GET", url: `/projects/${project.id}/agent-chats?scope=project`, headers });
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe("FORBIDDEN");

    const create = await fastify.inject({
      method: "POST",
      url: `/projects/${project.id}/agent-chats`,
      headers,
      payload: { text: "Ciao" },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe("FORBIDDEN");

    const stream = await fastify.inject({ method: "GET", url: `/agent-chats/whatever/stream`, headers });
    expect(stream.statusCode).toBe(403);
  });

  it("Node: un admin su progetto inesistente riceve 404", async () => {
    const admin = await createUser({ email: "admin@example.com", password: "password123", role: "admin" });
    const headers = { authorization: `Bearer ${fastify.jwt.sign({ sub: admin.id, email: admin.email })}` };
    const list = await fastify.inject({ method: "GET", url: `/projects/nope/agent-chats`, headers });
    expect(list.statusCode).toBe(404);
  });
});
