import type { VoiceSession, VoiceSettings, VoiceStatus } from "@my-planner/core";
import { ApiErrorException, DEFAULT_VOICE_MODEL } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";

/**
 * Assistente vocale con Gemini Live (singleton, configurato dall'admin).
 *
 * La chiave Google AI Studio e' cifrata a riposo (lib/secretBox.ts) e non
 * esce mai dalle API: per ogni conversazione il server crea un token
 * effimero monouso (`auth_tokens`, API v1alpha) con il modello bloccato, e il
 * browser apre il WebSocket Live con quello. Le azioni sui task le esegue il
 * browser con le API REST e il JWT dell'utente, quindi valgono gli stessi
 * permessi dell'interfaccia.
 */

const SINGLETON_ID = "singleton";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const WS_BASE_URL = "wss://generativelanguage.googleapis.com";

/** Il token deve aprire la sessione entro questo tempo... */
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000;
/** ...e la sessione aperta resta valida al massimo fino a qui. */
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{1,99}$/;
const VOICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,49}$/;

type VoiceSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.voiceSettings.findUnique>>>;

function toPublic(row: VoiceSettingsRow | null): VoiceSettings {
  if (!row) {
    return {
      enabled: false,
      configured: false,
      apiKeySet: false,
      model: DEFAULT_VOICE_MODEL,
      voiceName: null,
      updatedAt: null,
    };
  }
  return {
    enabled: row.enabled,
    configured: row.enabled && Boolean(row.apiKeyEnc),
    apiKeySet: Boolean(row.apiKeyEnc),
    model: row.model,
    voiceName: row.voiceName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findRow() {
  return prisma.voiceSettings.findUnique({ where: { id: SINGLETON_ID } });
}

function validationError(message: string): never {
  throw new ApiErrorException("VALIDATION_ERROR", message);
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  return toPublic(await findRow());
}

/** Solo admin: mostra o nasconde il pulsante microfono. */
export async function getVoiceStatus(): Promise<VoiceStatus> {
  return { available: toPublic(await findRow()).configured };
}

export interface VoiceSettingsInput {
  enabled: boolean;
  apiKey?: string | null;
  removeApiKey?: boolean;
  model?: string;
  voiceName?: string | null;
}

export async function updateVoiceSettings(input: VoiceSettingsInput): Promise<VoiceSettings> {
  const model = (input.model?.trim() || DEFAULT_VOICE_MODEL).replace(/^models\//, "");
  const voiceName = input.voiceName?.trim() || null;
  const apiKey = input.apiKey?.trim() || null;

  if (!MODEL_PATTERN.test(model)) validationError("Nome del modello non valido");
  if (voiceName && !VOICE_NAME_PATTERN.test(voiceName)) validationError("Nome della voce non valido");
  if (apiKey && !/^[\x21-\x7e]{20,500}$/.test(apiKey)) validationError("Chiave API non valida");

  const existing = await findRow();

  // Chiave: nuova => cifrata; vuota/omessa => invariata; removeApiKey => cancellata.
  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  if (input.removeApiKey) apiKeyEnc = null;
  if (apiKey) apiKeyEnc = await encryptSecret(apiKey);

  if (input.enabled && !apiKeyEnc) validationError("Inserisci la chiave API per attivare l'assistente vocale");

  const data = { enabled: input.enabled, apiKeyEnc, model, voiceName };
  const row = await prisma.voiceSettings.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
  return toPublic(row);
}

async function decryptApiKey(row: VoiceSettingsRow): Promise<string> {
  try {
    return await decryptSecret(row.apiKeyEnc!);
  } catch {
    throw new ApiErrorException(
      "VOICE_UNAVAILABLE",
      "Chiave API non decifrabile (chiave di cifratura cambiata?): reinseriscila nelle impostazioni",
    );
  }
}

/** Messaggio d'errore di Google ({ error: { message } }) o fallback con lo status. */
async function providerError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    if (data?.error?.message) return `Gemini: ${data.error.message}`;
  } catch {
    /* corpo non JSON */
  }
  return `Gemini ha risposto ${res.status}`;
}

/**
 * Verifica chiave e modello salvati (anche se l'assistente non e' ancora
 * attivo) leggendo i metadati del modello: nessun costo di generazione.
 */
export async function testVoiceSettings(): Promise<{ ok: true; model: string }> {
  const row = await findRow();
  if (!row?.apiKeyEnc) validationError("Salva prima la chiave API");
  const apiKey = await decryptApiKey(row);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(row.model)}`, {
      headers: { "x-goog-api-key": apiKey },
    });
  } catch (err) {
    throw new ApiErrorException("VOICE_PROVIDER_ERROR", `Gemini non raggiungibile: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new ApiErrorException("VOICE_PROVIDER_ERROR", await providerError(res));
  return { ok: true, model: row.model };
}

/**
 * Token effimero per una conversazione: monouso, va usato entro
 * NEW_SESSION_WINDOW_MS e il modello e' bloccato (fieldMask "model"), cosi'
 * anche se intercettato non serve ad altro.
 */
export async function createVoiceSession(now = new Date()): Promise<VoiceSession> {
  const row = await findRow();
  if (!row || !row.enabled || !row.apiKeyEnc) {
    throw new ApiErrorException("VOICE_UNAVAILABLE", "Assistente vocale non configurato");
  }
  const apiKey = await decryptApiKey(row);
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString();

  let res: Response;
  try {
    res = await fetch(`${GEMINI_BASE_URL}/v1alpha/auth_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(now.getTime() + NEW_SESSION_WINDOW_MS).toISOString(),
        bidiGenerateContentSetup: { model: `models/${row.model}` },
        fieldMask: "model",
      }),
    });
  } catch (err) {
    throw new ApiErrorException("VOICE_PROVIDER_ERROR", `Gemini non raggiungibile: ${err instanceof Error ? err.message : err}`);
  }
  if (!res.ok) throw new ApiErrorException("VOICE_PROVIDER_ERROR", await providerError(res));

  const data = (await res.json()) as { name?: string };
  if (!data.name) throw new ApiErrorException("VOICE_PROVIDER_ERROR", "Gemini non ha restituito il token");

  return {
    token: data.name,
    wsUrl:
      `${WS_BASE_URL}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained` +
      `?access_token=${encodeURIComponent(data.name)}`,
    model: row.model,
    voiceName: row.voiceName,
    expiresAt,
  };
}
