import type { FastifyInstance } from "fastify";
import { storageSettingsInputSchema } from "../lib/validation.js";
import { getStorageSettings, updateStorageSettings } from "../services/storageSettingsService.js";

/**
 * Impostazioni globali (storage allegati): riservate agli admin, perche'
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
}
