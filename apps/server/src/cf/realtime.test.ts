import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRealtimeUpgrade, matchRealtimePath, sendToProjectRealtime } from "./realtime.js";
import { signAccessToken } from "./jwt.js";
import { createUser } from "../services/userService.js";
import { createProject, createTask, moveTask } from "../services/taskService.js";
import { REALTIME_PROTOCOL, setRealtimePublisher, type BoardChangeMessage } from "../lib/realtime.js";

/** Board in tempo reale: handshake del WebSocket (auth) e pubblicazione degli avvisi. */

const env = { JWT_SECRET: process.env.JWT_SECRET! } as any;

/** Namespace DO finto: registra il nome dell'istanza e le richieste ricevute. */
function fakeNamespace() {
  const calls: { name: string; url: string; method: string; protocol: string | null; body: string | null }[] = [];
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (input: string | Request, init?: RequestInit) => {
        const req = typeof input === "string" ? new Request(input, init) : input;
        calls.push({
          name: id.name,
          url: req.url,
          method: req.method,
          protocol: req.headers.get("Sec-WebSocket-Protocol"),
          body: req.method === "POST" ? await req.text() : null,
        });
        return new Response(null, { status: req.method === "POST" ? 204 : 200 });
      },
    }),
  };
  return { namespace: namespace as any, calls };
}

function upgrade(projectId: string, protocols?: string, headers: Record<string, string> = {}) {
  return new Request(`https://api.example.com/realtime/projects/${projectId}`, {
    headers: {
      Upgrade: "websocket",
      ...(protocols ? { "Sec-WebSocket-Protocol": protocols } : {}),
      ...headers,
    },
  });
}

async function setup() {
  const project = await createProject("Board");
  const other = await createProject("Altro");
  const manager = await createUser({
    email: "manager@example.com",
    password: "password-123",
    role: "manager",
    projectIds: [project.id],
  });
  return {
    project,
    other,
    token: await signAccessToken(env, { sub: manager.id, email: manager.email }),
  };
}

describe("matchRealtimePath", () => {
  it("riconosce solo /realtime/projects/:id", () => {
    expect(matchRealtimePath("/realtime/projects/abc")).toBe("abc");
    expect(matchRealtimePath("/realtime/projects/abc/x")).toBeNull();
    expect(matchRealtimePath("/projects/abc")).toBeNull();
  });
});

describe("handleRealtimeUpgrade", () => {
  it("senza Upgrade: websocket risponde 426", async () => {
    const { project, token } = await setup();
    const { namespace, calls } = fakeNamespace();
    const req = new Request(`https://api.example.com/realtime/projects/${project.id}`, {
      headers: { "Sec-WebSocket-Protocol": `${REALTIME_PROTOCOL}, ${token}` },
    });
    const res = await handleRealtimeUpgrade(req, { ...env, PROJECT_REALTIME: namespace }, project.id);
    expect(res.status).toBe(426);
    expect(calls).toHaveLength(0);
  });

  it("senza token o con token non valido risponde 401", async () => {
    const { project } = await setup();
    const { namespace, calls } = fakeNamespace();
    const e = { ...env, PROJECT_REALTIME: namespace };
    expect((await handleRealtimeUpgrade(upgrade(project.id), e, project.id)).status).toBe(401);
    expect((await handleRealtimeUpgrade(upgrade(project.id, REALTIME_PROTOCOL), e, project.id)).status).toBe(401);
    expect(
      (await handleRealtimeUpgrade(upgrade(project.id, `${REALTIME_PROTOCOL}, non-un-jwt`), e, project.id)).status,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("un manager su un progetto non suo riceve 403", async () => {
    const { other, token } = await setup();
    const { namespace, calls } = fakeNamespace();
    const res = await handleRealtimeUpgrade(
      upgrade(other.id, `${REALTIME_PROTOCOL}, ${token}`),
      { ...env, PROJECT_REALTIME: namespace },
      other.id,
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("inoltra al DO del progetto senza passargli il token", async () => {
    const { project, token } = await setup();
    const { namespace, calls } = fakeNamespace();
    const res = await handleRealtimeUpgrade(
      upgrade(project.id, `${REALTIME_PROTOCOL}, ${token}`),
      { ...env, PROJECT_REALTIME: namespace },
      project.id,
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({ name: project.id, method: "GET", protocol: REALTIME_PROTOCOL }),
    ]);
  });

  it("senza binding PROJECT_REALTIME risponde 503", async () => {
    const { project, token } = await setup();
    const res = await handleRealtimeUpgrade(upgrade(project.id, `${REALTIME_PROTOCOL}, ${token}`), env, project.id);
    expect(res.status).toBe(503);
  });
});

describe("pubblicazione degli avvisi", () => {
  let published: BoardChangeMessage[] = [];
  beforeEach(() => {
    published = [];
    setRealtimePublisher((m) => published.push(m));
  });
  afterEach(() => setRealtimePublisher(null));

  it("creazione, cambio di stato e riordino pubblicano un avviso senza dati del task", async () => {
    const project = await createProject("Board");
    const task = await createTask(project.id, { title: "Segreto" } as any, { type: "mcp" });
    await moveTask(task.id, "in_progress", undefined, { type: "mcp" });
    await moveTask(task.id, "in_progress", 0, { type: "mcp" });

    expect(published.map((m) => m.event)).toEqual(["task.created", "task.status_changed", "task.reordered"]);
    for (const m of published) {
      expect(m).toEqual({ type: "board.changed", projectId: project.id, taskId: task.id, event: m.event, actorType: "mcp" });
    }
    expect(JSON.stringify(published)).not.toContain("Segreto");
  });

  it("un publisher che lancia non fa fallire l'azione", async () => {
    setRealtimePublisher(() => {
      throw new Error("DO irraggiungibile");
    });
    const project = await createProject("Board");
    await expect(createTask(project.id, { title: "Ok" } as any)).resolves.toMatchObject({ title: "Ok" });
  });

  it("sendToProjectRealtime invia l'avviso al DO del progetto", async () => {
    const { namespace, calls } = fakeNamespace();
    const msg: BoardChangeMessage = {
      type: "board.changed",
      projectId: "p1",
      taskId: "t1",
      event: "task.updated",
      actorType: "user",
    };
    await sendToProjectRealtime(namespace, msg);
    expect(calls).toEqual([
      expect.objectContaining({ name: "p1", method: "POST", url: "https://realtime.internal/publish", body: JSON.stringify(msg) }),
    ]);
  });
});
