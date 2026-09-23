import type { R2Bucket } from "@cloudflare/workers-types";
import type { AttachmentStorage, AttachmentStorageUploadResult } from "../../lib/attachmentStorage/types.js";
import { MAX_ATTACHMENT_SIZE_BYTES } from "../../services/attachmentService.js";

/**
 * Backend allegati R2 per il Worker Cloudflare (CF7). Sostituisce sia il
 * backend locale (local.ts) sia S3/MinIO (s3.ts) sul runtime Workers.
 * Il `storageBackend` salvato sul record Attachment è `r2`; la UI/Frontend
 * non filtra su questo campo, quindi non è un breaking change visibile.
 *
 * Usa `crypto.randomUUID()` (Web Crypto, disponibile su Workers) invece di
 * `randomUUID` da node:crypto.
 */
export interface R2StorageConfig {
  bucket: R2Bucket;
  /** Base URL pubblica del Worker, usata per costruire l'URL di download. */
  mcpBaseUrl: string;
}

export function createR2AttachmentStorage(config: R2StorageConfig): AttachmentStorage {
  const { bucket, mcpBaseUrl } = config;

  return {
    async upload({ taskId, fileName, mimeType, buffer }) {
      const safeName = fileName.replace(/[/\\]/g, "_");
      const key = `${taskId}/${crypto.randomUUID()}-${safeName}`;
      await bucket.put(key, buffer, {
        httpMetadata: { contentType: mimeType || "application/octet-stream" },
      });
      return { storageBackend: "r2" as const, storageRef: key };
    },

    async download(storageRef) {
      const object = await bucket.get(storageRef);
      if (!object) throw new Error(`Object R2 non trovato: ${storageRef}`);
      return object.body;
    },

    async delete(storageRef) {
      await bucket.delete(storageRef);
    },

    // Nessun URL firmato da R2 binding (serve l'API S3 per i presigned):
    // come il backend locale, si delega alla route autenticata
    // /mcp/attachments/:id/download del Worker (CF11).
    async getUrl(_storageRef, attachment) {
      return { url: `${mcpBaseUrl}/mcp/attachments/${attachment.id}/download`, expiresAt: null };
    },
  };
}

// Re-export del limite condiviso per coerenza REST/MCP (vedi routes/allegati).
export { MAX_ATTACHMENT_SIZE_BYTES };

export type { AttachmentStorageUploadResult };