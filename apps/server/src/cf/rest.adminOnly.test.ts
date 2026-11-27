import { describe, expect, it, vi } from "vitest";

// Il trasporto SMTP del Worker importa `cloudflare:sockets`, non disponibile in Node.
vi.mock("./smtpSocket.js", () => ({
  cfSmtpSocketFactory: async () => {
    throw new Error("non usato nei test");
  },
}));

import { buildRestApp } from "./rest.js";
import { signAccessToken } from "./jwt.js";
import { createUser } from "../services/userService.js";
import { createProject } from "../services/taskService.js";

/**
 * Route REST Cloudflare delle impostazioni di progetto: solo admin.
 * Un manager assegnato al progetto riceve 403; GET /statuses resta aperta.
 */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;

async function setup() {
  const project = await createProject("Clinica");
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  const admin = await createUser({ email: "admin@example.com", password: "password-123", role: "admin" });
  return {
    project,
    managerToken: await signAccessToken(env, { sub: manager.id, email: manager.email }),
    adminToken: await signAccessToken(env, { sub: admin.id, email: admin.email }),
  };
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

function adminOnlyRoutes(projectId: string): { method: string; url: string; body?: unknown }[] {
  return [
    { method: "PATCH", url: `/projects/${projectId}`, body: { name: "Rinominato" } },
    { method: "POST", url: `/projects/${projectId}/archive` },
    { method: "POST", url: `/projects/${projectId}/unarchive` },
    { method: "POST", url: `/projects/${projectId}/statuses`, body: { label: "In attesa" } },
    { method: "PATCH", url: `/projects/${projectId}/statuses/todo`, body: { label: "Da fare ora" } },
    { method: "DELETE", url: `/projects/${projectId}/statuses/todo` },
    { method: "POST", url: `/projects/${projectId}/tokens`, body: { label: "ci" } },
    { method: "GET", url: `/projects/${projectId}/tokens` },
    { method: "DELETE", url: `/projects/${projectId}/tokens/token-inesistente` },
  ];
}

describe("REST Cloudflare impostazioni di progetto solo admin", () => {
  it("un manager assegnato al progetto riceve 403 su ogni route delle impostazioni", async () => {
    const app = buildRestApp();
    const { project, managerToken } = await setup();
    for (const route of adminOnlyRoutes(project.id)) {
      const res = await call(app, route.method, route.url, managerToken, route.body);
      expect(res.status, `${route.method} ${route.url}`).toBe(403);
      expect(((await res.json()) as any).error.code).toBe("FORBIDDEN");
    }
  });

  it("il manager continua a leggere gli stati del progetto (200)", async () => {
    const app = buildRestApp();
    const { project, managerToken } = await setup();
    const res = await call(app, "GET", `/projects/${project.id}/statuses`, managerToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("l'admin rinomina il progetto e aggiunge uno stato (2xx)", async () => {
    const app = buildRestApp();
    const { project, adminToken } = await setup();
    const patch = await call(app, "PATCH", `/projects/${project.id}`, adminToken, { name: "Rinominato" });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as any).name).toBe("Rinominato");
    const status = await call(app, "POST", `/projects/${project.id}/statuses`, adminToken, { label: "In attesa" });
    expect(status.status).toBe(201);
  });
});

describe("REST Cloudflare assistente vocale", () => {
  it("impostazioni e uso dell'assistente vocale sono solo admin", async () => {
    const app = buildRestApp();
    const { managerToken, adminToken } = await setup();
    for (const [method, url, body] of [
      ["GET", "/settings/voice", undefined],
      ["PUT", "/settings/voice", { enabled: false }],
      ["POST", "/settings/voice/test", undefined],
      ["GET", "/voice/status", undefined],
      ["POST", "/voice/session", undefined],
    ] as const) {
      const res = await call(app, method, url, managerToken, body);
      expect(res.status, `${method} ${url}`).toBe(403);
    }

    const put = await call(app, "PUT", "/settings/voice", adminToken, {
      enabled: true,
      apiKey: "AIzaSyTEST-0123456789abcdefghijkl",
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ configured: true, apiKeySet: true });

    const managerStatus = await call(app, "GET", "/voice/status", managerToken);
    expect(managerStatus.status).toBe(403);
    const status = await call(app, "GET", "/voice/status", adminToken);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ available: true });
  });

  it("/voice/session richiede l'autenticazione", async () => {
    const app = buildRestApp();
    const res = await app.request("/voice/session", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });
});
