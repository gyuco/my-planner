import {
  AI_NOTE_MAX_LENGTH,
  AI_NOTIFY_MODES,
  AI_STEPS,
  ApiErrorException,
  normalizeAiSteps,
  type TaskAi,
  type TaskAiInput,
  emptySubtaskStatusCounts,
  FIBONACCI_COMPLEXITY,
  isBaseStatus,
  orderedStatusKeys,
  type SubtaskStatusCounts,
  type TaskComplexity,
  type TaskFieldChange,
  type TaskStatusKey,
  type TaskType,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { serializeProject } from "./projectSerializer.js";
import { getAttachmentStorage } from "../lib/attachmentStorage/provider.js";
import { parseEventData, SYSTEM_ACTOR, type Actor } from "./notificationService.js";
import { emitEvent } from "./activityService.js";
import { listCustomStatusKeys, resolveStatus } from "./statusService.js";
import { publishBoardChange } from "../lib/realtime.js";
import { getAiFeatures, scheduleTaskIndex, scheduleTaskRemoval, semanticSearch } from "./semanticService.js";

/**
 * Service layer condiviso tra route REST e tool MCP.
 * Nessuna business logic va duplicata: REST e MCP chiamano queste funzioni.
 * Tutti gli errori sono lanciati come ApiErrorException con un ErrorCode
 * coerente con API_CONTRACT.md §1, cosi' REST e MCP possono mappare lo
 * stesso envelope.
 */

type TaskPriority = "low" | "medium" | "high" | "urgent";

/**
 * Board vuota con tutte le colonne previste (stati di base + personalizzati),
 * nell'ordine di `orderedStatusKeys`: il client usa l'ordine delle chiavi.
 */
function emptyBoard(customKeys: string[]): Record<string, any[]> {
  return Object.fromEntries(orderedStatusKeys(customKeys).map((status) => [status, []]));
}

export function tagsToArray(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToCsv(tags: string[] | undefined): string | undefined {
  if (tags === undefined) return undefined;
  return tags.filter(Boolean).join(",");
}

const USER_NAME_SELECT = { select: { firstName: true, lastName: true, email: true } } as const;

/** Relazioni da includere in ogni query su Task per esporre `assigneeName`/`ownerName`. */
const TASK_INCLUDE = {
  // Per l'assegnatario serve anche la versione dell'avatar (mostrato sulle
  // card); il data URL dell'immagine non viene mai caricato qui.
  assignee: { select: { firstName: true, lastName: true, email: true, avatarUpdatedAt: true } },
  owner: USER_NAME_SELECT,
  aiWatcher: USER_NAME_SELECT,
} as const;

/** Filtri per persona comuni a lista e board (es. "assegnati a me"). */
interface PeopleFilters {
  assigneeId?: string;
  ownerId?: string;
}

function applyPeopleFilters(where: any, filters: PeopleFilters) {
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
}

export function userDisplayName(user: { firstName: string; lastName: string; email: string } | null | undefined) {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

/** Campi AI grezzi del DB -> oggetto `ai` dell'API (vedi TaskAi in core). */
function serializeAi(task: any): TaskAi {
  return {
    enabled: Boolean(task.aiEnabled),
    steps: normalizeAiSteps(String(task.aiSteps ?? "").split(",")),
    notify: (AI_NOTIFY_MODES as readonly string[]).includes(task.aiNotify) ? task.aiNotify : "end",
    watcherId: task.aiWatcherId ?? null,
    watcherName: userDisplayName(task.aiWatcher),
    note: task.aiNote ?? null,
    running:
      task.aiRunStep && task.aiRunStartedAt && (AI_STEPS as readonly string[]).includes(task.aiRunStep)
        ? { step: task.aiRunStep, startedAt: new Date(task.aiRunStartedAt).toISOString() }
        : null,
    rejectCount: task.aiRejectCount ?? 0,
    failure: task.aiFailedAt ? { at: new Date(task.aiFailedAt).toISOString(), reason: task.aiFailReason ?? "" } : null,
    dispatch: task.aiDispatchedAt
      ? { step: task.aiDispatchedStep, at: new Date(task.aiDispatchedAt).toISOString(), sessionUrl: task.aiSessionUrl ?? null }
      : null,
  };
}

function serializeTask(task: any): any {
  const {
    tags, assignee, owner,
    aiEnabled, aiSteps, aiNotify, aiWatcherId, aiWatcher, aiNote,
    aiRunStep, aiRunStartedAt, aiRejectCount, aiFailedAt, aiFailReason,
    aiDispatchedStep, aiDispatchedAt, aiSessionUrl,
    ...rest
  } = task;
  void [aiEnabled, aiSteps, aiNotify, aiWatcherId, aiWatcher, aiRunStep, aiRunStartedAt, aiRejectCount, aiFailedAt, aiFailReason];
  void [aiDispatchedStep, aiDispatchedAt, aiSessionUrl, aiNote];
  const out: any = { ...rest, tags: tagsToArray(tags ?? "") };
  out.ai = serializeAi(task);
  out.assigneeId = task.assigneeId ?? null;
  out.assigneeName = userDisplayName(assignee);
  out.assigneeAvatarVersion = assignee?.avatarUpdatedAt ? new Date(assignee.avatarUpdatedAt).getTime() : null;
  out.ownerId = task.ownerId ?? null;
  out.ownerName = userDisplayName(owner);
  if (task.dueDate) out.dueDate = new Date(task.dueDate).toISOString();
  if (task.createdAt) out.createdAt = new Date(task.createdAt).toISOString();
  if (task.updatedAt) out.updatedAt = new Date(task.updatedAt).toISOString();
  if (task.project) {
    out.projectId = task.project.id;
    out.projectName = task.project.name;
    delete out.project;
  }
  return out;
}

interface SubtaskCounts {
  total: number;
  open: number;
  byStatus: SubtaskStatusCounts;
}

function countSubtasks(subtasks: { status: string }[]): SubtaskCounts {
  const counts: SubtaskCounts = { total: 0, open: 0, byStatus: emptySubtaskStatusCounts() };
  for (const s of subtasks) {
    counts.total += 1;
    if (s.status !== "done") counts.open += 1;
    if (isBaseStatus(s.status)) counts.byStatus[s.status] += 1;
    else counts.byStatus.custom += 1;
  }
  return counts;
}

async function computeSubtaskCounts(taskIds: string[]) {
  const map = new Map<string, SubtaskCounts>();
  if (taskIds.length === 0) return map;
  const subtasks = await prisma.task.findMany({
    where: { parentId: { in: taskIds } },
    select: { parentId: true, status: true },
  });
  const grouped = new Map<string, { status: string }[]>();
  for (const s of subtasks) {
    const list = grouped.get(s.parentId as string) ?? [];
    list.push(s);
    grouped.set(s.parentId as string, list);
  }
  for (const [parentId, list] of grouped) map.set(parentId, countSubtasks(list));
  return map;
}

/** Scrive subtaskCount/openSubtaskCount/subtaskStatusCounts sul task serializzato. */
function applySubtaskCounts(serialized: any, counts: SubtaskCounts | undefined) {
  serialized.subtaskCount = counts?.total ?? 0;
  serialized.openSubtaskCount = counts?.open ?? 0;
  serialized.subtaskStatusCounts = counts?.byStatus ?? emptySubtaskStatusCounts();
}

export async function computeBlockedByOpenCount(taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, number>();
  const deps = await prisma.taskDependency.findMany({
    where: { taskId: { in: taskIds } },
    include: { blockedByTask: { select: { status: true } } },
  });
  const map = new Map<string, number>();
  for (const d of deps) {
    if (d.blockedByTask.status !== "done") {
      map.set(d.taskId, (map.get(d.taskId) ?? 0) + 1);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Progetti
// ---------------------------------------------------------------------------

export async function listProjects(includeArchived = false) {
  const rows = await prisma.project.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serializeProject);
}

export async function createProject(name: string) {
  if (!name || name.trim().length === 0 || name.length > 200) {
    throw new ApiErrorException("VALIDATION_ERROR", "Il nome del progetto deve avere tra 1 e 200 caratteri");
  }
  return serializeProject(await prisma.project.create({ data: { name } }));
}

export async function getProjectOrThrow(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiErrorException("NOT_FOUND", "Progetto non trovato");
  return project;
}

export async function renameProject(projectId: string, name: string) {
  await getProjectOrThrow(projectId);
  if (!name || name.trim().length === 0 || name.length > 200) {
    throw new ApiErrorException("VALIDATION_ERROR", "Il nome del progetto deve avere tra 1 e 200 caratteri");
  }
  return serializeProject(await prisma.project.update({ where: { id: projectId }, data: { name } }));
}

/**
 * Normalizza il repository GitHub del progetto: accetta "owner/repo",
 * "github.com/owner/repo", URL https (anche con .git o / finale) e
 * restituisce https://github.com/owner/repo. null/"" = nessun repository.
 */
export function normalizeRepoUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/);
  if (!m || (!/github\.com/i.test(raw) && raw.includes("://"))) {
    throw new ApiErrorException("VALIDATION_ERROR", "Repository non valido: usa https://github.com/owner/repo oppure owner/repo");
  }
  return `https://github.com/${m[1]}/${m[2]}`;
}

export async function updateProject(
  projectId: string,
  input: { name?: string; repoUrl?: string | null; groupName?: string | null },
) {
  await getProjectOrThrow(projectId);
  const data: { name?: string; repoUrl?: string | null; groupName?: string | null } = {};
  if (input.name !== undefined) {
    if (input.name.trim().length === 0 || input.name.length > 200) {
      throw new ApiErrorException("VALIDATION_ERROR", "Il nome del progetto deve avere tra 1 e 200 caratteri");
    }
    data.name = input.name;
  }
  if (input.repoUrl !== undefined) data.repoUrl = normalizeRepoUrl(input.repoUrl);
  if (input.groupName !== undefined) {
    // Spazi multipli compattati: "Prodotto  X" e "Prodotto X" sono lo stesso gruppo.
    const group = (input.groupName ?? "").trim().replace(/\s+/g, " ");
    if (group.length > 60) throw new ApiErrorException("VALIDATION_ERROR", "Il nome del gruppo deve avere al massimo 60 caratteri");
    data.groupName = group || null;
  }
  return serializeProject(await prisma.project.update({ where: { id: projectId }, data }));
}

export async function archiveProject(projectId: string) {
  await getProjectOrThrow(projectId);
  return serializeProject(await prisma.project.update({ where: { id: projectId }, data: { archived: true } }));
}

export async function unarchiveProject(projectId: string) {
  await getProjectOrThrow(projectId);
  return serializeProject(await prisma.project.update({ where: { id: projectId }, data: { archived: false } }));
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export interface TaskInput {
  title: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
}

function validateComplexity(complexity: unknown) {
  if (complexity === null || complexity === undefined) return;
  if (!(FIBONACCI_COMPLEXITY as readonly number[]).includes(complexity as number)) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `complexity deve essere uno dei valori Fibonacci ammessi: ${FIBONACCI_COMPLEXITY.join(", ")}`
    );
  }
}

/**
 * Valida parentId per createTask/updateTask: il parent deve esistere nello
 * stesso progetto, non puo' essere il task stesso, e non puo' essere a sua
 * volta una subtask — un solo livello di annidamento, niente epic/story
 * ricorsive (vedi discussione su gerarchia task grandi).
 */
async function validateParent(projectId: string, parentId: string, taskId?: string) {
  if (parentId === taskId) {
    throw new ApiErrorException("VALIDATION_ERROR", "Un task non può essere sotto-task di se stesso");
  }
  const parent = await prisma.task.findUnique({ where: { id: parentId } });
  if (!parent || parent.projectId !== projectId) {
    throw new ApiErrorException("NOT_FOUND", "Task genitore non trovato nel progetto");
  }
  if (parent.parentId) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      "Una sotto-task non può a sua volta avere sotto-task (un solo livello di annidamento)"
    );
  }
}

/**
 * Un task puo' essere assegnato solo a un admin o a un manager associato al
 * progetto: chiunque altro non potrebbe comunque vederlo.
 */
async function validateAssignee(projectId: string, assigneeId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: assigneeId,
      OR: [{ role: "admin" }, { projects: { some: { projectId } } }],
    },
    select: { id: true },
  });
  if (!user) {
    throw new ApiErrorException("VALIDATION_ERROR", "L'assegnatario deve essere un admin o un membro del progetto");
  }
}

/**
 * Destinatario delle notifiche di un evento sul task: l'assegnatario, se
 * esiste e non e' lui l'autore dell'azione (nessuno si notifica da solo).
 */
function notifyAssignee(assigneeId: string | null | undefined, actor: Actor): string | null {
  if (!assigneeId) return null;
  if (actor.type === "user" && actor.id === assigneeId) return null;
  return assigneeId;
}

/** Owner di un task appena creato: solo un utente REST, non MCP/sistema. */
function actorUserId(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}

export async function getTaskOrThrow(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
  return task;
}

export async function createTask(projectId: string, input: TaskInput, actor: Actor = SYSTEM_ACTOR) {
  await getProjectOrThrow(projectId);

  if (!input.title || input.title.trim().length === 0 || input.title.length > 300) {
    throw new ApiErrorException("VALIDATION_ERROR", "title deve avere tra 1 e 300 caratteri");
  }
  validateComplexity(input.complexity);
  if (input.parentId) await validateParent(projectId, input.parentId);
  if (input.assigneeId) await validateAssignee(projectId, input.assigneeId);

  const maxPosition = await prisma.task.aggregate({
    where: { projectId, status: "draft" },
    _max: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      projectId,
      title: input.title,
      description: input.description ?? "",
      type: input.type ?? "feature",
      priority: input.priority ?? "medium",
      complexity: input.complexity ?? null,
      tags: tagsToCsv(input.tags) ?? "",
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      position: (maxPosition._max.position ?? -1) + 1,
      parentId: input.parentId ?? null,
      assigneeId: input.assigneeId ?? null,
      ownerId: actorUserId(actor),
    },
    include: TASK_INCLUDE,
  });

  await emitEvent({
    projectId,
    taskId: task.id,
    type: "task.created",
    actor,
    recipientId: notifyAssignee(task.assigneeId, actor),
    data: { title: task.title, parentId: task.parentId },
  });
  scheduleTaskIndex(task.id);

  return serializeTask(task);
}

/** Massimo di task restituiti da una ricerca (board, archivio, MCP). */
const SEARCH_MAX_RESULTS = 100;

/**
 * Condizione Prisma della ricerca sui task, usata da board, archivio dei
 * completati, list_tasks MCP e assistente vocale. La ricerca e' semantica
 * (Workers AI + Vectorize, per significato): restano i task trovati, nei
 * progetti `projectIds` (undefined = tutti). Solo dove la ricerca semantica
 * non esiste (Node/Docker) o non risponde (es. quota giornaliera esaurita)
 * si ripiega sulla ricerca testuale su titolo e descrizione.
 */
async function searchWhere(
  query: string,
  projectIds: string[] | undefined,
  textWhere: (q: string) => any = (q) => ({ OR: [{ title: { contains: q } }, { description: { contains: q } }] }),
): Promise<any> {
  const q = query.trim();
  if (getAiFeatures().semanticSearch) {
    try {
      const matches = await semanticSearch({ query: q, projectIds, limit: SEARCH_MAX_RESULTS });
      return { id: { in: matches.map((m) => m.taskId) } };
    } catch (err) {
      console.error("[my-planner] ricerca semantica non riuscita, uso la ricerca testuale", err);
    }
  }
  return textWhere(q);
}

export async function listTasks(
  projectId: string,
  filters: { status?: string; priority?: TaskPriority; tag?: string; search?: string } & PeopleFilters
) {
  await getProjectOrThrow(projectId);
  const where: any = { projectId };
  if (filters.status) where.status = await resolveStatus(projectId, filters.status);
  if (filters.priority) where.priority = filters.priority;
  applyPeopleFilters(where, filters);
  if (filters.search?.trim()) where.AND = [await searchWhere(filters.search, [projectId])];

  let tasks = await prisma.task.findMany({
    where,
    orderBy: [{ status: "asc" }, { position: "asc" }],
    include: TASK_INCLUDE,
  });

  if (filters.tag) {
    tasks = tasks.filter((t) => tagsToArray(t.tags).includes(filters.tag as string));
  }

  const subtaskMap = await computeSubtaskCounts(tasks.map((t) => t.id));
  return tasks.map((t) => {
    const serialized = serializeTask(t);
    applySubtaskCounts(serialized, subtaskMap.get(t.id));
    return serialized;
  });
}

export async function getTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");

  const [blockedBy, blocking, commentsCount, attachmentsCount, subtasks] = await Promise.all([
    prisma.taskDependency.findMany({ where: { taskId } }),
    prisma.taskDependency.findMany({ where: { blockedByTaskId: taskId } }),
    prisma.comment.count({ where: { taskId } }),
    prisma.attachment.count({ where: { taskId } }),
    prisma.task.findMany({
      where: { parentId: taskId },
      orderBy: { position: "asc" },
      select: { id: true, title: true, status: true },
    }),
  ]);

  const serialized = serializeTask(task);
  serialized.blockedBy = blockedBy;
  serialized.blocking = blocking;
  serialized.commentsCount = commentsCount;
  serialized.attachmentsCount = attachmentsCount;
  serialized.subtasks = subtasks;
  applySubtaskCounts(serialized, countSubtasks(subtasks));
  return serialized;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  tags?: string[];
  dueDate?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
}

const MAX_CHANGE_VALUE_LENGTH = 200;

function changeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, MAX_CHANGE_VALUE_LENGTH);
}

/**
 * Diff tra il task prima e dopo l'update, per l'evento `task.updated`. Il
 * drawer salva tutti i campi ad ogni blur: senza diff ogni blur produrrebbe
 * un evento vuoto. La descrizione e' segnalata come cambiata ma senza valori.
 */
function diffTask(before: any, after: any): TaskFieldChange[] {
  const changes: TaskFieldChange[] = [];
  const fields = ["title", "type", "priority", "complexity", "tags", "dueDate", "parentId"] as const;
  for (const field of fields) {
    const from = changeValue(before[field]);
    const to = changeValue(after[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  if ((before.description ?? "") !== (after.description ?? "")) {
    changes.push({ field: "description", from: null, to: null });
  }
  return changes;
}

export async function updateTask(taskId: string, input: TaskUpdateInput, actor: Actor = SYSTEM_ACTOR) {
  const existing = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!existing) throw new ApiErrorException("NOT_FOUND", "Task non trovato");

  if (input.title !== undefined && (input.title.trim().length === 0 || input.title.length > 300)) {
    throw new ApiErrorException("VALIDATION_ERROR", "title deve avere tra 1 e 300 caratteri");
  }
  if (input.complexity !== undefined) validateComplexity(input.complexity);
  if (input.parentId) {
    await validateParent(existing.projectId, input.parentId, taskId);
    const ownSubtaskCount = await prisma.task.count({ where: { parentId: taskId } });
    if (ownSubtaskCount > 0) {
      throw new ApiErrorException(
        "VALIDATION_ERROR",
        "Un task con sotto-task proprie non può diventare a sua volta una sotto-task"
      );
    }
  }
  if (input.assigneeId) await validateAssignee(existing.projectId, input.assigneeId);

  const data: any = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.type !== undefined) data.type = input.type;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.complexity !== undefined) data.complexity = input.complexity;
  if (input.tags !== undefined) data.tags = tagsToCsv(input.tags);
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  if (input.parentId !== undefined) data.parentId = input.parentId;
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;

  const task = await prisma.task.update({ where: { id: taskId }, data, include: TASK_INCLUDE });

  const changes = diffTask(existing, task);
  if (changes.length > 0) {
    await emitEvent({
      projectId: task.projectId,
      taskId: task.id,
      type: "task.updated",
      actor,
      data: { title: task.title, parentId: task.parentId, changes },
    });
  }

  if (existing.title !== task.title || (existing.description ?? "") !== (task.description ?? "")) {
    scheduleTaskIndex(task.id);
  }

  // Cambio assegnatario: evento a parte, che notifica il nuovo assegnatario.
  if ((existing.assigneeId ?? null) !== (task.assigneeId ?? null)) {
    await emitEvent({
      projectId: task.projectId,
      taskId: task.id,
      type: "task.assigned",
      actor,
      recipientId: notifyAssignee(task.assigneeId, actor),
      data: { title: task.title, parentId: task.parentId, assigneeName: userDisplayName(task.assignee) },
    });
  }

  return serializeTask(task);
}

/** Riassunto leggibile della configurazione AI per il log attivita' (null = spenta). */
function aiSummary(ai: TaskAi): string | null {
  return ai.enabled ? `${ai.steps.join(",")}|${ai.notify}` : null;
}

/** Nota per l'agente normalizzata: spazi ai bordi tolti, vuota = null. */
export function normalizeAiNote(note: string | null | undefined): string | null {
  const text = (note ?? "").trim();
  if (!text) return null;
  if (text.length > AI_NOTE_MAX_LENGTH) {
    throw new ApiErrorException("VALIDATION_ERROR", `Nota per l'agente troppo lunga (max ${AI_NOTE_MAX_LENGTH} caratteri)`);
  }
  return text;
}

/**
 * Attiva, modifica o spegne la gestione AI di un task. L'autorizzazione
 * (solo admin) e' nelle route; qui `watcherId` e' l'admin che salva, che
 * diventa il destinatario degli avvisi. Spegnendo si conservano passi e
 * modalita', cosi' riattivare ripropone l'ultima configurazione. La nota per
 * l'agente (`input.note`) si salva anche a gestione spenta; omessa = invariata.
 */
export async function setTaskAi(taskId: string, input: TaskAiInput, watcherId: string, actor: Actor = SYSTEM_ACTOR) {
  const existing = await prisma.task.findUnique({ where: { id: taskId }, include: TASK_INCLUDE });
  if (!existing) throw new ApiErrorException("NOT_FOUND", "Task non trovato");

  const steps = input.steps !== undefined ? normalizeAiSteps(input.steps) : serializeAi(existing).steps;
  if (input.enabled && steps.length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "Scegli almeno un passo AI (triage, coder, reviewer)");
  }

  // Salvare la configurazione riprende anche un percorso fermato: azzera
  // fallimento, passo in corso e rimandi.
  const data: any = {
    aiEnabled: input.enabled,
    aiSteps: steps.join(","),
    aiFailedAt: null,
    aiFailReason: null,
    aiRunStep: null,
    aiRunStartedAt: null,
    aiRejectCount: 0,
  };
  if (input.notify !== undefined) data.aiNotify = input.notify;
  if (input.enabled) data.aiWatcherId = watcherId;
  if (input.note !== undefined) data.aiNote = normalizeAiNote(input.note);

  const task = await prisma.task.update({ where: { id: taskId }, data, include: TASK_INCLUDE });

  // Log attivita': per la nota si registra solo che e' cambiata (campo
  // aiNote, from/to null come per la descrizione), mai il testo.
  const changes: TaskFieldChange[] = [];
  const from = aiSummary(serializeAi(existing));
  const to = aiSummary(serializeAi(task));
  if (from !== to) changes.push({ field: "ai", from, to });
  if ((existing.aiNote ?? null) !== (task.aiNote ?? null)) {
    changes.push({ field: "aiNote", from: null, to: null });
  }
  if (changes.length > 0) {
    await emitEvent({
      projectId: task.projectId,
      taskId: task.id,
      type: "task.updated",
      actor,
      data: { title: task.title, parentId: task.parentId, changes },
    });
  }

  return serializeTask(task);
}

export async function deleteTask(taskId: string, actor: Actor = SYSTEM_ACTOR) {
  const existing = await getTaskOrThrow(taskId);

  const subtaskCount = await prisma.task.count({ where: { parentId: taskId } });
  if (subtaskCount > 0) {
    throw new ApiErrorException(
      "VALIDATION_ERROR",
      `Il task ha ${subtaskCount} sotto-task: eliminale o riassegnale prima di eliminare il task`
    );
  }

  // Elimina prima i file fisici/oggetti S3 (best-effort, vedi
  // AttachmentStorage.delete), poi i record DB in cascade.
  const attachments = await prisma.attachment.findMany({ where: { taskId } });
  const storage = await getAttachmentStorage();
  await Promise.all(attachments.map((a) => storage.delete(a.storageRef).catch(() => {})));

  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { taskId } }),
    prisma.attachment.deleteMany({ where: { taskId } }),
    prisma.taskDependency.deleteMany({ where: { OR: [{ taskId }, { blockedByTaskId: taskId }] } }),
    prisma.task.deleteMany({ where: { id: taskId } }),
  ]);

  await emitEvent({
    projectId: existing.projectId,
    taskId,
    type: "task.deleted",
    actor,
    data: { title: existing.title, parentId: existing.parentId },
  });
  scheduleTaskRemoval(taskId);

  return { id: taskId, deleted: true as const };
}

// ---------------------------------------------------------------------------
// Move / Board
// ---------------------------------------------------------------------------

export async function moveTask(
  taskId: string,
  requestedStatus: string,
  position?: number,
  actor: Actor = SYSTEM_ACTOR,
) {
  const existing = await getTaskOrThrow(taskId);
  // Stato di base, chiave o etichetta di uno stato personalizzato del progetto.
  const status = await resolveStatus(existing.projectId, requestedStatus);

  if (status === "in_progress") {
    const blockers = await prisma.taskDependency.findMany({
      where: { taskId },
      include: { blockedByTask: true },
    });
    const unresolved = blockers.filter((b) => b.blockedByTask.status !== "done");
    if (unresolved.length > 0) {
      throw new ApiErrorException(
        "DEPENDENCY_BLOCKED",
        `Task bloccato da ${unresolved.length} task non completati: ${unresolved
          .map((b) => b.blockedByTask.title)
          .join(", ")}`
      );
    }
  }

  let targetPosition = position;
  if (targetPosition === undefined) {
    const maxPosition = await prisma.task.aggregate({
      where: { projectId: existing.projectId, status },
      _max: { position: true },
    });
    targetPosition = (maxPosition._max.position ?? -1) + 1;
  }

  const data: any = { status, position: targetPosition };
  // Un utente che sposta il task (gestione AI) libera il passo in corso e
  // riprende un percorso fermato: il passo in attesa diventa quello della
  // nuova colonna. Gli spostamenti degli agenti passano dai tool ai_*.
  if (actor.type === "user" && existing.status !== status && (existing.aiRunStep || existing.aiFailedAt)) {
    Object.assign(data, { aiRunStep: null, aiRunStartedAt: null, aiFailedAt: null, aiFailReason: null });
  }
  const updated = await prisma.task.update({
    where: { id: taskId },
    data,
    include: TASK_INCLUDE,
  });

  // Un riordino nella stessa colonna passa da qui: non e' un cambio di stato
  // e non deve generare una notifica.
  if (existing.status !== status) {
    await emitEvent({
      projectId: updated.projectId,
      taskId: updated.id,
      type: "task.status_changed",
      actor,
      recipientId: notifyAssignee(updated.assigneeId, actor),
      data: {
        title: updated.title,
        from: existing.status as TaskStatusKey,
        to: status,
      },
    });
  } else {
    // Niente evento di attivita', ma la board degli altri client cambia.
    publishBoardChange({
      type: "board.changed",
      projectId: updated.projectId,
      taskId: updated.id,
      event: "task.reordered",
      actorType: actor.type,
    });
  }

  return serializeTask(updated);
}

/**
 * Utente che ha spostato per ultimo il task in Testing (dal log TaskEvent).
 * Contano solo gli spostamenti fatti da un utente REST: quelli via MCP o di
 * sistema non identificano una persona; se l'utente e' stato cancellato
 * `actorId` e' null (onDelete: SetNull) e l'evento viene ignorato.
 */
async function findLastTestingMover(taskId: string): Promise<string | null> {
  const events = await prisma.taskEvent.findMany({
    where: { taskId, type: "task.status_changed", actorType: "user", actorId: { not: null } },
    orderBy: { id: "desc" },
    select: { actorId: true, data: true },
  });
  for (const event of events) {
    if (parseEventData(event.data).to === "testing") return event.actorId;
  }
  return null;
}

/**
 * "Devolver a En curso": riporta un task da Testing a in_progress, lo
 * riassegna a chi lo aveva spostato in Testing (cosi' la correzione torna a
 * chi ha fatto il lavoro) e salva il motivo come commento.
 *
 * Se nessun utente lo ha spostato in Testing (es. solo MCP) o quell'utente
 * non e' piu' un assegnatario valido del progetto, l'assegnatario resta
 * quello attuale. Gli errori della move (es. DEPENDENCY_BLOCKED) si
 * propagano prima di qualsiasi altra scrittura.
 */
export async function sendBackTask(taskId: string, message: string, actor: Actor = SYSTEM_ACTOR) {
  if (!message || message.trim().length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "body del commento non può essere vuoto");
  }
  await getTaskOrThrow(taskId);

  const target = await findLastTestingMover(taskId);
  const moved = await moveTask(taskId, "in_progress", undefined, actor);

  let result = moved;
  if (target && target !== (moved.assigneeId ?? null)) {
    try {
      result = await updateTask(taskId, { assigneeId: target }, actor);
    } catch (err) {
      // L'utente non e' piu' admin/membro del progetto: resta l'assegnatario attuale.
      if (!(err instanceof ApiErrorException && err.code === "VALIDATION_ERROR")) throw err;
    }
  }

  await addComment(taskId, message, actor);
  return result;
}

type BoardFilters = { priority?: TaskPriority; tag?: string; search?: string; includeDone?: boolean } & PeopleFilters;

/** Condizione Prisma per "il task ha esattamente questo tag" (tags e' CSV senza spazi). */
function tagWhere(tag: string) {
  return {
    OR: [{ tags: tag }, { tags: { startsWith: `${tag},` } }, { tags: { endsWith: `,${tag}` } }, { tags: { contains: `,${tag},` } }],
  };
}

async function boardWhere(base: any, filters: BoardFilters, projectIds: string[] | undefined) {
  const where: any = { ...base };
  if (filters.priority) where.priority = filters.priority;
  applyPeopleFilters(where, filters);
  if (filters.search?.trim()) where.AND = [await searchWhere(filters.search, projectIds)];
  return where;
}

/**
 * Costruisce la board. Con `includeDone: false` i task completati non vengono
 * caricati (crescono senza limite col tempo): la colonna done resta vuota e
 * l'archivio si legge a pagine con listDoneTasks.
 */
async function buildBoard(where: any, include: any, customKeys: string[], filters: BoardFilters) {
  const includeDone = filters.includeDone !== false;
  let tasks = await prisma.task.findMany({
    where: includeDone ? where : { ...where, status: { not: "done" } },
    orderBy: [{ status: "asc" }, { position: "asc" }],
    include,
  });
  if (filters.tag) tasks = tasks.filter((t: any) => tagsToArray(t.tags).includes(filters.tag as string));

  const ids = tasks.map((t: any) => t.id);
  // In serie: su D1 le query passano comunque una alla volta.
  const blockedMap = await computeBlockedByOpenCount(ids);
  const subtaskMap = await computeSubtaskCounts(ids);

  const board = emptyBoard(customKeys);
  for (const t of tasks) {
    const serialized = serializeTask(t);
    serialized.blockedByOpenCount = blockedMap.get(t.id) ?? 0;
    applySubtaskCounts(serialized, subtaskMap.get(t.id));
    board[t.status]?.push(serialized);
  }
  return board;
}

export async function getBoard(projectId: string, filters: BoardFilters = {}) {
  await getProjectOrThrow(projectId);
  const customKeys = await listCustomStatusKeys([projectId]);
  return buildBoard(await boardWhere({ projectId }, filters, [projectId]), TASK_INCLUDE, customKeys, filters);
}

export async function getAggregatedBoard(projectIds: string[] | undefined, filters: BoardFilters = {}) {
  const customKeys = await listCustomStatusKeys(projectIds);
  const where = await boardWhere(
    { project: projectIds ? { id: { in: projectIds } } : { archived: false } },
    filters,
    projectIds,
  );
  return buildBoard(where, { project: true, ...TASK_INCLUDE }, customKeys, filters);
}

export interface DoneTasksQuery {
  /** Progetti consentiti; undefined = tutti i progetti attivi (solo admin). */
  projectIds?: string[];
  /** Ricerca del filtro della board (titolo o descrizione). */
  search?: string;
  /** Ricerca dell'archivio (titolo o nome del progetto). */
  q?: string;
  tag?: string;
  /** Id assegnatario, oppure "none" per i non assegnati. */
  assigneeId?: string;
  priorities?: TaskPriority[];
  /** Senza, solo i task di primo livello (come sulla board). */
  includeSubtasks?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Archivio dei task completati, dal piu' recente, a pagine. `total` conta
 * tutti i task che rispettano i filtri (badge del pulsante Done).
 */
export async function listDoneTasks(query: DoneTasksQuery) {
  const and: any[] = [];
  const where: any = {
    status: "done",
    project: query.projectIds ? { id: { in: query.projectIds } } : { archived: false },
    AND: and,
  };
  if (!query.includeSubtasks) where.parentId = null;
  if (query.assigneeId) where.assigneeId = query.assigneeId === "none" ? null : query.assigneeId;
  if (query.priorities && query.priorities.length > 0) where.priority = { in: query.priorities };
  if (query.tag) and.push(tagWhere(query.tag));
  if (query.search?.trim()) and.push(await searchWhere(query.search, query.projectIds));
  if (query.q?.trim()) {
    // Ripiego testuale dell'archivio: titolo o nome del progetto.
    and.push(
      await searchWhere(query.q, query.projectIds, (q) => ({
        OR: [{ title: { contains: q } }, { project: { name: { contains: q } } }],
      })),
    );
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 0), 200);
  const total = await prisma.task.count({ where });
  const rows =
    limit === 0
      ? []
      : await prisma.task.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          include: { project: true, ...TASK_INCLUDE },
          skip: Math.max(query.offset ?? 0, 0),
          take: limit,
        });
  return { total, tasks: rows.map((t) => serializeTask(t)) };
}

/**
 * Crea piu' sotto-task di `parentId` in un'unica chiamata (il "gruppo di
 * task" discusso: una epic grande diventa un parent + N subtasks create in
 * blocco invece che una per una). Tutto o niente: se una sola riga fallisce
 * la validazione, non viene creato nulla.
 */
export async function createSubtasks(
  projectId: string,
  parentId: string,
  inputs: TaskInput[],
  actor: Actor = SYSTEM_ACTOR,
) {
  await validateParent(projectId, parentId);
  if (inputs.length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "Serve almeno una sotto-task da creare");
  }
  for (const input of inputs) {
    if (!input.title || input.title.trim().length === 0 || input.title.length > 300) {
      throw new ApiErrorException("VALIDATION_ERROR", "title deve avere tra 1 e 300 caratteri");
    }
    validateComplexity(input.complexity);
  }
  const assigneeIds = new Set(inputs.map((i) => i.assigneeId).filter((id): id is string => !!id));
  for (const assigneeId of assigneeIds) await validateAssignee(projectId, assigneeId);

  const maxPosition = await prisma.task.aggregate({
    where: { projectId, status: "draft" },
    _max: { position: true },
  });
  let nextPosition = (maxPosition._max.position ?? -1) + 1;

  const created = await prisma.$transaction(
    inputs.map((input) =>
      prisma.task.create({
        data: {
          projectId,
          parentId,
          title: input.title,
          description: input.description ?? "",
          type: input.type ?? "feature",
          priority: input.priority ?? "medium",
          complexity: input.complexity ?? null,
          tags: tagsToCsv(input.tags) ?? "",
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          position: nextPosition++,
          assigneeId: input.assigneeId ?? null,
          ownerId: actorUserId(actor),
        },
        include: TASK_INCLUDE,
      })
    )
  );

  // Sequenziale: su D1 l'accesso Prisma e' serializzato (vedi cf/db.ts) e il
  // numero di sotto-task per chiamata e' comunque piccolo.
  for (const task of created) {
    await emitEvent({
      projectId,
      taskId: task.id,
      type: "task.created",
      actor,
      recipientId: notifyAssignee(task.assigneeId, actor),
      data: { title: task.title, parentId },
    });
  }
  scheduleTaskIndex(created.map((t) => t.id));

  return created.map(serializeTask);
}

// ---------------------------------------------------------------------------
// Dipendenze
// ---------------------------------------------------------------------------

export async function addDependency(taskId: string, blockedByTaskId: string, actor: Actor = SYSTEM_ACTOR) {
  if (taskId === blockedByTaskId) {
    throw new ApiErrorException("VALIDATION_ERROR", "Un task non può bloccare se stesso");
  }
  const [task, blockedByTask] = await Promise.all([getTaskOrThrow(taskId), getTaskOrThrow(blockedByTaskId)]);

  // Rileva cicli diretti E indiretti: se da blockedByTaskId, seguendo la
  // catena "e' bloccato da", si puo' raggiungere taskId, allora aggiungere
  // taskId -> blockedByTaskId creerebbe un ciclo.
  const wouldCreateCycle = await canReach(blockedByTaskId, taskId);
  if (wouldCreateCycle) {
    throw new ApiErrorException("CIRCULAR_DEPENDENCY", "Questa dipendenza creerebbe un ciclo tra i task");
  }

  const existing = await prisma.taskDependency.findUnique({
    where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } },
  });
  if (existing) return existing;

  const dependency = await prisma.taskDependency.create({ data: { taskId, blockedByTaskId } });

  await emitEvent({
    projectId: task.projectId,
    taskId,
    type: "dependency.added",
    actor,
    data: { title: task.title, relatedTaskId: blockedByTaskId, relatedTaskTitle: blockedByTask.title },
  });

  return dependency;
}

/**
 * Verifica se, partendo da `fromTaskId` e seguendo le dipendenze
 * "e' bloccato da" (taskId -> blockedByTaskId), si puo' raggiungere `targetTaskId`.
 * Usata per rilevare cicli indiretti prima di inserire una nuova dipendenza.
 */
async function canReach(fromTaskId: string, targetTaskId: string): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [fromTaskId];
  while (frontier.length > 0) {
    if (frontier.includes(targetTaskId)) return true;
    frontier.forEach((id) => visited.add(id));
    const deps = await prisma.taskDependency.findMany({
      where: { taskId: { in: frontier } },
      select: { blockedByTaskId: true },
    });
    frontier = deps.map((d) => d.blockedByTaskId).filter((id) => !visited.has(id));
  }
  return false;
}

export async function removeDependency(taskId: string, blockedByTaskId: string, actor: Actor = SYSTEM_ACTOR) {
  const existing = await prisma.taskDependency.findUnique({
    where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } },
    include: { task: true, blockedByTask: true },
  });
  if (!existing) throw new ApiErrorException("NOT_FOUND", "Dipendenza non trovata");
  await prisma.taskDependency.delete({ where: { taskId_blockedByTaskId: { taskId, blockedByTaskId } } });

  await emitEvent({
    projectId: existing.task.projectId,
    taskId,
    type: "dependency.removed",
    actor,
    data: {
      title: existing.task.title,
      relatedTaskId: blockedByTaskId,
      relatedTaskTitle: existing.blockedByTask.title,
    },
  });

  return { deleted: true as const };
}

export async function listBlockers(taskId: string) {
  await getTaskOrThrow(taskId);
  const deps = await prisma.taskDependency.findMany({
    where: { taskId },
    include: { blockedByTask: { include: TASK_INCLUDE } },
  });
  const blockers = deps.map((d) => serializeTask(d.blockedByTask));
  const allResolved = blockers.every((b) => b.status === "done");
  return { blockers, allResolved };
}

// ---------------------------------------------------------------------------
// Commenti
// ---------------------------------------------------------------------------

export async function addComment(taskId: string, body: string, actor: Actor = SYSTEM_ACTOR) {
  const task = await getTaskOrThrow(taskId);
  if (!body || body.trim().length === 0) {
    throw new ApiErrorException("VALIDATION_ERROR", "body del commento non può essere vuoto");
  }
  const comment = await prisma.comment.create({ data: { taskId, body } });

  await emitEvent({
    projectId: task.projectId,
    taskId: task.id,
    type: "comment.created",
    actor,
    recipientId: notifyAssignee(task.assigneeId, actor),
    data: { title: task.title, excerpt: body.slice(0, 200) },
  });

  return comment;
}

export async function listComments(taskId: string) {
  await getTaskOrThrow(taskId);
  return prisma.comment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
}
