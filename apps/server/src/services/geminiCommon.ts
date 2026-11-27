import { ApiErrorException, type ErrorCode } from "@my-planner/core";
import { decryptSecret } from "../lib/secretBox.js";

/**
 * Pezzi comuni alle funzioni Gemini (assistente vocale e pre-triage): la
 * chiave e' una sola, salvata cifrata in VoiceSettings.apiKeyEnc. Solo
 * `fetch`, cosi' gira uguale su Node e sul Worker Cloudflare.
 */

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

/** Nome modello ammesso (senza prefisso `models/`). */
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,99}$/;

/** Decifra la chiave salvata; se non si riesce lancia `errorCode` con un messaggio chiaro. */
export async function decryptApiKey(apiKeyEnc: string, errorCode: ErrorCode): Promise<string> {
  try {
    return await decryptSecret(apiKeyEnc);
  } catch {
    throw new ApiErrorException(
      errorCode,
      "Chiave API non decifrabile (chiave di cifratura cambiata?): reinseriscila nelle impostazioni",
    );
  }
}

/** Corpo d'errore di Google ({ error: { message, status } }), se leggibile. */
export async function readProviderError(res: Response): Promise<{ message: string | null; status: string | null }> {
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } };
    return { message: data?.error?.message ?? null, status: data?.error?.status ?? null };
  } catch {
    return { message: null, status: null };
  }
}

/** Messaggio d'errore di Google o fallback con lo status HTTP. */
export async function providerError(res: Response): Promise<string> {
  const { message } = await readProviderError(res);
  return message ? `Gemini: ${message}` : `Gemini ha risposto ${res.status}`;
}

/**
 * Legge i metadati di un modello (`GET v1beta/models/{model}`): verifica
 * chiave e nome del modello senza costi di generazione.
 */
export async function fetchModelMetadata(apiKey: string, model: string, errorCode: ErrorCode): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": apiKey },
    });
  } catch (err) {
    throw new ApiErrorException(errorCode, `Gemini non raggiungibile: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new ApiErrorException(errorCode, await providerError(res));
}
