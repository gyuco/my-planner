import type { AttachmentStorage } from "./types.js";
import { localAttachmentStorage } from "./local.js";
import { s3AttachmentStorage } from "./s3.js";

export type {
  AttachmentStorage,
  AttachmentStorageUploadInput,
  AttachmentStorageUploadResult,
  AttachmentUrlInfo,
  AttachmentUrlResult,
} from "./types.js";

/**
 * Selezione del backend allegati via `ATTACHMENTS_BACKEND` (local|s3),
 * vedi config.example.md e PRD sezione 4/6.
 */
export function getAttachmentStorage(): AttachmentStorage {
  const backend = (process.env.ATTACHMENTS_BACKEND ?? "local").toLowerCase();
  if (backend === "s3") return s3AttachmentStorage;
  return localAttachmentStorage;
}
