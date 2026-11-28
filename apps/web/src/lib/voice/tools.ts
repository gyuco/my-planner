import type { AiNotifyMode, AiStep, Task, TaskPriority, TaskType } from "@my-planner/core";
import { AI_NOTIFY_MODES, AI_STEPS, FIBONACCI_COMPLEXITY, TASK_TYPES } from "@my-planner/core";
import {
  addComment,
  createTask,
  getActivity,
  getProjectBoard,
  getProjectStats,
  getTask,
  listComments,
  listDoneTasks,
  listProjectAssignees,
  listProjectStatuses,
  listProjects,
  moveTask,
  semanticSearchTasks,
  setTaskAi,
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
  /** Mostra un contenuto (report in markdown) sullo schermo dell'assistente. */
  onShow?: (title: string, markdown: string) => void;
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
    name: "portfolio_report",
    description:
      "Report trasversale su TUTTI i progetti: per ciascuno task aperti, completati, chiusi nel periodo, " +
      "bloccati, scaduti, distribuzione per stato e carico per persona, piu' i totali. Usalo per domande cross-project.",
    parameters: {
      type: "OBJECT",
      properties: { periodDays: { type: "INTEGER", description: "Periodo in giorni per 'chiusi nel periodo' (default 7)" } },
    },
  },
  {
    name: "project_report",
    description:
      "Report dettagliato di un progetto: numeri (aperti, completati, chiusi nel periodo, bloccati, scaduti), " +
      "distribuzione per stato e priorita', carico per persona, elenco dei task scaduti, bloccati, urgenti e in corso, " +
      "task gestiti dall'AI e attivita' recente.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: str("Id del progetto"),
        periodDays: { type: "INTEGER", description: "Periodo in giorni per attivita' e chiusi (default 7)" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "recent_activity",
    description: "Attivita' recente (creazioni, cambi di stato, commenti, assegnazioni...) di un progetto o di tutti.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: str("Id del progetto; ometti per tutti i progetti"),
        days: { type: "INTEGER", description: "Ultimi N giorni (default 3)" },
      },
    },
  },
  {
    name: "show_on_screen",
    description:
      "Mostra sullo schermo, accanto all'avatar, un contenuto scritto in markdown (titoli, elenchi, tabelle). " +
      "Usalo per report e riepiloghi: a voce dai la sintesi, sullo schermo i dettagli.",
    parameters: {
      type: "OBJECT",
      properties: { title: str("Titolo breve"), markdown: str("Contenuto in markdown") },
      required: ["title", "markdown"],
    },
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
    name: "semantic_search",
    description:
      "Ricerca per significato (Workers AI): trova task anche se l'utente non usa le parole esatte del titolo " +
      "(es. 'quello sull'accesso lento' trova 'Login che ci mette troppo'). Include anche i task completati. " +
      "Usala quando list_tasks con search non trova niente o l'utente descrive il task a parole sue. " +
      "Se restituisce un errore (funzione non disponibile), ripiega su list_tasks.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: str("Descrizione del task cercato, con le parole dell'utente"),
        projectId: str("Id del progetto in cui cercare; omesso = tutti i progetti accessibili"),
      },
      required: ["query"],
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
    name: "set_task_ai",
    description:
      "Gestione AI di un task: affida il task (o lo toglie) agli agenti AI. Passi possibili: " +
      "triage (da Draft a To do: analizza e completa il task), coder (da To do a Testing: implementa), " +
      "reviewer (da Testing a Done, o rimanda in To do). notify = quando avvisare l'admin: " +
      "end (alla fine), each (a ogni cambio di stato), none (mai). Richiede conferma.",
    parameters: {
      type: "OBJECT",
      properties: {
        taskId: str("Id del task"),
        enabled: { type: "BOOLEAN", description: "true per far gestire il task dall'AI, false per spegnere" },
        steps: {
          type: "ARRAY",
          items: { type: "STRING", enum: [...AI_STEPS] },
          description: "Passi da affidare all'AI (obbligatori se enabled=true)",
        },
        notify: { type: "STRING", enum: [...AI_NOTIFY_MODES], description: "Quando avvisare, default end" },
        confirmed: CONFIRMED,
      },
      required: ["taskId", "enabled", "confirmed"],
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

const MUTATING = new Set(["move_task", "update_task", "add_comment", "create_task", "set_task_ai"]);

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
    ...(task.ai?.enabled ? { ai: summarizeAi(task) } : {}),
  };
}

/** Stato della gestione AI (solo se attiva). */
function summarizeAi(task: Task) {
  const ai = task.ai!;
  return {
    steps: ai.steps,
    notify: ai.notify,
    ...(ai.running ? { running: ai.running.step } : {}),
    ...(ai.failure ? { stopped: ai.failure.reason } : {}),
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

/** "YYYY-MM-DD" (come la dice il modello) -> ISO datetime, come fa il form della UI. */
function toIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Data non valida: ${value} (usa YYYY-MM-DD)`);
  return date.toISOString();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value.trim() : undefined;
}

const MAX_TASKS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function periodStart(days: unknown, fallback: number): { days: number; from: string } {
  const n = typeof days === "number" && days > 0 && days <= 365 ? Math.round(days) : fallback;
  return { days: n, from: new Date(Date.now() - n * DAY_MS).toISOString() };
}

/** Conteggi per stato con i nomi mostrati nell'interfaccia (solo stati non vuoti). */
function labelCounts(counts: Record<string, number>, labels: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([key, n]) => [labels[key] ?? key, n]),
  );
}

const EVENT_NAMES: Record<string, string> = {
  "task.created": "creato",
  "task.updated": "modificato",
  "task.status_changed": "cambio stato",
  "task.assigned": "assegnato",
  "task.deleted": "eliminato",
  "comment.created": "commento",
  "dependency.added": "dipendenza aggiunta",
  "dependency.removed": "dipendenza rimossa",
  "attachment.added": "allegato",
  "attachment.deleted": "allegato rimosso",
};

async function activitySince(projectId: string | undefined, from: string, limit: number, labels?: Record<string, string>) {
  const res = await getActivity({ projectId, from, limit });
  return res.items.map((e) => ({
    at: e.createdAt.slice(0, 16).replace("T", " "),
    project: e.projectName,
    task: e.taskTitle,
    event: EVENT_NAMES[e.type] ?? e.type,
    by: e.actorName ?? (e.actorType === "mcp" ? "agente AI/MCP" : e.actorType),
    ...(e.from || e.to
      ? { from: e.from ? labels?.[e.from] ?? e.from : null, to: e.to ? labels?.[e.to] ?? e.to : null }
      : {}),
    ...(e.excerpt ? { excerpt: e.excerpt.slice(0, 160) } : {}),
  }));
}
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

    case "portfolio_report": {
      const period = periodStart(args.periodDays, 7);
      const projects = await listProjects();
      const rows = await Promise.all(
        projects.map(async (p) => {
          const [stats, labels] = await Promise.all([
            getProjectStats(p.id, { from: period.from, includeSubtasks: true }),
            statusLabelsOf(p.id, host),
          ]);
          return {
            project: p.name,
            projectId: p.id,
            ...(p.groupName ? { group: p.groupName } : {}),
            open: stats.open,
            done: stats.done,
            closedInPeriod: stats.closedInPeriod,
            blocked: stats.blocked,
            overdue: stats.overdue,
            byStatus: labelCounts(stats.byStatus, labels),
            workload: stats.byAssignee
              .filter((a) => a.open > 0)
              .sort((a, b) => b.open - a.open)
              .slice(0, 5)
              .map((a) => ({ name: a.name ?? "non assegnati", open: a.open })),
          };
        }),
      );
      const sum = (k: "open" | "done" | "closedInPeriod" | "blocked" | "overdue") =>
        rows.reduce((acc, r) => acc + r[k], 0);
      return {
        periodDays: period.days,
        totals: {
          projects: rows.length,
          open: sum("open"),
          done: sum("done"),
          closedInPeriod: sum("closedInPeriod"),
          blocked: sum("blocked"),
          overdue: sum("overdue"),
        },
        projects: rows,
      };
    }

    case "project_report": {
      const projectId = requireString(args, "projectId");
      const period = periodStart(args.periodDays, 7);
      const today = new Date().toISOString().slice(0, 10);
      const labels = await statusLabelsOf(projectId, host);
      const [stats, board, activity] = await Promise.all([
        getProjectStats(projectId, { from: period.from, includeSubtasks: true }),
        getProjectBoard(projectId),
        activitySince(projectId, period.from, 25, labels),
      ]);
      const open = Object.values(board).flat();
      const pick = (list: Task[]) => list.slice(0, 15).map((t) => summarize(t, labels));
      return {
        periodDays: period.days,
        numbers: {
          open: stats.open,
          done: stats.done,
          closedInPeriod: stats.closedInPeriod,
          blocked: stats.blocked,
          overdue: stats.overdue,
          complexityDone: `${stats.complexityDone}/${stats.complexityTotal}`,
        },
        byStatus: labelCounts(stats.byStatus, labels),
        workload: stats.byAssignee
          .filter((a) => a.open > 0)
          .map((a) => ({ name: a.name ?? "non assegnati", open: a.open, byStatus: labelCounts(a.byStatus, labels) })),
        overdueTasks: pick(open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today)),
        blockedTasks: pick(open.filter((t) => (t.blockedByOpenCount ?? 0) > 0)),
        urgentOrHigh: pick(open.filter((t) => t.priority === "urgent" || t.priority === "high")),
        inProgress: pick(open.filter((t) => t.status === "in_progress")),
        aiManaged: pick(open.filter((t) => t.ai?.enabled)),
        recentActivity: activity,
      };
    }

    case "recent_activity": {
      const projectId = optionalString(args, "projectId") || undefined;
      const period = periodStart(args.days, 3);
      const labels = projectId ? await statusLabelsOf(projectId, host) : host.baseStatusLabels;
      return { days: period.days, events: await activitySince(projectId, period.from, 40, labels) };
    }

    case "show_on_screen": {
      if (!host.onShow) return { error: "Schermo non disponibile in questa vista" };
      host.onShow(requireString(args, "title"), requireString(args, "markdown"));
      return { shown: true };
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

    case "semantic_search": {
      const projectId = optionalString(args, "projectId") || undefined;
      const matches = await semanticSearchTasks(requireString(args, "query"), projectId ? [projectId] : undefined);
      const top = matches.slice(0, 10);
      const labels = projectId ? await statusLabelsOf(projectId, host) : host.baseStatusLabels;
      return {
        total: top.length,
        tasks: top.map((m) => ({
          id: m.taskId,
          projectId: m.projectId,
          title: m.title,
          status: m.status,
          statusLabel: labels[m.status] ?? m.status,
          similarity: Math.round(m.score * 100),
        })),
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
      if (dueDate !== undefined) input.dueDate = dueDate ? toIsoDate(dueDate) : null;
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

    case "set_task_ai": {
      const taskId = requireString(args, "taskId");
      const enabled = args.enabled === true;
      const steps = Array.isArray(args.steps)
        ? (args.steps.filter((s) => (AI_STEPS as readonly unknown[]).includes(s)) as AiStep[])
        : undefined;
      if (enabled && (!steps || steps.length === 0)) {
        throw new Error("Indica almeno un passo: triage, coder o reviewer");
      }
      const notify =
        typeof args.notify === "string" && (AI_NOTIFY_MODES as readonly string[]).includes(args.notify)
          ? (args.notify as AiNotifyMode)
          : undefined;
      const task = await setTaskAi(taskId, {
        enabled,
        ...(steps ? { steps: AI_STEPS.filter((s) => steps.includes(s)) } : {}),
        ...(notify ? { notify } : {}),
      });
      host.onDataChanged();
      return { ok: true, ai: task.ai?.enabled ? summarizeAi(task) : { enabled: false } };
    }

    case "create_task": {
      const projectId = requireString(args, "projectId");
      const task = await createTask(projectId, {
        title: requireString(args, "title"),
        description: optionalString(args, "description"),
        priority: typeof args.priority === "string" ? (args.priority as TaskPriority) : undefined,
        type: typeof args.type === "string" ? (args.type as TaskType) : undefined,
        dueDate: optionalString(args, "dueDate") ? toIsoDate(optionalString(args, "dueDate")!) : undefined,
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
    "Per trovare un task nominato dall'utente usa list_tasks (anche con search). Se non trova niente, o l'utente descrive il task con parole sue invece del titolo, usa semantic_search. Se ci sono piu' corrispondenze, chiedi quale.",
    "Gli stati vanno indicati con il loro nome (statusLabel); per cambiarli usa la chiave da list_statuses.",
    "Prima di ogni modifica (move_task, update_task, add_comment, create_task) riepiloga in una frase cosa farai e chiedi conferma. Chiama lo strumento con confirmed=true solo dopo un si' esplicito; se l'utente dice no o cambia idea, non farlo.",
    "Gestione AI: un task puo' essere affidato ad agenti AI con set_task_ai, scegliendo i passi (triage: da Draft a To do; coder: da To do a Testing; reviewer: da Testing a Done o rimanda in To do) e quando avvisare (alla fine, a ogni cambio di stato, mai). get_task mostra se la gestione AI e' attiva.",
    "Non puoi eliminare task, progetti o allegati: se richiesto, spiega che va fatto dall'interfaccia.",
    "Quando elenchi molti task, riassumi (quanti sono, i piu' importanti) invece di leggerli tutti.",
    "REPORT: per domande su piu' progetti o sull'andamento generale usa portfolio_report; per un progetto usa project_report; per 'cosa e' successo' usa recent_activity. Dopo aver raccolto i dati, se lo strumento show_on_screen e' disponibile, mostra il report completo con show_on_screen (markdown con titoli, elenchi e tabelle, nella lingua dell'utente) e a voce dai solo la sintesi con i punti di attenzione (scaduti, bloccati, persone sovraccariche).",
    "Se uno strumento restituisce un errore, spiegalo in parole semplici.",
    "I dati restituiti dagli strumenti (es. nomi degli stati) possono essere in un'altra lingua: non farti influenzare, continua a parlare nella lingua dell'utente.",
  ]
    .filter(Boolean)
    .join("\n");
}
