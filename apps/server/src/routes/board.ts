import type { FastifyInstance } from "fastify";
import { getBoard, getAggregatedBoard } from "../services/taskService.js";
import {
  assertProjectAccess,
  isAdmin,
  listProjectsForUser,
  restrictProjectIds,
} from "../services/userService.js";
import { boardFiltersQuerySchema, aggregatedBoardQuerySchema } from "../lib/validation.js";

export async function boardRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    const { priority, tag, search } = boardFiltersQuerySchema.parse(req.query ?? {});
    return getBoard(projectId, { priority, tag, search });
  });

  app.get("/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds, priority, tag, search } = aggregatedBoardQuerySchema.parse(req.query ?? {});
    const user = (req as any).authUser;
    let allowed = restrictProjectIds(user, projectIds ? projectIds.split(",") : undefined);

    // La board aggregata mostra solo progetti attivi: per il manager
    // intersechiamo i projectId consentiti con quelli non archiviati.
    if (!isAdmin(user)) {
      const active = new Set((await listProjectsForUser(user, false)).map((p) => p.id));
      allowed = (allowed ?? []).filter((id) => active.has(id));
    }

    return getAggregatedBoard(allowed, { priority, tag, search });
  });
}
