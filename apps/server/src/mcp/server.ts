import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiErrorException, apiError, FIBONACCI_COMPLEXITY } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  getBoard,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  createSubtask,
  listSubtasks,
  addDependency,
  removeDependency,
  listBlockers,
  addComment,
  listComments,
} from "../services/taskService.js";

const complexitySchema = z
  .union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(5),
    z.literal(8),
    z.literal(13),
    z.literal(21),
  ])
  .nullable()
  .optional();

void FIBONACCI_COMPLEXITY; // referenziato in taskService per la validazione condivisa

/**
 * Crea un'istanza McpServer scoped a un singolo progetto (token-based, vedi auth.ts).
 * Tutti i tool operano solo sul progetto risolto dal token: nessuna fuga di dati
 * tra progetti diversi. Segue API_CONTRACT.md §7: stesso service layer di REST,
 * stesso envelope errore (isError + JSON code/message).
 */
export function createProjectMcpServer(projectId: string) {
  const server = new McpServer({ name: "my-planner", version: "0.1.0" });

  function ok(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }

  function fail(code: Parameters<typeof apiError>[0], message: string) {
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(apiError(code, message)) }] };
  }

  function withErrors<T>(fn: () => Promise<T>) {
    return fn().then(
      (data) => ok(data),
      (err) => {
        if (err instanceof ApiErrorException) return fail(err.code, err.message);
        return fail("INTERNAL_ERROR", (err as Error)?.message ?? "Errore interno");
      }
    );
  }

  async function assertTaskInProject(taskId: string) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
    if (task.projectId !== projectId) {
      throw new ApiErrorException("FORBIDDEN", "Il task non appartiene al progetto del token");
    }
    return task;
  }

  // --- Task ----------------------------------------------------------------

  server.tool(
    "list_tasks",
    "Elenca i task del progetto associato al token",
    {
      status: z.enum(["draft", "in_progress", "done"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
      includeSubtasks: z.boolean().optional().default(false),
    },
    async (input) => withErrors(() => listTasks(projectId, input))
  );

  server.tool("get_task", "Recupera un task del progetto associato al token", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return getTask(taskId);
    })
  );

  server.tool(
    "create_task",
    "Crea un task nel progetto associato al token",
    {
      title: z.string().min(1).max(300),
      description: z.string().default(""),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      complexity: complexitySchema,
      tags: z.array(z.string()).default([]),
      dueDate: z.string().datetime().nullable().optional(),
      parentTaskId: z.string().nullable().optional(),
    },
    async (input) =>
      withErrors(async () => {
        if (input.parentTaskId) await assertTaskInProject(input.parentTaskId);
        return createTask(projectId, input);
      })
  );

  server.tool(
    "update_task",
    "Aggiorna un task del progetto associato al token",
    {
      taskId: z.string(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      complexity: complexitySchema,
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
    },
    async ({ taskId, ...rest }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return updateTask(taskId, rest);
      })
  );

  server.tool("delete_task", "Elimina un task del progetto associato al token (cascade)", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return deleteTask(taskId);
    })
  );

  server.tool(
    "move_task",
    "Sposta un task del progetto in un nuovo stato (draft | in_progress | done)",
    { taskId: z.string(), status: z.enum(["draft", "in_progress", "done"]), position: z.number().int().nonnegative().optional() },
    async ({ taskId, status, position }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return moveTask(taskId, status, position);
      })
  );

  // --- Subtask ---------------------------------------------------------------

  server.tool(
    "add_subtask",
    "Crea un subtask sotto parentTaskId, nel progetto associato al token",
    {
      parentTaskId: z.string(),
      title: z.string().min(1).max(300),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      complexity: complexitySchema,
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
    },
    async ({ parentTaskId, ...rest }) =>
      withErrors(async () => {
        await assertTaskInProject(parentTaskId);
        return createSubtask(parentTaskId, rest);
      })
  );

  server.tool("list_subtasks", "Elenca i subtask diretti di parentTaskId", { parentTaskId: z.string() }, async ({ parentTaskId }) =>
    withErrors(async () => {
      await assertTaskInProject(parentTaskId);
      return listSubtasks(parentTaskId);
    })
  );

  server.tool(
    "update_subtask",
    "Aggiorna un subtask del progetto associato al token",
    {
      subtaskId: z.string(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      complexity: complexitySchema,
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
    },
    async ({ subtaskId, ...rest }) =>
      withErrors(async () => {
        await assertTaskInProject(subtaskId);
        return updateTask(subtaskId, rest);
      })
  );

  // --- Dipendenze --------------------------------------------------------

  server.tool(
    "add_dependency",
    "Dichiara che taskId e' bloccato da blockedByTaskId (entrambi nel progetto del token)",
    { taskId: z.string(), blockedByTaskId: z.string() },
    async ({ taskId, blockedByTaskId }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        await assertTaskInProject(blockedByTaskId);
        return addDependency(taskId, blockedByTaskId);
      })
  );

  server.tool(
    "remove_dependency",
    "Rimuove la dipendenza taskId <- blockedByTaskId",
    { taskId: z.string(), blockedByTaskId: z.string() },
    async ({ taskId, blockedByTaskId }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return removeDependency(taskId, blockedByTaskId);
      })
  );

  server.tool("list_blockers", "Elenca i task che bloccano taskId", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return listBlockers(taskId);
    })
  );

  // --- Commenti ------------------------------------------------------------

  server.tool(
    "add_comment",
    "Aggiunge un commento markdown a taskId",
    { taskId: z.string(), body: z.string().min(1) },
    async ({ taskId, body }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return addComment(taskId, body);
      })
  );

  server.tool("list_comments", "Elenca i commenti di taskId in ordine cronologico", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return listComments(taskId);
    })
  );

  // --- Board -----------------------------------------------------------------

  server.tool(
    "get_board",
    "Restituisce la board Kanban del progetto associato al token",
    {
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
    },
    async (filters) => withErrors(() => getBoard(projectId, filters))
  );

  return server;
}
