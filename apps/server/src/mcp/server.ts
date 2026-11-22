import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiErrorException, apiError, FIBONACCI_COMPLEXITY } from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import {
  getBoard,
  getAggregatedBoard,
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
} from "../services/taskService.js";
import { createAttachment, listAttachments, getAttachmentOrThrow, getAttachmentUrl } from "../services/attachmentService.js";
import { completeAiStep, failAiStep, listAiQueue, rejectAiStep, startAiStep } from "../services/aiService.js";
import { AI_STEPS } from "@my-planner/core";
import {
  assertProjectAccess,
  getAuthUser,
  listProjectAssignees,
  listProjectsForUser,
  restrictProjectIds,
} from "../services/userService.js";
import { listProjectStatuses, resolveStatus } from "../services/statusService.js";
import { buildTaskUrl, getAppUrl } from "../services/emailSettingsService.js";
import type { Actor } from "../services/notificationService.js";

/** Il token MCP identifica un progetto, non un utente: gli eventi non sono "miei". */
const MCP_ACTOR: Actor = { type: "mcp" };

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
 * Ambito di un server MCP: decide su quali progetti operano i tool.
 *  - "project": token di progetto, un solo progetto implicito (nessun
 *    parametro projectId nei tool);
 *  - "global": token utente (login web OAuth), tutti i progetti visibili
 *    all'utente; i tool a livello progetto richiedono `projectId`.
 * I tool che partono da un taskId/attachmentId ricavano il progetto dal task
 * e verificano l'accesso con `assertTask`.
 */
interface McpScope {
  kind: "project" | "global";
  /** Parametri aggiuntivi dei tool a livello progetto ({} o { projectId }). */
  projectShape: { projectId: z.ZodString };
  /** Progetto su cui operare a partire dall'input del tool (verificato). */
  resolveProject(input: { projectId?: string }): Promise<string>;
  /** Carica il task e verifica che sia nell'ambito; errore altrimenti. */
  assertTask(taskId: string): Promise<{ id: string; projectId: string }>;
  /** Frase usata nelle descrizioni dei tool per indicare il progetto. */
  projectRef: string;
  /** Progetti della coda AI: projectId (verificato) o tutti quelli accessibili. */
  queueProjectIds(projectId?: string): Promise<string[] | undefined>;
}

/**
 * Crea un'istanza McpServer scoped a un singolo progetto (token-based, vedi auth.ts).
 * Tutti i tool operano solo sul progetto risolto dal token: nessuna fuga di dati
 * tra progetti diversi. Segue API_CONTRACT.md §7: stesso service layer di REST,
 * stesso envelope errore (isError + JSON code/message).
 */
export function createProjectMcpServer(projectId: string) {
  return buildServer({
    kind: "project",
    // Nessun parametro projectId: il progetto e' quello del token.
    projectShape: {} as McpScope["projectShape"],
    resolveProject: async () => projectId,
    async assertTask(taskId) {
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
      if (task.projectId !== projectId) {
        throw new ApiErrorException("FORBIDDEN", "Il task non appartiene al progetto del token");
      }
      return task;
    },
    projectRef: "del progetto associato al token",
    queueProjectIds: async () => [projectId],
  });
}

/**
 * MCP globale (API_CONTRACT.md §7bis): un token per utente, ottenuto solo col
 * login web OAuth, che da' accesso a tutti i progetti visibili all'utente
 * (admin: tutti; manager: quelli assegnati). Ruolo e progetti vengono riletti
 * a ogni chiamata, quindi le modifiche fatte dalla UI valgono subito.
 */
export function createGlobalMcpServer(userId: string) {
  async function currentUser() {
    const user = await getAuthUser(userId);
    if (!user) throw new ApiErrorException("UNAUTHORIZED", "Utente del token MCP non piu' esistente");
    return user;
  }

  return buildServer(
    {
      kind: "global",
      projectShape: {
        projectId: z.string().min(1).describe("Id del progetto (vedi list_projects)"),
      },
      async resolveProject(input) {
        if (!input.projectId) throw new ApiErrorException("VALIDATION_ERROR", "projectId obbligatorio (vedi list_projects)");
        await assertProjectAccess(await currentUser(), input.projectId);
        return input.projectId;
      },
      async assertTask(taskId) {
        const task = await prisma.task.findUnique({ where: { id: taskId } });
        if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
        await assertProjectAccess(await currentUser(), task.projectId);
        return task;
      },
      projectRef: "del progetto indicato da projectId",
      async queueProjectIds(requested) {
        const user = await currentUser();
        if (requested) {
          await assertProjectAccess(user, requested);
          return [requested];
        }
        return restrictProjectIds(user, undefined);
      },
    },
    (server, { withErrors }) => {
      server.tool(
        "list_projects",
        "Elenca i progetti a cui l'utente del token ha accesso (admin: tutti; manager: quelli assegnati). " +
          "Usa l'id come projectId negli altri tool.",
        { includeArchived: z.boolean().default(false) },
        async ({ includeArchived }) =>
          withErrors(async () => {
            const projects = await listProjectsForUser(await currentUser(), includeArchived);
            return projects.map((p) => ({
              id: p.id,
              name: p.name,
              repoUrl: p.repoUrl ?? null,
              archived: p.archived,
              createdAt: p.createdAt.toISOString(),
            }));
          })
      );

      server.tool(
        "get_aggregated_board",
        "Board Kanban aggregata su piu' progetti (tutti quelli accessibili non archiviati, o quelli in projectIds). " +
          "Ogni task include `project` (id e nome). Le colonne sono gli stati di base piu' gli stati personalizzati dei progetti inclusi.",
        {
          projectIds: z.array(z.string()).optional(),
          priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
          tag: z.string().optional(),
          search: z.string().optional(),
          assigneeId: z.string().optional(),
          ownerId: z.string().optional(),
        },
        async ({ projectIds, ...filters }) =>
          withErrors(async () => {
            const allowed = restrictProjectIds(await currentUser(), projectIds);
            return getAggregatedBoard(allowed, filters);
          })
      );
    }
  );
}

type ToolHelpers = { withErrors: <T>(fn: () => Promise<T>) => Promise<ReturnType<typeof okResult> | ReturnType<typeof failResult>> };

function okResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function failResult(code: Parameters<typeof apiError>[0], message: string) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(apiError(code, message)) }] };
}

function buildServer(scope: McpScope, extraTools?: (server: McpServer, helpers: ToolHelpers) => void) {
  const server = new McpServer({ name: scope.kind === "global" ? "my-planner-global" : "my-planner", version: "0.1.0" });
  const P = scope.projectShape;
  const ref = scope.projectRef;

  function withErrors<T>(fn: () => Promise<T>) {
    return fn().then(
      (data) => okResult(data),
      (err) => {
        if (err instanceof ApiErrorException) return failResult(err.code, err.message);
        return failResult("INTERNAL_ERROR", (err as Error)?.message ?? "Errore interno");
      }
    );
  }

  const assertTaskInProject = scope.assertTask;

  extraTools?.(server, { withErrors });

  // --- Task ----------------------------------------------------------------

  server.tool(
    "list_tasks",
    `Elenca i task ${ref}`,
    {
      ...P,
      status: z.string().min(1).describe("Stato: draft | todo | in_progress | testing | done oppure uno stato personalizzato del progetto (chiave o nome, vedi list_statuses)").optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
      assigneeId: z.string().optional(),
      ownerId: z.string().optional(),
    },
    async ({ projectId: _p, ...filters }) =>
      withErrors(async () => listTasks(await scope.resolveProject({ projectId: _p }), filters))
  );

  server.tool(
    "list_assignees",
    "Elenca gli utenti a cui si possono assegnare i task del progetto (admin e membri del progetto): usa l'id come assigneeId",
    { ...P },
    async (input) => withErrors(async () => listProjectAssignees(await scope.resolveProject(input)))
  );

  server.tool(
    "get_task",
    "Recupera un task a cui il token ha accesso. Se il task ha sotto-task, la risposta include " +
      "subtaskCount/openSubtaskCount/subtaskStatusCounts e l'array subtasks (id/title/status di ciascuna); un task senza sotto-task ha " +
      "subtaskCount 0. parentId e' valorizzato solo se il task e' esso stesso una sotto-task di un altro. " +
      "Se l'URL pubblico dell'app e' configurato, la risposta include `url`: link diretto al task nella UI.",
    { taskId: z.string() },
    async ({ taskId }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        const task = await getTask(taskId);
        const appUrl = await getAppUrl();
        return appUrl ? { ...task, url: buildTaskUrl(appUrl, task.projectId, task.id) } : task;
      })
  );

  server.tool(
    "create_task",
    `Crea un task ${ref.replace(/^del /, "nel ")}. Passa parentId per creare direttamente una sotto-task di un ` +
      "task esistente (che non deve essere a sua volta una sotto-task: un solo livello di annidamento).",
    {
      ...P,
      title: z.string().min(1).max(300),
      description: z.string().default(""),
      type: z.enum(["bug", "feature", "analysis"]).default("feature"),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      complexity: complexitySchema,
      tags: z.array(z.string()).default([]),
      dueDate: z.string().datetime().nullable().optional(),
      parentId: z.string().nullable().optional(),
      assigneeId: z.string().nullable().optional(),
    },
    async ({ projectId: _p, ...input }) =>
      withErrors(async () => createTask(await scope.resolveProject({ projectId: _p }), input, MCP_ACTOR))
  );

  server.tool(
    "create_subtasks",
    "Crea in un'unica chiamata piu' sotto-task sotto parentId — usalo quando un task grande va scomposto in un " +
      "gruppo di sotto-task invece che una per una. Tutto o niente: se una riga non e' valida non viene creato nulla.",
    {
      parentId: z.string(),
      subtasks: z
        .array(
          z.object({
            title: z.string().min(1).max(300),
            description: z.string().default(""),
            type: z.enum(["bug", "feature", "analysis"]).default("feature"),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
            complexity: complexitySchema,
            tags: z.array(z.string()).default([]),
            dueDate: z.string().datetime().nullable().optional(),
            assigneeId: z.string().nullable().optional(),
          })
        )
        .min(1),
    },
    async ({ parentId, subtasks }) =>
      withErrors(async () => {
        const parent = await assertTaskInProject(parentId);
        return createSubtasks(parent.projectId, parentId, subtasks, MCP_ACTOR);
      })
  );

  server.tool(
    "update_task",
    "Aggiorna un task a cui il token ha accesso. parentId puo' essere impostato per riassegnare la task " +
      "come sotto-task di un'altra (null per staccarla e renderla di nuovo un task di primo livello). " +
      "status (opzionale) sposta il task come move_task, anche in uno stato personalizzato.",
    {
      taskId: z.string(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().optional(),
      type: z.enum(["bug", "feature", "analysis"]).optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      complexity: complexitySchema,
      tags: z.array(z.string()).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      parentId: z.string().nullable().optional(),
      assigneeId: z.string().nullable().optional(),
      status: z.string().min(1).describe("Stato: draft | todo | in_progress | testing | done oppure uno stato personalizzato del progetto (chiave o nome, vedi list_statuses)").optional(),
    },
    async ({ taskId, status, ...rest }) =>
      withErrors(async () => {
        const task = await assertTaskInProject(taskId);
        // Valida lo stato prima di salvare gli altri campi: niente update a meta'.
        if (status !== undefined) await resolveStatus(task.projectId, status);
        const hasFields = Object.values(rest).some((v) => v !== undefined);
        const updated = hasFields ? await updateTask(taskId, rest, MCP_ACTOR) : undefined;
        if (status === undefined) return updated ?? getTask(taskId);
        return moveTask(taskId, status, undefined, MCP_ACTOR);
      })
  );

  server.tool("delete_task", "Elimina un task a cui il token ha accesso (cascade)", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return deleteTask(taskId, MCP_ACTOR);
    })
  );

  server.tool(
    "move_task",
    "Sposta un task del progetto in un nuovo stato: uno di base (draft | todo | in_progress | testing | done) " +
      "oppure uno stato personalizzato del progetto, indicato per chiave o per nome (vedi list_statuses)",
    {
      taskId: z.string(),
      status: z.string().min(1).describe("Stato: draft | todo | in_progress | testing | done oppure uno stato personalizzato del progetto (chiave o nome, vedi list_statuses)"),
      position: z.number().int().nonnegative().optional(),
    },
    async ({ taskId, status, position }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return moveTask(taskId, status, position, MCP_ACTOR);
      })
  );

  // --- Dipendenze --------------------------------------------------------

  server.tool(
    "add_dependency",
    "Dichiara che taskId e' bloccato da blockedByTaskId (entrambi devono essere accessibili al token)",
    { taskId: z.string(), blockedByTaskId: z.string() },
    async ({ taskId, blockedByTaskId }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        await assertTaskInProject(blockedByTaskId);
        return addDependency(taskId, blockedByTaskId, MCP_ACTOR);
      })
  );

  server.tool(
    "remove_dependency",
    "Rimuove la dipendenza taskId <- blockedByTaskId",
    { taskId: z.string(), blockedByTaskId: z.string() },
    async ({ taskId, blockedByTaskId }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return removeDependency(taskId, blockedByTaskId, MCP_ACTOR);
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
        return addComment(taskId, body, MCP_ACTOR);
      })
  );

  server.tool("list_comments", "Elenca i commenti di taskId in ordine cronologico", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return listComments(taskId);
    })
  );

  // --- Allegati ----------------------------------------------------------

  server.tool("list_attachments", "Elenca gli allegati di taskId", { taskId: z.string() }, async ({ taskId }) =>
    withErrors(async () => {
      await assertTaskInProject(taskId);
      return listAttachments(taskId);
    })
  );

  server.tool(
    "attach_file",
    "Allega un file a taskId; il contenuto va passato come base64 inline (limite sul contenuto decodificato: 20MB, 50MB per i video mp4/m4v/mov/webm/mkv/avi)",
    {
      taskId: z.string(),
      fileName: z.string(),
      mimeType: z.string(),
      contentBase64: z.string(),
    },
    async ({ taskId, fileName, mimeType, contentBase64 }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        const buffer = Buffer.from(contentBase64, "base64");
        return createAttachment(taskId, { fileName, mimeType, buffer }, MCP_ACTOR);
      })
  );

  server.tool(
    "get_attachment_url",
    "Restituisce l'URL di download per un allegato (autenticato con lo stesso token MCP)",
    { attachmentId: z.string() },
    async ({ attachmentId }) =>
      withErrors(async () => {
        const attachment = await getAttachmentOrThrow(attachmentId);
        const task = await assertTaskInProject(attachment.taskId);
        void task;
        return getAttachmentUrl(attachmentId);
      })
  );

  // --- Board -----------------------------------------------------------------

  server.tool(
    "get_board",
    `Restituisce la board Kanban ${ref}. Ogni task` + " include subtaskCount/openSubtaskCount/subtaskStatusCounts " +
      "(0 se non ha sotto-task) cosi' da distinguere a colpo d'occhio i task singoli da quelli con un gruppo di sotto-task. " +
      "Oltre agli stati di base ha una colonna per ogni stato personalizzato del progetto (chiave dello stato).",
    {
      ...P,
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      tag: z.string().optional(),
      search: z.string().optional(),
    },
    async ({ projectId: _p, ...filters }) =>
      withErrors(async () => getBoard(await scope.resolveProject({ projectId: _p }), filters))
  );

  // --- Gestione AI (passi triage / coder / reviewer) ----------------------

  const AI_WORKFLOW =
    "Flusso dei task gestiti da AI: list_ai_tasks per la coda -> ai_start_step per prendere il task (blocco 60 min) -> " +
    "lavoro (triage: analizza e arricchisci il task con update_task; coder: implementa nel repository del progetto su un branch " +
    "dedicato e apri una PR; reviewer: rivedi la PR) -> ai_complete_step con il riepilogo (il server sposta il task: " +
    "triage Draft->TODO, coder TODO->Testing, reviewer Testing->Done), oppure ai_reject (solo reviewer: torna in TODO) " +
    "o ai_fail se non riesci a completare. Non spostare i task AI con move_task.";

  server.tool(
    "list_ai_tasks",
    `Coda dei task gestiti da AI con un passo in attesa (${ref.replace(/^del /, "nel ")}${scope.kind === "global" ? ", o in tutti i progetti accessibili se projectId e' omesso" : ""}), ` +
      "dal piu' urgente. Ogni voce ha step (triage | coder | reviewer), repoUrl del progetto e rejectCount. " +
      "Esclude task gia' in lavorazione, fermati o (per coder) bloccati da dipendenze aperte. " + AI_WORKFLOW,
    {
      ...(scope.kind === "global" ? { projectId: z.string().optional() } : {}),
      step: z.enum(AI_STEPS).optional(),
    },
    async (input: { projectId?: string; step?: (typeof AI_STEPS)[number] }) =>
      withErrors(async () => listAiQueue(await scope.queueProjectIds(input.projectId), input.step))
  );

  server.tool(
    "ai_start_step",
    "Prende in carico il passo AI in attesa di taskId (blocco di 60 minuti: altri agenti non lo vedono in coda). " +
      "step facoltativo: se indicato deve coincidere con il passo in attesa. Restituisce il task completo. " + AI_WORKFLOW,
    { taskId: z.string(), step: z.enum(AI_STEPS).optional() },
    async ({ taskId, step }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return startAiStep(taskId, MCP_ACTOR, step);
      })
  );

  server.tool(
    "ai_complete_step",
    "Chiude con successo il passo AI di taskId: summary (markdown) diventa un commento e il server sposta il task alla " +
      "colonna successiva (triage -> TODO, coder -> Testing, reviewer -> Done). Per il coder includi branch e link alla PR.",
    { taskId: z.string(), summary: z.string().min(1) },
    async ({ taskId, summary }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return completeAiStep(taskId, summary, MCP_ACTOR);
      })
  );

  server.tool(
    "ai_reject",
    "Solo per il passo reviewer: rimanda taskId in TODO con il motivo (commento) cosi' il coder lo riprende. " +
      "Dopo 3 rimandi il percorso AI si ferma e l'admin viene avvisato.",
    { taskId: z.string(), reason: z.string().min(1) },
    async ({ taskId, reason }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return rejectAiStep(taskId, reason, MCP_ACTOR);
      })
  );

  server.tool(
    "ai_fail",
    "Il passo AI di taskId non si puo' completare (informazioni mancanti, errore, task fuori portata): il task resta " +
      "dov'e', il percorso AI si ferma e l'admin viene avvisato con il motivo.",
    { taskId: z.string(), reason: z.string().min(1) },
    async ({ taskId, reason }) =>
      withErrors(async () => {
        await assertTaskInProject(taskId);
        return failAiStep(taskId, reason, MCP_ACTOR);
      })
  );

  server.tool(
    "list_statuses",
    "Elenca gli stati del progetto nell'ordine delle colonne: i 5 di base (builtIn true) e quelli personalizzati " +
      "(es. bloqueante). Usa `key` (o il nome) come status in move_task, update_task e list_tasks.",
    { ...P },
    async (input) => withErrors(async () => listProjectStatuses(await scope.resolveProject(input)))
  );

  return server;
}
