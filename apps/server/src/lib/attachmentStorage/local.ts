import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AttachmentStorage } from "./types.js";

/**
 * Backend filesystem locale (B9). Scrive sotto la directory configurata
 * (StorageSettings.localDir, fallback `ATTACHMENTS_LOCAL_DIR` /
 * `./attachments/local`), un sottodirectory per task per evitare collisioni
 * tra nomi file.
 */

export interface LocalAttachmentStorageConfig {
  baseDir: string;
}

function mcpBaseUrl(): string {
  return process.env.MCP_HTTP_BASE_URL ?? `http://localhost:${process.env.MCP_HTTP_PORT ?? 3100}`;
}

export function createLocalAttachmentStorage(config: LocalAttachmentStorageConfig): AttachmentStorage {
  const { baseDir } = config;
  return {
    async upload({ taskId, fileName, buffer }) {
      const dir = path.join(baseDir, taskId);
      await mkdir(dir, { recursive: true });
      const safeName = fileName.replace(/[/\\]/g, "_");
      const storedName = `${randomUUID()}-${safeName}`;
      await writeFile(path.join(dir, storedName), buffer);
      return { storageBackend: "local", storageRef: path.posix.join(taskId, storedName) };
    },

    async download(storageRef) {
      return createReadStream(path.join(baseDir, storageRef));
    },

    async delete(storageRef) {
      try {
        await unlink(path.join(baseDir, storageRef));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },

    // Per il backend locale non esiste un URL firmato: il download avviene
    // via route dedicata autenticata (REST: JWT, MCP: token di progetto —
    // vedi API_CONTRACT.md §7 get_attachment_url).
    async getUrl(_storageRef, attachment) {
      return { url: `${mcpBaseUrl()}/mcp/attachments/${attachment.id}/download`, expiresAt: null };
    },
  };
}

export const localAttachmentStorage = createLocalAttachmentStorage({
  baseDir: process.env.ATTACHMENTS_LOCAL_DIR ?? "./attachments/local",
});
