import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Il trasporto SMTP del Worker importa `cloudflare:sockets`, non disponibile in Node.
vi.mock("./smtpSocket.js", () => ({
  cfSmtpSocketFactory: async () => {
    throw new Error("non usato nei test");
  },
}));

import { buildRestApp } from "./rest.js";
import { signAccessToken } from "./jwt.js";
import { createUser } from "../services/userService.js";
import { createProject, updateProject } from "../services/taskService.js";
import { setAgentClientFactory } from "../services/agentConfigService.js";

/** Route REST Cloudflare /projects/:projectId/ai-agent: solo admin. */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;
let anthropicCalls = 0;

beforeEach(() => {
  anthropicCalls = 0;
  setAgentClientFactory(() => {
    anthropicCalls++;
    throw new Error("il client Anthropic non deve essere usato");
  });
});

afterEach(() => setAgentClientFactory(null));

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
  return {
    project,
    managerToken: await signAccessToken(env, { sub: manager.id, email: manager.email }),
    adminToken: await signAccessToken(env, { sub: admin.id, email: admin.email }),
  };
}

describe("REST Cloudflare /projects/:projectId/ai-agent", () => {
  it("un manager assegnato al progetto riceve 403 su GET, PUT e DELETE", async () => {
    const app = buildRestApp();
    const { project, managerToken } = await setup();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await app.request(
        `/projects/${project.id}/ai-agent`,
        {
          method,
          headers: { Authorization: `Bearer ${managerToken}`, "content-type": "application/json" },
          ...(method === "PUT"
            ? {
                body: JSON.stringify({
                  apiKey: "sk-ant-api03-x",
                  githubToken: "ghp_x",
                  mcpUrl: "https://planner.example.com/mcp",
                }),
              }
            : {}),
        },
        env,
      );
      expect(res.status, method).toBe(403);
      expect(((await res.json()) as any).error.code, method).toBe("FORBIDDEN");
    }
    expect(anthropicCalls).toBe(0);
  });

  it("l'admin legge la configurazione (200)", async () => {
    const app = buildRestApp();
    const { project, adminToken } = await setup();
    const res = await app.request(
      `/projects/${project.id}/ai-agent`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: false });
  });
});
