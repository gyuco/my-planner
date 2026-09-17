/**
 * Interfaccia comune per lo storage allegati (B9/B10, vedi PRD sezione 4
 * "Allegati — storage pluggabile" e API_CONTRACT.md §6/§7).
 * Le implementazioni (locale/S3) vivono in questa cartella e sono
 * selezionate a runtime da `getAttachmentStorage()` (vedi index.ts),
 * in base a `ATTACHMENTS_BACKEND`.
 */
export interface AttachmentStorageUploadInput {
  taskId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface AttachmentStorageUploadResult {
  storageBackend: "local" | "s3" | "r2";
  storageRef: string;
}

export interface AttachmentUrlInfo {
  id: string;
  fileName: string;
  mimeType: string;
}

export interface AttachmentUrlResult {
  url: string;
  expiresAt: string | null;
}

export interface AttachmentStorage {
  upload(input: AttachmentStorageUploadInput): Promise<AttachmentStorageUploadResult>;
  /**
   * Ritorna il corpo dell'allegato come stream. Su runtime Node si tratta di
   * un NodeJS.ReadableStream (local.ts/s3.ts); sul Worker Cloudflare/R2
   * (r2.ts) di un web ReadableStream. Entrambi sono accettati da
   * reply.send(Fastify) e c.body(Hono).
   */
  download(storageRef: string): Promise<NodeJS.ReadableStream | ReadableStream>;
  delete(storageRef: string): Promise<void>;
  getUrl(storageRef: string, attachment: AttachmentUrlInfo): Promise<AttachmentUrlResult>;
}
