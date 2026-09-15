import type { FastifyInstance } from "fastify";
import { getBoard, getAggregatedBoard } from "../services/taskService.js";
import { boardFiltersQuerySchema, aggregatedBoardQuerySchema } from "../lib/validation.js";

export async function boardRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { priority, tag, search } = boardFiltersQuerySchema.parse(req.query ?? {});
    return getBoard(projectId, { priority, tag, search });
  });

  app.get("/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds, priority, tag, search } = aggregatedBoardQuerySchema.parse(req.query ?? {});
    return getAggregatedBoard(projectIds ? projectIds.split(",") : undefined, {
      priority,
      tag,
      search,
    });
  });
}
