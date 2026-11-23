import { describe, it, expect, vi } from "vitest";

// rest.ts importa l'invio email del Worker (cloudflare:sockets), non disponibile su Node.
vi.mock("./email.js", () => ({ sendStandupEmail: vi.fn() }));

import { buildRestApp } from "./rest.js";
import { signAccessToken } from "./jwt.js";
import { createProject } from "../services/taskService.js";
import { createUser } from "../services/userService.js";

/** Route della chat agente su Hono: solo admin, un manager riceve 403 anche sui suoi progetti. */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;

describe("cf chat agente: solo admin", () => {
  it("un manager riceve 403 FORBIDDEN su lista, creazione e stream", async () => {
    const project = await createProject("Clinica");
    const manager = await createUser({
      email: "manager@example.com",
      password: "password123",
      role: "manager",
      projectIds: [project.id],
    });
    const token = await signAccessToken(env, { sub: manager.id, email: manager.email });
    const app = buildRestApp();
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };

    const list = await app.request(`/projects/${project.id}/agent-chats?scope=project`, { headers }, env);
    expect(list.status).toBe(403);
    expect(((await list.json()) as any).error.code).toBe("FORBIDDEN");

    const create = await app.request(
      `/projects/${project.id}/agent-chats`,
      { method: "POST", headers, body: JSON.stringify({ text: "Ciao" }) },
      env,
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as any).error.code).toBe("FORBIDDEN");

    const stream = await app.request(`/agent-chats/whatever/stream`, { headers }, env);
    expect(stream.status).toBe(403);
  });

  it("senza token: 401", async () => {
    const app = buildRestApp();
    const res = await app.request(`/agent-chats/whatever/events`, {}, env);
    expect(res.status).toBe(401);
  });
});
