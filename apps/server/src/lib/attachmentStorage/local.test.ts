import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalAttachmentStorage } from "./local.js";

/**
 * Test su filesystem reale, in una directory temporanea dedicata (non la
 * directory attachments/local usata dall'app), ripulita dopo ogni test.
 */
const testDir = path.resolve(process.cwd(), "test-tmp", `local-storage-${randomUUID()}`);
const localAttachmentStorage = createLocalAttachmentStorage({ baseDir: testDir });

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("localAttachmentStorage", () => {
  it("upload scrive il file su disco sotto una sottocartella per taskId", async () => {
    const result = await localAttachmentStorage.upload({
      taskId: "task-1",
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("contenuto"),
    });
    expect(result.storageBackend).toBe("local");
    expect(result.storageRef.startsWith("task-1/")).toBe(true);
    expect(existsSync(path.join(testDir, result.storageRef))).toBe(true);
  });

  it("download restituisce uno stream leggibile con il contenuto corretto", async () => {
    const uploaded = await localAttachmentStorage.upload({
      taskId: "task-2",
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });

    const stream = await localAttachmentStorage.download(uploaded.storageRef);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as any) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("delete rimuove il file dal disco", async () => {
    const uploaded = await localAttachmentStorage.upload({
      taskId: "task-3",
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    expect(existsSync(path.join(testDir, uploaded.storageRef))).toBe(true);

    await localAttachmentStorage.delete(uploaded.storageRef);
    expect(existsSync(path.join(testDir, uploaded.storageRef))).toBe(false);
  });

  it("delete su un file inesistente non lancia errore (idempotente)", async () => {
    await expect(localAttachmentStorage.delete("non-esiste/nessuno.txt")).resolves.toBeUndefined();
  });

  it("getUrl restituisce una route dedicata /mcp/attachments/:id/download con expiresAt null", async () => {
    const result = await localAttachmentStorage.getUrl("task-1/foo.txt", {
      id: "att-123",
      fileName: "foo.txt",
      mimeType: "text/plain",
    });
    expect(result.url).toContain("/mcp/attachments/att-123/download");
    expect(result.expiresAt).toBeNull();
  });

  it("sanifica i separatori di percorso nel nome file (niente / o \\ nel segmento generato)", async () => {
    const result = await localAttachmentStorage.upload({
      taskId: "task-4",
      fileName: "../../evil.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    const storedFileName = result.storageRef.slice("task-4/".length);
    expect(storedFileName).not.toMatch(/[/\\]/);
    // Il file resta comunque confinato sotto la cartella del taskId.
    expect(existsSync(path.join(testDir, result.storageRef))).toBe(true);
    expect(path.resolve(testDir, result.storageRef).startsWith(path.resolve(testDir, "task-4"))).toBe(true);
  });
});
