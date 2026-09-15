import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { AttachmentStorage } from "./types.js";

/**
 * Backend S3-compatibile (B10), configurato via StorageSettings (UI) con
 * fallback su S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY
 * (vedi config.example.md). `forcePathStyle` a true per compatibilità con
 * MinIO e altri storage S3-compatibili self-hosted.
 */

const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface S3AttachmentStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3AttachmentStorage(config: S3AttachmentStorageConfig): AttachmentStorage {
  function client(): S3Client {
    return new S3Client({
      endpoint: config.endpoint || undefined,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  function bucket(): string {
    if (!config.bucket) throw new Error("Bucket S3 non configurato (backend s3 richiede un bucket)");
    return config.bucket;
  }

  return {
    async upload({ taskId, fileName, mimeType, buffer }) {
      const key = `${taskId}/${randomUUID()}-${fileName}`;
      await client().send(
        new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimeType })
      );
      return { storageBackend: "s3", storageRef: key };
    },

    async download(storageRef) {
      const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: storageRef }));
      return res.Body as NodeJS.ReadableStream;
    },

    async delete(storageRef) {
      try {
        await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageRef }));
      } catch {
        // Coerente con il backend locale: la delete è best-effort, non deve
        // bloccare la cancellazione del task/allegato se l'oggetto è già assente.
      }
    },

    async getUrl(storageRef) {
      const url = await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: storageRef }), {
        expiresIn: SIGNED_URL_TTL_SECONDS,
      });
      return { url, expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString() };
    },
  };
}

export const s3AttachmentStorage = createS3AttachmentStorage({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
});
