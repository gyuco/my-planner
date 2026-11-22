import type { FastifyInstance } from "fastify";
import { getBoard, getAggregatedBoard, listDoneTasks } from "../services/taskService.js";
import { getProjectStats } from "../services/statsService.js";
import {
  assertProjectAccess,
  doneProjectScope,
  isAdmin,
  listProjectsForUser,
  restrictProjectIds,
} from "../services/userService.js";
import {
  boardFiltersQuerySchema,
  aggregatedBoardQuerySchema,
  doneTasksQuerySchema,
  projectStatsQuerySchema,
} from "../lib/validation.js";

export async function boardRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return getBoard(projectId, boardFiltersQuerySchema.parse(req.query ?? {}));
  });

  app.get("/projects/:projectId/stats", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return getProjectStats(projectId, projectStatsQuerySchema.parse(req.query ?? {}));
  });

  app.get("/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds, ...filters } = aggregatedBoardQuerySchema.parse(req.query ?? {});
    const user = (req as any).authUser;
    let allowed = restrictProjectIds(user, projectIds ? projectIds.split(",") : undefined);

    // La board aggregata mostra solo progetti attivi: per il manager
    // intersechiamo i projectId consentiti con quelli non archiviati.
    if (!isAdmin(user)) {
      const active = new Set((await listProjectsForUser(user, false)).map((p) => p.id));
      allowed = (allowed ?? []).filter((id) => active.has(id));
    }

    return getAggregatedBoard(allowed, filters);
  });

  app.get("/tasks/done", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds, ...query } = doneTasksQuerySchema.parse(req.query ?? {});
    const allowed = await doneProjectScope((req as any).authUser, projectIds);
    return listDoneTasks({ ...query, projectIds: allowed });
  });
}

