import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProjectMcpServer } from "./server.js";
import { createProject, createTask, addDependency } from "../services/taskService.js";

/**
 * Test in-process dei tool MCP (T2): istanzia createProjectMcpServer(projectId)
 * e lo collega a un Client via InMemoryTransport (nessun transport
 * stdio/http reale), come suggerito dal SDK per test.
 */

function parseToolResult(result: any) {
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

async function connectClient(projectId: string) {
  const server = createProjectMcpServer(projectId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("createProjectMcpServer — tool scoping e domain errors", () => {
  let projectA: { id: string };
  let projectB: { id: string };
  let clientA: Client;
  let clientB: Client;

  beforeEach(async () => {
    projectA = await createProject("Progetto A");
    projectB = await createProject("Progetto B");
    clientA = (await connectClient(projectA.id)).client;
    clientB = (await connectClient(projectB.id)).client;
  });

  afterEach(async () => {
    await clientA.close();
    await clientB.close();
  });

  it("list_tasks/get_board restituiscono solo dati del progetto scoped dal token", async () => {
    const taskA = await createTask(projectA.id, { title: "Task A" });
    await createTask(projectB.id, { title: "Task B" });

    const listResult = await clientA.callTool({ name: "list_tasks", arguments: {} });
    const tasks = parseToolResult(listResult);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskA.id);

    const boardResult = await clientA.callTool({ name: "get_board", arguments: {} });
    const board = parseToolResult(boardResult);
    expect(board.draft.map((t: any) => t.id)).toEqual([taskA.id]);
  });

  it("create_task crea nel progetto scoped dal token", async () => {
    const result = await clientA.callTool({
      name: "create_task",
      arguments: { title: "Nuovo task" },
    });
    const task = parseToolResult(result);
    expect(task.projectId).toBe(projectA.id);
  });

  it("get_task su un task di un altro progetto restituisce FORBIDDEN", async () => {
    const taskB = await createTask(projectB.id, { title: "Task B" });

    const result = await clientA.callTool({ name: "get_task", arguments: { taskId: taskB.id } });
    expect(result.isError).toBe(true);
    const body = parseToolResult(result);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("update_task/delete_task su task di altro progetto restituiscono FORBIDDEN", async () => {
    const taskB = await createTask(projectB.id, { title: "Task B" });

    const updateResult = await clientA.callTool({
      name: "update_task",
      arguments: { taskId: taskB.id, title: "Hackerato" },
    });
    expect(updateResult.isError).toBe(true);
    expect(parseToolResult(updateResult).error.code).toBe("FORBIDDEN");

    const deleteResult = await clientA.callTool({ name: "delete_task", arguments: { taskId: taskB.id } });
    expect(deleteResult.isError).toBe(true);
    expect(parseToolResult(deleteResult).error.code).toBe("FORBIDDEN");
  });

  it("get_task su taskId inesistente restituisce NOT_FOUND", async () => {
    const result = await clientA.callTool({ name: "get_task", arguments: { taskId: "non-esiste" } });
    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error.code).toBe("NOT_FOUND");
  });

  it("move_task propaga DEPENDENCY_BLOCKED nell'envelope isError corretto", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const b = await createTask(projectA.id, { title: "B" });
    await addDependency(a.id, b.id);

    const result = await clientA.callTool({
      name: "move_task",
      arguments: { taskId: a.id, status: "in_progress" },
    });
    expect(result.isError).toBe(true);
    const body = parseToolResult(result);
    expect(body.error.code).toBe("DEPENDENCY_BLOCKED");
    expect(body.error.message).toContain("B");
  });

  it("add_dependency propaga CIRCULAR_DEPENDENCY nell'envelope isError corretto", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const b = await createTask(projectA.id, { title: "B" });
    await addDependency(a.id, b.id); // A bloccato da B

    const result = await clientA.callTool({
      name: "add_dependency",
      arguments: { taskId: b.id, blockedByTaskId: a.id },
    });
    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error.code).toBe("CIRCULAR_DEPENDENCY");
  });

  it("add_dependency con task di un altro progetto restituisce FORBIDDEN", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const bOther = await createTask(projectB.id, { title: "B other" });

    const result = await clientA.callTool({
      name: "add_dependency",
      arguments: { taskId: a.id, blockedByTaskId: bOther.id },
    });
    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error.code).toBe("FORBIDDEN");
  });

  it("add_comment/list_comments funzionano e FORBIDDEN su task di altro progetto", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const added = await clientA.callTool({ name: "add_comment", arguments: { taskId: a.id, body: "ciao" } });
    expect(parseToolResult(added).body).toBe("ciao");

    const listed = await clientA.callTool({ name: "list_comments", arguments: { taskId: a.id } });
    expect(parseToolResult(listed)).toHaveLength(1);

    const taskB = await createTask(projectB.id, { title: "B" });
    const forbidden = await clientA.callTool({ name: "add_comment", arguments: { taskId: taskB.id, body: "x" } });
    expect(forbidden.isError).toBe(true);
    expect(parseToolResult(forbidden).error.code).toBe("FORBIDDEN");
  });

  it("attach_file/list_attachments/get_attachment_url funzionano nel progetto scoped", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const contentBase64 = Buffer.from("contenuto file").toString("base64");
    const attached = await clientA.callTool({
      name: "attach_file",
      arguments: { taskId: a.id, fileName: "note.txt", mimeType: "text/plain", contentBase64 },
    });
    const attachment = parseToolResult(attached);
    expect(attachment.fileName).toBe("note.txt");

    const listed = await clientA.callTool({ name: "list_attachments", arguments: { taskId: a.id } });
    expect(parseToolResult(listed)).toHaveLength(1);

    const urlResult = await clientA.callTool({
      name: "get_attachment_url",
      arguments: { attachmentId: attachment.id },
    });
    expect(parseToolResult(urlResult).url).toContain(attachment.id);
  });

  it("get_attachment_url su allegato di altro progetto restituisce FORBIDDEN", async () => {
    const taskB = await createTask(projectB.id, { title: "B" });
    const contentBase64 = Buffer.from("x").toString("base64");
    const attached = await clientB.callTool({
      name: "attach_file",
      arguments: { taskId: taskB.id, fileName: "note.txt", mimeType: "text/plain", contentBase64 },
    });
    const attachment = parseToolResult(attached);

    const result = await clientA.callTool({ name: "get_attachment_url", arguments: { attachmentId: attachment.id } });
    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error.code).toBe("FORBIDDEN");
  });

  it("remove_dependency/list_blockers funzionano nel progetto scoped", async () => {
    const a = await createTask(projectA.id, { title: "A" });
    const b = await createTask(projectA.id, { title: "B" });
    await addDependency(a.id, b.id);

    const blockers = await clientA.callTool({ name: "list_blockers", arguments: { taskId: a.id } });
    expect(parseToolResult(blockers).blockers).toHaveLength(1);

    const removed = await clientA.callTool({
      name: "remove_dependency",
      arguments: { taskId: a.id, blockedByTaskId: b.id },
    });
    expect(parseToolResult(removed)).toEqual({ deleted: true });
  });
});
