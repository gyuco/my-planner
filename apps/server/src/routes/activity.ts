import type { FastifyInstance } from "fastify";
import { activityFiltersFromQuery, listActivity, listActivityActors } from "../services/activityService.js";
import { activityQuerySchema } from "../lib/validation.js";

/**
 * Log attivita': GET /activity con filtri e cursori (`afterId` per il
 * polling dei nuovi eventi, `beforeId` per la paginazione all'indietro).
 */
export async function activityRoutes(app: FastifyInstance) {
  app.get("/activity", { onRequest: [app.authenticate] }, async (req) => {
    const query = activityQuerySchema.parse(req.query ?? {});
    return listActivity((req as any).authUser, activityFiltersFromQuery(query));
  });

  app.get("/activity/actors", { onRequest: [app.authenticate] }, async (req) => {
    return listActivityActors((req as any).authUser);
  });
}
