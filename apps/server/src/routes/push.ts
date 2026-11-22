import type { FastifyInstance } from "fastify";
import { pushSubscriptionInputSchema } from "../lib/validation.js";
import { getVapidPublicKey, listDevices, removeDevice, sendTestPush, subscribeDevice } from "../services/pushService.js";

/**
 * Notifiche push (API_CONTRACT.md §2bis): chiave pubblica VAPID e gestione dei
 * dispositivi dell'utente loggato. Stesse route del Worker (src/cf/rest.ts).
 */
export async function pushRoutes(app: FastifyInstance) {
  app.get("/push/public-key", { onRequest: [app.authenticate] }, async () => ({ publicKey: await getVapidPublicKey() }));

  app.get("/auth/me/push-subscriptions", { onRequest: [app.authenticate] }, async (req) => listDevices((req as any).authUser.id));

  app.post("/auth/me/push-subscriptions", { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = pushSubscriptionInputSchema.parse(req.body ?? {});
    return reply.code(201).send(await subscribeDevice((req as any).authUser.id, body));
  });

  app.post("/auth/me/push-subscriptions/test", { onRequest: [app.authenticate] }, async (req) => sendTestPush((req as any).authUser.id));

  app.delete("/auth/me/push-subscriptions/:deviceId", { onRequest: [app.authenticate] }, async (req) => {
    const { deviceId } = req.params as { deviceId: string };
    return removeDevice((req as any).authUser.id, deviceId);
  });
}
