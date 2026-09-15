import type { FastifyInstance } from "fastify";
import { storageSettingsInputSchema } from "../lib/validation.js";
import { getStorageSettings, updateStorageSettings } from "../services/storageSettingsService.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/settings/storage", { onRequest: [app.authenticate] }, async () => {
    return getStorageSettings();
  });

  app.put("/settings/storage", { onRequest: [app.authenticate] }, async (req) => {
    const input = storageSettingsInputSchema.parse(req.body ?? {});
    return updateStorageSettings(input);
  });
}
