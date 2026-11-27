import { describe, expect, it, vi } from "vitest";
import { AI_NOTE_MAX_LENGTH } from "@my-planner/core";

// Il trasporto SMTP del Worker importa `cloudflare:sockets`, non disponibile in Node.
vi.mock("./smtpSocket.js", () => ({
  cfSmtpSocketFactory: async () => {
    throw new Error("non usato nei test");
  },
}));

import { buildRestApp } from "./rest.js";
import { signAccessToken } from "./jwt.js";
import { createUser } from "../services/userService.js";
import { createProject, createTask } from "../services/taskService.js";

/**
 * Nota dell'admin per l'agente (`ai.note`) via PUT /tasks/:taskId/ai sul
 * Worker: stesse regole della route Node (routes/tasks.aiNote.test.ts).
 */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;

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
  return { task, manager, admin };
}

function call(app: ReturnType<typeof buildRestApp>, method: string, url: string, token: string, body?: unknown) {
  return app.request(
    url,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

describe("REST Cloudflare PUT /tasks/:taskId/ai — nota per l'agente", () => {
  it("admin salva, vuota = null, troppo lunga 400, manager 403", async () => {
    const app = buildRestApp();
    const { task, admin, manager } = await setup();
    const adminToken = await signAccessToken(env, { sub: admin.id, email: admin.email });
    const managerToken = await signAccessToken(env, { sub: manager.id, email: manager.email });
    const url = `/tasks/${task.id}/ai`;

    const saved = await call(app, "PUT", url, adminToken, { enabled: true, steps: ["coder"], note: "Usa la libreria X" });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as any).ai.note).toBe("Usa la libreria X");

    const tooLong = await call(app, "PUT", url, adminToken, { enabled: true, steps: ["coder"], note: "x".repeat(AI_NOTE_MAX_LENGTH + 1) });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as any).error.code).toBe("VALIDATION_ERROR");

    const forbidden = await call(app, "PUT", url, managerToken, { enabled: false, note: "Altro" });
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as any).error.code).toBe("FORBIDDEN");

    const cleared = await call(app, "PUT", url, adminToken, { enabled: true, steps: ["coder"], note: "" });
    expect(((await cleared.json()) as any).ai.note).toBeNull();
  });
});
