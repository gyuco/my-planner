import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBoard, moveTask, addDependency } from "../services/taskService.js";
import { prisma } from "../lib/prisma.js";

/**
 * Crea un'istanza McpServer scoped a un singolo progetto (token-based, vedi auth.ts).
 * Tutti i tool operano solo sul progetto risolto dal token: nessuna fuga di dati
 * tra progetti diversi. Il set di tool qui è la base v1 (vedi prd.md sezione 4);
 * va esteso da `coder` seguendo l'elenco completo del PRD, sempre riusando
 * il service layer in apps/server/src/services.
 */
export function createProjectMcpServer(projectId: string) {
  const server = new McpServer({ name: "my-planner", version: "0.1.0" });

  server.tool("get_board", "Restituisce la board Kanban del progetto associato al token", {}, async () => {
    const board = await getBoard(projectId);
    return { content: [{ type: "text", text: JSON.stringify(board, null, 2) }] };
  });

  server.tool(
    "create_task",
    "Crea un task nel progetto associato al token",
    {
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      complexity: z.number().optional(),
    },
    async ({ title, description, priority, complexity }) => {
      const task = await prisma.task.create({
        data: { projectId, title, description: description ?? "", priority: priority ?? "medium", complexity },
      });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.tool(
    "move_task",
    "Sposta un task del progetto in un nuovo stato (draft | in_progress | done)",
    { taskId: z.string(), status: z.enum(["draft", "in_progress", "done"]) },
    async ({ taskId, status }) => {
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      if (task.projectId !== projectId) throw new Error("Task non appartiene al progetto del token");
      const updated = await moveTask(taskId, status);
      return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
    }
  );

  server.tool(
    "add_dependency",
    "Dichiara che taskId è bloccato da blockedByTaskId (entrambi nel progetto del token)",
    { taskId: z.string(), blockedByTaskId: z.string() },
    async ({ taskId, blockedByTaskId }) => {
      const [a, b] = await Promise.all([
        prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
        prisma.task.findUniqueOrThrow({ where: { id: blockedByTaskId } }),
      ]);
      if (a.projectId !== projectId || b.projectId !== projectId) {
        throw new Error("Entrambi i task devono appartenere al progetto del token");
      }
      const dep = await addDependency(taskId, blockedByTaskId);
      return { content: [{ type: "text", text: JSON.stringify(dep, null, 2) }] };
    }
  );

  return server;
}
