import type { AttachmentStorage } from "./types.js";
import { createLocalAttachmentStorage } from "./local.js";
import { createS3AttachmentStorage } from "./s3.js";
import { getInternalStorageSettings } from "../../services/storageSettingsService.js";
import { setAttachmentStorageFactory } from "./provider.js";

export type {
  AttachmentStorage,
  AttachmentStorageUploadInput,
  AttachmentStorageUploadResult,
  AttachmentUrlInfo,
  AttachmentUrlResult,
} from "./types.js";

export { getAttachmentStorage, setAttachmentStorageFactory } from "./provider.js";

/**
 * Selezione del backend allegati su runtime Node: la config persistita in DB
 * (StorageSettings, modificabile da UI) ha priorità; se il DB non è stato
 * ancora popolato si ricade sulle variabili d'ambiente storiche
 * (ATTACHMENTS_BACKEND / S3_*, vedi config.example.md).
 *
 * IMPORTANTE: questo modulo è Node-only (importa local.ts/s3.ts con node:fs e
 * @aws-sdk). Il Worker Cloudflare usa il provider con la factory R2 e non deve
 * importare questo file.
 */
async function selectNodeAttachmentStorage(): Promise<AttachmentStorage> {
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

// Registra il selettore Node all'import (side effect voluto). Su Node questo
// modulo va importato dal bootstrap (src/index.ts, test/setup.ts).
setAttachmentStorageFactory(selectNodeAttachmentStorage);