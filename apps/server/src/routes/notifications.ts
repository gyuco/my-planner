import type { FastifyInstance } from "fastify";
import { listNotifications, markNotificationsRead } from "../services/notificationService.js";
import { markNotificationsReadInputSchema, notificationsQuerySchema } from "../lib/validation.js";

/**
 * Notifiche in-app: GET fa anche da polling (unreadCount + eventi non letti),
 * POST /read sposta il cursore unico dell'utente.
 */
export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", { onRequest: [app.authenticate] }, async (req) => {
    const { limit } = notificationsQuerySchema.parse(req.query ?? {});
    return listNotifications((req as any).authUser, limit ?? 30);
  });

  app.post("/notifications/read", { onRequest: [app.authenticate] }, async (req) => {
    const { upTo } = markNotificationsReadInputSchema.parse(req.body ?? {});
    return markNotificationsRead((req as any).authUser, upTo);
  });
}
