import type { VoiceSession, VoiceSettings, VoiceStatus } from "@my-planner/core";
import { ApiErrorException, DEFAULT_PRETRIAGE_MODEL, DEFAULT_VOICE_MODEL } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { encryptSecret } from "../lib/secretBox.js";
import { GEMINI_BASE_URL, MODEL_PATTERN, decryptApiKey, fetchModelMetadata, providerError } from "./geminiCommon.js";

/**
 * Assistente vocale con Gemini Live (singleton, configurato dall'admin).
 *
 * La chiave Google AI Studio e' cifrata a riposo (lib/secretBox.ts) e non
 * esce mai dalle API: per ogni conversazione il server crea un token
 * effimero monouso (`auth_tokens`, API v1alpha) con il modello bloccato, e il
 * browser apre il WebSocket Live con quello. Le azioni sui task le esegue il
 * browser con le API REST e il JWT dell'utente, quindi valgono gli stessi
 * permessi dell'interfaccia.
 *
 * Lo stesso singleton contiene anche le impostazioni del pre-triage dei task
 * (vedi pretriageService.ts), che usa la stessa chiave con un modello di testo.
 */

const SINGLETON_ID = "singleton";
const WS_BASE_URL = "wss://generativelanguage.googleapis.com";

/** Il token deve aprire la sessione entro questo tempo... */
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000;
/** ...e la sessione aperta resta valida al massimo fino a qui. */
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

const VOICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,49}$/;

export type VoiceSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.voiceSettings.findUnique>>>;

function toPublic(row: VoiceSettingsRow | null): VoiceSettings {
  if (!row) {
    return {
      enabled: false,
      configured: false,
      apiKeySet: false,
      model: DEFAULT_VOICE_MODEL,
      voiceName: null,
      pretriageEnabled: false,
      pretriageModel: DEFAULT_PRETRIAGE_MODEL,
      updatedAt: null,
    };
  }
  return {
    enabled: row.enabled,
    configured: row.enabled && Boolean(row.apiKeyEnc),
    apiKeySet: Boolean(row.apiKeyEnc),
    model: row.model,
    voiceName: row.voiceName,
    pretriageEnabled: row.pretriageEnabled,
    pretriageModel: row.pretriageModel,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Riga del singleton (null se mai configurato): la usa anche il pre-triage. */
export async function findVoiceSettingsRow() {
  return prisma.voiceSettings.findUnique({ where: { id: SINGLETON_ID } });
}

function validationError(message: string): never {
  throw new ApiErrorException("VALIDATION_ERROR", message);
}

export async function getVoiceSettings(): Promise<VoiceSettings> {
  return toPublic(await findVoiceSettingsRow());
}

/** Solo admin: mostra o nasconde il pulsante microfono. */
export async function getVoiceStatus(): Promise<VoiceStatus> {
  return { available: toPublic(await findVoiceSettingsRow()).configured };
}

export interface VoiceSettingsInput {
  enabled: boolean;
  apiKey?: string | null;
  removeApiKey?: boolean;
  model?: string;
  voiceName?: string | null;
  /** Omesso = invariato. */
  pretriageEnabled?: boolean;
  /** Omesso = invariato; vuoto = default. */
  pretriageModel?: string;
}

function normalizeModel(model: string | undefined, fallback: string): string {
  return (model?.trim() || fallback).replace(/^models\//, "");
}

export async function updateVoiceSettings(input: VoiceSettingsInput): Promise<VoiceSettings> {
  const model = normalizeModel(input.model, DEFAULT_VOICE_MODEL);
  const voiceName = input.voiceName?.trim() || null;
  const apiKey = input.apiKey?.trim() || null;

  if (!MODEL_PATTERN.test(model)) validationError("Nome del modello non valido");
  if (voiceName && !VOICE_NAME_PATTERN.test(voiceName)) validationError("Nome della voce non valido");
  if (apiKey && !/^[\x21-\x7e]{20,500}$/.test(apiKey)) validationError("Chiave API non valida");

  const existing = await findVoiceSettingsRow();
  const pretriageEnabled = input.pretriageEnabled ?? existing?.pretriageEnabled ?? false;
  const pretriageModel =
    input.pretriageModel === undefined
      ? (existing?.pretriageModel ?? DEFAULT_PRETRIAGE_MODEL)
      : normalizeModel(input.pretriageModel, DEFAULT_PRETRIAGE_MODEL);
  if (!MODEL_PATTERN.test(pretriageModel)) validationError("Nome del modello del pre-triage non valido");

  // Chiave: nuova => cifrata; vuota/omessa => invariata; removeApiKey => cancellata.
  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  if (input.removeApiKey) apiKeyEnc = null;
  if (apiKey) apiKeyEnc = await encryptSecret(apiKey);

  // Assistente vocale e pre-triage sono indipendenti: ognuno richiede solo la chiave.
  if (input.enabled && !apiKeyEnc) validationError("Inserisci la chiave API per attivare l'assistente vocale");
  if (pretriageEnabled && !apiKeyEnc) validationError("Inserisci la chiave API per attivare il pre-triage");

  const data = { enabled: input.enabled, apiKeyEnc, model, voiceName, pretriageEnabled, pretriageModel };
  const row = await prisma.voiceSettings.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
  return toPublic(row);
}

/**
 * Verifica chiave e modello salvati (anche se l'assistente non e' ancora
 * attivo) leggendo i metadati del modello: nessun costo di generazione.
 */
export async function testVoiceSettings(): Promise<{ ok: true; model: string }> {
  const row = await findVoiceSettingsRow();
  if (!row?.apiKeyEnc) validationError("Salva prima la chiave API");
  const apiKey = await decryptApiKey(row.apiKeyEnc, "VOICE_UNAVAILABLE");
  await fetchModelMetadata(apiKey, row.model, "VOICE_PROVIDER_ERROR");
  return { ok: true, model: row.model };
}

/**
 * Token effimero per una conversazione: monouso, va usato entro
 * NEW_SESSION_WINDOW_MS e il modello e' bloccato (fieldMask "model"), cosi'
 * anche se intercettato non serve ad altro.
 */
export async function createVoiceSession(now = new Date()): Promise<VoiceSession> {
  const row = await findVoiceSettingsRow();
  if (!row || !row.enabled || !row.apiKeyEnc) {
    throw new ApiErrorException("VOICE_UNAVAILABLE", "Assistente vocale non configurato");
  }
  const apiKey = await decryptApiKey(row.apiKeyEnc, "VOICE_UNAVAILABLE");
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
