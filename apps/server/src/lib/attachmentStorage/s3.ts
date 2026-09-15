import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { AttachmentStorage } from "./types.js";

/**
 * Backend S3-compatibile (B10), configurato via S3_ENDPOINT/S3_BUCKET/
 * S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (vedi config.example.md).
 * `forcePathStyle` a true per compatibilità con MinIO e altri storage
 * S3-compatibili self-hosted.
 */

const SIGNED_URL_TTL_SECONDS = 15 * 60;

function client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET non configurato (ATTACHMENTS_BACKEND=s3 richiede S3_BUCKET)");
  return b;
}

export const s3AttachmentStorage: AttachmentStorage = {
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
