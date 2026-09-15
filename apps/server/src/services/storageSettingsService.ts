import type { StorageSettings } from "@my-planner/core";
import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";

const SINGLETON_ID = "singleton";

async function getOrCreate() {
  const existing = await prisma.storageSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.storageSettings.create({ data: { id: SINGLETON_ID } });
}

function toPublic(row: Awaited<ReturnType<typeof getOrCreate>>): StorageSettings {
  return {
    backend: row.backend as StorageSettings["backend"],
    localDir: row.localDir,
    s3Endpoint: row.s3Endpoint,
    s3Bucket: row.s3Bucket,
    s3Region: row.s3Region,
    s3AccessKeyId: row.s3AccessKeyId,
    s3SecretAccessKeySet: Boolean(row.s3SecretAccessKey),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getStorageSettings(): Promise<StorageSettings> {
  return toPublic(await getOrCreate());
}

export interface StorageSettingsInput {
  backend: "local" | "s3";
  localDir?: string;
  s3Endpoint?: string | null;
  s3Bucket?: string | null;
  s3Region?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
}

export async function updateStorageSettings(input: StorageSettingsInput): Promise<StorageSettings> {
  if (input.backend === "s3" && !input.s3Bucket?.trim()) {
    throw new ApiErrorException("VALIDATION_ERROR", "s3Bucket è obbligatorio per il backend S3/MinIO");
  }

  await getOrCreate();
  const updated = await prisma.storageSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      backend: input.backend,
      ...(input.localDir !== undefined ? { localDir: input.localDir } : {}),
      s3Endpoint: input.s3Endpoint ?? null,
      s3Bucket: input.s3Bucket ?? null,
      s3Region: input.s3Region ?? null,
      s3AccessKeyId: input.s3AccessKeyId ?? null,
      // Secret vuoto/omesso => mantiene quello già salvato.
      ...(input.s3SecretAccessKey ? { s3SecretAccessKey: input.s3SecretAccessKey } : {}),
    },
  });
  return toPublic(updated);
}

/** Config interna (con secret in chiaro) usata dal factory di attachmentStorage. */
export async function getInternalStorageSettings() {
  return getOrCreate();
}
