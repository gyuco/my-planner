import type { FastifyInstance } from "fastify";
import { getBoard, getAggregatedBoard } from "../services/taskService.js";

export async function boardRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { priority, tag, search } = req.query as Record<string, string | undefined>;
    return getBoard(projectId, { priority: priority as any, tag, search });
  });

  app.get("/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds, priority, tag, search } = req.query as Record<string, string | undefined>;
    return getAggregatedBoard(projectIds ? projectIds.split(",") : undefined, {
      priority: priority as any,
      tag,
      search,
    });
  });
}
