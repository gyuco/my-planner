import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// rest.ts importa l'invio email del Worker (cloudflare:sockets), non disponibile su Node.
vi.mock("../cf/email.js", () => ({ sendStandupEmail: vi.fn() }));

import Fastify, { type FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";
import { ApiErrorException, apiError, HTTP_STATUS_BY_ERROR_CODE } from "@my-planner/core";
import { ZodError } from "zod";
import { agentChatRoutes } from "./agentChats.js";
import { buildRestApp } from "../cf/rest.js";
import { signAccessToken } from "../cf/jwt.js";
import { createProject } from "../services/taskService.js";
import { createUser, getAuthUser } from "../services/userService.js";

/** Le route della chat agente sono solo per admin: un manager riceve 403 anche sui suoi progetti. */

const SECRET = process.env.JWT_SECRET!;
const env = { JWT_SECRET: SECRET } as any;

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
  } as any);
  const token = await signAccessToken(env, { sub: manager.id, email: manager.email });
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
  });

  it("Cloudflare: un manager riceve 403 FORBIDDEN su lista e creazione", async () => {
    const { project, token } = await managerOnProject();
    const app = buildRestApp();
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

    const list = await app.request(`/projects/${project.id}/agent-chats?scope=project`, { headers }, env);
    expect(list.status).toBe(403);
    expect((await list.json()).error.code).toBe("FORBIDDEN");

    const create = await app.request(
      `/projects/${project.id}/agent-chats`,
      { method: "POST", headers, body: JSON.stringify({ text: "Ciao" }) },
      env,
    );
    expect(create.status).toBe(403);
    expect((await create.json()).error.code).toBe("FORBIDDEN");

    const stream = await app.request(`/agent-chats/whatever/stream`, { headers }, env);
    expect(stream.status).toBe(403);
  });
});
