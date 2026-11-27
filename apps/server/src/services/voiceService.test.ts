import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  createVoiceSession,
  getVoiceSettings,
  getVoiceStatus,
  testVoiceSettings,
  updateVoiceSettings,
} from "./voiceService.js";

/** Assistente vocale Gemini Live: chiave cifrata e token effimeri (fetch simulato). */

const API_KEY = "AIzaSyTEST-0123456789abcdefghijkl";
let calls: { url: string; init: RequestInit }[] = [];
let nextResponse: () => Response = () => Response.json({});

beforeEach(() => {
  calls = [];
  nextResponse = () => Response.json({ name: "auth_tokens/abc123" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return nextResponse();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("impostazioni assistente vocale", () => {
  it("senza configurazione e' spento con il modello di default", async () => {
    expect(await getVoiceSettings()).toMatchObject({
      enabled: false,
      configured: false,
      apiKeySet: false,
      model: "gemini-3.8-live",
    });
    expect(await getVoiceStatus()).toEqual({ available: false });
  });

  it("salva la chiave cifrata e non la restituisce mai", async () => {
    const settings = await updateVoiceSettings({ enabled: true, apiKey: API_KEY, voiceName: "Kore" });
    expect(settings).toMatchObject({ enabled: true, configured: true, apiKeySet: true, voiceName: "Kore" });
    expect(JSON.stringify(settings)).not.toContain(API_KEY);

    const row = await prisma.voiceSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.apiKeyEnc).toMatch(/^v1:/);
    expect(row.apiKeyEnc).not.toContain(API_KEY);
    expect(await getVoiceStatus()).toEqual({ available: true });
  });

  it("chiave vuota = invariata, removeApiKey la cancella", async () => {
    await updateVoiceSettings({ enabled: true, apiKey: API_KEY });
    const before = await prisma.voiceSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    await updateVoiceSettings({ enabled: true, apiKey: "", model: "models/gemini-3.8-live" });
    const after = await prisma.voiceSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(after.apiKeyEnc).toBe(before.apiKeyEnc);
    expect(after.model).toBe("gemini-3.8-live");

    const removed = await updateVoiceSettings({ enabled: false, removeApiKey: true });
    expect(removed).toMatchObject({ apiKeySet: false, configured: false });
  });

  it("non si attiva senza chiave e rifiuta modelli o voci non validi", async () => {
    await expect(updateVoiceSettings({ enabled: true })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateVoiceSettings({ enabled: false, model: "../evil" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updateVoiceSettings({ enabled: false, voiceName: "a b" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("impostazioni pre-triage (stessa chiave)", () => {
  it("default spento con il modello di testo di default", async () => {
    expect(await getVoiceSettings()).toMatchObject({
      pretriageEnabled: false,
      pretriageModel: "gemini-flash-lite-latest",
    });
  });

  it("si attiva anche con l'assistente vocale spento, purche' ci sia la chiave", async () => {
    await expect(updateVoiceSettings({ enabled: false, pretriageEnabled: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Inserisci la chiave API per attivare il pre-triage",
    });
    const settings = await updateVoiceSettings({
      enabled: false,
      apiKey: API_KEY,
      pretriageEnabled: true,
      pretriageModel: "models/gemini-2.5-flash",
    });
    expect(settings).toMatchObject({
      enabled: false,
      configured: false,
      pretriageEnabled: true,
      pretriageModel: "gemini-2.5-flash",
    });
  });

  it("campi omessi = invariati, modello vuoto = default, modello non valido rifiutato", async () => {
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY, pretriageEnabled: true, pretriageModel: "gemini-2.5-flash" });
    expect(await updateVoiceSettings({ enabled: true })).toMatchObject({
      pretriageEnabled: true,
      pretriageModel: "gemini-2.5-flash",
    });
    expect(await updateVoiceSettings({ enabled: true, pretriageModel: "" })).toMatchObject({
      pretriageModel: "gemini-flash-lite-latest",
    });
    await expect(updateVoiceSettings({ enabled: true, pretriageModel: "../evil" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("token effimero", () => {
  it("richiede l'assistente attivo", async () => {
    await expect(createVoiceSession()).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY });
    await expect(createVoiceSession()).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
  });

  it("crea un token monouso con il modello bloccato e la chiave solo in header", async () => {
    await updateVoiceSettings({ enabled: true, apiKey: API_KEY, voiceName: "Kore" });
    const now = new Date("2026-11-27T10:00:00.000Z");
    const session = await createVoiceSession(now);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1alpha/auth_tokens");
    expect(url).not.toContain(API_KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(API_KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      uses: 1,
      expireTime: "2026-11-27T10:30:00.000Z",
      newSessionExpireTime: "2026-11-27T10:02:00.000Z",
      bidiGenerateContentSetup: { model: "models/gemini-3.8-live" },
      fieldMask: "model",
    });

    expect(session).toEqual({
      token: "auth_tokens/abc123",
      wsUrl:
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fabc123",
      model: "gemini-3.8-live",
      voiceName: "Kore",
      expiresAt: "2026-11-27T10:30:00.000Z",
    });
  });

  it("riporta l'errore di Google", async () => {
    await updateVoiceSettings({ enabled: true, apiKey: API_KEY });
    nextResponse = () => Response.json({ error: { message: "API key not valid" } }, { status: 400 });
    await expect(createVoiceSession()).rejects.toMatchObject({
      code: "VOICE_PROVIDER_ERROR",
      message: "Gemini: API key not valid",
    });
  });

  it("il test legge i metadati del modello con la chiave salvata", async () => {
    await expect(testVoiceSettings()).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await updateVoiceSettings({ enabled: false, apiKey: API_KEY });
    nextResponse = () => Response.json({ name: "models/gemini-3.8-live" });
    expect(await testVoiceSettings()).toEqual({ ok: true, model: "gemini-3.8-live" });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-live");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe(API_KEY);
  });
});
