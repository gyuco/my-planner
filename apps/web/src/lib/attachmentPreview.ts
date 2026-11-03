import type { Attachment } from "@my-planner/core";

export type PreviewKind = "image" | "video";

// Fallback su estensione: alcuni browser inviano mimeType vuoto o generico
// (es. .mkv -> "" / application/octet-stream).
const IMAGE_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const VIDEO_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

function extension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx + 1).toLowerCase();
}

export function previewKind(attachment: Pick<Attachment, "fileName" | "mimeType">): PreviewKind | null {
  if (attachment.mimeType.startsWith("image/")) return "image";
  if (attachment.mimeType.startsWith("video/")) return "video";
  const ext = extension(attachment.fileName);
  if (ext in IMAGE_EXT) return "image";
  if (ext in VIDEO_EXT) return "video";
  return null;
}

/** MIME da usare per il Blob dell'anteprima (quello salvato, o dedotto dall'estensione). */
export function previewMimeType(attachment: Pick<Attachment, "fileName" | "mimeType">): string | undefined {
  const mime = attachment.mimeType;
  if (mime.startsWith("image/") || mime.startsWith("video/")) return mime;
  const ext = extension(attachment.fileName);
  return IMAGE_EXT[ext] ?? VIDEO_EXT[ext];
}
