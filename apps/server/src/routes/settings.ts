import type { FastifyInstance } from "fastify";
import { emailSettingsInputSchema, emailTestInputSchema, storageSettingsInputSchema } from "../lib/validation.js";
import { getStorageSettings, updateStorageSettings } from "../services/storageSettingsService.js";
import { getEmailSettings, sendTestEmail, updateEmailSettings } from "../services/emailSettingsService.js";

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
}
