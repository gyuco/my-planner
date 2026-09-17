import type { AttachmentStorage } from "./types.js";

/**
 * Punto di accesso runtime-agnostico allo storage allegati.
 *
 * La logica di selezione del backend (DB StorageSettings + env, con i backend
 * Node local/S3) vive in `index.ts` ed è registrata qui su Node. Il Worker
 * Cloudflare (src/cf) registra invece la factory R2. In questo modo il bundle
 * del Worker non importa mai i moduli Node-only (node:fs, @aws-sdk).
 */
let factory: (() => Promise<AttachmentStorage>) | null = null;

export function setAttachmentStorageFactory(f: (() => Promise<AttachmentStorage>) | null) {
  factory = f;
}

export async function getAttachmentStorage(): Promise<AttachmentStorage> {
  if (!factory) {
    throw new Error(
      "Attachment storage non configurato: registrare una factory con setAttachmentStorageFactory() " +
        "(Node: importare lib/attachmentStorage/index.js; Worker: src/cf)."
    );
  }
  return factory();
}