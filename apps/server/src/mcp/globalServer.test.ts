import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGlobalMcpServer } from "./server.js";
import { createProject, createTask } from "../services/taskService.js";
import { createUser, updateUser } from "../services/userService.js";
import { issueUserMcpToken, listUserMcpTokens, resolveUserFromMcpToken, revokeUserMcpToken } from "./auth.js";
import { prisma } from "../lib/prisma.js";

/**
 * MCP globale (token utente da login web OAuth): un solo server per tutti i
 * progetti visibili all'utente, con le stesse regole di accesso della UI.
 */

function parse(result: any) {
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

async function connect(userId: string) {
  const server = createGlobalMcpServer(userId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function setup() {
  const projectA = await createProject("Progetto A");
  const projectB = await createProject("Progetto B");
  const admin = await createUser({ email: "admin@test.dev", password: "password-123", role: "admin" });
  const manager = await createUser({
    email: "mgr@test.dev",
    password: "password-123",
    role: "manager",
    projectIds: [projectA.id],
  });
  return { projectA, projectB, admin, manager };
}

describe("createGlobalMcpServer", () => {
  it("list_projects: admin vede tutto, manager solo i progetti assegnati", async () => {
    const { projectA, admin, manager } = await setup();

    const adminClient = await connect(admin.id);
    const adminProjects = parse(await adminClient.callTool({ name: "list_projects", arguments: {} }));
    expect(adminProjects.map((p: any) => p.name).sort()).toEqual(["Progetto A", "Progetto B"]);

    const mgrClient = await connect(manager.id);
    const mgrProjects = parse(await mgrClient.callTool({ name: "list_projects", arguments: {} }));
    expect(mgrProjects.map((p: any) => p.id)).toEqual([projectA.id]);
  });

  it("i tool di progetto richiedono projectId e verificano l'accesso", async () => {
    const { projectA, projectB, manager } = await setup();
    const taskA = await createTask(projectA.id, { title: "Task A" });
    const taskB = await createTask(projectB.id, { title: "Task B" });
    const client = await connect(manager.id);

    const listA = parse(await client.callTool({ name: "list_tasks", arguments: { projectId: projectA.id } }));
    expect(listA.map((t: any) => t.id)).toEqual([taskA.id]);

    const listB = await client.callTool({ name: "list_tasks", arguments: { projectId: projectB.id } });
    expect(listB.isError).toBe(true);
    expect(parse(listB).error.code).toBe("FORBIDDEN");

    const getB = await client.callTool({ name: "get_task", arguments: { taskId: taskB.id } });
    expect(parse(getB).error.code).toBe("FORBIDDEN");

    const created = parse(
      await client.callTool({ name: "create_task", arguments: { projectId: projectA.id, title: "Nuovo" } })
    );
    expect(created.projectId).toBe(projectA.id);

    const createB = await client.callTool({ name: "create_task", arguments: { projectId: projectB.id, title: "No" } });
    expect(parse(createB).error.code).toBe("FORBIDDEN");

    const tools = await client.listTools();
    const listTasksTool = tools.tools.find((t) => t.name === "list_tasks")!;
    expect(listTasksTool.inputSchema.required).toContain("projectId");
  });

  it("i permessi sono riletti a ogni chiamata (revoca progetto dalla UI)", async () => {
    const { projectA, projectB, manager, admin } = await setup();
    await createTask(projectA.id, { title: "Task A" });
    const client = await connect(manager.id);

    expect((await client.callTool({ name: "list_tasks", arguments: { projectId: projectA.id } })).isError).toBeFalsy();
    await updateUser(manager.id, { projectIds: [projectB.id] }, admin.id);
    const after = await client.callTool({ name: "list_tasks", arguments: { projectId: projectA.id } });
    expect(parse(after).error.code).toBe("FORBIDDEN");
  });

  it("get_aggregated_board limita ai progetti accessibili", async () => {
    const { projectA, projectB, manager, admin } = await setup();
    const taskA = await createTask(projectA.id, { title: "Task A" });
    const taskB = await createTask(projectB.id, { title: "Task B" });

    const mgr = await connect(manager.id);
    const mgrBoard = parse(await mgr.callTool({ name: "get_aggregated_board", arguments: { projectIds: [projectA.id, projectB.id] } }));
    expect(mgrBoard.draft.map((t: any) => t.id)).toEqual([taskA.id]);

    const adm = await connect(admin.id);
    const admBoard = parse(await adm.callTool({ name: "get_aggregated_board", arguments: {} }));
    expect(admBoard.draft.map((t: any) => t.id).sort()).toEqual([taskA.id, taskB.id].sort());
  });
});

describe("token MCP globali", () => {
  it("emissione, risoluzione, elenco e revoca", async () => {
    const { manager, admin } = await setup();
    const raw = await issueUserMcpToken(manager.id, "claude.ai");
    expect(raw.startsWith("mpu_")).toBe(true);
    expect(await resolveUserFromMcpToken(raw)).toBe(manager.id);

    const list = await listUserMcpTokens(manager.id);
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("claude.ai");
    expect(list[0].lastUsedAt).not.toBeNull();

    // Un utente non puo' revocare il token di un altro.
    expect(await revokeUserMcpToken(admin.id, list[0].id)).toBeNull();
    const revoked = await revokeUserMcpToken(manager.id, list[0].id);
    expect(revoked?.revokedAt).not.toBeNull();
    await expect(resolveUserFromMcpToken(raw)).rejects.toThrow();
  });

  it("i token di progetto non valgono come token globali", async () => {
    await expect(resolveUserFromMcpToken("a".repeat(64))).rejects.toThrow();
  });

  it("eliminare l'utente elimina i suoi token", async () => {
    const { manager } = await setup();
    await issueUserMcpToken(manager.id);
    await prisma.user.delete({ where: { id: manager.id } });
    expect(await prisma.userMcpToken.count()).toBe(0);
  });
});
