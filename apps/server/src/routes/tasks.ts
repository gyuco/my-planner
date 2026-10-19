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
  createSubtasks,
  getTaskOrThrow,
} from "../services/taskService.js";
import { assertProjectAccess, assertTaskAccess } from "../services/userService.js";
import { userActor } from "../services/notificationService.js";
import {
  taskFiltersQuerySchema,
  taskInputSchema,
  taskUpdateInputSchema,
  moveTaskInputSchema,
  dependencyInputSchema,
  commentInputSchema,
  createSubtasksInputSchema,
} from "../lib/validation.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    const { status, priority, tag, search } = taskFiltersQuerySchema.parse(req.query ?? {});
    return listTasks(projectId, { status, priority, tag, search });
  });

  app.post("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    const body = taskInputSchema.parse(req.body ?? {});
    const task = await createTask(projectId, body, userActor((req as any).authUser));
    return reply.code(201).send(task);
  });

  app.get("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return getTask(taskId);
  });

  app.patch("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const body = taskUpdateInputSchema.parse(req.body ?? {});
    return updateTask(taskId, body);
  });

  app.delete("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return deleteTask(taskId);
  });

  app.post("/tasks/:taskId/subtasks", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { subtasks } = createSubtasksInputSchema.parse(req.body ?? {});
    const parent = await getTaskOrThrow(taskId);
    const created = await createSubtasks(parent.projectId, taskId, subtasks, userActor((req as any).authUser));
    return reply.code(201).send(created);
  });

  app.post("/tasks/:taskId/move", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { status, position } = moveTaskInputSchema.parse(req.body ?? {});
    return moveTask(taskId, status, position, userActor((req as any).authUser));
  });

  // --- Dipendenze ------------------------------------------------------------

  app.post("/tasks/:taskId/dependencies", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { blockedByTaskId } = dependencyInputSchema.parse(req.body ?? {});
    await assertTaskAccess((req as any).authUser, blockedByTaskId);
    const dep = await addDependency(taskId, blockedByTaskId);
    return reply.code(201).send(dep);
  });

  app.delete("/tasks/:taskId/dependencies/:blockedByTaskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId, blockedByTaskId } = req.params as { taskId: string; blockedByTaskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    await assertTaskAccess((req as any).authUser, blockedByTaskId);
    return removeDependency(taskId, blockedByTaskId);
  });

  app.get("/tasks/:taskId/blockers", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return listBlockers(taskId);
  });

  // --- Commenti ----------------------------------------------------------

  app.post("/tasks/:taskId/comments", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { body } = commentInputSchema.parse(req.body ?? {});
    const comment = await addComment(taskId, body, userActor((req as any).authUser));
    return reply.code(201).send(comment);
  });

  app.get("/tasks/:taskId/comments", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return listComments(taskId);
  });
}
