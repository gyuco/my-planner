import type { FastifyInstance } from "fastify";
import { getBoard, getAggregatedBoard, moveTask } from "../services/taskService.js";

export async function boardRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    return getBoard(projectId);
  });

  app.get("/board", { onRequest: [app.authenticate] }, async (req) => {
    const { projectIds } = req.query as { projectIds?: string };
    return getAggregatedBoard(projectIds ? projectIds.split(",") : undefined);
  });

  app.patch("/tasks/:taskId/status", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const { status } = req.body as { status: "draft" | "in_progress" | "done" };
    try {
      return await moveTask(taskId, status);
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });
}
