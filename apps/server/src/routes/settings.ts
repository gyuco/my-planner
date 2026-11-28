import type { FastifyInstance } from "fastify";
import {
  emailSettingsInputSchema,
  emailTestInputSchema,
  storageSettingsInputSchema,
  voiceSettingsInputSchema,
} from "../lib/validation.js";
import { getStorageSettings, updateStorageSettings } from "../services/storageSettingsService.js";
import { getEmailSettings, sendTestEmail, updateEmailSettings } from "../services/emailSettingsService.js";
import {
  createVoiceSession,
  getVoiceSettings,
  getVoiceStatus,
  testVoiceSettings,
  updateVoiceSettings,
} from "../services/voiceService.js";
import { testPretriageSettings } from "../services/pretriageService.js";

/**
 * Impostazioni globali (storage allegati, SMTP notifiche): riservate agli admin, perche'
 * valgono per tutti i progetti e tutti gli utenti.
 */
export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings/storage", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return getStorageSettings();
  });

  app.put("/settings/storage", { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const input = storageSettingsInputSchema.parse(req.body ?? {});
    return updateStorageSettings(input);
  });

  app.get("/settings/email", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return getEmailSettings();
  });

  app.put("/settings/email", { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const input = emailSettingsInputSchema.parse(req.body ?? {});
    return updateEmailSettings(input);
  });

  // Destinatario di default: l'admin che sta configurando.
  app.post("/settings/email/test", { onRequest: [app.authenticate, app.requireAdmin] }, async (req: any) => {
    const input = emailTestInputSchema.parse(req.body ?? {});
    return sendTestEmail(input.to || req.authUser.email);
  });

  app.get("/settings/voice", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return getVoiceSettings();
  });

  app.put("/settings/voice", { onRequest: [app.authenticate, app.requireAdmin] }, async (req) => {
    const input = voiceSettingsInputSchema.parse(req.body ?? {});
    return updateVoiceSettings(input);
  });

  app.post("/settings/voice/test", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return testVoiceSettings();
  });

  // Verifica del modello del pre-triage (stessa chiave, metadati: nessun costo).
  app.post("/settings/voice/pretriage-test", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return testPretriageSettings();
  });

  // Assistente vocale: solo admin (le azioni passano poi dalle normali API
  // REST, con i permessi dell'utente).
  app.get("/voice/status", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return getVoiceStatus();
  });

  app.post("/voice/session", { onRequest: [app.authenticate, app.requireAdmin] }, async () => {
    return createVoiceSession();
  });
}
