import type { FastifyInstance } from "fastify";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  sendBackTask,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
  createSubtasks,
  getTaskOrThrow,
  setTaskAi,
} from "../services/taskService.js";
import { assertAdmin, assertProjectAccess, assertTaskAccess, listProjectAssignees } from "../services/userService.js";
import { userActor } from "../services/notificationService.js";
import { getAiFeatures } from "../services/semanticService.js";
import { getPretriageStatus, runPretriage } from "../services/pretriageService.js";
import {
  taskFiltersQuerySchema,
  taskInputSchema,
  taskUpdateInputSchema,
  moveTaskInputSchema,
  sendBackTaskInputSchema,
  taskAiInputSchema,
  dependencyInputSchema,
  commentInputSchema,
  createSubtasksInputSchema,
} from "../lib/validation.js";

export async function taskRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/tasks", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return listTasks(projectId, taskFiltersQuerySchema.parse(req.query ?? {}));
  });

  app.get("/projects/:projectId/assignees", { onRequest: [app.authenticate] }, async (req) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess((req as any).authUser, projectId);
    return listProjectAssignees(projectId);
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

  // Gestione AI del task: solo admin (API_CONTRACT.md §4).
  app.put("/tasks/:taskId/ai", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    const user = (req as any).authUser;
    assertAdmin(user);
    await assertTaskAccess(user, taskId);
    const body = taskAiInputSchema.parse(req.body ?? {});
    return setTaskAi(taskId, body, user.id, userActor(user));
  });

  app.patch("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const body = taskUpdateInputSchema.parse(req.body ?? {});
    return updateTask(taskId, body, userActor((req as any).authUser));
  });

  app.delete("/tasks/:taskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return deleteTask(taskId, userActor((req as any).authUser));
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

  // Testing -> in_progress + riassegnazione a chi lo aveva messo in Testing + commento.
  app.post("/tasks/:taskId/send-back", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { message } = sendBackTaskInputSchema.parse(req.body ?? {});
    return sendBackTask(taskId, message, userActor((req as any).authUser));
  });

  // --- Dipendenze ------------------------------------------------------------

  app.post("/tasks/:taskId/dependencies", { onRequest: [app.authenticate] }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    const { blockedByTaskId } = dependencyInputSchema.parse(req.body ?? {});
    await assertTaskAccess((req as any).authUser, blockedByTaskId);
    const dep = await addDependency(taskId, blockedByTaskId, userActor((req as any).authUser));
    return reply.code(201).send(dep);
  });

  app.delete("/tasks/:taskId/dependencies/:blockedByTaskId", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId, blockedByTaskId } = req.params as { taskId: string; blockedByTaskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    await assertTaskAccess((req as any).authUser, blockedByTaskId);
    return removeDependency(taskId, blockedByTaskId, userActor((req as any).authUser));
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

  // --- Workers AI: su Node non ci sono binding, risponde tutto false -------
  app.get("/ai/features", { onRequest: [app.authenticate] }, async () => getAiFeatures());

  // --- Pre-triage con Gemini (tutti gli utenti con accesso al task) -------

  app.get("/pretriage/status", { onRequest: [app.authenticate] }, async () => {
    return getPretriageStatus();
  });

  // Aggiunge un commento con l'esito; non modifica i campi del task.
  app.post("/tasks/:taskId/pretriage", { onRequest: [app.authenticate] }, async (req) => {
    const { taskId } = req.params as { taskId: string };
    await assertTaskAccess((req as any).authUser, taskId);
    return runPretriage(taskId, userActor((req as any).authUser));
  });
}
