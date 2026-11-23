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
import { setRoutineConfig } from "../services/aiRoutineService.js";

/** Route REST Cloudflare POST /projects/:projectId/ai-routine/session: solo admin. */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;
let fires: { url: string; body: any }[] = [];

beforeEach(() => {
  fires = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fires.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_1" });
  });
});

afterEach(() => vi.unstubAllGlobals());

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
  return {
    project,
    managerToken: await signAccessToken(env, { sub: manager.id, email: manager.email }),
    adminToken: await signAccessToken(env, { sub: admin.id, email: admin.email }),
  };
}

function post(app: ReturnType<typeof buildRestApp>, projectId: string, token: string, body: unknown) {
  return app.request(
    `/projects/${projectId}/ai-routine/session`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("REST Cloudflare POST /projects/:projectId/ai-routine/session", () => {
  it("un manager assegnato al progetto riceve 403 e la routine non parte", async () => {
    const app = buildRestApp();
    const { project, managerToken } = await setup();
    const res = await post(app, project.id, managerToken, { message: "Ciao" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("FORBIDDEN");
    expect(fires).toHaveLength(0);
  });

  it("l'admin avvia la sessione (200) e riceve il link", async () => {
    const app = buildRestApp();
    const { project, adminToken } = await setup();
    const res = await post(app, project.id, adminToken, { message: "Aggiorna il README" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionUrl: "https://claude.ai/code/session_1" });
    expect(fires).toHaveLength(1);
  });
});
