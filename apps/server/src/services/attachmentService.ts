import { ApiErrorException } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { getAttachmentStorage } from "../lib/attachmentStorage/provider.js";
import { getTaskOrThrow } from "./taskService.js";

/**
 * Service layer condiviso REST/MCP per gli allegati (B9-B11, vedi
 * API_CONTRACT.md §6/§7). Validazione dimensione/tipo qui, upload/download/
 * delete delegati al backend selezionato via `getAttachmentStorage()`.
 */

export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Estensione -> MIME accettati per quell'estensione (informativo; la
// validazione principale è su whitelist di estensione + controllo magic-byte
// per rifiutare eseguibili/script anche se rinominati).
const ALLOWED_EXTENSIONS = new Set([
  // immagini
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  // pdf
  "pdf",
  // office
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // testo/markdown
  "txt",
  "md",
  // zip
  "zip",
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "sh",
  "bat",
  "cmd",
  "msi",
  "dll",
  "apk",
  "jar",
  "com",
  "scr",
  "bin",
  "ps1",
  "vbs",
  "js",
  "mjs",
  "cjs",
  "cpl",
  "gadget",
  "app",
  "deb",
  "rpm",
]);

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

/**
 * Controllo "magic byte" minimale: rifiuta contenuti che iniziano con la
 * signature di un eseguibile Windows (MZ), ELF Linux, o uno shebang di
 * script (#!), indipendentemente dall'estensione dichiarata — copre il caso
 * "eseguibile rinominato con estensione ammessa".
 */
function hasExecutableMagic(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // MZ (PE/EXE)
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return true; // \x7fELF
  }
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) return true; // #!
  return false;
}

export function validateAttachment(fileName: string, size: number, buffer: Buffer): void {
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new ApiErrorException(
      "ATTACHMENT_TOO_LARGE",
      `Il file supera la dimensione massima consentita di 20MB (${size} byte)`
    );
  }

  const ext = getExtension(fileName);
  if (!ext || BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new ApiErrorException(
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      `Tipo di file "${ext || fileName}" non ammesso (ammessi: immagini, PDF, Office, testo/markdown, zip)`
    );
  }

  if (hasExecutableMagic(buffer)) {
    throw new ApiErrorException(
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      "Il contenuto del file sembra un eseguibile o uno script, non ammesso"
    );
  }
}

function serializeAttachment(attachment: any) {
  return { ...attachment, createdAt: new Date(attachment.createdAt).toISOString() };
}

export interface CreateAttachmentInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export async function createAttachment(taskId: string, input: CreateAttachmentInput) {
  await getTaskOrThrow(taskId);
  validateAttachment(input.fileName, input.buffer.length, input.buffer);

  const storage = await getAttachmentStorage();
  const { storageBackend, storageRef } = await storage.upload({
    taskId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    buffer: input.buffer,
  });

  const attachment = await prisma.attachment.create({
    data: {
      taskId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.buffer.length,
      storageBackend,
      storageRef,
    },
  });
  return serializeAttachment(attachment);
}

export async function listAttachments(taskId: string) {
  await getTaskOrThrow(taskId);
  const attachments = await prisma.attachment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  return attachments.map(serializeAttachment);
}

export async function getAttachmentOrThrow(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new ApiErrorException("NOT_FOUND", "Allegato non trovato");
  return attachment;
}

export async function getAttachmentForDownload(attachmentId: string) {
  const attachment = await getAttachmentOrThrow(attachmentId);
  const storage = await getAttachmentStorage();
  const stream = await storage.download(attachment.storageRef);
  return { attachment: serializeAttachment(attachment), stream };
}

export async function getAttachmentUrl(attachmentId: string) {
  const attachment = await getAttachmentOrThrow(attachmentId);
  const storage = await getAttachmentStorage();
  return storage.getUrl(attachment.storageRef, attachment);
}

export async function deleteAttachment(attachmentId: string) {
  const attachment = await getAttachmentOrThrow(attachmentId);
  const storage = await getAttachmentStorage();
  await storage.delete(attachment.storageRef).catch(() => {});
  await prisma.attachment.delete({ where: { id: attachmentId } });
  return { deleted: true as const };
}
