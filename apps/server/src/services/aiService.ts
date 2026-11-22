import {
  AI_MAX_REJECTS,
  AI_RUN_TTL_MS,
  AI_STEP_STATUS,
  AI_STEP_TARGET,
  ApiErrorException,
  normalizeAiSteps,
  type AiStep,
  type TaskPriority,
} from "@my-planner/core";
import { prisma } from "../lib/prisma.js";
import { emitEvent } from "./activityService.js";
import { addComment, computeBlockedByOpenCount, getTask, moveTask } from "./taskService.js";
import type { Actor } from "./notificationService.js";

/**
 * Esecuzione dei passi AI di un task (tool MCP ai_*). Il server decide le
 * transizioni, non l'agente:
 *  - triage:   Draft   -> TODO
 *  - coder:    TODO    -> Testing   (solo task senza blocchi aperti)
 *  - reviewer: Testing -> Done, oppure di nuovo TODO (rimando, al massimo
 *              AI_MAX_REJECTS giri, poi il percorso si ferma)
 * Un passo preso in carico blocca il task per AI_RUN_TTL_MS, cosi' due
 * agenti non lavorano lo stesso task. Un percorso fermato (fallimento) resta
 * fermo finche' un admin non salva di nuovo la gestione AI o un utente sposta
 * il task.
 */

const STEP_LABEL: Record<AiStep, string> = { triage: "Triage", coder: "Coder", reviewer: "Reviewer" };
const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const MAX_TEXT = 20_000;

type AiTaskRow = NonNullable<Awaited<ReturnType<typeof loadTask>>>;

async function loadTask(taskId: string) {
  return prisma.task.findUnique({ where: { id: taskId } });
}

function stepsOf(task: AiTaskRow): AiStep[] {
  return normalizeAiSteps(task.aiSteps.split(","));
}

function isRunFresh(task: AiTaskRow, now = Date.now()) {
  return Boolean(task.aiRunStep && task.aiRunStartedAt && now - task.aiRunStartedAt.getTime() < AI_RUN_TTL_MS);
}

/** Passo che parte dalla colonna corrente, se scelto (ignora blocco e fallimento). */
function stepForStatus(task: AiTaskRow): AiStep | null {
  return stepsOf(task).find((s) => AI_STEP_STATUS[s] === task.status) ?? null;
}

function assertAiEnabled(task: AiTaskRow | null): asserts task is AiTaskRow {
  if (!task) throw new ApiErrorException("NOT_FOUND", "Task non trovato");
  if (!task.aiEnabled) throw new ApiErrorException("VALIDATION_ERROR", "Il task non e' gestito da AI");
}

function cleanText(value: string, field: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new ApiErrorException("VALIDATION_ERROR", `${field} obbligatorio`);
  return text.slice(0, MAX_TEXT);
}

/** Destinatario della notifica di fallimento: l'admin che segue l'AI, se vuole avvisi e non e' l'autore. */
function watcherRecipient(task: AiTaskRow, actor: Actor): string | null {
  if (!task.aiWatcherId || task.aiNotify === "none") return null;
  if (actor.type === "user" && actor.id === task.aiWatcherId) return null;
  return task.aiWatcherId;
}

export interface AiQueueItem {
  taskId: string;
  projectId: string;
  projectName: string;
  /** Repository GitHub del progetto (dove lavorano coder e reviewer), se impostato. */
  repoUrl: string | null;
  title: string;
  status: string;
  step: AiStep;
  priority: TaskPriority;
  type: string;
  rejectCount: number;
}

/**
 * Coda di lavoro: task AI con un passo in attesa (non fermati, non presi in
 * carico da un altro agente, coder solo senza blocchi aperti), dal piu'
 * urgente. `projectIds` undefined = tutti i progetti non archiviati.
 */
export async function listAiQueue(projectIds: string[] | undefined, step?: AiStep): Promise<AiQueueItem[]> {
  const statuses = step ? [AI_STEP_STATUS[step]] : ["draft", "todo", "testing"];
  const tasks = await prisma.task.findMany({
    where: {
      aiEnabled: true,
      aiFailedAt: null,
      status: { in: statuses },
      project: projectIds ? { id: { in: projectIds }, archived: false } : { archived: false },
    },
    include: { project: { select: { name: true, repoUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  const now = Date.now();
  const candidates = tasks
    .filter((t) => !isRunFresh(t, now))
    .map((t) => ({ task: t, step: stepForStatus(t) }))
    .filter((c): c is { task: (typeof tasks)[number]; step: AiStep } => c.step !== null && (!step || c.step === step));

  const blocked = await computeBlockedByOpenCount(candidates.filter((c) => c.step === "coder").map((c) => c.task.id));
  return candidates
    .filter((c) => c.step !== "coder" || (blocked.get(c.task.id) ?? 0) === 0)
    .sort((a, b) => PRIORITY_ORDER[a.task.priority as TaskPriority] - PRIORITY_ORDER[b.task.priority as TaskPriority])
    .map(({ task, step }) => ({
      taskId: task.id,
      projectId: task.projectId,
      projectName: task.project.name,
      repoUrl: task.project.repoUrl ?? null,
      title: task.title,
      status: task.status,
      step,
      priority: task.priority as TaskPriority,
      type: task.type,
      rejectCount: task.aiRejectCount,
    }));
}

/** Prende in carico il passo in attesa del task (blocco per AI_RUN_TTL_MS). */
export async function startAiStep(taskId: string, actor: Actor, expectedStep?: AiStep) {
  const task = await loadTask(taskId);
  assertAiEnabled(task);
  if (task.aiFailedAt) {
    throw new ApiErrorException("CONFLICT", `Percorso AI fermato: ${task.aiFailReason ?? ""}`.trim());
  }
  if (isRunFresh(task)) {
    throw new ApiErrorException("CONFLICT", `Passo ${task.aiRunStep} gia' in corso su questo task`);
  }
  const step = stepForStatus(task);
  if (!step) throw new ApiErrorException("VALIDATION_ERROR", "Nessun passo AI in attesa nella colonna corrente");
  if (expectedStep && expectedStep !== step) {
    throw new ApiErrorException("VALIDATION_ERROR", `Il passo in attesa e' ${step}, non ${expectedStep}`);
  }
  if (step === "coder") {
    const blocked = (await computeBlockedByOpenCount([taskId])).get(taskId) ?? 0;
    if (blocked > 0) throw new ApiErrorException("DEPENDENCY_BLOCKED", `Task bloccato da ${blocked} task non completati`);
  }

  await prisma.task.update({ where: { id: taskId }, data: { aiRunStep: step, aiRunStartedAt: new Date() } });
  await emitEvent({
    projectId: task.projectId,
    taskId,
    type: "ai.step_started",
    actor,
    data: { title: task.title, parentId: task.parentId, aiStep: step },
  });
  return getTask(taskId);
}

/** Passo su cui l'agente sta lavorando: quello preso in carico, o quello in attesa se non lo ha preso. */
function currentStep(task: AiTaskRow): AiStep {
  const running = task.aiRunStep as AiStep | null;
  const step = running && stepsOf(task).includes(running) ? running : stepForStatus(task);
  if (!step) throw new ApiErrorException("VALIDATION_ERROR", "Nessun passo AI in corso o in attesa su questo task");
  if (AI_STEP_STATUS[step] !== task.status) {
    throw new ApiErrorException(
      "CONFLICT",
      `Il task non e' piu' nella colonna del passo ${step} (ora e' in ${task.status}): ricomincia da list_ai_tasks`,
    );
  }
  if (task.aiFailedAt) throw new ApiErrorException("CONFLICT", "Percorso AI fermato: riprendilo prima di continuare");
  return step;
}

/** Chiude il passo con successo: commento col riepilogo e spostamento alla colonna successiva. */
export async function completeAiStep(taskId: string, summary: string, actor: Actor) {
  const task = await loadTask(taskId);
  assertAiEnabled(task);
  const step = currentStep(task);
  const text = cleanText(summary, "summary");

  await addComment(taskId, `**🤖 ${STEP_LABEL[step]} completato**\n\n${text}`, actor);
  await prisma.task.update({
    where: { id: taskId },
    data: { aiRunStep: null, aiRunStartedAt: null, ...(step === "reviewer" ? { aiRejectCount: 0 } : {}) },
  });
  await moveTask(taskId, AI_STEP_TARGET[step], undefined, actor);
  return getTask(taskId);
}

/** Il reviewer rimanda in TODO; dopo AI_MAX_REJECTS rimandi il percorso si ferma. */
export async function rejectAiStep(taskId: string, reason: string, actor: Actor) {
  const task = await loadTask(taskId);
  assertAiEnabled(task);
  const step = currentStep(task);
  if (step !== "reviewer") throw new ApiErrorException("VALIDATION_ERROR", "Solo il passo reviewer puo' rimandare il task");
  const text = cleanText(reason, "reason");
  const count = task.aiRejectCount + 1;
  const stop = count >= AI_MAX_REJECTS;

  await addComment(taskId, `**🤖 Review: rimandato in TODO** (giro ${count}/${AI_MAX_REJECTS})\n\n${text}`, actor);
  await prisma.task.update({
    where: { id: taskId },
    data: { aiRunStep: null, aiRunStartedAt: null, aiRejectCount: count },
  });
  await moveTask(taskId, "todo", undefined, actor);

  if (stop) {
    await markFailed(task, "reviewer", `Rimandato ${count} volte dal reviewer. Ultimo motivo: ${text}`, actor);
  }
  return getTask(taskId);
}

/** Il passo non si puo' completare: il task resta dov'e', il percorso si ferma e l'admin viene avvisato. */
export async function failAiStep(taskId: string, reason: string, actor: Actor) {
  const task = await loadTask(taskId);
  assertAiEnabled(task);
  const step = ((task.aiRunStep as AiStep | null) ?? stepForStatus(task)) || null;
  const text = cleanText(reason, "reason");
  await addComment(taskId, `**🤖 ${step ? STEP_LABEL[step] : "AI"}: passo non completato**\n\n${text}`, actor);
  await markFailed(task, step, text, actor);
  return getTask(taskId);
}

async function markFailed(task: AiTaskRow, step: AiStep | null, reason: string, actor: Actor) {
  await prisma.task.update({
    where: { id: task.id },
    data: { aiFailedAt: new Date(), aiFailReason: reason.slice(0, 2000), aiRunStep: null, aiRunStartedAt: null },
  });
  await emitEvent({
    projectId: task.projectId,
    taskId: task.id,
    type: "ai.failed",
    actor,
    recipientId: watcherRecipient(task, actor),
    data: { title: task.title, parentId: task.parentId, excerpt: reason.slice(0, 300), ...(step ? { aiStep: step } : {}) },
  });
}
