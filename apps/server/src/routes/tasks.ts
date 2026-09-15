import type { FastifyInstance } from "fastify";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
} from "../services/taskService.js";
import {
  taskFiltersQuerySchema,
  taskInputSchema,
  taskUpdateInputSchema,
  moveTaskInputSchema,
  dependencyInputSchema,
  commentInputSchema,
} from "../lib/validation.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { status, priority, tag, search } = taskFiltersQuerySchema.parse(req.query ?? {});
    return listTasks(projectId, { status, priority, tag, search });
  });

  app.post("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = taskInputSchema.parse(req.body ?? {});
    const task = await createTask(projectId, body);
    return reply.code(201).send(task);
  });

  app.get("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return getTask(taskId);
  });

  app.patch("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const body = taskUpdateInputSchema.parse(req.body ?? {});
    return updateTask(taskId, body);
  });

  app.delete("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return deleteTask(taskId);
  });

  app.post("/tasks/:taskId/move", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const { status, position } = moveTaskInputSchema.parse(req.body ?? {});
    return moveTask(taskId, status, position);
  });

  // --- Dipendenze ------------------------------------------------------------

  app.post("/tasks/:taskId/dependencies", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const { blockedByTaskId } = dependencyInputSchema.parse(req.body ?? {});
    const dep = await addDependency(taskId, blockedByTaskId);
    return reply.code(201).send(dep);
  });

  app.delete("/tasks/:taskId/dependencies/:blockedByTaskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId, blockedByTaskId } = req.params as { taskId: string; blockedByTaskId: string };
    return removeDependency(taskId, blockedByTaskId);
  });

  app.get("/tasks/:taskId/blockers", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return listBlockers(taskId);
  });

  // --- Commenti ----------------------------------------------------------

  app.post("/tasks/:taskId/comments", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const { body } = commentInputSchema.parse(req.body ?? {});
    const comment = await addComment(taskId, body);
    return reply.code(201).send(comment);
  });

  app.get("/tasks/:taskId/comments", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return listComments(taskId);
  });
}
