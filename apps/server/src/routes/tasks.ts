import type { FastifyInstance } from "fastify";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  createSubtask,
  listSubtasks,
  moveTask,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
} from "../services/taskService.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { status, priority, tag, search, includeSubtasks } = req.query as Record<string, string | undefined>;
    return listTasks(projectId, {
      status: status as any,
      priority: priority as any,
      tag,
      search,
      includeSubtasks: includeSubtasks === "true",
    });
  });

  app.post("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = (req.body ?? {}) as any;
    const task = await createTask(projectId, body);
    return reply.code(201).send(task);
  });

  app.get("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return getTask(taskId);
  });

  app.patch("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const body = (req.body ?? {}) as any;
    return updateTask(taskId, body);
  });

  app.delete("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return deleteTask(taskId);
  });

  app.post("/tasks/:taskId/move", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const { status, position } = (req.body ?? {}) as { status: "draft" | "in_progress" | "done"; position?: number };
    return moveTask(taskId, status, position);
  });

  // --- Subtask -------------------------------------------------------------

  app.post("/tasks/:taskId/subtasks", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const body = (req.body ?? {}) as any;
    const subtask = await createSubtask(taskId, body);
    return reply.code(201).send(subtask);
  });

  app.get("/tasks/:taskId/subtasks", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return listSubtasks(taskId);
  });

  app.patch("/subtasks/:subtaskId", { onRequest: [app.authenticate] }, async (req) => {
    const { subtaskId } = req.params as { subtaskId: string };
    const body = (req.body ?? {}) as any;
    return updateTask(subtaskId, body);
  });

  // --- Dipendenze ------------------------------------------------------------

  app.post("/tasks/:taskId/dependencies", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const { blockedByTaskId } = (req.body ?? {}) as { blockedByTaskId: string };
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
    const { body } = (req.body ?? {}) as { body: string };
    const comment = await addComment(taskId, body);
    return reply.code(201).send(comment);
  });

  app.get("/tasks/:taskId/comments", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    return listComments(taskId);
  });
}
