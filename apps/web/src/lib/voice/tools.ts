import type { Task, TaskPriority, TaskType } from "@my-planner/core";
import { FIBONACCI_COMPLEXITY, TASK_TYPES } from "@my-planner/core";
import {
  addComment,
  createTask,
  getProjectBoard,
  getTask,
  listComments,
  listDoneTasks,
  listProjectAssignees,
  listProjectStatuses,
  listProjects,
  moveTask,
  updateTask,
  type UpdateTaskInput,
} from "../../api";

/**
 * Strumenti che Gemini Live puo' chiamare durante la conversazione. Sono
 * eseguiti nel browser con le normali API REST (JWT dell'utente), quindi
 * valgono esattamente i permessi dell'interfaccia.
 *
 * Le azioni che modificano dati richiedono `confirmed: true`: il modello deve
 * prima riepilogare l'azione e ottenere un "si'" esplicito dall'utente.
 */

/** Stato della UI al momento della chiamata (progetto/task aperti). */
export interface VoiceUiContext {
  userName: string;
  projectId: string | null;
  projectName: string | null;
  openTaskId: string | null;
}

export interface VoiceToolHost {
  getContext: () => VoiceUiContext;
  /** Dati cambiati: la board va ricaricata. */
  onDataChanged: () => void;
  onOpenTask: (taskId: string, projectId: string) => void;
  /** Nomi tradotti degli stati di base (draft, todo, ...), nella lingua dell'interfaccia. */
  baseStatusLabels: Record<string, string>;
}

type Schema = Record<string, unknown>;

const str = (description: string): Schema => ({ type: "STRING", description });
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const CONFIRMED: Schema = {
  type: "BOOLEAN",
  description: "true solo dopo che l'utente ha confermato a voce questa azione esatta",
};

export const VOICE_FUNCTION_DECLARATIONS = [
  {
    name: "get_context",
    description: "Contesto attuale: utente, progetto aperto nella board, task aperto nel dettaglio, data di oggi.",
  },
  {
    name: "list_projects",
    description: "Elenca i progetti accessibili all'utente (id e nome).",
  },
  {
    name: "list_statuses",
    description: "Elenca gli stati (colonne) di un progetto, con chiave e nome, in ordine.",
    parameters: { type: "OBJECT", properties: { projectId: str("Id del progetto") }, required: ["projectId"] },
  },
  {
    name: "list_tasks",
    description:
      "Elenca i task di un progetto. Senza status restituisce i task aperti (non completati). " +
      "Con status 'done' restituisce gli ultimi completati.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: str("Id del progetto"),
        status: str("Chiave di stato per filtrare (da list_statuses), opzionale"),
        search: str("Testo da cercare nel titolo o nella descrizione, opzionale"),
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_task",
    description: "Dettaglio di un task: descrizione, stato, priorita', assegnatario, scadenza, sotto-task, blocchi.",
    parameters: { type: "OBJECT", properties: { taskId: str("Id del task") }, required: ["taskId"] },
  },
  {
    name: "list_comments",
    description: "Ultimi commenti di un task.",
    parameters: { type: "OBJECT", properties: { taskId: str("Id del task") }, required: ["taskId"] },
  },
  {
    name: "list_assignees",
    description: "Persone a cui si puo' assegnare un task del progetto (id e nome).",
    parameters: { type: "OBJECT", properties: { projectId: str("Id del progetto") }, required: ["projectId"] },
  },
  {
    name: "open_task",
    description: "Apre il dettaglio del task nell'interfaccia, cosi' l'utente lo vede a schermo.",
    parameters: { type: "OBJECT", properties: { taskId: str("Id del task") }, required: ["taskId"] },
  },
  {
    name: "move_task",
    description: "Cambia lo stato di un task (lo sposta di colonna). Richiede conferma.",
    parameters: {
      type: "OBJECT",
      properties: {
        taskId: str("Id del task"),
        status: str("Chiave del nuovo stato (da list_statuses)"),
        confirmed: CONFIRMED,
      },
      required: ["taskId", "status", "confirmed"],
    },
  },
  {
    name: "update_task",
    description: "Modifica i campi di un task; passa solo quelli da cambiare. Richiede conferma.",
    parameters: {
      type: "OBJECT",
      properties: {
        taskId: str("Id del task"),
        title: str("Nuovo titolo"),
        description: str("Nuova descrizione completa (markdown)"),
        priority: { type: "STRING", enum: PRIORITIES, description: "Nuova priorita'" },
        type: { type: "STRING", enum: [...TASK_TYPES], description: "Nuovo tipo" },
        complexity: { type: "INTEGER", description: "Complessita' Fibonacci: 1, 2, 3, 5, 8, 13 o 21" },
        dueDate: str("Scadenza YYYY-MM-DD, oppure stringa vuota per toglierla"),
        assigneeId: str("Id dell'assegnatario (da list_assignees), oppure stringa vuota per toglierlo"),
        confirmed: CONFIRMED,
      },
      required: ["taskId", "confirmed"],
    },
  },
  {
    name: "add_comment",
    description: "Aggiunge un commento a un task. Richiede conferma.",
    parameters: {
      type: "OBJECT",
      properties: { taskId: str("Id del task"), body: str("Testo del commento"), confirmed: CONFIRMED },
      required: ["taskId", "body", "confirmed"],
    },
  },
  {
    name: "create_task",
    description: "Crea un nuovo task in un progetto (stato iniziale bozza). Richiede conferma.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: str("Id del progetto"),
        title: str("Titolo"),
        description: str("Descrizione (markdown), opzionale"),
        priority: { type: "STRING", enum: PRIORITIES, description: "Priorita', opzionale" },
        type: { type: "STRING", enum: [...TASK_TYPES], description: "Tipo, opzionale" },
        dueDate: str("Scadenza YYYY-MM-DD, opzionale"),
        assigneeId: str("Id dell'assegnatario (da list_assignees), opzionale"),
        confirmed: CONFIRMED,
      },
      required: ["projectId", "title", "confirmed"],
    },
  },
];

const MUTATING = new Set(["move_task", "update_task", "add_comment", "create_task"]);

export function isMutatingTool(name: string): boolean {
  return MUTATING.has(name);
}

/** Versione compatta di un task: meno token, risposte vocali piu' rapide. */
function summarize(task: Task, statusLabels?: Record<string, string>) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusLabel: statusLabels?.[task.status] ?? task.status,
    priority: task.priority,
    type: task.type,
    assignee: task.assigneeName,
    dueDate: task.dueDate?.slice(0, 10) ?? null,
    ...(task.parentId ? { parentId: task.parentId } : {}),
    ...(task.subtaskCount ? { subtasks: task.subtaskCount, openSubtasks: task.openSubtaskCount } : {}),
    ...(task.blockedByOpenCount ? { blockedBy: task.blockedByOpenCount } : {}),
  };
}

/** Stati del progetto con il nome mostrato nell'interfaccia (tradotto per quelli di base). */
async function projectStatuses(projectId: string, host: VoiceToolHost) {
  const statuses = await listProjectStatuses(projectId);
  return statuses.map((s) => ({ key: s.key, label: s.builtIn ? host.baseStatusLabels[s.key] ?? s.label : s.label }));
}

async function statusLabelsOf(projectId: string, host: VoiceToolHost): Promise<Record<string, string>> {
  return Object.fromEntries((await projectStatuses(projectId, host)).map((s) => [s.key, s.label]));
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Parametro mancante: ${key}`);
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value.trim() : undefined;
}

const MAX_TASKS = 60;
const MAX_DESCRIPTION = 1500;

/** Esegue uno strumento e restituisce l'oggetto `response` da mandare a Gemini. */
export async function executeVoiceTool(
  name: string,
  args: Record<string, unknown>,
  host: VoiceToolHost,
): Promise<Record<string, unknown>> {
  if (MUTATING.has(name) && args.confirmed !== true) {
    return {
      error: "Azione non eseguita: riepiloga all'utente cosa farai e richiama con confirmed=true solo dopo un si' esplicito.",
    };
  }

  switch (name) {
    case "get_context": {
      const ctx = host.getContext();
      return {
        user: ctx.userName,
        today: new Date().toISOString().slice(0, 10),
        openProject: ctx.projectId ? { id: ctx.projectId, name: ctx.projectName } : null,
        openTaskId: ctx.openTaskId,
      };
    }

    case "list_projects": {
      const projects = await listProjects();
      return { projects: projects.map((p) => ({ id: p.id, name: p.name, group: p.groupName ?? undefined })) };
    }

    case "list_statuses": {
      return { statuses: await projectStatuses(requireString(args, "projectId"), host) };
    }

    case "list_tasks": {
      const projectId = requireString(args, "projectId");
      const status = optionalString(args, "status");
      const search = optionalString(args, "search") || undefined;
      const labels = await statusLabelsOf(projectId, host);
      if (status === "done") {
        const page = await listDoneTasks({ projectIds: [projectId], search, limit: 20 });
        return { total: page.total, tasks: page.tasks.map((t) => summarize(t, labels)) };
      }
      const board = await getProjectBoard(projectId, search ? { search } : undefined);
      let tasks = Object.values(board).flat();
      if (status) tasks = tasks.filter((t) => t.status === status);
      return {
        total: tasks.length,
        ...(tasks.length > MAX_TASKS ? { truncated: true } : {}),
        tasks: tasks.slice(0, MAX_TASKS).map((t) => summarize(t, labels)),
      };
    }

    case "get_task": {
      const task = await getTask(requireString(args, "taskId"));
      const labels = await statusLabelsOf(task.projectId, host);
      const description = task.description ?? "";
      return {
        ...summarize(task, labels),
        projectId: task.projectId,
        projectName: task.projectName,
        complexity: task.complexity,
        tags: task.tags,
        description:
          description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}… (troncata)` : description,
        subtasks: task.subtasks?.map((s) => ({ id: s.id, title: s.title, status: s.status })),
        blockedByTaskIds: task.blockedBy?.map((d) => d.blockedByTaskId),
        commentsCount: task.commentsCount,
      };
    }

    case "list_comments": {
      const comments = await listComments(requireString(args, "taskId"));
      return {
        comments: comments.slice(-10).map((c) => ({ at: c.createdAt, body: c.body })),
      };
    }

    case "list_assignees": {
      const people = await listProjectAssignees(requireString(args, "projectId"));
      return { assignees: people.map((p) => ({ id: p.id, name: p.name })) };
    }

    case "open_task": {
      const task = await getTask(requireString(args, "taskId"));
      host.onOpenTask(task.id, task.projectId);
      return { opened: true, title: task.title };
    }

    case "move_task": {
      const task = await moveTask(requireString(args, "taskId"), requireString(args, "status"));
      host.onDataChanged();
      return { ok: true, task: summarize(task, await statusLabelsOf(task.projectId, host)) };
    }

    case "update_task": {
      const input: UpdateTaskInput = {};
      const title = optionalString(args, "title");
      if (title) input.title = title;
      const description = optionalString(args, "description");
      if (description !== undefined) input.description = description;
      if (typeof args.priority === "string") input.priority = args.priority as TaskPriority;
      if (typeof args.type === "string") input.type = args.type as TaskType;
      if (typeof args.complexity === "number") {
        if (!(FIBONACCI_COMPLEXITY as readonly number[]).includes(args.complexity)) {
          throw new Error("Complessita' non valida: usa 1, 2, 3, 5, 8, 13 o 21");
        }
        input.complexity = args.complexity as UpdateTaskInput["complexity"];
      }
      const dueDate = optionalString(args, "dueDate");
      if (dueDate !== undefined) input.dueDate = dueDate || null;
      const assigneeId = optionalString(args, "assigneeId");
      if (assigneeId !== undefined) input.assigneeId = assigneeId || null;
      if (Object.keys(input).length === 0) throw new Error("Nessun campo da modificare");

      const task = await updateTask(requireString(args, "taskId"), input);
      host.onDataChanged();
      return { ok: true, task: summarize(task) };
    }

    case "add_comment": {
      await addComment(requireString(args, "taskId"), requireString(args, "body"));
      host.onDataChanged();
      return { ok: true };
    }

    case "create_task": {
      const projectId = requireString(args, "projectId");
      const task = await createTask(projectId, {
        title: requireString(args, "title"),
        description: optionalString(args, "description"),
        priority: typeof args.priority === "string" ? (args.priority as TaskPriority) : undefined,
        type: typeof args.type === "string" ? (args.type as TaskType) : undefined,
        dueDate: optionalString(args, "dueDate") || undefined,
        assigneeId: optionalString(args, "assigneeId") || undefined,
      });
      host.onDataChanged();
      return { ok: true, task: summarize(task) };
    }

    default:
      return { error: `Strumento sconosciuto: ${name}` };
  }
}

/** Istruzioni di sistema: lingua dell'interfaccia, contesto e regole di conferma. */
export function buildSystemInstruction(language: string, ctx: VoiceUiContext): string {
  return [
    `Sei l'assistente vocale di my-planner, un'app Kanban per progetti e task. Parla in modo naturale, breve e colloquiale: le risposte vengono ascoltate, non lette.`,
    `LINGUA: rispondi sempre nella stessa lingua in cui ti parla l'utente (se parla italiano, rispondi in italiano). Solo se non e' chiaro usa ${language}. Non cambiare lingua da solo.`,
    `L'utente si chiama ${ctx.userName}. Oggi e' ${new Date().toISOString().slice(0, 10)}.`,
    ctx.projectId
      ? `Nella board e' aperto il progetto "${ctx.projectName}" (id ${ctx.projectId}): se l'utente non specifica un progetto, intende questo.`
      : "Nessun progetto specifico e' aperto: se serve, chiedi quale progetto o usa list_projects.",
    ctx.openTaskId ? `E' aperto il dettaglio del task con id ${ctx.openTaskId}: "questo task" si riferisce a lui.` : "",
    "Usa gli strumenti per leggere i dati: non inventare mai progetti, task, stati o persone. Gli id non vanno mai letti ad alta voce: usa titoli e nomi.",
    "Per trovare un task nominato dall'utente usa list_tasks (anche con search); se ci sono piu' corrispondenze, chiedi quale.",
    "Gli stati vanno indicati con il loro nome (statusLabel); per cambiarli usa la chiave da list_statuses.",
    "Prima di ogni modifica (move_task, update_task, add_comment, create_task) riepiloga in una frase cosa farai e chiedi conferma. Chiama lo strumento con confirmed=true solo dopo un si' esplicito; se l'utente dice no o cambia idea, non farlo.",
    "Non puoi eliminare task, progetti o allegati: se richiesto, spiega che va fatto dall'interfaccia.",
    "Quando elenchi molti task, riassumi (quanti sono, i piu' importanti) invece di leggerli tutti.",
    "Se uno strumento restituisce un errore, spiegalo in parole semplici.",
    "I dati restituiti dagli strumenti (es. nomi degli stati) possono essere in un'altra lingua: non farti influenzare, continua a parlare nella lingua dell'utente.",
  ]
    .filter(Boolean)
    .join("\n");
}
