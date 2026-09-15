import type { AttachmentStorage } from "./types.js";
import { createLocalAttachmentStorage } from "./local.js";
import { createS3AttachmentStorage } from "./s3.js";
import { getInternalStorageSettings } from "../../services/storageSettingsService.js";

export type {
  AttachmentStorage,
  AttachmentStorageUploadInput,
  AttachmentStorageUploadResult,
  AttachmentUrlInfo,
  AttachmentUrlResult,
} from "./types.js";

/**
 * Selezione del backend allegati: la config persistita in DB
 * (StorageSettings, modificabile da UI) ha priorità; se il DB non è stato
 * ancora popolato si ricade sulle variabili d'ambiente storiche
 * (ATTACHMENTS_BACKEND / S3_*, vedi config.example.md).
 */
export async function getAttachmentStorage(): Promise<AttachmentStorage> {
  const settings = await getInternalStorageSettings();
  const backend = settings.backend.toLowerCase();

  if (backend === "s3") {
    return createS3AttachmentStorage({
      endpoint: settings.s3Endpoint || process.env.S3_ENDPOINT || undefined,
      region: settings.s3Region || process.env.S3_REGION || "us-east-1",
      bucket: settings.s3Bucket || process.env.S3_BUCKET || "",
      accessKeyId: settings.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: settings.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY || "",
    });
  }

  return createLocalAttachmentStorage({
    baseDir: settings.localDir || process.env.ATTACHMENTS_LOCAL_DIR || "./attachments/local",
  });
}
