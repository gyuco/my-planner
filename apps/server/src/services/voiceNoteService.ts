import type { Comment } from "@my-planner/core";
import { ApiErrorException } from "@my-planner/core";
import { getAiRuntime } from "../lib/workersAi.js";
import type { Actor } from "./notificationService.js";
import { WHISPER_MODEL, aiProviderError } from "./semanticService.js";
import { addComment, getTaskOrThrow } from "./taskService.js";

/**
 * Note vocali da smartphone: l'audio registrato nel browser viene trascritto
 * con Whisper (Workers AI) e salvato come commento del task, con l'attore di
 * chi l'ha registrato. L'audio non viene conservato.
 */

/** ~10 minuti di audio compresso (webm/opus, m4a): oltre si rifiuta. */
export const MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = /^(audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|wave|aac|x-m4a|m4a|flac)|video\/webm)(;.*)?$/i;
const LANGUAGE_PATTERN = /^[a-z]{2}$/;

export interface VoiceNoteResult {
  transcript: string;
  comment: Comment;
}

/** Base64 senza Buffer (gira anche su workerd), a blocchi per non saturare lo stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function transcribeVoiceNote(
  taskId: string,
  audio: { bytes: Uint8Array; mimeType: string; language?: string | null },
  actor: Actor,
): Promise<VoiceNoteResult> {
  const { ai } = getAiRuntime();
  if (!ai) throw new ApiErrorException("AI_UNAVAILABLE", "Trascrizione delle note vocali non disponibile su questa installazione");
  await getTaskOrThrow(taskId);

  if (audio.bytes.length === 0) throw new ApiErrorException("VALIDATION_ERROR", "Nota vocale vuota");
  if (audio.bytes.length > MAX_VOICE_NOTE_BYTES) {
    throw new ApiErrorException("ATTACHMENT_TOO_LARGE", "Nota vocale troppo lunga (max 10 MB)");
  }
  if (audio.mimeType && !ALLOWED_MIME.test(audio.mimeType)) {
    throw new ApiErrorException("ATTACHMENT_TYPE_NOT_ALLOWED", "Formato audio non supportato");
  }
  const language = audio.language?.toLowerCase().slice(0, 2);

  let out: unknown;
  try {
    out = await ai.run(WHISPER_MODEL, {
      audio: bytesToBase64(audio.bytes),
      task: "transcribe",
      // Senza lingua Whisper la riconosce da solo; quella dell'interfaccia
      // evita errori sulle note brevi.
      ...(language && LANGUAGE_PATTERN.test(language) ? { language } : {}),
      vad_filter: true,
    });
  } catch (err) {
    throw aiProviderError(err);
  }

  const transcript = String((out as { text?: unknown })?.text ?? "").trim();
  if (!transcript) {
    throw new ApiErrorException("VALIDATION_ERROR", "Nessuna parola riconosciuta nella nota vocale");
  }

  const comment = await addComment(taskId, `🎙️ **Nota vocale**\n\n${transcript}`, actor);
  return { transcript, comment: comment as unknown as Comment };
}
