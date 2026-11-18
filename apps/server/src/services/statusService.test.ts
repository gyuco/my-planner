import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProjectMcpServer } from "../mcp/server.js";
import { createProject, createTask, getBoard, getTask, listTasks, moveTask } from "./taskService.js";
import {
  createProjectStatus,
  deleteProjectStatus,
  listProjectStatuses,
  renameProjectStatus,
  resolveStatus,
} from "./statusService.js";

function parseToolResult(result: any) {
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

async function connectClient(projectId: string) {
  const server = createProjectMcpServer(projectId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("statusService — stati personalizzati", () => {
  it("elenca i 5 stati di base quando il progetto non ha stati personalizzati", async () => {
    const project = await createProject("P");
    const statuses = await listProjectStatuses(project.id);
    expect(statuses.map((s) => s.key)).toEqual(["draft", "todo", "in_progress", "testing", "done"]);
    expect(statuses.every((s) => s.builtIn)).toBe(true);
  });

  it("crea uno stato con chiave derivata dal nome, tra in_progress e testing", async () => {
    const project = await createProject("P");
    const created = await createProjectStatus(project.id, "Pendiente Email");
    expect(created).toEqual({ key: "pendiente-email", label: "Pendiente Email", builtIn: false });
    await createProjectStatus(project.id, "Bloqueante");

    const keys = (await listProjectStatuses(project.id)).map((s) => s.key);
    expect(keys).toEqual(["draft", "todo", "in_progress", "pendiente-email", "bloqueante", "testing", "done"]);
  });

  it("rifiuta nomi duplicati, uguali a uno stato di base o senza caratteri validi", async () => {
    const project = await createProject("P");
    await createProjectStatus(project.id, "Bloqueante");
    await expect(createProjectStatus(project.id, "bloqueante")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createProjectStatus(project.id, "todo")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createProjectStatus(project.id, "!!!")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createProjectStatus(project.id, "   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("gli stati sono per progetto", async () => {
    const a = await createProject("A");
    const b = await createProject("B");
    await createProjectStatus(a.id, "Bloqueante");
    expect((await listProjectStatuses(b.id)).map((s) => s.key)).not.toContain("bloqueante");
    await expect(resolveStatus(b.id, "bloqueante")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rinomina cambia solo l'etichetta: i task restano nello stato", async () => {
    const project = await createProject("P");
    const status = await createProjectStatus(project.id, "Bloqueante");
    const task = await createTask(project.id, { title: "Bug" });
    await moveTask(task.id, status.key);

    const renamed = await renameProjectStatus(project.id, status.key, "Bloccante");
    expect(renamed).toEqual({ key: "bloqueante", label: "Bloccante", builtIn: false });
    expect((await getTask(task.id)).status).toBe("bloqueante");
    // Il nuovo nome si puo' usare al posto della chiave.
    expect(await resolveStatus(project.id, "bloccante")).toBe("bloqueante");
  });

  it("gli stati di base non si rinominano ne' cancellano", async () => {
    const project = await createProject("P");
    await expect(renameProjectStatus(project.id, "todo", "Da fare")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(deleteProjectStatus(project.id, "done")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("cancella uno stato solo se nessun task lo usa", async () => {
    const project = await createProject("P");
    const status = await createProjectStatus(project.id, "Bloqueante");
    const task = await createTask(project.id, { title: "Bug" });
    await moveTask(task.id, status.key);
    await expect(deleteProjectStatus(project.id, status.key)).rejects.toMatchObject({ code: "CONFLICT" });

    await moveTask(task.id, "todo");
    await expect(deleteProjectStatus(project.id, status.key)).resolves.toEqual({ key: "bloqueante", deleted: true });
    expect((await listProjectStatuses(project.id)).map((s) => s.key)).not.toContain("bloqueante");
  });

  it("la board ha una colonna per ogni stato personalizzato e moveTask rifiuta stati sconosciuti", async () => {
    const project = await createProject("P");
    await createProjectStatus(project.id, "Bloqueante");
    const task = await createTask(project.id, { title: "Bug" });
    await moveTask(task.id, "Bloqueante"); // per nome

    const board = await getBoard(project.id);
    expect(Object.keys(board)).toEqual(["draft", "todo", "in_progress", "bloqueante", "testing", "done"]);
    expect(board.bloqueante.map((t: any) => t.id)).toEqual([task.id]);
    expect((await listTasks(project.id, { status: "bloqueante" })).map((t) => t.id)).toEqual([task.id]);

    await expect(moveTask(task.id, "inesistente")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("MCP — stati personalizzati", () => {
  it("list_statuses, move_task, update_task e list_tasks accettano gli stati personalizzati", async () => {
    const project = await createProject("P");
    await createProjectStatus(project.id, "Pendiente email");
    const task = await createTask(project.id, { title: "Bug" });
    const client = await connectClient(project.id);

    const statuses = parseToolResult(await client.callTool({ name: "list_statuses", arguments: {} }));
    expect(statuses.map((s: any) => s.key)).toContain("pendiente-email");

    const moved = parseToolResult(
      await client.callTool({ name: "move_task", arguments: { taskId: task.id, status: "pendiente-email" } })
    );
    expect(moved.status).toBe("pendiente-email");

    const listed = parseToolResult(
      await client.callTool({ name: "list_tasks", arguments: { status: "pendiente-email" } })
    );
    expect(listed.map((t: any) => t.id)).toEqual([task.id]);

    const updated = parseToolResult(
      await client.callTool({ name: "update_task", arguments: { taskId: task.id, status: "todo", title: "Bug 2" } })
    );
    expect(updated).toMatchObject({ status: "todo", title: "Bug 2" });

    const bad = await client.callTool({ name: "update_task", arguments: { taskId: task.id, status: "nope", title: "X" } });
    expect(bad.isError).toBe(true);
    expect(parseToolResult(bad).error.code).toBe("VALIDATION_ERROR");
    // Stato non valido: nessun campo salvato a meta'.
    expect((await getTask(task.id)).title).toBe("Bug 2");

    await client.close();
  });
});
